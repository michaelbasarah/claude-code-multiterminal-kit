// One-time interactive consent for WSL/headless machines: prints an AUTH_URL to open in a browser
// (signed in as a test user), captures the loopback redirect, and saves token.json in the format
// auth.mjs reads. Desktop OAuth clients allow loopback redirects on any port.
import { promises as fs } from "node:fs";
import path from "node:path";
import http from "node:http";
import { google } from "googleapis";
import { resolvePaths, SCOPES } from "./config.mjs";

const { CONFIG_DIR, CLIENT_PATH, TOKEN_PATH } = resolvePaths();
const PORT = Number(process.env.OAUTH_PORT || 4100);
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;

const key = (({ installed, web }) => installed || web)(JSON.parse(await fs.readFile(CLIENT_PATH, "utf8")));
const oAuth2 = new google.auth.OAuth2(key.client_id, key.client_secret, REDIRECT);
const authUrl = oAuth2.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });
await fs.mkdir(CONFIG_DIR, { recursive: true });
await fs.writeFile(path.join(CONFIG_DIR, "auth-url.txt"), authUrl);
console.log("AUTH_URL: " + authUrl);

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/oauth2callback")) {
    res.statusCode = 200;
    res.end("ok");
    return;
  }
  const code = new URL(req.url, REDIRECT).searchParams.get("code");
  try {
    const { tokens } = await oAuth2.getToken(code);
    if (!tokens.refresh_token) throw new Error("no refresh_token returned (re-run; the consent screen must grant offline access)");
    await fs.writeFile(
      TOKEN_PATH,
      JSON.stringify({ type: "authorized_user", client_id: key.client_id, client_secret: key.client_secret, refresh_token: tokens.refresh_token }, null, 2),
    );
    await fs.chmod(TOKEN_PATH, 0o600);
    res.setHeader("Content-Type", "text/html");
    res.end("<h2>Authorized.</h2><p>You can close this tab and return to the terminal.</p>");
    console.log("TOKEN_SAVED");
    setTimeout(() => {
      server.close();
      process.exit(0);
    }, 300);
  } catch (e) {
    res.statusCode = 500;
    res.end("Auth error: " + e.message);
    console.error("AUTH_ERROR: " + e.message);
    process.exit(1);
  }
});
server.listen(PORT, () => console.error(`listening on ${PORT} for the redirect...`));
