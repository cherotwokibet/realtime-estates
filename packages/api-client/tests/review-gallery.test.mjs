import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient, ApiClientError } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  L = id(3),
  options = { bearerToken: 'synthetic' },
  origin = 'https://synthetic.invalid';
const gallery = () => ({
  kind: 'review_media_gallery',
  listingId: L,
  revision: 12,
  version: '7',
  state: 'pending',
  photos: Array.from({ length: 4 }, (_, position) => ({
    id: id(100 + position),
    alt: 'Synthetic',
    position,
  })),
});
const client = (fetch) =>
  new RealtorApiClient({ baseUrl: origin, privacyNoticeVersion: 'synthetic-v1', fetch });
const get = (api) => api.getReviewMediaGalleryV2(L, 12, '7', options);
test('review gallery client fixes path version credentials and detached frozen response without retries', async () => {
  let calls = 0;
  const data = gallery(),
    api = client(async (url, init) => {
      calls++;
      assert.equal(url, `${origin}/v2/staff/reviews/${L}/revisions/12/media-gallery`);
      assert.equal(init.method, 'GET');
      assert.equal(init.headers['X-Revision-Version'], '7');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      assert.equal(init.body, undefined);
      return Response.json(data);
    });
  const result = await get(api);
  assert.deepEqual(result, data);
  assert.ok(
    Object.isFrozen(result) && Object.isFrozen(result.photos) && Object.isFrozen(result.photos[0]),
  );
  assert.equal(calls, 1);
});
test('review gallery rejects mismatched or unbounded projections and original request validation', async () => {
  for (const data of [
    { ...gallery(), version: '8' },
    { ...gallery(), state: 'draft' },
    { ...gallery(), photos: [] },
    { ...gallery(), photos: gallery().photos.map((p) => ({ ...p, position: 0 })) },
    { ...gallery(), photos: gallery().photos.map((p) => ({ ...p, path: 'PRIVATE' })) },
  ]) {
    let calls = 0;
    const api = client(async () => {
      calls++;
      return Response.json(data);
    });
    await assert.rejects(
      () => get(api),
      (e) => e instanceof ApiClientError && e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  const api = client(async () => {
    calls++;
    throw Error();
  });
  await assert.rejects(() => api.getReviewMediaGalleryV2(L, 12, '0', options));
  assert.equal(calls, 0);
});
test('review image client fixes reviewer path and exact version using bounded image reader', async () => {
  let calls = 0;
  const bytes = Buffer.alloc(24);
  bytes.write('RIFF');
  bytes.writeUInt32LE(16, 4);
  bytes.write('WEBP', 8);
  const api = client(async (url, init) => {
    calls++;
    assert.equal(url, `${origin}/v2/staff/reviews/${L}/12/media/${id(100)}/preview`);
    assert.equal(init.headers['X-Revision-Version'], '7');
    return new Response(bytes, {
      headers: { 'Content-Type': 'image/webp', 'Content-Length': '24' },
    });
  });
  const image = await api.getReviewMediaPreviewV2(L, 12, id(100), '7', options);
  assert.deepEqual(Buffer.from(image.data), bytes);
  assert.equal(calls, 1);
});
