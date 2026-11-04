#!/usr/bin/env node
// Live-sync markdown docs -> Google Docs.
//
// Reads the sync map (DOC_SYNC_MAP, default ./doc-sync-map.json in the current repo). For each
// mapped .md it finds the Doc by exact title in the target folder and updates it IN PLACE
// (markdown re-converted to a formatted Doc, STABLE URL), or creates it if missing. Pass repo-relative
// paths to sync only those; no args = sync every doc in the map.
//
//   node sync-doc.mjs                      # sync every doc in the map
//   node sync-doc.mjs docs/HANDBOOK.md     # sync only the given (changed) files
//
// Used by the git post-commit hook. Never throws (logs and exits 0), so a Drive or network outage
// can never break a commit: that sync is skipped and retried next time the doc is committed.
import { google } from "googleapis";
import { promises as fs } from "node:fs";
import path from "node:path";
import { authorize } from "./auth.mjs";
import { validateMap, selectEntries, buildFindQuery } from "./map.mjs";

async function syncOne(drive, root, folderId, mdRel, title) {
  let body;
  try {
    body = await fs.readFile(path.join(root, mdRel), "utf8");
  } catch {
    console.log(`SKIP    ${mdRel} (file not found)`);
    return;
  }
  const found = await drive.files.list({ q: buildFindQuery(folderId, title), fields: "files(id,name)", pageSize: 1 });
  const existing = (found.data.files || [])[0];
  if (existing) {
    await drive.files.update({ fileId: existing.id, media: { mimeType: "text/markdown", body } });
    console.log(`UPDATED ${mdRel} -> "${title}" (id ${existing.id})`);
  } else {
    const res = await drive.files.create({
      requestBody: { name: title, mimeType: "application/vnd.google-apps.document", parents: [folderId] },
      media: { mimeType: "text/markdown", body },
      fields: "id,webViewLink",
    });
    console.log(`CREATED ${mdRel} -> "${title}" (id ${res.data.id}) ${res.data.webViewLink}`);
  }
}

async function main() {
  const mapPath = path.resolve(process.env.DOC_SYNC_MAP || "doc-sync-map.json");
  const root = path.dirname(mapPath);
  const map = validateMap(JSON.parse(await fs.readFile(mapPath, "utf8")));
  const entries = selectEntries(map, process.argv.slice(2), root);
  if (!entries.length) {
    console.log("nothing to sync");
    return;
  }
  const drive = google.drive({ version: "v3", auth: await authorize() });
  for (const d of entries) {
    try {
      await syncOne(drive, root, map.folderId, d.md, d.title);
    } catch (e) {
      console.log(`ERROR   ${d.md}: ${e?.errors?.[0]?.message || e.message}`);
    }
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(0);
});
process.on("unhandledRejection", () => process.exit(0));
