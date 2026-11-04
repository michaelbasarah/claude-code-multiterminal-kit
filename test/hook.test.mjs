import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { shouldRemind, buildOutput } from "../hooks/checkpoint-reminder.mjs";

const RE = "gh pr merge|deploy\\.sh";

test("shouldRemind matches merges and deploys only", () => {
  assert.ok(shouldRemind("gh pr merge 12 --squash", RE));
  assert.ok(shouldRemind("ssh h 'cd /srv && ./deploy.sh'", RE));
  assert.ok(!shouldRemind("git status", RE));
  assert.ok(!shouldRemind("", RE));
});

test("an invalid regex never throws", () => {
  assert.equal(shouldRemind("anything", "(["), false);
});

test("buildOutput shape", () => {
  assert.equal(buildOutput("ls", RE), null);
  const out = buildOutput("gh pr merge 1", RE);
  assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(out.hookSpecificOutput.additionalContext, /\/checkpoint/);
});

test("hook as a process: stdin in, JSON out; garbage in, silence out", () => {
  const env = { ...process.env, MULTITERMINAL_ENV: "/nonexistent", CHECKPOINT_TRIGGER_REGEX: "" };
  const run = (input) => execFileSync("node", ["hooks/checkpoint-reminder.mjs"], { input, env, encoding: "utf8" });
  const hit = run(JSON.stringify({ tool_input: { command: "gh pr merge 3" } }));
  assert.match(JSON.parse(hit).hookSpecificOutput.additionalContext, /checkpoint/);
  assert.equal(run(JSON.stringify({ tool_input: { command: "ls" } })), "");
  assert.equal(run("not json"), "");
});
