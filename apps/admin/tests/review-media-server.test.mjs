import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewGalleryRequest, reviewImageRequest } from '../dist/tests/lib/review-media-server.js';
import {
  GET as galleryGET,
  dynamic as galleryDynamic,
} from '../dist/tests/app/api/staff/reviews/[id]/[revision]/media-gallery/route.js';
import {
  GET as imageGET,
  dynamic as imageDynamic,
} from '../dist/tests/app/api/staff/reviews/[id]/[revision]/media/[mediaId]/preview/route.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  params = { id: id(1), revision: '12', mediaId: id(100) },
  instance = id(9),
  base = `/api/staff/reviews/${params.id}/12`;
const data = () => ({
  kind: 'review_media_gallery',
  listingId: params.id,
  revision: 12,
  version: '7',
  state: 'pending',
  photos: Array.from({ length: 4 }, (_, position) => ({
    id: id(100 + position),
    alt: 'Synthetic image',
    position,
  })),
});
const req = (kind = 'gallery', { headers = {}, suffix = '', method = 'GET', signal } = {}) =>
  new Request(
    'http://127.0.0.1:3001' +
      base +
      (kind === 'gallery' ? '/media-gallery' : `/media/${params.mediaId}/preview`) +
      suffix,
    {
      method,
      signal,
      headers: {
        host: '127.0.0.1:3001',
        origin: 'http://127.0.0.1:3001',
        'x-preview-instance': instance,
        'x-revision-version': '7',
        'sec-fetch-site': 'same-origin',
        ...headers,
      },
    },
  );
const webp = () => {
  const b = Buffer.alloc(24);
  b.write('RIFF');
  b.writeUInt32LE(16, 4);
  b.write('WEBP', 8);
  return b;
};
const image = () =>
  new Response(webp(), { headers: { 'Content-Type': 'image/webp', 'Content-Length': '24' } });
function privateHeaders(r) {
  assert.equal(r.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('cross-origin-resource-policy'), 'same-origin');
  for (const key of ['set-cookie', 'location', 'etag', 'last-modified', 'content-range'])
    assert.equal(r.headers.has(key), false);
}
test('fixed reviewer media proxies preserve private bounded version and server credential boundaries', async (t) => {
  const env = { ...process.env },
    fetch = globalThis.fetch;
  Object.assign(process.env, {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_MEDIA: 'synthetic',
    STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
    STAFF_PREVIEW_TOKEN: 'a.b.c',
    STAFF_PREVIEW_INSTANCE: instance,
  });
  t.after(() => {
    globalThis.fetch = fetch;
    for (const k of Object.keys(process.env)) if (!Object.hasOwn(env, k)) delete process.env[k];
    Object.assign(process.env, env);
  });
  let calls = [];
  const mock = (response = () => Response.json(data())) => {
    calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return response();
    };
  };
  await t.test(
    'compiled gallery GET fixes upstream route and captures credentials only on server',
    async () => {
      mock();
      assert.equal(galleryDynamic, 'force-dynamic');
      const r = await galleryGET(req(), { params: Promise.resolve(params) });
      assert.equal(r.status, 200);
      privateHeaders(r);
      assert.deepEqual(await r.json(), data());
      assert.equal(calls.length, 1);
      assert.equal(
        calls[0].url,
        `http://127.0.0.1:4101/v2/staff/reviews/${params.id}/revisions/12/media-gallery`,
      );
      assert.equal(calls[0].init.headers.Authorization, 'Bearer a.b.c');
      assert.equal(calls[0].init.headers['X-Revision-Version'], '7');
      assert.equal(calls[0].init.credentials, 'omit');
    },
  );
  await t.test(
    'compiled image GET preserves exact bytes and safe private response headers',
    async () => {
      mock(image);
      assert.equal(imageDynamic, 'force-dynamic');
      const r = await imageGET(req('image'), { params: Promise.resolve(params) });
      assert.equal(r.status, 200);
      privateHeaders(r);
      assert.equal(r.headers.get('x-revision-version'), '7');
      assert.deepEqual(Buffer.from(await r.arrayBuffer()), webp());
      assert.equal(
        calls[0].url,
        `http://127.0.0.1:4101/v2/staff/reviews/${params.id}/12/media/${params.mediaId}/preview`,
      );
    },
  );
  await t.test(
    'instance authorization origin and site restrictions block both before upstream work',
    async () => {
      for (const kind of ['gallery', 'image'])
        for (const headers of [
          { 'x-preview-instance': id(8) },
          { authorization: 'Bearer caller' },
          { origin: 'https://foreign.invalid' },
          { 'sec-fetch-site': 'cross-site' },
        ]) {
          mock();
          const r = await (kind === 'gallery' ? reviewGalleryRequest : reviewImageRequest)(
            req(kind, { headers }),
            params,
          );
          assert.equal(r.status, 403);
          privateHeaders(r);
          assert.equal(calls.length, 0);
        }
    },
  );
  await t.test(
    'caller context framing queries and invalid version are rejected without forwarding',
    async () => {
      for (const kind of ['gallery', 'image'])
        for (const options of [
          { suffix: '?version=7' },
          { headers: { 'x-revision-version': '07' } },
          { headers: { 'x-revision-version': '7, 7' } },
          { headers: { 'x-tenant-id': id(2) } },
          { headers: { cookie: 'x=1' } },
          { headers: { range: 'bytes=0-1' } },
          { headers: { 'if-none-match': 'x' } },
          { headers: { 'content-length': '0' } },
        ]) {
          mock();
          assert.equal(
            (
              await (kind === 'gallery' ? reviewGalleryRequest : reviewImageRequest)(
                req(kind, options),
                params,
              )
            ).status,
            400,
          );
          assert.equal(calls.length, 0);
        }
    },
  );
  await t.test(
    'malformed gallery or image responses cannot leak upstream private data',
    async () => {
      mock(() => Response.json({ ...data(), privatePath: 'PRIVATE' }));
      const gallery = await reviewGalleryRequest(req(), params);
      assert.equal(gallery.status, 502);
      assert.equal((await gallery.text()).includes('PRIVATE'), false);
      mock(
        () =>
          new Response('PRIVATE', {
            headers: { 'Content-Type': 'image/webp', 'Content-Length': '7' },
          }),
      );
      assert.equal((await reviewImageRequest(req('image'), params)).status, 502);
    },
  );
  await t.test(
    'denials preserve safe status without forwarding SQL diagnostics or cookies',
    async () => {
      for (const status of [401, 403, 404, 409, 503]) {
        mock(() =>
          Response.json(
            {
              error: {
                code: status === 409 ? 'VERSION_CONFLICT' : 'NOT_FOUND',
                message: 'PRIVATE',
              },
              requestId: id(90),
            },
            { status, headers: { 'Set-Cookie': 'PRIVATE' } },
          ),
        );
        const r = await reviewGalleryRequest(req(), params);
        assert.equal(r.status, status);
        privateHeaders(r);
        assert.equal((await r.text()).includes('PRIVATE'), false);
      }
    },
  );
  await t.test('cancelled requests and production refusal perform no upstream read', async () => {
    const controller = new AbortController();
    controller.abort();
    mock();
    assert.equal(
      (await reviewGalleryRequest(req('gallery', { signal: controller.signal }), params)).status,
      499,
    );
    assert.equal(calls.length, 0);
    process.env.NODE_ENV = 'production';
    try {
      assert.equal((await reviewImageRequest(req('image'), params)).status, 403);
      assert.equal(calls.length, 0);
    } finally {
      process.env.NODE_ENV = 'development';
    }
  });
});
