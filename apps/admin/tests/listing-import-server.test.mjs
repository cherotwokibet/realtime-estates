import test from 'node:test';
import assert from 'node:assert/strict';
import { listingImportPreviewRequest } from '../dist/tests/lib/listing-import-server.js';
import { POST, dynamic } from '../dist/tests/app/api/staff/listing-import-preview/route.js';
import { LISTING_IMPORT_COLUMNS, previewListingImport } from '@realtor/domain';
const instance = '00000000-0000-4000-8000-000000000009',
  csv =
    LISTING_IMPORT_COLUMNS.join(',') +
    '\n' +
    [
      'new-stock',
      'Synthetic title',
      '',
      'rent',
      'apartment',
      '20000.05',
      'month',
      '1',
      '1',
      '',
      'KE',
      'Synthetic locality',
      'area',
    ].join(',');
const req = ({
  method = 'POST',
  suffix = '',
  headers = {},
  body = JSON.stringify({ csv }),
  signal,
} = {}) =>
  new Request('http://127.0.0.1:3001/api/staff/listing-import-preview' + suffix, {
    method,
    signal,
    headers: {
      host: '127.0.0.1:3001',
      origin: 'http://127.0.0.1:3001',
      'x-preview-instance': instance,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...headers,
    },
    ...(method === 'GET' ? {} : { body, ...(typeof body !== 'string' ? { duplex: 'half' } : {}) }),
  });
function privateReply(r) {
  assert.match(r.headers.get('cache-control'), /private, no-store/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(r.headers.has('set-cookie'), false);
}
test('import preview proxy is fixed, server-only, bounded and read-only', async (t) => {
  const env = { ...process.env },
    fetch = globalThis.fetch;
  Object.assign(process.env, {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
    STAFF_PREVIEW_TOKEN: 'a.b.c',
    STAFF_PREVIEW_INSTANCE: instance,
  });
  t.after(() => {
    globalThis.fetch = fetch;
    for (const key of Object.keys(process.env))
      if (!Object.hasOwn(env, key)) delete process.env[key];
    Object.assign(process.env, env);
  });
  let calls = [];
  const mock = (response = () => Response.json(previewListingImport(csv, [], true))) => {
    calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return response();
    };
  };
  await t.test(
    'compiled POST uses fixed SDK and server bearer, strips all browser context and returns private data',
    async () => {
      mock();
      assert.equal(dynamic, 'force-dynamic');
      const r = await POST(req());
      assert.equal(r.status, 200);
      privateReply(r);
      const p = await r.json();
      assert.equal(p.rows[0].content.amountMinor, 2000005);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'http://127.0.0.1:4101/v2/staff/listing-import-preview');
      assert.deepEqual(JSON.parse(calls[0].init.body), { csv });
      assert.equal(calls[0].init.headers.Authorization, 'Bearer a.b.c');
      assert.equal(calls[0].init.headers['x-preview-instance'], undefined);
      assert.equal(calls[0].init.headers['Idempotency-Key'], undefined);
      assert.equal(calls[0].init.credentials, 'omit');
    },
  );
  await t.test(
    'production, stale instance, alternate Host, cross-origin and browser credentials fail before dispatch',
    async () => {
      for (const input of [
        { headers: { 'x-preview-instance': 'stale' } },
        { headers: { host: 'localhost:3001' } },
        { headers: { origin: 'https://other.invalid' } },
        { headers: { authorization: 'Bearer caller' } },
        { headers: { 'sec-fetch-site': 'cross-site' } },
      ]) {
        mock();
        const r = await listingImportPreviewRequest(req(input));
        assert.equal(r.status, 403);
        privateReply(r);
        assert.equal(calls.length, 0);
      }
      mock();
      process.env.NODE_ENV = 'production';
      assert.equal((await POST(req())).status, 403);
      process.env.NODE_ENV = 'development';
      assert.equal(calls.length, 0);
    },
  );
  await t.test(
    'malformed framing, duplicate JSON, oversized CSV and authority fields never dispatch',
    async () => {
      for (const input of [
        { method: 'GET' },
        { suffix: '?x=1' },
        { suffix: '/wrong' },
        { headers: { cookie: 'a=1' } },
        { headers: { 'x-tenant-id': 'caller' } },
        { headers: { 'content-encoding': 'gzip' } },
        { headers: { 'transfer-encoding': 'chunked' } },
        { headers: { 'content-length': '1' } },
        { headers: { 'content-type': 'application/json;charset=latin1' } },
        { body: '{"csv":"a","csv":"b"}' },
        { body: JSON.stringify({ csv, role: 'admin' }) },
        { body: JSON.stringify({ csv: 'x'.repeat(32769) }) },
        { body: 'x'.repeat(262145) },
      ]) {
        mock();
        const r = await POST(req(input));
        assert.ok([400, 405].includes(r.status));
        assert.equal(calls.length, 0);
        assert.equal((await r.json()).submissionUncertain, false);
      }
    },
  );
  await t.test(
    'malformed upstream response and denied current access return safe codes without private facts',
    async () => {
      mock(() => Response.json({ ...previewListingImport(csv, [], true), validRows: 99 }));
      const bad = await POST(req());
      assert.equal(bad.status, 502);
      assert.doesNotMatch(await bad.text(), /a\.b\.c|Synthetic title/);
      mock(() =>
        Response.json(
          { error: { code: 'FORBIDDEN', message: 'PRIVATE' }, requestId: instance },
          { status: 403 },
        ),
      );
      const denied = await POST(req());
      assert.equal(denied.status, 403);
      assert.doesNotMatch(await denied.text(), /PRIVATE/);
      assert.equal(calls.length, 1);
    },
  );
  await t.test(
    'request cancellation closes stalled incoming body without upstream work',
    async () => {
      mock();
      const abort = new AbortController();
      let cancelled = 0;
      const body = new ReadableStream({
        cancel() {
          cancelled++;
        },
      });
      const pending = POST(req({ signal: abort.signal, body }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      abort.abort();
      const r = await pending;
      assert.equal(r.status, 499);
      assert.equal(cancelled, 1);
      assert.equal(calls.length, 0);
      privateReply(r);
    },
  );
});
