import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { loadMobilePhoto } from '../dist/tests/src/published-photos.js';
import { resolveMobileReferenceConfig } from '../dist/tests/src/reference-catalogue.js';
import { mobileWebpDataUri } from '../dist/tests/src/image-data-uri.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const bytes = await sharp({
  create: { width: 320, height: 240, channels: 3, background: '#248ba3' },
})
  .webp()
  .toBuffer();
const config = {
  mode: 'synthetic-reference-public-v1',
  tenantSlug: 'realtime-estates',
  apiOrigin: 'https://synthetic.invalid',
  allowLoopbackHttp: false,
  photoMode: 'synthetic-native-v1',
};
const property = {
  id: id(10),
  revision: 2,
  photos: [
    { key: `synthetic/${id(1)}/${id(2)}/${id(3)}.webp`, alt: 'Synthetic first image' },
    { key: `synthetic/${id(1)}/${id(4)}/${id(5)}.webp`, alt: 'Synthetic second image' },
  ],
};
const response = (data = bytes, extra = {}) =>
  new Response(data, {
    headers: {
      'content-type': 'image/webp',
      'content-length': String(bytes.length),
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      ...extra,
    },
  });
const signal = () => new AbortController().signal;
test('mobile photo mode is strict, default-off, development-only and rejects accessors/authority extras', () => {
  const raw = {
    mode: config.mode,
    apiOrigin: config.apiOrigin,
    allowLoopbackHttp: false,
    photoMode: config.photoMode,
  };
  assert.equal(
    resolveMobileReferenceConfig(raw, 'realtime-estates', true).photoMode,
    config.photoMode,
  );
  assert.equal(resolveMobileReferenceConfig(raw, 'realtime-estates', false).mode, 'error');
  for (const bad of [
    { ...raw, photoMode: 'live' },
    { ...raw, token: 'forbidden' },
    {
      ...raw,
      get photoMode() {
        throw Error('not invoked');
      },
    },
  ])
    assert.equal(resolveMobileReferenceConfig(bad, 'realtime-estates', true).mode, 'error');
});
test('selected mobile photo uses exact configured anonymous target and owns decoded fixture bytes only', async () => {
  let calls = 0;
  const result = await loadMobilePhoto(config, property, 1, signal(), async (url, o) => {
    calls++;
    assert.equal(
      url,
      `${config.apiOrigin}/v2/public/listings/${property.id}/revisions/2/photos/${id(4)}/${id(5)}.webp`,
    );
    assert.equal(o.credentials, 'omit');
    assert.equal(o.redirect, 'error');
    assert.equal(o.cache, 'no-store');
    assert.deepEqual([...new Headers(o.headers).keys()], ['accept']);
    return response();
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, {
    status: 'ready',
    uri: 'data:image/webp;base64,' + bytes.toString('base64'),
    alt: 'Synthetic second image',
    index: 1,
    count: 2,
  });
  assert.equal(JSON.stringify(result).includes('synthetic.invalid'), false);
});
test('off, empty, pre-cancelled, invalid target, duplicate key and descriptor aliases never dispatch', async () => {
  let calls = 0;
  const transport = async () => {
    calls++;
    return response();
  };
  assert.equal(
    (await loadMobilePhoto({ ...config, photoMode: undefined }, property, 0, signal(), transport))
      .status,
    'off',
  );
  assert.equal(
    (await loadMobilePhoto(config, { ...property, photos: [] }, 0, signal(), transport)).status,
    'empty',
  );
  const c = new AbortController();
  c.abort();
  assert.equal(
    (await loadMobilePhoto(config, property, 0, c.signal, transport)).status,
    'unavailable',
  );
  for (const p of [
    { ...property, revision: 0 },
    {
      ...property,
      get photos() {
        throw Error('must not read');
      },
    },
    { ...property, photos: [property.photos[0], property.photos[0]] },
    ...[
      'https://evil.invalid/image.webp',
      property.photos[0].key + '?x=1',
      property.photos[0].key.replace('.webp', '.png'),
    ].map((key) => ({ ...property, photos: [{ key, alt: 'Bad' }] })),
  ])
    assert.equal((await loadMobilePhoto(config, p, 0, signal(), transport)).status, 'unavailable');
  assert.equal(
    (await loadMobilePhoto(config, property, 2, signal(), transport)).status,
    'unavailable',
  );
  assert.equal(calls, 0);
});
test('denied, malformed headers, overflow, truncated and altered framing expose no image and never retry', async () => {
  for (const make of [
    () => new Response('not found', { status: 404 }),
    () => response(bytes, { 'content-type': 'image/png' }),
    () => response(bytes, { 'content-length': '10485761' }),
    () => response(bytes, { 'cache-control': 'public' }),
    () => response(bytes, { 'content-encoding': 'gzip' }),
    () => response(bytes.subarray(1)),
    () => response(Buffer.concat([bytes, Buffer.from([1])])),
    () => {
      const b = Buffer.from(bytes);
      b[0] ^= 1;
      return response(b);
    },
  ]) {
    let calls = 0;
    const result = await loadMobilePhoto(config, property, 0, signal(), async () => {
      calls++;
      return make();
    });
    assert.equal(result.status, 'unavailable');
    assert.equal(calls, 1);
  }
});
test('uncooperative late transport and stalled body cancel without a late image or retry', async () => {
  let resolve,
    cancelled = 0;
  const c = new AbortController();
  const pending = loadMobilePhoto(
    config,
    property,
    0,
    c.signal,
    () => new Promise((r) => (resolve = r)),
  );
  c.abort();
  assert.equal((await pending).status, 'unavailable');
  resolve(
    response(
      new ReadableStream({
        cancel() {
          cancelled++;
        },
      }),
    ),
  );
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(cancelled, 1);
  const d = new AbortController();
  const body = new ReadableStream({
    cancel() {
      cancelled++;
    },
  });
  const timer = setTimeout(() => d.abort(), 10);
  try {
    assert.equal(
      (await loadMobilePhoto(config, property, 0, d.signal, async () => response(body))).status,
      'unavailable',
    );
  } finally {
    clearTimeout(timer);
  }
  assert.equal(cancelled, 2);
});
test('owned URI encoding preserves bounded chunk boundaries and cancellation across a large synthetic byte array', async () => {
  for (const size of [1, 2, 3, 12288, 12289, 24578]) {
    const data = Uint8Array.from({ length: size }, (_, n) => n % 251);
    assert.equal(
      await mobileWebpDataUri(data, signal()),
      'data:image/webp;base64,' + Buffer.from(data).toString('base64'),
    );
  }
  const c = new AbortController();
  const pending = mobileWebpDataUri(new Uint8Array(300000), c.signal);
  c.abort();
  await assert.rejects(pending);
});
