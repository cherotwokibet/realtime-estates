import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { convertSyntheticImage } from '../dist/index.js';
import { verifySyntheticProcessReadback, MediaReadbackError } from '../dist/process-readback.js';
import { syntheticPng, riffChunk } from './fixtures.mjs';

const hash = b => createHash('sha256').update(b).digest('hex');
const json = m => Buffer.from(JSON.stringify(m) + '\n');
function riff(chunks) {
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  const length = Buffer.alloc(4); length.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from('RIFF'), length, body]);
}
function webpChunks(bytes) {
  const chunks = [];
  for (let offset = 12; offset < bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    chunks.push({ kind: bytes.toString('latin1', offset, offset + 4), body: Buffer.from(bytes.subarray(offset + 8, offset + 8 + size)) });
    offset += 8 + size + size % 2;
  }
  return chunks;
}

test('pure readback matches actual encoded dimensions/hashes and snapshots ordinary buffers', async () => {
  for (const alpha of [255, 110]) {
    const source = syntheticPng(23, 17, () => [30, 100, 180, alpha]);
    const converted = await convertSyntheticImage(source);
    const expectedSource = Buffer.from(source), expectedOutput = Buffer.from(converted.data);
    const result = verifySyntheticProcessReadback(source, converted.data, json(converted.manifest));
    assert.deepEqual(result.manifest, converted.manifest);
    assert.equal(Object.isFrozen(result.manifest), true);
    assert.equal(Object.isFrozen(result.manifest.encoder), true);
    source.fill(0); converted.data.fill(0);
    assert.deepEqual(result.data, expectedOutput);
    assert.equal(result.manifest.inputSha256, hash(expectedSource));
  }
});

test('sidecar cannot override input/output facts, encoder, pipeline or operations', async () => {
  const source = syntheticPng(); const r = await convertSyntheticImage(source);
  const changes = [
    { inputSha256: '0'.repeat(64) }, { inputBytes: source.length + 1 }, { sourceFormat: 'jpeg' },
    { sha256: 'f'.repeat(64) }, { width: r.manifest.width + 1 }, { height: 1921 }, { bytes: r.data.length + 1 },
    { pipeline: 'accepted' }, { mimeType: 'text/html' }, { format: 'png' },
    { encoder: { sharp: '0.35.4', vips: r.manifest.encoder.vips } },
    { encoder: { ...r.manifest.encoder, extra: true } }, { operations: ['strip-metadata'] }, { accepted: true },
  ];
  for (const change of changes) assert.throws(() => verifySyntheticProcessReadback(source, r.data, json({ ...r.manifest, ...change })), MediaReadbackError);
  assert.throws(() => verifySyntheticProcessReadback(Buffer.concat([source, Buffer.from([0])]), r.data, json(r.manifest)), MediaReadbackError);
  const changed = Buffer.from(r.data); changed[changed.length - 2] ^= 1;
  assert.throws(() => verifySyntheticProcessReadback(source, changed, json(r.manifest)), MediaReadbackError);
});

test('bounded canonical sidecar rejects duplicate/escaped keys, rounded tokens and invalid UTF-8', async () => {
  const source = syntheticPng(); const r = await convertSyntheticImage(source);
  const text = JSON.stringify(r.manifest);
  const bad = [
    Buffer.from(text.replace('"width":16', '"width":16,"width":16')),
    Buffer.from(text.replace('"width"', '"\\u0077idth"')),
    Buffer.from(text.replace('"width":16', '"width":1.6e1')),
    Buffer.from(text.replace('"width":16', '"width":16.0000000000000001')),
    Buffer.from([0xff]), Buffer.alloc(4097, 32), Buffer.from('[]'), Buffer.from('{}'),
  ];
  for (const sidecar of bad) assert.throws(() => verifySyntheticProcessReadback(source, r.data, sidecar), MediaReadbackError);
});

test('static coded headers reject metadata, animation, unknown/trailing chunks and canvas mismatch', async () => {
  const source = syntheticPng(16, 12, () => [30, 100, 180, 100]);
  const r = await convertSyntheticImage(source); const chunks = webpChunks(r.data);
  const frame = chunks.find(x => x.kind === 'VP8 ' || x.kind === 'VP8L');
  assert.ok(frame);
  const canvas = chunks.find(x => x.kind === 'VP8X'); assert.ok(canvas);
  const mismatch = Buffer.from(canvas.body); mismatch[4] ^= 1;
  const animated = Buffer.from(canvas.body); animated[0] |= 2;
  const metadata = await sharp(r.data).withMetadata().webp().toBuffer();
  const outputs = [
    Buffer.concat([r.data, Buffer.from([0])]), r.data.subarray(0, -1),
    riff([...chunks.map(x => riffChunk(x.kind, x.body)), riffChunk('EXIF', Buffer.from('private synthetic metadata'))]),
    riff([...chunks.map(x => riffChunk(x.kind, x.body)), riffChunk('JUNK', Buffer.from([0]))]),
    riff([...chunks.map(x => riffChunk(x.kind, x.body)), riffChunk(frame.kind, frame.body)]),
    riff(chunks.map(x => riffChunk(x.kind, x.kind === 'VP8X' ? mismatch : x.body))),
    riff(chunks.map(x => riffChunk(x.kind, x.kind === 'VP8X' ? animated : x.body))), metadata,
  ];
  for (const bytes of outputs) {
    const manifest = { ...r.manifest, sha256: hash(bytes), bytes: bytes.length };
    assert.throws(() => verifySyntheticProcessReadback(source, bytes, json(manifest)), MediaReadbackError);
  }
});

test('readback enforces actual byte caps and rejects shared memory before parsing', async () => {
  const source = syntheticPng(); const r = await convertSyntheticImage(source);
  for (const args of [
    [Buffer.alloc(10 * 1024 * 1024 + 1), r.data, json(r.manifest)],
    [source, Buffer.alloc(10 * 1024 * 1024 + 1), json(r.manifest)],
    [source, Buffer.from(new SharedArrayBuffer(r.data.length)), json(r.manifest)],
    [source, r.data, Buffer.from(new SharedArrayBuffer(32))],
    [Buffer.alloc(0), r.data, json(r.manifest)],
  ]) assert.throws(() => verifySyntheticProcessReadback(...args), MediaReadbackError);
});
