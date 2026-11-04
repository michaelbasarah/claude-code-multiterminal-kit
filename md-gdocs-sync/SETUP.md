# md-gdocs-sync: one-time setup

Gives the sync script permission to edit Google Docs in one Drive folder as **you** (OAuth, no
service account). About 10 minutes, once.

The files you create below are secrets, like passwords. They live in `~/.config/md-gdocs-sync/`
(override with `MD_GDOCS_SYNC_DIR`), outside any repo. Never commit or paste them.

## 1. Google Cloud project and APIs

1. Open <https://console.cloud.google.com/>, signed in as the Google account that owns the Docs.
2. Create a project (any name) or reuse one.
3. Enable the **Drive API**, **Docs API** and **Sheets API** (Sheets only matters for `drive.mjs append-row`).

## 2. OAuth consent screen

1. APIs & Services -> OAuth consent screen -> User type **External** -> Create.
2. Name it anything, add your own address as support and developer contact. Skip scopes.
3. Add your own Google account under **Test users**. Staying in "Testing" is fine.

## 3. OAuth client

1. APIs & Services -> Credentials -> Create credentials -> OAuth client ID -> **Desktop app**.
2. Download the JSON and save it as `~/.config/md-gdocs-sync/oauth-client.json`.

## 4. Approve once

```bash
cd md-gdocs-sync
npm install
node consent.mjs   # headless/WSL: prints a link to open; or `node auth.mjs` where a browser can auto-open
```

Google warns that the app is unverified. That is expected for your own script: Advanced -> Go to
app -> Allow. A refresh token is saved to `token.json` (mode 600).

## 5. Map and hook

```bash
cp doc-sync-map.example.json /path/to/your/repo/doc-sync-map.json   # edit folderId + docs
cd /path/to/your/repo && sh /path/to/kit/md-gdocs-sync/install-hook.sh
```

`folderId` is the last path segment of the Drive folder URL. Create the Docs manually or let the
first sync create them; after that every commit touching a mapped `.md` updates the same Doc in
place, so shared links stay valid. Check `.doc-sync.log` if a Doc looks stale.

Matching is by **exact Doc title** inside that folder. Don't rename a mirror in Drive, or the next
sync creates a duplicate.

## Helper CLI

```
node drive.mjs ls <folderId>
node drive.mjs move <fileId> <folderId>
node drive.mjs rename <fileId> "Name"
node drive.mjs trash <fileId>            # recoverable
node drive.mjs new-doc "Title" <folderId> contentFile
node drive.mjs append-doc <docId> contentFile
node drive.mjs read <fileId>             # export a Doc/Sheet as text
```
