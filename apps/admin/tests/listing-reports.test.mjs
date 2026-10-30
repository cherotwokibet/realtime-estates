import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listingReportsBoundary,
  listingReportDecisionBoundary,
} from '../dist/tests/lib/listing-reports-server.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_REPORT_PREVIEW_MODE: 'synthetic-v1',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
  STAFF_PREVIEW_TOKEN: 'synthetic.bearer.signature',
  STAFF_PREVIEW_INSTANCE: id(1),
};
const req = (query = '', options = {}) =>
  new Request('http://localhost:3120/api/listing-reports' + query, {
    ...options,
    headers: { host: '127.0.0.1:3120', 'x-preview-instance': id(1), ...options.headers },
  });
const command = {
  policy: 'listing-report-decision-command-v1',
  operationId: id(2),
  reportId: id(3),
  expectedVersion: '1',
  decision: 'reviewed',
  reason: 'Synthetic review only.',
};
const post = (body) =>
  req('', {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:3120', 'content-type': 'application/json' },
    body,
  });
test('admin report queue binds server identity and rejects authority or invalid query before IO', async () => {
  let calls = 0;
  const transport = async (url, init) => {
    calls++;
    assert.equal(url, 'http://127.0.0.1:4101/v2/staff/listing-reports?limit=2&status=all');
    assert.equal(
      new Headers(init.headers).get('authorization'),
      'Bearer synthetic.bearer.signature',
    );
    assert.equal(new Headers(init.headers).has('x-preview-instance'), false);
    return Response.json({
      policy: 'listing-report-queue-v1',
      items: [],
      hasMore: false,
      limit: 2,
      status: 'all',
    });
  };
  assert.equal(
    (await listingReportsBoundary(req('?limit=2&status=all'), env, transport)).status,
    200,
  );
  for (const r of [
    req('?status=new&status=all'),
    req('?tenant=foreign'),
    req('', { headers: { cookie: 'ignored' } }),
    req('', { headers: { authorization: 'Bearer caller' } }),
    req('', { headers: { 'x-preview-instance': 'stale' } }),
  ])
    assert.ok((await listingReportsBoundary(r, env, transport)).status >= 400);
  assert.equal(
    (await listingReportsBoundary(req(), { ...env, NODE_ENV: 'production' }, transport)).status,
    403,
  );
  assert.equal(calls, 1);
});
test('admin review rejects duplicate keys and route mismatch before dispatch; lost result stays uncertain', async () => {
  let calls = 0;
  const lost = async () => {
    calls++;
    throw Error('Synthetic lost reply');
  };
  for (const body of [
    JSON.stringify({ ...command, reportId: id(9) }),
    JSON.stringify(command).replace('"reason":', '"reason":"duplicate","reason":'),
  ])
    assert.equal(
      (await listingReportDecisionBoundary(post(body), id(3), id(2), env, lost)).status,
      400,
    );
  assert.equal(calls, 0);
  const response = await listingReportDecisionBoundary(
    post(JSON.stringify(command)),
    id(3),
    id(2),
    env,
    lost,
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).submissionUncertain, true);
  assert.equal(calls, 1);
});
test('admin original review is GET only, validates identity and preserves current access denial', async () => {
  let calls = 0;
  const saved = {
    policy: 'listing-report-decision-receipt-v1',
    operationId: id(2),
    reportId: id(3),
    version: '2',
    decision: 'reviewed',
    reason: command.reason,
    actorId: id(4),
    recordedAt: '2026-10-30T04:00:00.000Z',
  };
  const transport = async (url, init) => {
    calls++;
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    return Response.json(saved);
  };
  const result = await listingReportDecisionBoundary(req(), id(3), id(2), env, transport);
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).receipt, saved);
  assert.equal(calls, 1);
  const denied = await listingReportDecisionBoundary(req(), id(3), id(2), env, async () =>
    Response.json(
      { error: { code: 'FORBIDDEN', message: 'denied' }, requestId: id(8) },
      { status: 403, headers: { 'x-request-id': id(8) } },
    ),
  );
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).submissionUncertain, false);
});
