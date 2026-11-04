import test from "node:test";
import assert from "node:assert/strict";
import { parseEnv, loadConfig, expandHome, requireKeys, envFilePath } from "../lib/env.mjs";

test("parseEnv handles comments, quotes, export and inline comments", () => {
  const out = parseEnv(`# c\nA=1\nexport B="two words"\nC='x|y'\nD=val # note\n\nbad line\nE=\n`);
  assert.deepEqual(out, { A: "1", B: "two words", C: "x|y", D: "val", E: "" });
});

test("loadConfig: defaults < file < environment; blank file values don't shadow defaults", () => {
  const file = "MAIN_WORKTREE=/from/file\nDEFAULT_BRANCH=\nSTALE_PR_DAYS=5\n";
  const cfg = loadConfig({ env: { STALE_PR_DAYS: "9" }, file: "x", readFile: () => file });
  assert.equal(cfg.MAIN_WORKTREE, "/from/file");
  assert.equal(cfg.DEFAULT_BRANCH, "main");
  assert.equal(cfg.STALE_PR_DAYS, "9");
});

test("loadConfig tolerates a missing env file", () => {
  const cfg = loadConfig({ env: {}, readFile: () => { throw new Error("ENOENT"); } });
  assert.equal(cfg.BRANCH_PREFIX, "feat");
});

test("expandHome and path defaults", () => {
  assert.equal(expandHome("~/x", "/h"), "/h/x");
  assert.equal(expandHome("/abs", "/h"), "/abs");
  assert.equal(envFilePath({}, "/h"), "/h/.config/claude-multiterminal/env");
  assert.equal(envFilePath({ MULTITERMINAL_ENV: "~/e" }, "/h"), "/h/e");
});

test("requireKeys names every missing key", () => {
  assert.throws(() => requireKeys({ A: "1" }, ["A", "B", "C"]), /B, C/);
});
