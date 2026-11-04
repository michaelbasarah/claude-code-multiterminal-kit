import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateConfig, loadConfigFile, parseFlagLog, headerProblems, parseEnvKeys, parseArgs } from "../verify-effects/lib.mjs";

const example = JSON.parse(readFileSync(new URL("../verify-effects/effects.config.example.json", import.meta.url), "utf8"));

test("the shipped example config validates and gets defaults", () => {
  const cfg = validateConfig(example);
  assert.deepEqual(Object.keys(cfg.targets), ["prod", "staging"]);
  assert.equal(cfg.targets.staging.defaultBranch, "main");
  assert.equal(cfg.flags.eventSuffix, "_sweep");
  assert.equal(cfg.web.url, "https://www.example.com/");
});

test("validateConfig lists every problem at once", () => {
  assert.throws(
    () => validateConfig({ targets: { prod: { ssh: "h" } }, flags: { items: [{ name: "a" }, { name: "a" }, { name: "b", envKey: "lower" }] } }),
    (e) => /targets\.prod\.domain/.test(e.message) && /duplicate "a"/.test(e.message) && /envKey/.test(e.message),
  );
  assert.throws(() => validateConfig(null), /at least one target/);
});

test("loadConfigFile reports unreadable and invalid files helpfully", () => {
  assert.throws(() => loadConfigFile("x.json", () => { throw new Error("ENOENT"); }), /cannot read effects config/);
  assert.throws(() => loadConfigFile("x.json", () => "{nope"), /not valid JSON/);
  assert.ok(loadConfigFile("x.json", () => JSON.stringify(example)).targets.prod);
});

test("parseFlagLog reads JSON and dev lines; last boot wins", () => {
  const log = [
    `app | {"event":"digest_sweep","status":"off (DIGEST_SWEEP_MINUTES=0)"}`,
    `app | {"event":"digest_sweep","status":"on","everyMinutes":720}`,
    `app | cleanup_sweep | status=off (CLEANUP_SWEEP_MINUTES=0) everyMinutes=0`,
    `app | reminder_sweep | status=on everyMinutes=15`,
    `unrelated line`,
  ].join("\n");
  const seen = parseFlagLog(log, "_sweep");
  assert.equal(seen.digest_sweep.on, true);
  assert.equal(seen.digest_sweep.everyMinutes, 720);
  assert.equal(seen.cleanup_sweep.on, false);
  assert.equal(seen.cleanup_sweep.status, "off (CLEANUP_SWEEP_MINUTES=0)");
  assert.equal(seen.reminder_sweep.everyMinutes, 15);
});

test("parseFlagLog ignores events without the suffix and empty input", () => {
  assert.deepEqual(parseFlagLog(`{"event":"boot","status":"on"}`, "_sweep"), {});
  assert.deepEqual(parseFlagLog("", "_sweep"), {});
});

test("headerProblems: missing, wrong, forbidden, case-insensitive", () => {
  const req = { "X-Frame-Options": "DENY", "x-content-type-options": "nosniff" };
  assert.deepEqual(headerProblems({ "x-frame-options": "deny", "X-Content-Type-Options": " nosniff " }, req), []);
  const p = headerProblems({ "x-frame-options": "SAMEORIGIN", "x-powered-by": "Express" }, req);
  assert.equal(p.length, 3);
  assert.ok(p.some((x) => /MISSING/.test(x)) && p.some((x) => /leaked/.test(x)));
});

test("parseEnvKeys keeps names only", () => {
  assert.deepEqual([...parseEnvKeys("A_B=\nC=\nnot a key\n \nlower=\n")].sort(), ["A_B", "C"]);
});

test("parseArgs: --expect-on is strict", () => {
  const ctx = { flagNames: ["a_sweep", "b_sweep"], targetNames: ["prod", "staging"] };
  const a = parseArgs(["--target", "staging", "--expect-on", "a_sweep,b_sweep", "--since-hours", "6", "--json"], ctx);
  assert.equal(a.target, "staging");
  assert.deepEqual([...a.expectOn], ["a_sweep", "b_sweep"]);
  assert.equal(a.sinceHours, 6);
  assert.throws(() => parseArgs(["--expect-on", "typo"], ctx), /unknown flag "typo"/);
  assert.throws(() => parseArgs(["--expect-on", "a_sweep", "--no-ssh"], ctx), /needs the box/);
  assert.throws(() => parseArgs(["--target", "dev"], ctx), /unknown --target/);
  assert.throws(() => parseArgs(["--since-hours", "0"], ctx), /positive/);
  assert.throws(() => parseArgs(["--wat"], ctx), /unknown argument/);
  assert.equal(parseArgs([], ctx).target, "prod");
});
