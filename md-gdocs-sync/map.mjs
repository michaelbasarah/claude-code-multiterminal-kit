// Pure helpers for the sync map: validation, path matching, Drive query building.
// No googleapis, no network, so all of it is unit-tested offline.
import path from "node:path";

export const PLACEHOLDER_FOLDER = "YOUR_DRIVE_FOLDER_ID";

/** PURE: validate a parsed map. Throws one Error listing every problem. */
export function validateMap(map) {
  const problems = [];
  if (!map || typeof map !== "object") throw new Error("sync map must be a JSON object");
  if (typeof map.folderId !== "string" || !map.folderId.trim()) problems.push("folderId: required string");
  else if (map.folderId === PLACEHOLDER_FOLDER) problems.push(`folderId: still the placeholder "${PLACEHOLDER_FOLDER}"`);
  if (!Array.isArray(map.docs) || map.docs.length === 0) problems.push("docs: need at least one { md, title } entry");
  const titles = new Set();
  const mds = new Set();
  for (const [i, d] of (Array.isArray(map.docs) ? map.docs : []).entries()) {
    if (typeof d?.md !== "string" || !d.md.endsWith(".md")) problems.push(`docs[${i}].md: must be a path ending in .md`);
    if (typeof d?.title !== "string" || !d.title.trim()) problems.push(`docs[${i}].title: required string`);
    if (d?.title && titles.has(d.title)) problems.push(`docs[${i}].title: duplicate "${d.title}" (updates match Docs by title)`);
    if (d?.md && mds.has(normalizeRel(d.md))) problems.push(`docs[${i}].md: duplicate "${d.md}"`);
    titles.add(d?.title);
    if (d?.md) mds.add(normalizeRel(d.md));
  }
  if (problems.length) throw new Error(`invalid sync map:\n  - ${problems.join("\n  - ")}`);
  return map;
}

/** PURE: a repo-relative path in canonical form (forward slashes, no leading ./). */
export function normalizeRel(p, root = null) {
  let q = String(p).replace(/\\/g, "/");
  if (root && path.isAbsolute(q)) q = path.relative(root, q).replace(/\\/g, "/");
  return path.posix.normalize(q).replace(/^\.\//, "");
}

/**
 * PURE: which map entries to sync. No wanted paths = all. Matching is by full repo-relative path,
 * not basename, so docs/README.md and api/README.md can't be confused.
 */
export function selectEntries(map, wanted = [], root = null) {
  if (!wanted.length) return map.docs;
  const set = new Set(wanted.map((w) => normalizeRel(w, root)));
  return map.docs.filter((d) => set.has(normalizeRel(d.md)));
}

/** PURE: escape a value for use inside single quotes in a Drive `q` query. */
export function escapeQuery(v) {
  return String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * PURE: the Drive query that finds the existing Doc by exact title in the folder. The mimeType
 * filter stops a same-named folder or file from matching and hijacking the update.
 */
export function buildFindQuery(folderId, title) {
  return `name = '${escapeQuery(title)}' and mimeType = 'application/vnd.google-apps.document' and '${escapeQuery(folderId)}' in parents and trashed = false`;
}
