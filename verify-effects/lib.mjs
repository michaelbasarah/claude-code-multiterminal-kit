// Pure parts of verify-effects: config validation, log/header/env parsers, argv parsing.
// No network, no ssh, no side effects, so all of it is unit-tested offline.
import { readFileSync } from "node:fs";

/**
 * PURE: validate a parsed config object and fill defaults. Throws one Error listing every problem.
 * Shape: see effects.config.example.json.
 */
export function validateConfig(raw) {
  const problems = [];
  const cfg = raw && typeof raw === "object" ? raw : {};
  const targets = cfg.targets;
  if (!targets || typeof targets !== "object" || Object.keys(targets).length === 0) {
    problems.push("targets: need at least one target object");
  } else {
    for (const [name, t] of Object.entries(targets)) {
      for (const key of ["ssh", "domain", "checkout", "appDir", "service"]) {
        if (typeof t?.[key] !== "string" || !t[key]) problems.push(`targets.${name}.${key}: required string`);
      }
    }
  }
  const flags = cfg.flags ?? { items: [] };
  if (!Array.isArray(flags.items)) problems.push("flags.items: must be an array");
  const seen = new Set();
  for (const [i, it] of (flags.items || []).entries()) {
    if (typeof it?.name !== "string" || !it.name) problems.push(`flags.items[${i}].name: required string`);
    else if (seen.has(it.name)) problems.push(`flags.items[${i}].name: duplicate "${it.name}"`);
    else seen.add(it.name);
    if (it?.envKey !== undefined && !/^[A-Z0-9_]+$/.test(String(it.envKey))) {
      problems.push(`flags.items[${i}].envKey: must be an UPPER_SNAKE env key name`);
    }
  }
  const hdr = cfg.edge?.requiredHeaders;
  if (hdr !== undefined && (typeof hdr !== "object" || Array.isArray(hdr))) {
    problems.push("edge.requiredHeaders: must be an object of header -> expected value");
  }
  if (problems.length) throw new Error(`invalid effects config:\n  - ${problems.join("\n  - ")}`);

  const out = {
    targets: {},
    edge: {
      path: cfg.edge?.path ?? "/",
      healthPath: cfg.edge?.healthPath ?? "/health",
      requiredHeaders: cfg.edge?.requiredHeaders ?? {},
      forbiddenHeaders: cfg.edge?.forbiddenHeaders ?? ["x-powered-by"],
    },
    flags: { eventSuffix: flags.eventSuffix ?? "_flag", items: flags.items || [] },
    web: cfg.web?.url ? { url: cfg.web.url } : null,
  };
  for (const [name, t] of Object.entries(targets)) {
    out.targets[name] = {
      compose: "docker compose",
      envFile: ".env",
      secretsDir: "secrets",
      tracksDefaultBranch: false,
      defaultBranch: "main",
      ...t,
    };
  }
  return out;
}

export function loadConfigFile(file, readFile = (f) => readFileSync(f, "utf8")) {
  let text;
  try {
    text = readFile(file);
  } catch (e) {
    throw new Error(`cannot read effects config ${file}: ${e.message}. Copy effects.config.example.json and edit it.`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`effects config ${file} is not valid JSON: ${e.message}`);
  }
  return validateConfig(json);
}

/**
 * PURE: pull the latest reported status of every gated feature out of a container log.
 *
 * The app logs one `<name><suffix>` line per boot, either as JSON
 * (`{"event":"deposit_flag","status":"off (DEPOSIT_FLAG=0)"}`) or as a readable dev line
 * (`deposit_flag | status=on everyMinutes=720`). Both are parsed; the LAST occurrence per event wins,
 * because a log window can span several restarts and only the newest boot describes the process
 * that is running now.
 *
 * @returns {Record<string,{status:string, everyMinutes:?number, on:boolean}>}
 */
export function parseFlagLog(text, suffix = "_flag") {
  const esc = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const devRe = new RegExp(`([a-z0-9_]+${esc})\\s*\\|\\s*(.*)$`);
  const out = {};
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let event, status, everyMinutes;
    const jsonStart = line.indexOf("{");
    if (jsonStart >= 0) {
      try {
        ({ event, status, everyMinutes } = JSON.parse(line.slice(jsonStart)));
      } catch {
        /* not JSON: fall through to the dev-line parser */
      }
    }
    if (!event) {
      const m = line.match(devRe);
      if (!m) continue;
      event = m[1];
      // Dev loggers don't quote values, so an off-status is written bare and contains spaces:
      // `status=off (DEPOSIT_FLAG=0) `. Read to the next `key=` token or end of line, otherwise the
      // part that says WHICH knob to flip is thrown away.
      status = (m[2].match(/status=("[^"]*"|.*?)(?=\s+[A-Za-z][A-Za-z0-9_]*=|$)/)?.[1] || "").replace(/^"|"$/g, "").trim();
      const mins = m[2].match(/everyMinutes=(\d+)/);
      everyMinutes = mins ? Number(mins[1]) : undefined;
    }
    if (typeof event !== "string" || !event.endsWith(suffix) || status === undefined) continue;
    out[event] = {
      status: String(status),
      everyMinutes: Number.isFinite(Number(everyMinutes)) && everyMinutes !== undefined ? Number(everyMinutes) : null,
      on: String(status).startsWith("on"),
    };
  }
  return out;
}

/**
 * PURE: which required headers are missing or wrong on a response, plus any forbidden header that
 * leaked. Names compare case-insensitively; values case-insensitively and whitespace-loosely.
 */
export function headerProblems(headers, required = {}, forbidden = ["x-powered-by"]) {
  const got = new Map();
  for (const [k, v] of Object.entries(headers || {})) {
    if (v === undefined || v === null) continue;
    got.set(k.toLowerCase(), String(v));
  }
  const problems = [];
  for (const [name, want] of Object.entries(required)) {
    const have = got.get(name.toLowerCase());
    if (have === undefined) problems.push(`${name}: MISSING`);
    else if (have.trim().toLowerCase() !== String(want).trim().toLowerCase()) problems.push(`${name}: "${have}" != "${want}"`);
  }
  for (const name of forbidden) {
    if (got.has(name.toLowerCase())) problems.push(`${name} leaked: "${got.get(name.toLowerCase())}"`);
  }
  return problems;
}

/** PURE: the KEY NAMES in an env file dump (`grep -oE '^[A-Z0-9_]+='` output). Values are never read. */
export function parseEnvKeys(text) {
  return new Set(
    String(text || "")
      .split("\n")
      .map((l) => l.trim().replace(/=$/, ""))
      .filter((l) => /^[A-Z0-9_]+$/.test(l)),
  );
}

/**
 * PURE: parse argv. Strict about --expect-on on purpose: it is the one flag whose whole job is to
 * fail. A typo or an unknown name would otherwise be dropped and the run would print "all checks
 * passed". A silent no-op assertion is worse than none, so unknown names are a hard error, and
 * asserting a flag is on while skipping the layer that reads flags (--no-ssh) is refused.
 */
export function parseArgs(argv, { flagNames = [], targetNames = [] } = {}) {
  const args = { target: targetNames[0] ?? "prod", json: false, ssh: true, expectOn: new Set(), sinceHours: null, config: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target") args.target = argv[++i];
    else if (a === "--config") args.config = argv[++i];
    else if (a === "--json") args.json = true;
    else if (a === "--no-ssh") args.ssh = false;
    else if (a === "--expect-on") {
      for (const raw of (argv[++i] || "").split(",").map((x) => x.trim()).filter(Boolean)) {
        if (!flagNames.includes(raw)) throw new Error(`--expect-on: unknown flag "${raw}" (known: ${flagNames.join(", ") || "none configured"})`);
        args.expectOn.add(raw);
      }
    } else if (a === "--since-hours") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) throw new Error("--since-hours wants a positive number of hours");
      args.sinceHours = n;
    } else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (targetNames.length && !targetNames.includes(args.target)) {
    throw new Error(`unknown --target ${args.target} (want: ${targetNames.join(" | ")})`);
  }
  if (args.expectOn.size && !args.ssh) {
    throw new Error("--expect-on needs the box: flag status is read from the container log, which --no-ssh skips");
  }
  return args;
}
