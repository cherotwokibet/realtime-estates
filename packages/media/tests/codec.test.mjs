import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import { convertSyntheticImage, MediaCodecError, SYNTHETIC_CODEC_POLICY } from '../dist/index.js';
import { syntheticPng, dimensionHeaderPng, syntheticApng, pngChunk, pngSignature, corruptPngCompressedData, riffChunk, webpContainer } from './fixtures.mjs';

// Real local codecs and authored synthetic pixels. PNG fixture construction is independent
// of Sharp; JPEG/WebP test fixture encoding and output inspection share Sharp/libvips.
// Tests prove this host/package behavior, not production upload or hostile-process isolation.
const hash = data => createHash('sha256').update(data).digest('hex');
const hasCode = code => error => error instanceof MediaCodecError && error.code === code;

async function outputPixels(result) {
  return sharp(result.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function at(data, info, x, y) { return [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + info.channels)]; }

test('independently constructed PNG pixels become a fresh WebP with exact derived manifest', async () => {
  const input = syntheticPng(24, 16, () => [40, 110, 180, 255]);
  const result = await convertSyntheticImage(input);
  assert.equal(result.data.toString('ascii', 0, 4), 'RIFF');
  assert.equal(result.data.toString('ascii', 8, 12), 'WEBP');
  assert.notDeepEqual(result.data, input);
  assert.deepEqual(result.manifest, {
    pipeline: 'synthetic-codec-v1', sourceFormat: 'png', inputSha256: hash(input), inputBytes: input.length,
    format: 'webp', mimeType: 'image/webp', sha256: hash(result.data), width: 24, height: 16, bytes: result.data.length,
    encoder: { sharp: '0.35.5', vips: sharp.versions.vips },
    operations: ['auto-orient', 'resize-inside-1920-without-enlargement', 'strip-metadata', 'webp-quality-82-effort-4'],
  });
  const { data, info } = await outputPixels(result);
  assert.equal(info.width, 24);
  assert.equal(info.height, 16);
  const pixel = at(data, info, 12, 8);
  for (const [index, expected] of [40, 110, 180].entries()) assert.ok(Math.abs(pixel[index] - expected) <= 8);
  assert.equal(pixel[3], 255);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.manifest) && Object.isFrozen(result.manifest.encoder) && Object.isFrozen(result.manifest.operations));
});

test('real JPEG, progressive JPEG and static WebP are decoded and newly encoded', async () => {
  const source = syntheticPng(32, 20, (x, y) => [30 + x * 4, 30 + y * 6, 130, 255]);
  for (const [format, input] of [
    ['jpeg', await sharp(source).jpeg({ quality: 90 }).toBuffer()],
    ['jpeg', await sharp(source).jpeg({ quality: 90, progressive: true }).toBuffer()],
    ['webp', await sharp(source).webp({ lossless: true }).toBuffer()],
  ]) {
    const result = await convertSyntheticImage(input);
    assert.equal(result.manifest.sourceFormat, format);
    assert.equal(result.manifest.inputSha256, hash(input));
    assert.equal(result.manifest.sha256, hash(result.data));
    assert.equal((await sharp(result.data).metadata()).format, 'webp');
    const { data, info } = await outputPixels(result);
    const pixel = at(data, info, 16, 10);
    for (const [i, expected] of [94, 90, 130].entries()) assert.ok(Math.abs(pixel[i] - expected) < 20);
  }
});

test('EXIF orientation changes pixels and dimensions while source metadata is removed', async () => {
  const input = await sharp(syntheticPng(80, 40, x => x < 40 ? [220, 20, 20, 255] : [20, 20, 220, 255]))
    .withMetadata({ orientation: 6, exif: { IFD0: { Artist: 'Synthetic fixture author', Copyright: 'Synthetic fixture only' } } })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><synthetic>local-only</synthetic></x:xmpmeta>')
    .jpeg({ quality: 95 }).toBuffer();
  const before = await sharp(input).metadata();
  assert.equal(before.orientation, 6);
  assert.ok(before.exif && before.icc && before.xmp);
  const result = await convertSyntheticImage(input);
  assert.equal(result.manifest.width, 40);
  assert.equal(result.manifest.height, 80);
  const after = await sharp(result.data).metadata();
  for (const field of ['orientation', 'exif', 'icc', 'xmp', 'iptc']) assert.equal(after[field], undefined, field);
  const { data, info } = await outputPixels(result);
  const top = at(data, info, 20, 10), bottom = at(data, info, 20, 70);
  assert.ok(top[0] > 180 && top[2] < 60, 'red left source rotates to top');
  assert.ok(bottom[2] > 180 && bottom[0] < 60, 'blue right source rotates to bottom');
});

test('resize bounds both axes to1920 without enlarging small sources and preserves alpha', async () => {
  for (const [width, height] of [[2400, 30], [30, 2400], [17, 9]]) {
    const result = await convertSyntheticImage(syntheticPng(width, height, () => [70, 90, 110, 128]));
    assert.ok(result.manifest.width <= 1920 && result.manifest.height <= 1920);
    assert.ok(result.manifest.width <= width && result.manifest.height <= height);
    assert.equal(Math.max(result.manifest.width, result.manifest.height), Math.min(1920, Math.max(width, height)));
    const { data, info } = await outputPixels(result);
    assert.equal(at(data, info, 2, 2)[3], 128);
  }
});

test('input snapshot prevents ordinary Buffer mutation after the call from changing decode/hash', async () => {
  const input = syntheticPng(12, 8);
  const original = Buffer.from(input);
  const conversion = convertSyntheticImage(input);
  input.fill(0);
  const result = await conversion;
  assert.equal(result.manifest.inputSha256, hash(original));
  assert.equal(result.manifest.width, 12);
});

test('actual Buffer length and immutable policy enforce the10MiB cap before parsing', async () => {
  assert.ok(Object.isFrozen(SYNTHETIC_CODEC_POLICY));
  await assert.rejects(convertSyntheticImage(Buffer.alloc(SYNTHETIC_CODEC_POLICY.maxInputBytes + 1)), hasCode('INPUT_TOO_LARGE'));
  for (const input of [Buffer.alloc(0), new Uint8Array([1, 2]), 'image.jpg', null]) {
    await assert.rejects(convertSyntheticImage(input), hasCode('INVALID_INPUT'));
  }
});

test('forged PNG headers exceed40MP or the separate16384-axis limit before decode', async () => {
  for (const [width, height] of [[7000, 6000], [16385, 1], [1, 16385], [0xffffffff, 0xffffffff]]) {
    await assert.rejects(convertSyntheticImage(dimensionHeaderPng(width, height)), hasCode('IMAGE_TOO_LARGE'));
  }
  await assert.rejects(convertSyntheticImage(dimensionHeaderPng(0, 2)), hasCode('INVALID_IMAGE'));
});

test('output cap uses actual freshly encoded bytes and trusted overrides can only tighten it', async () => {
  const input = syntheticPng();
  const result = await convertSyntheticImage(input);
  const exact = await convertSyntheticImage(input, { maxOutputBytes: result.data.length });
  assert.equal(exact.manifest.bytes, result.data.length);
  await assert.rejects(convertSyntheticImage(input, { maxOutputBytes: result.data.length - 1 }), hasCode('OUTPUT_TOO_LARGE'));
  for (const maxOutputBytes of [0, -1, 1.5, NaN, Infinity, SYNTHETIC_CODEC_POLICY.maxOutputBytes + 1]) {
    await assert.rejects(convertSyntheticImage(input, { maxOutputBytes }), hasCode('INVALID_INPUT'));
  }
});

test('unsupported formats and signature-only spoofing do not produce output', async () => {
  for (const input of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from('GIF89a'), Buffer.from('not an image')]) {
    await assert.rejects(convertSyntheticImage(input), hasCode('UNSUPPORTED_FORMAT'));
  }
  for (const input of [pngSignature, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), webpContainer([riffChunk('VP8 ', Buffer.from('not pixels'))])]) {
    await assert.rejects(convertSyntheticImage(input), hasCode('INVALID_IMAGE'));
  }
});

test('container names compare literal bytes and never mask high-bit lookalikes', async () => {
  const png = syntheticPng(2, 2, undefined, [pngChunk(Buffer.from([0xe1, 0x63, 0x54, 0x4c]), Buffer.alloc(8))]);
  await assert.rejects(convertSyntheticImage(png), hasCode('INVALID_IMAGE'));
  const webp = await sharp(syntheticPng()).webp().toBuffer();
  const spoofedSignature = Buffer.from(webp);
  spoofedSignature[0] |= 0x80;
  await assert.rejects(convertSyntheticImage(spoofedSignature), hasCode('UNSUPPORTED_FORMAT'));
  const spoofedChunk = Buffer.from(webp);
  spoofedChunk[12] |= 0x80;
  await assert.rejects(convertSyntheticImage(spoofedChunk), hasCode('INVALID_IMAGE'));
});

test('truncation, invalid PNG CRC/data and RIFF length/overflow fail closed', async () => {
  const png = syntheticPng();
  const jpeg = await sharp(png).jpeg().toBuffer();
  const webp = await sharp(png).webp().toBuffer();
  for (const input of [png, jpeg, webp]) {
    await assert.rejects(convertSyntheticImage(input.subarray(0, input.length - 5)), hasCode('INVALID_IMAGE'));
  }
  const crcCorrupt = Buffer.from(png);
  crcCorrupt[crcCorrupt.length - 1] ^= 1;
  const chunkOverflow = Buffer.from(webp);
  chunkOverflow.writeUInt32LE(0xffffffff, 16);
  for (const input of [crcCorrupt, corruptPngCompressedData(), chunkOverflow, Buffer.concat([webp, Buffer.from([0])])]) {
    await assert.rejects(convertSyntheticImage(input), hasCode('INVALID_IMAGE'));
  }
});

test('full APNG and APNG frame/control chunks are rejected rather than taking one frame', async () => {
  await assert.rejects(convertSyntheticImage(syntheticApng()), hasCode('ANIMATED_INPUT'));
  for (const type of ['acTL', 'fcTL', 'fdAT']) {
    await assert.rejects(convertSyntheticImage(syntheticPng(2, 2, undefined, [pngChunk(type, Buffer.alloc(8))])), hasCode('ANIMATED_INPUT'));
  }
});

test('real animated WebP and each animation indicator are rejected', async () => {
  const raw = Buffer.alloc(8 * 16 * 3);
  raw.fill(80, 0, 8 * 8 * 3);
  raw.fill(180, 8 * 8 * 3);
  const animation = await sharp(raw, { raw: { width: 8, height: 16, channels: 3, pageHeight: 8 } })
    .webp({ lossless: true, delay: [100, 100], loop: 0 }).toBuffer();
  assert.equal((await sharp(animation, { animated: true }).metadata()).pages, 2);
  await assert.rejects(convertSyntheticImage(animation), hasCode('ANIMATED_INPUT'));
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x02;
  for (const input of [
    webpContainer([riffChunk('VP8X', vp8x)]),
    webpContainer([riffChunk('ANIM', Buffer.alloc(6))]),
    webpContainer([riffChunk('ANMF', Buffer.alloc(16))]),
  ]) await assert.rejects(convertSyntheticImage(input), hasCode('ANIMATED_INPUT'));
});

test('concatenated JPEGs, source trailing data and JPEG MPF are rejected', async () => {
  const jpeg = await sharp(syntheticPng()).jpeg({ progressive: true }).toBuffer();
  await assert.rejects(convertSyntheticImage(Buffer.concat([jpeg, jpeg])), hasCode('INVALID_IMAGE'));
  await assert.rejects(convertSyntheticImage(Buffer.concat([jpeg, Buffer.from([0])])), hasCode('INVALID_IMAGE'));
  await assert.rejects(convertSyntheticImage(Buffer.concat([jpeg, Buffer.from('hidden trailing payload'), Buffer.from([0xff, 0xd9])])), hasCode('INVALID_IMAGE'));
  const mpfSegment = Buffer.concat([Buffer.from([0xff, 0xe2, 0x00, 0x06]), Buffer.from('MPF\0')]);
  const mpf = Buffer.concat([jpeg.subarray(0, 2), mpfSegment, jpeg.subarray(2)]);
  await assert.rejects(convertSyntheticImage(mpf), hasCode('ANIMATED_INPUT'));
  const afterScanMpf = Buffer.concat([jpeg.subarray(0, -2), mpfSegment, jpeg.subarray(-2)]);
  await assert.rejects(convertSyntheticImage(afterScanMpf), hasCode('ANIMATED_INPUT'));
});
