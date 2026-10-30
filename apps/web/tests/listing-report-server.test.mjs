import test from 'node:test';
import assert from 'node:assert/strict';
import { handleListingReport } from '../dist/tests/lib/listing-report-server.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const env = {
  NODE_ENV: 'development',
  WEB_REPORT_PREVIEW_MODE: 'synthetic-v1',
  WEB_CATALOGUE_MODE: 'connected',
  WEB_CATALOGUE_DATA: 'synthetic',
  TENANT_SLUG: 'realtime-estates',
  WEB_REPORT_API_ORIGIN: 'http://127.0.0.1:4100',
  API_ORIGIN: 'http://127.0.0.1:4100',
  WEB_REPORT_INSTANCE: id(9),
};
const command = {
  policy: 'listing-report-command-v1',
  listingId: id(1),
  operationId: id(2),
  reason: 'other',
  details: null,
};
const receipt = {
  policy: 'listing-report-receipt-v1',
  listingId: id(1),
  operationId: id(2),
  status: 'recorded',
  recordedAt: '2026-10-30T04:00:00.000Z',
};
const request = (method, body, patch = {}) =>
  new Request('http://127.0.0.1:3135/api/listing-reports/' + id(1) + '/' + id(2), {
    method,
    headers: {
      host: '127.0.0.1:3135',
      origin: 'http://127.0.0.1:3135',
      'x-preview-instance': id(9),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...patch,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
test('public report BFF forwards only a validated original and never browser authority', async () => {
  const calls = [],
    fetcher = async (url, init) => {
      calls.push({ url, init });
      return Response.json(receipt, { status: init.method === 'POST' ? 202 : 200 });
    };
  const post = await handleListingReport(request('POST', command), id(1), id(2), env, fetcher);
  assert.equal(post.status, 202);
  assert.deepEqual(await post.json(), { receipt });
  assert.equal((await handleListingReport(request('GET'), id(1), id(2), env, fetcher)).status, 200);
  assert.deepEqual(
    calls.map((c) => c.init.method),
    ['POST', 'GET'],
  );
  assert.equal(calls[1].init.body, undefined);
  assert.equal(new Headers(calls[0].init.headers).has('authorization'), false);
  assert.equal(new Headers(calls[0].init.headers).has('cookie'), false);
});
test('BFF rejects stale/cross-origin and ambiguous requests before IO; lost outcome remains uncertain', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw Error('Synthetic lost reply');
  };
  for (const req of [
    request('POST', command, { cookie: 'ignored' }),
    request('POST', command, { origin: 'https://external.invalid' }),
    request('POST', { ...command, listingId: id(8) }),
    request('POST', JSON.stringify(command).replace('"details":', '"details":"first","details":')),
  ])
    assert.ok((await handleListingReport(req, id(1), id(2), env, fetcher)).status >= 400);
  assert.equal(calls, 0);
  const res = await handleListingReport(request('POST', command), id(1), id(2), env, fetcher);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).submissionUncertain, true);
  assert.equal(calls, 1);
});
