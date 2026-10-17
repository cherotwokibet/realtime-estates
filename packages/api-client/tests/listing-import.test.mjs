import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient, ApiClientError } from '../dist/index.js';
import { LISTING_IMPORT_COLUMNS, previewListingImport } from '@realtor/domain';
const csv =
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
const data = () => previewListingImport(csv, [], true),
  options = { bearerToken: 'synthetic' },
  origin = 'https://synthetic.invalid';
const client = (fetch) =>
  new RealtorApiClient({ baseUrl: origin, privacyNoticeVersion: 'synthetic', fetch });
test('import SDK fixes read-only POST, captured CSV, bearer, no credentials/redirects/idempotency/retry', async () => {
  let calls = 0;
  const api = client(async (url, init) => {
    calls++;
    assert.equal(url, origin + '/v2/staff/listing-import-preview');
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer synthetic');
    assert.equal(init.headers['Idempotency-Key'], undefined);
    assert.deepEqual(JSON.parse(init.body), { csv });
    return Response.json(data());
  });
  const result = await api.previewListingImportV2(csv, options);
  assert.equal(result.rows[0].content.amountMinor, 2000005);
  assert.ok(Object.isFrozen(result.rows));
  assert.equal(calls, 1);
});
test('invalid original CSV and predispatch cancellation never call transport', async () => {
  let calls = 0;
  const api = client(async () => {
    calls++;
    throw Error();
  });
  await assert.rejects(
    () => api.previewListingImportV2('bad', options),
    (e) => e.kind === 'VALIDATION',
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    () => api.previewListingImportV2(csv, { ...options, signal: abort.signal }),
    (e) => e.kind === 'CANCELLED' && !e.submissionUncertain,
  );
  assert.equal(calls, 0);
});
test('altered projections and framing fail safely with no mutation uncertainty or retries', async () => {
  const wrong = JSON.parse(JSON.stringify(data()));
  wrong.rows[0].content.amountMinor++;
  for (const response of [
    () => Response.json(wrong),
    () => new Response('x', { headers: { 'content-type': 'text/plain' } }),
    () =>
      new Response('{}', {
        headers: { 'content-type': 'application/json', 'content-length': '1048577' },
      }),
    () =>
      new Response('{}', {
        headers: { 'content-type': 'application/json', 'content-length': '3' },
      }),
    () => new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }),
    () => new Response('x'.repeat(1048577), { headers: { 'content-type': 'application/json' } }),
  ]) {
    let calls = 0;
    await assert.rejects(
      () =>
        client(async () => {
          calls++;
          return response();
        }).previewListingImportV2(csv, options),
      (e) => e instanceof ApiClientError && e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
    );
    assert.equal(calls, 1);
  }
});
test('read-only preview timeout cancels late ignored-abort response body without retry', async () => {
  let calls = 0,
    cancelled = 0;
  let resolve;
  const pending = new Promise((r) => (resolve = r));
  const api = client(async () => {
    calls++;
    await pending;
    return new Response(
      new ReadableStream({
        cancel() {
          cancelled++;
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });
  await assert.rejects(
    () => api.previewListingImportV2(csv, { ...options, timeoutMs: 10 }),
    (e) => e.kind === 'TIMEOUT' && !e.submissionUncertain,
  );
  resolve();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, 1);
  assert.equal(cancelled, 1);
});

test('preview cancellation closes a stalled response stream and remains read-only', async () => {
  let cancelled = 0,
    started;
  const ready = new Promise((resolve) => (started = resolve));
  const controller = new AbortController();
  const api = client(
    async () =>
      new Response(
        new ReadableStream({
          start() {
            started();
          },
          cancel() {
            cancelled++;
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  const result = api.previewListingImportV2(csv, { ...options, signal: controller.signal });
  await ready;
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(
    () => result,
    (e) => e.kind === 'CANCELLED' && !e.submissionUncertain,
  );
  assert.equal(cancelled, 1);
});
