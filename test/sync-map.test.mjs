import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, statSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateMap, normalizeRel, selectEntries, escapeQuery, buildFindQuery, PLACEHOLDER_FOLDER } from "../md-gdocs-sync/map.mjs";
import { resolvePaths } from "../md-gdocs-sync/config.mjs";

const map = { folderId: "FOLDER1", docs: [{ md: "docs/README.md", title: "A" }, { md: "api/README.md", title: "B" }, { md: "NOTES.md", title: "C" }] };

test("the shipped example map is rejected until the placeholder folder id is replaced", () => {
  const ex = JSON.parse(readFileSync(new URL("../md-gdocs-sync/doc-sync-map.example.json", import.meta.url), "utf8"));
  assert.equal(ex.folderId, PLACEHOLDER_FOLDER);
  assert.throws(() => validateMap(ex), /placeholder/);
  assert.ok(validateMap({ ...ex, folderId: "real" }));
});

test("validateMap reports all problems", () => {
  assert.throws(
    () => validateMap({ folderId: "", docs: [{ md: "x.txt", title: "T" }, { md: "a.md", title: "T" }] }),
    (e) => /folderId/.test(e.message) && /ending in \.md/.test(e.message) && /duplicate "T"/.test(e.message),
  );
  assert.throws(() => validateMap({ folderId: "f", docs: [] }), /at least one/);
});

test("selectEntries matches full relative paths, not basenames", () => {
  assert.deepEqual(selectEntries(map, ["api/README.md"]).map((d) => d.title), ["B"]);
  assert.deepEqual(selectEntries(map, ["./docs/README.md"]).map((d) => d.title), ["A"]);
  assert.deepEqual(selectEntries(map, ["/r/NOTES.md"], "/r").map((d) => d.title), ["C"]);
  assert.deepEqual(selectEntries(map, ["README.md"]), []);
  assert.equal(selectEntries(map, []).length, 3);
});

test("normalizeRel", () => {
  assert.equal(normalizeRel("./a//b.md"), "a/b.md");
  assert.equal(normalizeRel("a\\b.md"), "a/b.md");
});

test("Drive query escaping blocks quote injection", () => {
  assert.equal(escapeQuery("it's"), "it\\'s");
  assert.equal(escapeQuery("a\\b"), "a\\\\b");
  const q = buildFindQuery("F", "x' or name contains '");
  assert.ok(q.includes("name = 'x\\' or name contains \\''"));
  assert.ok(q.includes("application/vnd.google-apps.document"));
});

test("credential paths default outside any repo and honour overrides", () => {
  const d = resolvePaths({}, "/h");
  assert.equal(d.TOKEN_PATH, "/h/.config/md-gdocs-sync/token.json");
  const o = resolvePaths({ MD_GDOCS_SYNC_DIR: "~/creds", GOOGLE_TOKEN_JSON: "/t.json" }, "/h");
  assert.equal(o.CLIENT_PATH, "/h/creds/oauth-client.json");
  assert.equal(o.TOKEN_PATH, "/t.json");
});

test("install-hook.sh: installs, is idempotent, refuses foreign hooks without --force", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "kit-hook-"));
  const script = path.resolve("md-gdocs-sync/install-hook.sh");
  const sh = (...a) => execFileSync("sh", [script, ...a], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  sh();
  const hook = path.join(repo, ".git/hooks/post-commit");
  assert.ok(statSync(hook).mode & 0o100, "hook is executable");
  const body = readFileSync(hook, "utf8");
  assert.match(body, /md-gdocs-sync post-commit hook/);
  assert.match(body, /exit 0\s*$/);
  assert.ok(body.includes(path.resolve("md-gdocs-sync/sync-doc.mjs")));
  sh(); // idempotent
  writeFileSync(hook, "#!/bin/sh\necho mine\n");
  assert.throws(() => sh(), /not written by md-gdocs-sync|exit/i);
  assert.match(readFileSync(hook, "utf8"), /echo mine/);
  sh("--force");
  assert.match(readFileSync(hook, "utf8"), /md-gdocs-sync post-commit hook/);
  assert.ok(existsSync(hook));
});
