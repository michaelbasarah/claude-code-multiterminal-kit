#!/usr/bin/env node
/**
 * verify-effects: check what a deploy actually DID, not what it delivered.
 *
 * `git log` proves exactly one thing: that app code baked into the container image reached the box.
 * Every other layer has its own boundary where a green merge, a matching commit sha and a 200 from
 * /health can all be true while the feature has never executed once: an edge-proxy config pinned to
 * an old inode, a flag that defaults to off, a separately deployed frontend, a secret nobody placed.
 * This script turns that checklist into one command driven by a config table.
 *
 *   | Layer                  | git log proves it? | checked here by                              |
 *   |------------------------|--------------------|----------------------------------------------|
 *   | App code (in image)    | yes                | checkout HEAD == origin default (ls-remote)  |
 *   | Edge / bind-mounted cfg| NO                 | request the public edge, assert real headers |
 *   | Env-gated flags        | NO                 | boot-log status "on" + env key present       |
 *   | Separate web deploy    | NO                 | fetch the live page                          |
 *   | Hand-placed secrets    | NO                 | the file exists on the box (name only)       |
 *
 * Read-only by construction: every remote command is a read (`git rev-parse`, `compose ps`, `logs`,
 * `grep -o` over env KEY NAMES only). Values are never fetched, printed or logged.
 *
 *   node verify-effects/verify-effects.mjs --config effects.config.json
 *   node verify-effects/verify-effects.mjs --target staging
 *   node verify-effects/verify-effects.mjs --expect-on reminder_sweep,digest_sweep
 *
 * Exit: 0 = every check passed or was skipped, 1 = at least one FAIL, 2 = bad usage/config. A flag
 * that is off is DARK (informational: dark is the shipped default) and only FAILs when named in
 * --expect-on, which turns "we enabled it" into a claim the machine can refuse.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig } from "../lib/env.mjs";
import { loadConfigFile, parseArgs, parseFlagLog, headerProblems, parseEnvKeys } from "./lib.mjs";

const execFileP = promisify(execFile);

const mk = (status) => (name, layer, detail) => ({ name, layer, status, detail });
const ok = mk("PASS"), fail = mk("FAIL"), info = mk("INFO"), dark = mk("DARK"), skip = mk("SKIP");

/** Run one command over ssh. Read-only by contract: never pass a mutating command here. */
async function ssh(host, command, { timeout = 30_000 } = {}) {
  const { stdout } = await execFileP("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, command], {
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

async function fetchPage(url, { timeout = 15_000, redirect = "manual" } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    // GET, not HEAD: some routes 405 a HEAD and you would assert headers on an error page. Redirects
    // are NOT followed by default: the headers must be on the response a browser gets first.
    const res = await fetch(url, { signal: ctl.signal, redirect });
    const headers = {};
    for (const [k, v] of res.headers) headers[k] = v;
    return { status: res.status, headers, body: await res.text().catch(() => "") };
  } finally {
    clearTimeout(timer);
  }
}

async function checkAppLayer(t, { localRef }) {
  const results = [];
  const head = (await ssh(t.ssh, `git -C ${t.checkout} rev-parse HEAD`)).trim();
  const branch = (await ssh(t.ssh, `git -C ${t.checkout} rev-parse --abbrev-ref HEAD`)).trim();
  if (t.tracksDefaultBranch && localRef) {
    results.push(
      head.startsWith(localRef) || localRef.startsWith(head)
        ? ok("checkout HEAD", "app code", `${head.slice(0, 7)} == origin/${t.defaultBranch}`)
        : fail("checkout HEAD", "app code", `box ${head.slice(0, 7)} (${branch}) != origin/${t.defaultBranch} ${localRef.slice(0, 7)}: DEPLOY DRIFT`),
    );
  } else {
    results.push(info("checkout HEAD", "app code", `${head.slice(0, 7)} on ${branch}`));
  }
  const ps = (await ssh(t.ssh, `cd ${t.appDir} && ${t.compose} ps --format '{{.Name}} {{.Status}}'`)).trim();
  const line = ps.split("\n").find((l) => l.includes(t.service)) || "";
  results.push(/\bUp\b/.test(line) ? ok("container", "app code", line.trim()) : fail("container", "app code", line.trim() || `${t.service} not running`));
  return results;
}

async function checkEdgeLayer(t, edge) {
  const url = `https://${t.domain}${edge.path}`;
  let res;
  try {
    res = await fetchPage(url);
  } catch (err) {
    return [fail("edge reachable", "edge", `${url}: ${err?.message || err}`)];
  }
  const results = [
    res.status > 0 && res.status < 500 ? ok("edge reachable", "edge", `${url} -> ${res.status}`) : fail("edge reachable", "edge", `${url} -> ${res.status}`),
  ];
  const problems = headerProblems(res.headers, edge.requiredHeaders, edge.forbiddenHeaders);
  results.push(
    problems.length === 0
      ? ok("headers", "edge", `${Object.keys(edge.requiredHeaders).length} required present, none forbidden`)
      : fail("headers", "edge", problems.join("; ")),
  );
  if (edge.healthPath) {
    try {
      const health = await fetchPage(`https://${t.domain}${edge.healthPath}`);
      results.push(health.status === 200 ? ok(edge.healthPath, "edge", "200") : fail(edge.healthPath, "edge", `${health.status}`));
    } catch (err) {
      results.push(fail(edge.healthPath, "edge", err?.message || String(err)));
    }
  }
  return results;
}

/**
 * Env-gated flags. The status line the app prints once per boot is the only honest signal that a
 * feature is scheduled; the merge that added it proves nothing. Read the boot log from the
 * container's start, then cross-check which gate keys exist in the env file at all (a missing key
 * silently falls to its default, usually off).
 */
async function checkFlagLayer(t, flags, { expectOn, sinceHours }) {
  if (flags.items.length === 0) return [];
  const results = [];
  let since = sinceHours ? `${sinceHours}h` : "72h";
  let window = sinceHours ? `the last ${sinceHours}h` : "the last 72h";
  if (!sinceHours) {
    try {
      const startedAt = (await ssh(t.ssh, `docker inspect -f '{{.State.StartedAt}}' $(cd ${t.appDir} && ${t.compose} ps -q ${t.service})`)).trim();
      if (Date.parse(startedAt)) {
        since = new Date(Date.parse(startedAt) - 1000).toISOString();
        window = `this container's boot (started ${startedAt})`;
      }
    } catch { /* keep the 72h fallback */ }
  }
  let logText = "";
  try {
    logText = await ssh(t.ssh, `cd ${t.appDir} && ${t.compose} logs ${t.service} --since ${since} 2>&1 | grep -a ${flags.eventSuffix} || true`, { timeout: 60_000 });
  } catch (err) {
    return [fail("flag log", "flags", err?.message || String(err))];
  }
  const seen = parseFlagLog(logText, flags.eventSuffix);
  if (Object.keys(seen).length === 0) {
    results.push(fail("flag log", "flags", `no *${flags.eventSuffix} status line within ${window}: says nothing about what is scheduled. Widen with --since-hours, or restart the container to re-emit.`));
  }
  for (const { name } of flags.items) {
    const rec = seen[name];
    const expected = expectOn.has(name);
    if (!rec) results.push(expected ? fail(name, "flags", "no status line in window") : skip(name, "flags", "no status line in window"));
    else if (rec.on) results.push(ok(name, "flags", `on${rec.everyMinutes ? `, every ${rec.everyMinutes}m` : ""}`));
    else if (expected) results.push(fail(name, "flags", `expected on, got ${rec.status}`));
    else results.push(dark(name, "flags", rec.status));
  }
  const keyed = flags.items.filter((i) => i.envKey);
  if (keyed.length) {
    try {
      const keys = parseEnvKeys(await ssh(t.ssh, `grep -oE '^[A-Z0-9_]+=' ${t.appDir}/${t.envFile} | sort -u`));
      const missing = keyed.filter((i) => !keys.has(i.envKey)).map((i) => i.envKey);
      const present = keyed.filter((i) => keys.has(i.envKey)).map((i) => i.envKey);
      const missingExpected = keyed.filter((i) => expectOn.has(i.name) && !keys.has(i.envKey)).map((i) => i.envKey);
      results.push(
        missingExpected.length
          ? fail("flag env keys", "flags", `absent (default applies): ${missingExpected.join(", ")}`)
          : info("flag env keys", "flags", `set: ${present.join(", ") || "none"} | absent (default applies): ${missing.join(", ") || "none"}`),
      );
    } catch (err) {
      results.push(fail("flag env keys", "flags", err?.message || String(err)));
    }
  }
  return results;
}

async function checkWebLayer(web) {
  if (!web) return [];
  try {
    // Follow redirects: a site may legitimately redirect some routes. What matters is that a real
    // page is SERVED by the separate deploy pipeline, not which hop serves it.
    const res = await fetchPage(web.url, { redirect: "follow" });
    if (res.status !== 200) return [fail("web site", "web", `${web.url} -> ${res.status}`)];
    const titled = /<title[^>]*>([^<]*)</i.exec(res.body)?.[1]?.trim() || "(no <title>)";
    return [ok("web site", "web", `200 | ${titled.slice(0, 60)}`)];
  } catch (err) {
    return [fail("web site", "web", err?.message || String(err))];
  }
}

/** Secrets placed by hand (never in git, never in the image). Names only, never contents. */
async function checkSecretsLayer(t) {
  try {
    const out = await ssh(t.ssh, `ls -1 ${t.appDir}/${t.secretsDir} 2>/dev/null || true`);
    const names = out.split("\n").map((s) => s.trim()).filter(Boolean);
    return [names.length ? info("secrets dir", "secrets", names.join(", ")) : dark("secrets dir", "secrets", "empty or absent: anything gated on a hand-placed secret has never run")];
  } catch (err) {
    return [fail("secrets dir", "secrets", err?.message || String(err))];
  }
}

const ICON = { PASS: "PASS", FAIL: "FAIL", DARK: "DARK", INFO: "INFO", SKIP: "SKIP" };

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("verify-effects [--config file] [--target name] [--expect-on a,b] [--since-hours N] [--no-ssh] [--json]");
    return;
  }
  let cfg, args;
  try {
    const i = argv.indexOf("--config");
    const file = (i >= 0 && argv[i + 1]) || loadConfig().EFFECTS_CONFIG || "effects.config.json";
    cfg = loadConfigFile(file);
    args = parseArgs(argv, { flagNames: cfg.flags.items.map((f) => f.name), targetNames: Object.keys(cfg.targets) });
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exitCode = 2;
    return;
  }

  const t = cfg.targets[args.target];
  let localRef = null;
  if (t.tracksDefaultBranch) {
    try {
      // Ask the REMOTE, not a local ref: a local origin/main goes stale the moment a PR is
      // squash-merged server-side. ls-remote reads without touching local refs.
      const out = (await execFileP("git", ["ls-remote", "origin", `refs/heads/${t.defaultBranch}`])).stdout.trim();
      localRef = out.split(/\s+/)[0] || null;
    } catch { /* not in a repo / no network: the HEAD check degrades to INFO */ }
  }

  const results = [...(await checkEdgeLayer(t, cfg.edge)), ...(await checkWebLayer(cfg.web))];
  if (args.ssh) {
    for (const run of [(x, o) => checkAppLayer(x, o), (x, o) => checkFlagLayer(x, cfg.flags, o), (x) => checkSecretsLayer(x)]) {
      try {
        results.push(...(await run(t, { localRef, expectOn: args.expectOn, sinceHours: args.sinceHours })));
      } catch (err) {
        results.push(fail("ssh layer", "ssh", err?.message || String(err)));
      }
    }
  } else {
    results.push(skip("box checks", "ssh", "--no-ssh: app/flag/secret layers not checked"));
  }

  const failed = results.filter((r) => r.status === "FAIL");
  if (args.json) {
    console.log(JSON.stringify({ target: args.target, checkedAt: new Date().toISOString(), results, failed: failed.length }, null, 2));
  } else {
    console.log(`\n  effect check: ${args.target} (${t.domain})  ${new Date().toISOString()}\n`);
    let layer = null;
    for (const r of results) {
      if (r.layer !== layer) {
        layer = r.layer;
        console.log(`  ${layer}`);
      }
      console.log(`    ${ICON[r.status]}  ${r.name.padEnd(24)} ${r.detail}`);
    }
    const darkCount = results.filter((r) => r.status === "DARK").length;
    console.log(`\n  ${failed.length ? `${failed.length} FAILED` : "all checks passed"}${darkCount ? `  |  ${darkCount} dark (shipped but never executed)` : ""}\n`);
  }
  // exitCode, not exit(): with stdout piped the write is async and exit() can truncate the report.
  process.exitCode = failed.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
