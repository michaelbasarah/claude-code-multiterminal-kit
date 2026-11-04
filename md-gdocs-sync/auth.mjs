// OAuth (user-delegated) auth: acts AS the Google account that consents.
// Credentials live OUTSIDE the repo (see config.mjs): oauth-client.json from Google Cloud, and
// token.json (the saved refresh token, created on first consent). Both are secrets.
import { promises as fs } from "node:fs";
import { google } from "googleapis";
import { authenticate } from "@google-cloud/local-auth";
import { resolvePaths, SCOPES } from "./config.mjs";

const { CONFIG_DIR, CLIENT_PATH, TOKEN_PATH } = resolvePaths();

async function loadSavedToken() {
  try {
    return google.auth.fromJSON(JSON.parse(await fs.readFile(TOKEN_PATH, "utf8")));
  } catch {
    return null;
  }
}

async function saveToken(client) {
  const key = JSON.parse(await fs.readFile(CLIENT_PATH, "utf8"));
  const k = key.installed || key.web;
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(
    TOKEN_PATH,
    JSON.stringify({ type: "authorized_user", client_id: k.client_id, client_secret: k.client_secret, refresh_token: client.credentials.refresh_token }, null, 2),
  );
  await fs.chmod(TOKEN_PATH, 0o600);
}

/** Returns an authorized client, running the one-time consent flow if needed. */
export async function authorize() {
  let client = await loadSavedToken();
  if (client) return client;
  client = await authenticate({ scopes: SCOPES, keyfilePath: CLIENT_PATH }); // needs a browser
  if (client.credentials?.refresh_token) await saveToken(client);
  return client;
}

export { CONFIG_DIR, CLIENT_PATH, TOKEN_PATH, SCOPES };

// `node auth.mjs` on its own runs/verifies the consent flow.
if (import.meta.url === `file://${process.argv[1]}`) {
  authorize()
    .then(async (auth) => {
      const me = await google.oauth2({ version: "v2", auth }).userinfo.get();
      console.log(`Authorized as: ${me.data.email}`);
      console.log(`Token saved at: ${TOKEN_PATH}`);
    })
    .catch((err) => {
      console.error("Auth failed:", err.message);
      process.exit(1);
    });
}
