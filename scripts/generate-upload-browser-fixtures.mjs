/** Reproducible independently authored image fixtures; no vendor/customer media. */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { syntheticPng } from '../packages/media/tests/fixtures.mjs';
if (process.argv.length !== 2 || process.env.NODE_ENV === 'production')
  throw Error('Local synthetic fixture generator takes no arguments and refuses production.');
const runId = randomUUID(),
  parent = await mkdtemp(path.join(tmpdir(), 'realtor-upload-browser-'));
const nativeRoot = path.join(parent, 'native-root'),
  filesRoot = path.join(parent, 'files');
await mkdir(nativeRoot);
await mkdir(filesRoot);
const files = [];
async function save(name, bytes, kind, width = null, height = null) {
  const location = path.join(filesRoot, name);
  await writeFile(location, bytes, { flag: 'wx' });
  const result = {
    name,
    path: location,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    kind,
    width,
    height,
  };
  files.push(result);
  return result;
}
for (let index = 1; index <= 13; index++)
  await save(
    `fictional-photo-${String(index).padStart(2, '0')}.png`,
    syntheticPng(128 + index, 96, (x, y) => [
      (x * 17 + index * 31) % 256,
      (y * 13 + index * 7) % 256,
      (x + y + index * 19) % 256,
      255,
    ]),
    'synthetic_png',
    128 + index,
    96,
  );
const cancel = await save(
  'fictional-cancel-test.png',
  syntheticPng(1600, 1200, (x, y) => {
    const v = (Math.imul(x + 1, 1664525) ^ Math.imul(y + 1, 1013904223)) >>> 0;
    return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, 255];
  }),
  'synthetic_png',
  1600,
  1200,
);
if (cancel.bytes > 10485760) throw Error('Cancellation image exceeds the real input cap.');
await save(
  'fictional-corrupt.png',
  Buffer.from('Deliberately corrupt synthetic image fixture; not a real PNG.'),
  'invalid_image',
);
const manifest = {
  runId,
  createdAt: new Date().toISOString(),
  nativeRoot,
  filesRoot,
  files,
  scope:
    'Own synthetic fixtures only. No real property photographs, customers, vendor material or image-processing pass is implied by generation.',
};
const proof = new URL(
  `../docs/evidence/${manifest.createdAt.slice(0, 10)}-upload-browser-matrix/`,
  import.meta.url,
);
await mkdir(proof, { recursive: true });
const manifestPath = new URL(`fixtures-${runId}.json`, proof);
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(
  JSON.stringify({
    manifestPath: fileURLToPath(manifestPath),
    nativeRoot,
    filesRoot,
    files: files.length,
    cancelBytes: cancel.bytes,
  }),
);
