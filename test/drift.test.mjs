import test from "node:test";
import assert from "node:assert/strict";
import { findStalePRs, evaluateDrift, renderReport } from "../tools/drift-check.mjs";

const NOW = Date.parse("2026-01-10T00:00:00Z");
const pr = (n, createdAt) => ({ number: n, title: `t${n}`, createdAt });

test("findStalePRs uses the day threshold", () => {
  const prs = [pr(1, "2026-01-09T12:00:00Z"), pr(2, "2026-01-07T00:00:00Z")];
  assert.deepEqual(findStalePRs(prs, NOW, 2).map((p) => p.number), [2]);
  assert.deepEqual(findStalePRs(undefined, NOW, 2), []);
});

const base = { mainHead: "abc123", prodHead: "abc123", behind: "", health: { "https://a/health": "200" }, stalePRs: [], staleDays: 2, defaultBranch: "main" };

test("in sync = no findings", () => {
  assert.deepEqual(evaluateDrift(base), []);
});

test("prod behind main is reported with the undeployed commits", () => {
  const d = evaluateDrift({ ...base, prodHead: "old999", behind: "abc123 one\ndef456 two" });
  assert.equal(d.length, 1);
  assert.match(d[0], /2 commit\(s\) behind origin\/main/);
  assert.match(d[0], /MERGED BUT NOT DEPLOYED/);
});

test("unreachable prod, bad health, stale PRs and gh failure each add a finding", () => {
  const d = evaluateDrift({
    ...base,
    prodHead: "ERROR: ssh failed",
    health: { "https://a/health": "503" },
    stalePRs: [pr(7, "x")],
    prListError: "ERROR: gh",
  });
  assert.equal(d.length, 4);
});

test("unreadable origin is itself a finding", () => {
  const d = evaluateDrift({ ...base, mainHead: "ERROR: boom" });
  assert.equal(d.length, 1);
  assert.match(d[0], /cannot read origin\/main/);
});

test("no prod configured (null) skips the deploy comparison", () => {
  assert.deepEqual(evaluateDrift({ ...base, prodHead: null }), []);
});

test("renderReport shows verdict and worktrees", () => {
  const ok = renderReport({ now: "N", drift: [], mainHead: "a", prodHead: "a", health: {}, openPRs: [], worktrees: "/r  abc [main]", defaultBranch: "main" });
  assert.match(ok, /\*\*Verdict: IN SYNC\*\*/);
  assert.match(ok, /\/r {2}abc \[main\]/);
  const bad = renderReport({ now: "N", drift: ["x"], mainHead: "a", prodHead: null, health: {}, openPRs: [pr(3, "x")], worktrees: "", defaultBranch: "main" });
  assert.match(bad, /\*\*Verdict: DRIFT\*\*/);
  assert.match(bad, /not checked/);
  assert.match(bad, /#3/);
});
