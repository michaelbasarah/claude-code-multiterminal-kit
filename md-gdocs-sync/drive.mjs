#!/usr/bin/env node
// Small Drive/Docs/Sheets helper CLI (list, move, rename, trash, read, create, append).
//
//   node drive.mjs ls <folderId>
//   node drive.mjs find "<drive query>"
//   node drive.mjs mkdir <name> <parentId>
//   node drive.mjs move <fileId> <newParentId>
//   node drive.mjs rename <fileId> "<new title>"
//   node drive.mjs trash <fileId>                 (move to trash, recoverable)
//   node drive.mjs read <fileId>                  (export Doc/Sheet as text)
//   node drive.mjs new-doc "<title>" <parentId> [contentFile|-]
//   node drive.mjs append-doc <fileId> <contentFile|->
//   node drive.mjs new-sheet "<title>" <parentId> [csvFile|-]
//   node drive.mjs append-row <sheetId> <tabName|-> '<json array of cells>'
//   node drive.mjs del-row <sheetId> <rowNumber>   (1-based; row 1 = header)
//
// Files/dirs print as: <id>  <mimeType>  <name>

import { promises as fs } from 'node:fs';
import { google } from 'googleapis';
import { authorize } from './auth.mjs';

const SHORT = {
  'application/vnd.google-apps.folder': 'folder',
  'application/vnd.google-apps.document': 'doc',
  'application/vnd.google-apps.spreadsheet': 'sheet',
  'application/vnd.google-apps.presentation': 'slides',
};
const short = (m) => SHORT[m] || m;

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function readInput(arg) {
  if (!arg) return '';
  if (arg === '-') return readStdin(); // robust stream read (fs.readFile(0) is flaky for pipes)
  return fs.readFile(arg, 'utf8');
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    console.log(await fs.readFile(new URL(import.meta.url)).then((b) =>
      b.toString().split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')));
    return;
  }

  const auth = await authorize();
  const drive = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });
  const docs = google.docs({ version: 'v1', auth });

  switch (cmd) {
    case 'ls': {
      const [folderId] = args;
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id,name,mimeType,modifiedTime)',
        orderBy: 'folder,name',
        pageSize: 200,
      });
      for (const f of res.data.files || []) console.log(`${f.id}\t${short(f.mimeType)}\t${f.name}`);
      break;
    }
    case 'find': {
      const [q] = args;
      const res = await drive.files.list({
        q: `${q} and trashed = false`,
        fields: 'files(id,name,mimeType,parents)',
        pageSize: 100,
      });
      for (const f of res.data.files || []) console.log(`${f.id}\t${short(f.mimeType)}\t${f.name}`);
      break;
    }
    case 'mkdir': {
      const [name, parentId] = args;
      const res = await drive.files.create({
        requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: parentId ? [parentId] : undefined },
        fields: 'id,name',
      });
      console.log(`created folder ${res.data.id}\t${res.data.name}`);
      break;
    }
    case 'move': {
      const [fileId, newParent] = args;
      const cur = await drive.files.get({ fileId, fields: 'parents' });
      await drive.files.update({
        fileId,
        addParents: newParent,
        removeParents: (cur.data.parents || []).join(','),
        fields: 'id,parents',
      });
      console.log(`moved ${fileId} -> ${newParent}`);
      break;
    }
    case 'rename': {
      const [fileId, title] = args;
      await drive.files.update({ fileId, requestBody: { name: title } });
      console.log(`renamed ${fileId} -> ${title}`);
      break;
    }
    case 'trash': {
      const [fileId] = args;
      await drive.files.update({ fileId, requestBody: { trashed: true } });
      console.log(`trashed ${fileId}`);
      break;
    }
    case 'read': {
      const [fileId] = args;
      const meta = await drive.files.get({ fileId, fields: 'mimeType,name' });
      const mt = meta.data.mimeType;
      const exportAs = mt === 'application/vnd.google-apps.spreadsheet' ? 'text/csv'
        : mt.startsWith('application/vnd.google-apps') ? 'text/plain' : null;
      if (exportAs) {
        const res = await drive.files.export({ fileId, mimeType: exportAs }, { responseType: 'text' });
        console.log(res.data);
      } else {
        const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
        console.log(res.data);
      }
      break;
    }
    case 'new-doc': {
      const [title, parentId, contentFile] = args;
      const body = await readInput(contentFile);
      const res = await drive.files.create({
        requestBody: { name: title, mimeType: 'application/vnd.google-apps.document', parents: parentId ? [parentId] : undefined },
        media: body ? { mimeType: 'text/plain', body } : undefined,
        fields: 'id,name,webViewLink',
      });
      console.log(`created doc ${res.data.id}\t${res.data.webViewLink || res.data.name}`);
      break;
    }
    case 'append-doc': {
      const [fileId, contentFile] = args;
      const text = '\n' + (await readInput(contentFile));
      const doc = await docs.documents.get({ documentId: fileId });
      const endIndex = doc.data.body.content.at(-1).endIndex - 1;
      await docs.documents.batchUpdate({
        documentId: fileId,
        requestBody: { requests: [{ insertText: { location: { index: endIndex }, text } }] },
      });
      console.log(`appended ${text.length} chars to ${fileId}`);
      break;
    }
    case 'new-sheet': {
      const [title, parentId, csvFile] = args;
      const body = await readInput(csvFile);
      const res = await drive.files.create({
        requestBody: { name: title, mimeType: 'application/vnd.google-apps.spreadsheet', parents: parentId ? [parentId] : undefined },
        media: body ? { mimeType: 'text/csv', body } : undefined,
        fields: 'id,name,webViewLink',
      });
      console.log(`created sheet ${res.data.id}\t${res.data.webViewLink || res.data.name}`);
      break;
    }
    case 'append-row': {
      const [sheetId, tab, jsonCells] = args;
      const values = [JSON.parse(jsonCells)];
      // tab "-" (or a name that doesn't exist) => use the first tab automatically.
      let target = tab;
      if (!target || target === '-') {
        const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties.title' });
        target = meta.data.sheets[0].properties.title;
      }
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `'${target.replace(/'/g, "''")}'!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
      });
      console.log(`appended row to ${sheetId} ['${target}']`);
      break;
    }
    case 'del-row': {
      const [sheetId, rowNum] = args;
      const n = parseInt(rowNum, 10);
      if (!n || n < 1) { console.error('del-row needs a 1-based row number'); process.exit(1); }
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties(sheetId,title)' });
      const sid = meta.data.sheets[0].properties.sheetId;
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests: [{ deleteDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: n - 1, endIndex: n } } }] },
      });
      console.log(`deleted row ${n} from ${sheetId}`);
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}. Run \`node drive.mjs help\`.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('error:', err?.errors?.[0]?.message || err.message);
  process.exit(1);
});
