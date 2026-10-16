import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { convertSyntheticImage } from '@realtor/media';
import { createLocalSyntheticStore } from '@realtor/media/local-store';
import { syntheticPng } from './fixtures.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function* chunks(bytes) {
  for (let offset = 0; offset < bytes.length; offset += 7) yield bytes.subarray(offset, offset + 7);
}

test('local synthetic flow preserves captured input and separately stores actual codec output', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'realtor-store-codec-'));
  const store = await createLocalSyntheticStore(parent);
  try {
    const input = syntheticPng(19, 13, (x, y) => [x * 10, y * 15, 90, 255]);
    const quarantined = await store.ingest(chunks(input));
    const captured = await store.read(quarantined.handle);
    assert.equal(quarantined.kind, 'quarantine');
    assert.deepEqual(captured, input);
    const converted = await convertSyntheticImage(captured);
    assert.equal(converted.manifest.inputSha256, quarantined.sha256);
    assert.equal(converted.manifest.inputBytes, quarantined.bytes);
    const saved = await store.publish(converted.data);
    assert.equal(saved.kind, 'output');
    assert.notEqual(saved.handle, quarantined.handle);
    assert.equal(saved.sha256, converted.manifest.sha256);
    assert.equal(saved.bytes, converted.manifest.bytes);
    // The adapter snapshots before its first await, independently of codec Buffer ownership.
    converted.data.fill(0);
    captured.fill(0);
    const stored = await store.read(saved.handle);
    assert.equal(digest(stored), saved.sha256);
    const metadata = await sharp(stored).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 19);
    assert.equal(metadata.height, 13);
    assert.deepEqual(await store.read(quarantined.handle), input);
  } finally {
    await store.dispose();
    assert.deepEqual(await readdir(parent), []);
    await rmdir(parent);
  }
});

test('failed actual decoding leaves quarantine private and creates no output in the local flow', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'realtor-store-reject-'));
  const store = await createLocalSyntheticStore(parent);
  try {
    const source = Buffer.from('synthetic corrupt image');
    const quarantined = await store.ingest(chunks(source));
    await assert.rejects(convertSyntheticImage(await store.read(quarantined.handle)));
    const roots = await readdir(parent);
    assert.equal(roots.length, 1);
    assert.deepEqual(await readdir(path.join(parent, roots[0], 'output')), []);
    assert.deepEqual(await store.read(quarantined.handle), source);
  } finally {
    await store.dispose();
    await rmdir(parent);
  }
});

test('storage publication alone certifies byte identity, not image safety or SQL acceptance', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'realtor-store-scope-'));
  const store = await createLocalSyntheticStore(parent);
  try {
    const bytes = Buffer.from('deliberately not an image');
    const saved = await store.publish(bytes);
    assert.deepEqual(await store.read(saved.handle), bytes);
    assert.equal(saved.sha256, digest(bytes));
    assert.deepEqual(Object.keys(saved).sort(), ['bytes', 'handle', 'kind', 'sha256']);
    assert.equal('accepted' in saved, false);
  } finally {
    await store.dispose();
    await rmdir(parent);
  }
});
