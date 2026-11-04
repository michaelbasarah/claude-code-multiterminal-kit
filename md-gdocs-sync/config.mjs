// Paths and scopes shared by auth.mjs and consent.mjs. No googleapis import, so it is testable offline.
import os from "node:os";
import path from "node:path";

export function expandHome(p, home = os.homedir()) {
  if (p === "~") return home;
  if (typeof p === "string" && p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
}

/** Credentials live OUTSIDE any repo: oauth-client.json (from Google Cloud) and token.json (refresh token). */
export function resolvePaths(env = process.env, home = os.homedir()) {
  const dir = expandHome(env.MD_GDOCS_SYNC_DIR, home) || path.join(home, ".config", "md-gdocs-sync");
  return {
    CONFIG_DIR: dir,
    CLIENT_PATH: expandHome(env.GOOGLE_CLIENT_JSON, home) || path.join(dir, "oauth-client.json"),
    TOKEN_PATH: expandHome(env.GOOGLE_TOKEN_JSON, home) || path.join(dir, "token.json"),
  };
}

// Full Drive (to edit EXISTING files), plus the Docs and Sheets content APIs.
export const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/documents",
];
