import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  convertSyntheticFloorPlan,
  convertSyntheticImage,
  MediaCodecError,
} from '../dist/index.js';
import { syntheticPng } from './fixtures.mjs';
const hash = (b) => createHash('sha256').update(b).digest('hex');
test('synthetic floor-plan line pixels use lossless output with separate non-photo role and bound provenance', async () => {
  const input = syntheticPng(96, 64, (x, y) =>
    x === 20 || y === 20 || x === 75 || y === 48 ? [0, 0, 0, 255] : [255, 255, 255, 255],
  );
  const result = await convertSyntheticFloorPlan(input);
  const before = await sharp(input).ensureAlpha().raw().toBuffer();
  const after = await sharp(result.data).ensureAlpha().raw().toBuffer();
  assert.deepEqual(after, before);
  assert.equal(result.manifest.pipeline, 'synthetic-floor-plan-codec-v1');
  assert.equal(result.manifest.role, 'floor_plan');
  assert.equal(result.manifest.countsAsPhoto, false);
  assert.equal(result.manifest.inputSha256, hash(input));
  assert.equal(result.manifest.sha256, hash(result.data));
  assert.equal(result.manifest.operations.at(-1), 'webp-lossless-effort-4');
  assert.ok(Object.isFrozen(result.manifest) && Object.isFrozen(result.manifest.operations));
  const photo = await convertSyntheticImage(input);
  assert.equal(photo.manifest.pipeline, 'synthetic-codec-v1');
  assert.equal(photo.manifest.operations.at(-1), 'webp-quality-82-effort-4');
  assert.equal(photo.manifest.role, undefined);
});
test('raster floor plans auto-orient, strip source metadata and remain bounded without enlargement', async () => {
  const input = await sharp(syntheticPng(36, 24, () => [10, 20, 30, 255]))
    .withMetadata({ orientation: 6, exif: { IFD0: { Artist: 'PRIVATE SYNTHETIC NAME' } } })
    .png()
    .toBuffer();
  const result = await convertSyntheticFloorPlan(input);
  assert.equal(result.manifest.width, 24);
  assert.equal(result.manifest.height, 36);
  const metadata = await sharp(result.data).metadata();
  for (const field of ['orientation', 'exif', 'icc', 'xmp', 'iptc'])
    assert.equal(metadata[field], undefined);
  assert.ok(!result.data.includes(Buffer.from('PRIVATE SYNTHETIC NAME')));
});
test('floor-plan conversion rejects unsupported documents, corrupt image containers and output-cap overflow', async () => {
  for (const b of [
    Buffer.from('%PDF-1.7 synthetic'),
    Buffer.from('<svg>synthetic</svg>'),
    Buffer.from('not an image'),
  ])
    await assert.rejects(
      () => convertSyntheticFloorPlan(b),
      (e) => e instanceof MediaCodecError,
    );
  await assert.rejects(
    () =>
      convertSyntheticFloorPlan(
        syntheticPng(32, 32, () => [0, 0, 0, 255]),
        { maxOutputBytes: 1 },
      ),
    (e) => e.code === 'OUTPUT_TOO_LARGE',
  );
});
