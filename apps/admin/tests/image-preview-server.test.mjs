import assert from 'node:assert/strict';
import test from 'node:test';
import { imagePreviewRequest } from '../dist/tests/lib/image-preview-server.js';
import {
  GET,
  dynamic,
} from '../dist/tests/app/api/staff/drafts/[id]/[revision]/media/[mediaId]/preview/route.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const params = { id: id(1), revision: '1', mediaId: id(2) },
  instance = id(9);
const path = `/api/staff/drafts/${params.id}/${params.revision}/media/${params.mediaId}/preview`;
// Bounded RIFF/WEBP framing fixture only; no decoder or visible image is proved.
function webp() {
  const bytes = new Uint8Array(20);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  new DataView(bytes.buffer).setUint32(4, 12, true);
  bytes.set(new TextEncoder().encode('WEBPVP8 '), 8);
  return bytes;
}
function imageResponse(data = webp(), patch = {}, status = 200) {
  return new Response(data, {
    status,
    headers: { 'Content-Type': 'image/webp', 'Content-Length': String(data.byteLength), ...patch },
  });
}
function request({
  headers = {},
  url = `http://127.0.0.1:3001${path}`,
  method = 'GET',
  signal,
} = {}) {
  return new Request(url, {
    method,
    signal,
    headers: {
      host: '127.0.0.1:3001',
      origin: 'http://127.0.0.1:3001',
      'x-preview-instance': instance,
      'x-revision-version': '3',
      'sec-fetch-site': 'same-origin',
      ...headers,
    },
  });
}
function privateHeaders(response) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('expires'), '0');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  for (const name of [
    'etag',
    'last-modified',
    'content-range',
    'content-encoding',
    'set-cookie',
    'location',
  ])
    assert.equal(response.headers.has(name), false, name);
}
async function safeError(response, status, code) {
  assert.equal(response.status, status);
  privateHeaders(response);
  assert.deepEqual(await response.json(), {
    error: { code, message: 'Private image preview is unavailable.' },
    submissionUncertain: false,
  });
}

// Actual exported proxy and compiled Next route through the real SDK, using
// controlled fetch responses. No local server, identity provider or native/store
// proof is claimed by these transport-boundary tests.
test('private image proxy and GET route retain exact loopback scope, bounded reads and safe read-only failures', async (t) => {
  const oldEnv = { ...process.env },
    oldFetch = globalThis.fetch;
  let calls = [];
  Object.assign(process.env, {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_MEDIA: 'synthetic',
    STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
    STAFF_PREVIEW_TOKEN: 'a.b.c',
    STAFF_PREVIEW_INSTANCE: instance,
  });
  t.after(() => {
    globalThis.fetch = oldFetch;
    for (const key of Object.keys(process.env))
      if (!Object.hasOwn(oldEnv, key)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  });
  const mock = (operation = () => imageResponse()) => {
    calls = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return operation(input, init);
    };
  };

  await t.test(
    'helper returns owned private WebP bytes and forwards only server identity and validated scope',
    async () => {
      const fixture = webp();
      mock(() => imageResponse(fixture));
      const response = await imagePreviewRequest(
        request({ headers: { 'accept-encoding': 'gzip, deflate, br', 'x-caller-role': 'admin' } }),
        params,
      );
      assert.equal(response.status, 200);
      privateHeaders(response);
      assert.equal(response.headers.get('content-type'), 'image/webp');
      assert.equal(response.headers.get('content-length'), '20');
      assert.equal(response.headers.get('x-revision-version'), '3');
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), fixture);
      assert.equal(calls.length, 1);
      const { url, init } = calls[0],
        headers = new Headers(init.headers);
      assert.equal(
        url,
        `http://127.0.0.1:4101/v2/staff/listings/${params.id}/revisions/1/media/${params.mediaId}/preview`,
      );
      assert.equal(init.method, 'GET');
      assert.equal(init.body, undefined);
      assert.equal(init.credentials, 'omit');
      assert.equal(init.cache, 'no-store');
      assert.equal(init.redirect, 'error');
      assert.equal(headers.get('authorization'), 'Bearer a.b.c');
      assert.equal(headers.get('x-revision-version'), '3');
      for (const name of [
        'host',
        'origin',
        'cookie',
        'x-preview-instance',
        'x-caller-role',
        'accept-encoding',
        'content-type',
        'range',
      ])
        assert.equal(headers.has(name), false, name);
      assert.ok(init.signal instanceof AbortSignal);
      assert.equal(url.includes('a.b.c'), false);
      assert.equal(url.includes(instance), false);
    },
  );

  await t.test(
    'actual GET export awaits route params and preserves the maximum exact version string',
    async () => {
      mock();
      let resolved = false;
      const routeParams = Promise.resolve().then(() => {
        resolved = true;
        return params;
      });
      const response = await GET(
        request({ headers: { 'x-revision-version': '9007199254740991' } }),
        { params: routeParams },
      );
      assert.equal(resolved, true);
      assert.equal(dynamic, 'force-dynamic');
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-revision-version'), '9007199254740991');
      assert.equal(
        new Headers(calls[0].init.headers).get('x-revision-version'),
        '9007199254740991',
      );
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), webp());
    },
  );

  await t.test(
    'production, default metadata mode and unavailable configured credentials refuse before upstream IO',
    async () => {
      mock();
      for (const [key, value] of [
        ['NODE_ENV', 'production'],
        ['STAFF_PREVIEW_MODE', ''],
        ['STAFF_PREVIEW_MEDIA', ''],
        ['STAFF_PREVIEW_TOKEN', 'selected invalid token'],
        ['STAFF_PREVIEW_API_ORIGIN', 'https://external.invalid/'],
        ['STAFF_PREVIEW_INSTANCE', 'old'],
      ]) {
        const prior = process.env[key];
        process.env[key] = value;
        try {
          await safeError(await imagePreviewRequest(request(), params), 403, 'PREVIEW_UNAVAILABLE');
        } finally {
          if (prior === undefined) delete process.env[key];
          else process.env[key] = prior;
        }
      }
      assert.equal(calls.length, 0);
    },
  );

  await t.test(
    'exact Host, instance, fetch-site, optional Origin and browser bearer guards run before upstream IO',
    async () => {
      mock();
      for (const headers of [
        { host: 'evil.invalid' },
        { host: '127.0.0.1:3001, 127.0.0.1:3001' },
        { 'x-preview-instance': 'old' },
        { 'x-preview-instance': `${instance}, ${instance}` },
        { 'sec-fetch-site': 'cross-site' },
        { origin: 'https://other.invalid' },
        { origin: '' },
        { authorization: 'Bearer selected' },
      ])
        await safeError(
          await imagePreviewRequest(request({ headers }), params),
          403,
          'PREVIEW_UNAVAILABLE',
        );
      await safeError(
        await imagePreviewRequest(request({ url: `https://127.0.0.1:3001${path}` }), params),
        403,
        'PREVIEW_UNAVAILABLE',
      );
      assert.equal(calls.length, 0);
      const withoutOrigin = request();
      withoutOrigin.headers.delete('origin');
      withoutOrigin.headers.set('sec-fetch-site', 'none');
      assert.equal((await imagePreviewRequest(withoutOrigin, params)).status, 200);
      assert.equal(calls.length, 1);
      mock();
      assert.equal(
        (await imagePreviewRequest(request({ url: `http://localhost:3001${path}` }), params))
          .status,
        200,
      );
    },
  );

  await t.test(
    'query, fragment, encoded/trailing aliases, tuple mismatches and noncanonical version tokens cannot reach upstream',
    async () => {
      mock();
      for (const url of [
        `http://127.0.0.1:3001${path}?`,
        `http://127.0.0.1:3001${path}?version=3`,
        `http://127.0.0.1:3001${path}#private`,
        `http://127.0.0.1:3001${path}/`,
        `http://127.0.0.1:3001${path.replace('/preview', '/%70review')}`,
        `http://127.0.0.1:3001${path.replace('/media/', '//media/')}`,
      ])
        await safeError(await imagePreviewRequest(request({ url }), params), 400, 'INVALID_INPUT');
      for (const changed of [
        { ...params, id: 'bad' },
        { ...params, mediaId: 'bad' },
        { ...params, revision: '01' },
        { ...params, revision: '0' },
        { ...params, revision: '2147483648' },
        { ...params, mediaId: id(3) },
      ])
        await safeError(await imagePreviewRequest(request(), changed), 400, 'INVALID_INPUT');
      for (const version of [
        '',
        '0',
        '03',
        '-1',
        '3.0',
        '3e0',
        '3, 3',
        '9007199254740992',
        '9223372036854775807',
      ])
        await safeError(
          await imagePreviewRequest(
            request({ headers: { 'x-revision-version': version } }),
            params,
          ),
          400,
          'INVALID_INPUT',
        );
      const missing = request();
      missing.headers.delete('x-revision-version');
      await safeError(await imagePreviewRequest(missing, params), 400, 'INVALID_INPUT');
      assert.equal(calls.length, 0);
    },
  );

  await t.test(
    'GET-only and body/framing/range/conditional/content-encoding/Expect/cookie refusal never reads or forwards bytes',
    async () => {
      mock();
      for (const method of ['POST', 'PUT', 'DELETE', 'HEAD'])
        await safeError(
          await GET(request({ method, headers: { 'content-type': 'application/json' } }), {
            params: Promise.resolve(params),
          }),
          405,
          'METHOD_NOT_ALLOWED',
        );
      for (const headers of [
        { 'content-length': '0' },
        { 'content-length': '1' },
        { 'transfer-encoding': 'chunked' },
        { 'content-type': 'image/webp' },
        { 'content-encoding': 'identity' },
        { expect: '100-continue' },
        { range: 'bytes=0-19' },
        { 'if-match': '3' },
        { 'if-none-match': 'anything' },
        { 'if-modified-since': 'yesterday' },
        { 'if-range': 'bytes' },
        { cookie: 'session=selected' },
      ])
        await safeError(
          await imagePreviewRequest(request({ headers }), params),
          400,
          'INVALID_INPUT',
        );
      let pulls = 0;
      const body = new ReadableStream(
          {
            pull() {
              pulls++;
            },
          },
          { highWaterMark: 0 },
        ),
        withBody = request();
      // Native Request disallows a GET body; instrument its server-facing property
      // to verify the exported boundary also refuses an unexpected adapter stream.
      Object.defineProperty(withBody, 'body', { value: body });
      await safeError(await imagePreviewRequest(withBody, params), 400, 'INVALID_INPUT');
      assert.equal(pulls, 0);
      await body.cancel();
      assert.equal(calls.length, 0);
    },
  );

  await t.test(
    'safe HTTP errors and malformed binary successes never disclose upstream text or storage selectors',
    async () => {
      for (const [status, code, safeCode] of [
        [401, 'UNAUTHENTICATED', 'UNAUTHENTICATED'],
        [403, 'FORBIDDEN', 'FORBIDDEN'],
        [404, 'NOT_FOUND', 'NOT_FOUND'],
        [409, 'VERSION_CONFLICT', 'VERSION_CONFLICT'],
        [503, 'SERVICE_UNAVAILABLE', 'PREVIEW_UNAVAILABLE'],
      ]) {
        mock(() =>
          Response.json(
            {
              error: { code, message: 'Private image preview is unavailable.' },
              requestId: id(50),
            },
            { status, headers: { 'X-Request-Id': id(50) } },
          ),
        );
        await safeError(await imagePreviewRequest(request(), params), status, safeCode);
        assert.equal(calls.length, 1);
      }
      const malformed = webp();
      malformed[0] = 0;
      for (const response of [
        () => imageResponse(webp(), { 'Content-Type': 'application/json' }),
        () => imageResponse(webp(), { 'Content-Encoding': 'gzip' }),
        () => imageResponse(webp(), { 'Content-Range': 'bytes 0-19/20' }),
        () => new Response(webp(), { headers: { 'Content-Type': 'image/webp' } }),
        () => imageResponse(webp(), { 'Content-Length': '21' }),
        () => imageResponse(webp(), { 'Content-Length': String(10 * 1024 * 1024 + 1) }),
        () => imageResponse(malformed),
        () => imageResponse(webp(), {}, 201),
        () =>
          new Response(null, {
            status: 302,
            headers: { Location: 'http://private.invalid/storage-secret' },
          }),
      ]) {
        mock(response);
        await safeError(await imagePreviewRequest(request(), params), 502, 'PREVIEW_UNAVAILABLE');
        assert.equal(calls.length, 1);
      }
      mock(() => {
        throw new Error('C:\\private-storage\\root-secret');
      });
      await safeError(await imagePreviewRequest(request(), params), 502, 'PREVIEW_UNAVAILABLE');
      assert.equal(calls.length, 1);
    },
  );

  await t.test(
    'request cancellation prevents initial IO and interrupts the SDK response read without a write uncertainty flag',
    async () => {
      mock();
      const pre = new AbortController();
      pre.abort();
      await safeError(
        await imagePreviewRequest(request({ signal: pre.signal }), params),
        499,
        'CANCELLED',
      );
      assert.equal(calls.length, 0);
      const active = new AbortController();
      let cancelled = false,
        signal;
      mock((_url, init) => {
        signal = init.signal;
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(webp().subarray(0, 12));
          },
          cancel() {
            cancelled = true;
          },
        });
        setTimeout(() => active.abort(), 5);
        return new Response(stream, {
          headers: { 'Content-Type': 'image/webp', 'Content-Length': '20' },
        });
      });
      await safeError(
        await imagePreviewRequest(request({ signal: active.signal }), params),
        499,
        'CANCELLED',
      );
      assert.equal(signal.aborted, true);
      assert.equal(cancelled, true);
      assert.equal(calls.length, 1);
    },
  );
});
