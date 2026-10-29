/** Read-only source/archive reconciliation. Never modifies an original or replaces the pinned manifest. */
import { readFile, realpath, stat, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
const workspace = fileURLToPath(new URL('../', import.meta.url));
const manifestBytes = await readFile(resolve(workspace, 'docs/preservation-manifest.json'));
const pinnedManifestSha256 = createHash('sha256')
  .update(manifestBytes.toString('utf8').replaceAll('\r\n', '\n'))
  .digest('hex');
if (pinnedManifestSha256 !== '35ff89ff4c35cefba122d0a9ad52eed69ebb91ed3186f8e91a8d728aab2089c0')
  throw Error(
    'Pinned original manifest changed; review/version the inventory rather than silently rebasing it.',
  );
const manifest = JSON.parse(manifestBytes);
const output = resolve(workspace, 'docs/evidence/2026-10-29-preservation');
await mkdir(output, { recursive: true });
await writeFile(
  resolve(output, 'verification.json'),
  JSON.stringify(
    { status: 'running', startedAt: new Date().toISOString(), pinnedManifestSha256 },
    null,
    2,
  ) + '\n',
);
const failures = [],
  changes = [],
  additions = [],
  links = [],
  collections = {},
  observed = [];
const excluded = new Set(manifest.excludedGeneratedDirectories);
function inside(root, path) {
  const rel = relative(root, path);
  return rel !== '' && !rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel);
}
function originalPath(root, name) {
  if (
    typeof name !== 'string' ||
    !name ||
    name.includes('\\') ||
    name.split('/').some((p) => !p || p === '.' || p === '..') ||
    isAbsolute(name)
  )
    throw Error('Invalid preserved relative path');
  const full = resolve(root, ...name.split('/'));
  if (!inside(root, full)) throw Error('Original path escaped root');
  return full;
}
async function hashFile(path) {
  const before = await stat(path, { bigint: true });
  if (!before.isFile()) throw Error('Not a regular file');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const after = await stat(path, { bigint: true });
  if (before.size !== after.size || before.mtimeNs !== after.mtimeNs)
    throw Error('Original changed during read');
  return {
    bytes: Number(after.size),
    sha256: hash.digest('hex'),
    readOnlyMode: (Number(after.mode) & 0o222) === 0,
  };
}
const roots = {};
for (const [key, value] of Object.entries(manifest.sourceRoots)) {
  try {
    roots[key] = await realpath(value);
    collections[key] = { expected: 0, verified: 0, bytes: 0 };
  } catch (e) {
    failures.push({ collection: key, kind: 'root-unavailable', message: e.message });
  }
}
const expected = new Map();
for (const entry of manifest.files) {
  const key = entry.collection + '\0' + entry.path.toLowerCase();
  if (expected.has(key)) throw Error('Duplicate original inventory identity');
  expected.set(key, entry);
  collections[entry.collection] ??= { expected: 0, verified: 0, bytes: 0 };
  collections[entry.collection].expected++;
}
for (const entry of manifest.files) {
  try {
    const root = roots[entry.collection];
    if (!root) continue;
    const file = originalPath(root, entry.path),
      actualPath = await realpath(file);
    if (!inside(root, actualPath)) throw Error('Resolved original escaped root');
    const result = await hashFile(file);
    observed.push([entry.collection, entry.path, result.bytes, result.sha256]);
    if (result.bytes !== entry.bytes || result.sha256 !== entry.sha256)
      changes.push({
        collection: entry.collection,
        path: entry.path,
        expectedBytes: entry.bytes,
        expectedSha256: entry.sha256,
        ...result,
      });
    else {
      collections[entry.collection].verified++;
      collections[entry.collection].bytes += result.bytes;
    }
  } catch (e) {
    failures.push({
      collection: entry.collection,
      path: entry.path,
      kind: 'file-unavailable-or-unstable',
      message: e.message,
    });
  }
}
async function walk(collection, root, dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name),
      name = relative(root, full).split(sep).join('/');
    if (entry.isSymbolicLink()) {
      links.push({ collection, path: name });
      continue;
    }
    if (entry.isDirectory()) {
      if (!excluded.has(entry.name)) await walk(collection, root, full);
    } else if (entry.isFile() && !expected.has(collection + '\0' + name.toLowerCase()))
      additions.push({ collection, path: name, bytes: (await stat(full)).size });
  }
}
for (const [collection, root] of Object.entries(roots))
  try {
    await walk(collection, root, root);
  } catch (e) {
    failures.push({ collection, kind: 'inventory-enumeration', message: e.message });
  }
let archiveRoot;
const archives = [];
try {
  archiveRoot = await realpath(resolve(workspace, '../rebuild-preservation/2026-10-09'));
} catch (e) {
  failures.push({ kind: 'archive-root-unavailable', message: e.message });
}
for (const archive of manifest.snapshots) {
  try {
    if (!archiveRoot) throw Error('Preserved archive root unavailable');
    const path = originalPath(archiveRoot, archive.path);
    const resolved = await realpath(path);
    if (!inside(archiveRoot, resolved)) throw Error('Archive escaped preservation root');
    const actual = await hashFile(path);
    archives.push({
      path: basename(path),
      expectedBytes: archive.bytes,
      expectedSha256: archive.sha256,
      ...actual,
      matches: actual.bytes === archive.bytes && actual.sha256 === archive.sha256,
    });
  } catch (e) {
    failures.push({
      archive: archive.path,
      kind: 'preserved-archive-unavailable',
      message: e.message,
    });
  }
}
const result = {
  recordedAt: new Date().toISOString(),
  policy: 'read-only-preservation-reconciliation-v1',
  pinnedManifestSha256,
  manifestHashScope:
    'UTF-8 with CRLF normalized to LF; original files and archives hashed byte-for-byte',
  pinnedDate: manifest.date,
  excludedGeneratedDirectories: [...excluded],
  expectedFiles: manifest.files.length,
  verifiedFiles: Object.values(collections).reduce((n, c) => n + c.verified, 0),
  collections,
  sourceChanges: changes,
  unlistedFiles: additions,
  unfollowedLinks: links,
  failures,
  archives,
  observedDigest: createHash('sha256').update(JSON.stringify(observed)).digest('hex'),
  originalWrites: 0,
  snapshotReplacements: 0,
  scope:
    'Local read-only original inventory and existing archive hash reconciliation; no asset rights/account/live-data/offsite backup proof',
};
const complete =
  result.verifiedFiles === result.expectedFiles &&
  changes.length === 0 &&
  additions.length === 0 &&
  links.length === 0 &&
  failures.length === 0 &&
  archives.length === manifest.snapshots.length &&
  archives.every((a) => a.matches && a.readOnlyMode);
result.status = 'completed';
result.complete = complete;
await writeFile(resolve(output, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify({
    complete,
    expectedFiles: result.expectedFiles,
    verifiedFiles: result.verifiedFiles,
    changes: changes.length,
    unlisted: additions.length,
    links: links.length,
    failures: failures.length,
    archives: archives.map((a) => ({ path: a.path, matches: a.matches, readOnly: a.readOnlyMode })),
  }),
);
if (!complete) process.exitCode = 1;
