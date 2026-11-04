// Tiny config loader shared by the hook, the drift report and the effect checker.
// One env file (see .env.example); real environment variables win over it.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULTS = {
  DEFAULT_BRANCH: "main",
  BRANCH_PREFIX: "feat",
  STATE_FILE: "project-state.md",
  DRIFT_REPORT_FILE: "drift-report.md",
  CHECKPOINT_TRIGGER_REGEX: "gh pr merge|deploy\\.sh",
  STALE_PR_DAYS: "2",
};

/** Expand a leading `~` the way a shell would (env files are not shell-expanded). */
export function expandHome(p, home = os.homedir()) {
  if (typeof p !== "string") return p;
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
}

/** PURE: parse KEY=VALUE lines. Supports `export`, quotes, blank lines and # comments. */
export function parseEnv(text) {
  const out = {};
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    const quoted = value.match(/^(["'])(.*)\1\s*(?:#.*)?$/);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, "").trim();
    out[m[1]] = value;
  }
  return out;
}

export function envFilePath(env = process.env, home = os.homedir()) {
  return expandHome(env.MULTITERMINAL_ENV, home) || path.join(home, ".config", "claude-multiterminal", "env");
}

/**
 * Merge defaults < env file < real environment. Empty strings in the file count as unset, so a
 * copied .env.example with blank optional lines does not shadow a default.
 */
export function loadConfig({ env = process.env, file, readFile = (f) => readFileSync(f, "utf8") } = {}) {
  let fromFile = {};
  try {
    fromFile = parseEnv(readFile(file || envFilePath(env)));
  } catch {
    /* no env file is fine: environment variables alone are a valid setup */
  }
  const merged = { ...DEFAULTS };
  for (const [k, v] of Object.entries(fromFile)) if (v !== "") merged[k] = v;
  for (const [k, v] of Object.entries(env)) if (v !== undefined && v !== "") merged[k] = v;
  for (const k of ["MAIN_WORKTREE", "WORKTREE_ROOT", "MEMORY_DIR", "EFFECTS_CONFIG", "MD_GDOCS_SYNC_DIR", "DOC_SYNC_MAP"]) {
    if (merged[k]) merged[k] = expandHome(merged[k]);
  }
  return merged;
}

export function requireKeys(cfg, keys) {
  const missing = keys.filter((k) => !cfg[k]);
  if (missing.length) {
    throw new Error(`missing config: ${missing.join(", ")} (set them in ${envFilePath()} or the environment; see .env.example)`);
  }
}
