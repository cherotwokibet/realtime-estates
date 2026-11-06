import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { RealtorApiClient, readPublishedFloorPlanImageBytes } from '../dist/index.js';
import { convertSyntheticFloorPlan } from '../../media/dist/index.js';
import { syntheticPng } from '../../media/tests/fixtures.mjs';
const output = await convertSyntheticFloorPlan(syntheticPng()),
  listing = '00000000-0000-4000-8000-000000000100';
const saved = {
  policy: 'synthetic-published-floor-plan-v1',
  listingId: listing,
  revision: 1,
  approvedVersion: '6',
  floorPlan: {
    width: output.manifest.width,
    height: output.manifest.height,
    bytes: output.data.length,
    sha256: createHash('sha256').update(output.data).digest('hex'),
  },
};
const url = `https://synthetic.invalid/v3/properties/${listing}/revisions/1/floor-plan-image/6`;
const image = (bytes = output.data, headers = {}) =>
  new Response(bytes, {
    headers: {
      'content-type': 'image/webp',
      'content-length': String(saved.floorPlan.bytes),
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
const meta = (v) => Response.json(v, { headers: { 'cache-control': 'no-store' } });
const client = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'synthetic',
    fetch,
  });
test('anonymous SDK image joins exact metadata around verified bytes without caller credentials', async () => {
  const seen = [];
  const api = client(async (u, o) => {
    seen.push(String(u));
    assert.equal(o.credentials, 'omit');
    assert.equal(o.cache, 'no-store');
    assert.equal(o.redirect, 'error');
    assert.equal(new Headers(o.headers).has('authorization'), false);
    return String(u).includes('floor-plan-image') ? image() : meta(saved);
  });
  const r = await api.getPublishedFloorPlanImage(listing, 1, '6');
  assert.deepEqual(Buffer.from(r.data), output.data);
  assert.deepEqual(r.metadata, saved);
  assert.equal(seen.length, 3);
  await assert.rejects(
    () => api.getPublishedFloorPlanImage(listing, 1, '6', { bearerToken: 'forbidden' }),
    (e) => e.kind === 'VALIDATION',
  );
  assert.equal(seen.length, 3);
});
test('published image refuses stale or changed metadata and never repairs or retries', async () => {
  let calls = 0;
  const api = client(async (u) => {
    calls++;
    return String(u).includes('floor-plan-image')
      ? image()
      : meta(calls > 1 ? { ...saved, approvedVersion: '7' } : saved);
  });
  await assert.rejects(() => api.getPublishedFloorPlanImage(listing, 1, '6'));
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(() =>
    client(async () => {
      calls++;
      return meta(saved);
    }).getPublishedFloorPlanImage(listing, 1, '5'),
  );
  assert.equal(calls, 1);
});
test('binary reader rejects target aliases, invalid headers and changed image bytes', async () => {
  for (const u of [
    url + '?',
    url + '#x',
    url.replace('/6', '/06'),
    url.replace('https:', 'ftp:'),
    '//synthetic.invalid' + new URL(url).pathname,
  ])
    await assert.rejects(() =>
      readPublishedFloorPlanImageBytes(u, saved, new AbortController().signal, async () => {
        throw Error('Must not fetch');
      }),
    );
  for (const response of [
    () => image(Buffer.alloc(output.data.length)),
    () => image(output.data, { 'content-length': '1' }),
    () => image(output.data, { 'content-encoding': 'gzip' }),
    () => image(output.data, { 'cache-control': 'public,max-age=60' }),
  ])
    await assert.rejects(() =>
      readPublishedFloorPlanImageBytes(url, saved, new AbortController().signal, async () =>
        response(),
      ),
    );
});
test('abort settles stalled response bodies and cancels late transport results', async () => {
  const c = new AbortController();
  let cancel = 0,
    entered;
  const ready = new Promise((r) => (entered = r));
  const r = readPublishedFloorPlanImageBytes(url, saved, c.signal, async () => {
    entered();
    return image(
      new ReadableStream({
        pull() {},
        cancel() {
          cancel++;
        },
      }),
    );
  });
  await ready;
  await new Promise((r) => setTimeout(r, 0));
  c.abort();
  await assert.rejects(() => r);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(cancel >= 1);
  let release;
  const held = new Promise((r) => (release = r)),
    late = new AbortController();
  const p = readPublishedFloorPlanImageBytes(url, saved, late.signal, () => held);
  late.abort();
  await assert.rejects(() => p);
  release(
    image(
      new ReadableStream({
        cancel() {
          cancel++;
        },
      }),
    ),
  );
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(cancel >= 1);
});

test('public metadata accessors and pre-aborted SDK reads never enter transport', async () => {
  let invoked = false,
    calls = 0;
  const value = { ...saved };
  Object.defineProperty(value, 'listingId', {
    enumerable: true,
    get() {
      invoked = true;
      return listing;
    },
  });
  await assert.rejects(() =>
    readPublishedFloorPlanImageBytes(url, value, new AbortController().signal, async () => {
      calls++;
      return image();
    }),
  );
  assert.equal(invoked, false);
  assert.equal(calls, 0);
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    () =>
      client(async () => {
        calls++;
        return meta(saved);
      }).getPublishedFloorPlanImage(listing, 1, '6', { signal: c.signal }),
    (e) => e.kind === 'CANCELLED',
  );
  assert.equal(calls, 0);
});

test('trusted platform digest adapter preserves verification without WebCrypto and rejects bad or interrupted digests', async () => {
  const make = (digest) =>
    new RealtorApiClient({
      baseUrl: 'https://synthetic.invalid',
      privacyNoticeVersion: 'synthetic',
      floorPlanImageDigest: digest,
      fetch: async (u) => (String(u).includes('floor-plan-image') ? image() : meta(saved)),
    });
  const hash = async (data) => {
    const d = createHash('sha256').update(data).digest();
    return d.buffer.slice(d.byteOffset, d.byteOffset + d.length);
  };
  assert.deepEqual(
    Buffer.from((await make(hash).getPublishedFloorPlanImage(listing, 1, '6')).data),
    output.data,
  );
  await assert.rejects(
    () => make(async () => new ArrayBuffer(32)).getPublishedFloorPlanImage(listing, 1, '6'),
    (e) => e.kind === 'INVALID_RESPONSE',
  );
  const c = new AbortController();
  await assert.rejects(
    () =>
      make(async () => {
        c.abort();
        return new Promise(() => {});
      }).getPublishedFloorPlanImage(listing, 1, '6', { signal: c.signal }),
    (e) => e.kind === 'CANCELLED',
  );
  assert.throws(
    () => make('wrong'),
    (e) => e.kind === 'CONFIGURATION',
  );
});
