import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../dist/service.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1),
  L = id(100),
  OP = id(200),
  R = id(300),
  A = id(10);
const cmd = {
  policy: 'listing-report-command-v1',
  operationId: OP,
  listingId: L,
  reason: 'other',
  details: 'Synthetic report only.',
};
const receipt = {
  policy: 'listing-report-receipt-v1',
  operationId: OP,
  listingId: L,
  status: 'recorded',
  recordedAt: '2026-10-29T12:00:00.000Z',
};
const decision = {
  policy: 'listing-report-decision-command-v1',
  operationId: OP,
  reportId: R,
  expectedVersion: '1',
  decision: 'dismissed',
  reason: 'Synthetic review only.',
};
const decided = {
  policy: 'listing-report-decision-receipt-v1',
  operationId: OP,
  reportId: R,
  version: '2',
  decision: 'dismissed',
  reason: decision.reason,
  actorId: A,
  recordedAt: receipt.recordedAt,
};
const publicPath = `/v2/public/listings/${L}/reports/${OP}`,
  staffPath = `/v2/staff/listing-reports/${R}/operations/${OP}`;
function fixture(overrides = {}) {
  const calls = [],
    contexts = [];
  let verified = 0;
  const options = {
    tenantId: T,
    privacyNoticeVersion: 'synthetic-report-notice-v1',
    publicReportMode: 'synthetic-listing-report-v1',
    uuid: () => id(999),
    verifyAuthorization: async () => {
      verified++;
      return { actorId: A };
    },
    database: {
      transaction: async (context, work) => {
        contexts.push(context);
        return work({
          query: async (sql, args) => {
            calls.push({ sql, args });
            if (sql.startsWith('SET ')) return { rows: [] };
            if (sql.includes('list_listing_reports'))
              return {
                rows: [
                  {
                    queue: {
                      policy: 'listing-report-queue-v1',
                      items: [],
                      hasMore: false,
                      limit: args[0],
                      status: args[2],
                    },
                  },
                ],
              };
            return {
              rows: [
                {
                  receipt:
                    sql.includes('report_decision') || sql.includes('decide_listing_report')
                      ? decided
                      : receipt,
                },
              ],
            };
          },
        });
      },
    },
    ...overrides,
  };
  return {
    run: createApiService(options),
    calls,
    contexts,
    get verified() {
      return verified;
    },
  };
}
const request = (path = publicPath, method = 'GET', body, headers = {}) =>
  new Request('https://api.synthetic.invalid' + path, {
    method,
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
  });
test('report routes are explicitly disabled by default and malformed mode/notice is refused', async () => {
  const f = fixture({ publicReportMode: undefined });
  for (const p of [publicPath, staffPath, '/v2/staff/listing-reports'])
    assert.equal((await f.run(request(p))).status, 404);
  assert.equal(f.calls.length, 0);
  assert.equal(f.verified, 0);
  assert.throws(() => fixture({ publicReportMode: 'enabled' }));
  assert.throws(() => fixture({ privacyNoticeVersion: 'Unreviewed notice text' }));
});
test('anonymous exact POST captures in configured company only, returns minimal202 and reads original without identity', async () => {
  const f = fixture();
  const saved = await f.run(request(publicPath, 'POST', cmd));
  assert.equal(saved.status, 202);
  assert.equal(saved.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await saved.json(), receipt);
  assert.deepEqual(await (await f.run(request())).json(), receipt);
  assert.equal(f.verified, 0);
  assert.ok(f.contexts.every((c) => c.tenantId === T && c.actorId === null));
  const write = f.calls.find((c) => c.sql.includes('capture_listing_report'));
  assert.deepEqual(JSON.parse(write.args[1]), cmd);
  assert.equal(write.args[2], 'synthetic-report-notice-v1');
  assert.ok(!JSON.stringify(await (await f.run(request())).json()).includes(cmd.details));
});
test('anonymous report rejects authority/body/query/route/duplicate-key smuggling before any database operation', async () => {
  const cases = [
    request(publicPath + '?tenantId=' + id(2)),
    request(publicPath + '#fragment'),
    request(publicPath, 'GET', undefined, { authorization: 'Bearer ignored' }),
    request(publicPath, 'GET', undefined, { cookie: 'session=ignored' }),
    request(publicPath, 'POST', cmd, { 'x-tenant-id': id(2) }),
    request(publicPath, 'POST', cmd, { 'idempotency-key': id(9) }),
    request(publicPath, 'GET', undefined, { 'content-type': 'application/json' }),
    request(publicPath.replace(OP, OP.toUpperCase() + 'x')),
    request(publicPath, 'POST', { ...cmd, operationId: id(9) }),
    request(publicPath, 'POST', { ...cmd, listingId: id(9) }),
    request(publicPath, 'POST', { ...cmd, tenantId: T }),
    request(
      publicPath,
      'POST',
      JSON.stringify(cmd).replace('"details":', '"details":"first","details":'),
    ),
    request(
      publicPath,
      'POST',
      JSON.stringify(cmd).replace('"details":', '"deta\\u0069ls":"first","details":'),
    ),
  ];
  for (const req of cases) {
    const f = fixture();
    const res = await f.run(req);
    assert.equal(res.status, 400, req.url);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  assert.equal((await f.run(request(publicPath, 'DELETE'))).status, 405);
  assert.equal(f.calls.length, 0);
});
test('report submission limit is separate from general budget; denied or malformed budget cannot write and oversized bodies are bounded', async () => {
  let key;
  const f = fixture({
    reportLimiter: {
      consume: (k) => {
        key = k;
        return { allowed: false, retryAfterSeconds: 42 };
      },
    },
  });
  const denied = await f.run(request(publicPath, 'POST', cmd));
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get('retry-after'), '42');
  assert.equal(key, `report:${T}:shared-local`);
  assert.equal(f.calls.length, 0);
  const invalid = fixture({
    reportLimiter: { consume: () => ({ allowed: true, retryAfterSeconds: 1 }) },
  });
  assert.equal((await invalid.run(request(publicPath, 'POST', cmd))).status, 503);
  assert.equal(invalid.calls.length, 0);
  const large = fixture();
  assert.equal((await large.run(request(publicPath, 'POST', 'x'.repeat(8193)))).status, 413);
  assert.equal(large.calls.length, 0);
});
test('private bounded queue and exact review/original routes verify current identity and bind returned actor/version/operation', async () => {
  const f = fixture();
  assert.equal((await f.run(request('/v2/staff/listing-reports'))).status, 401);
  assert.equal(f.calls.length, 0);
  const auth = { authorization: 'Bearer synthetic-test-placeholder' };
  assert.deepEqual(
    await (
      await f.run(request('/v2/staff/listing-reports?limit=2&status=all', 'GET', undefined, auth))
    ).json(),
    { policy: 'listing-report-queue-v1', items: [], hasMore: false, limit: 2, status: 'all' },
  );
  assert.deepEqual(await (await f.run(request(staffPath, 'POST', decision, auth))).json(), decided);
  assert.deepEqual(await (await f.run(request(staffPath, 'GET', undefined, auth))).json(), decided);
  assert.ok(f.contexts.every((c) => c.tenantId === T && c.actorId === A));
  assert.equal(f.verified, 3);
  const malformed = fixture({
    database: {
      transaction: async (_context, work) =>
        work({
          query: async (sql) => ({
            rows: sql.startsWith('SET ') ? [] : [{ receipt: { ...decided, actorId: id(99) } }],
          }),
        }),
    },
  });
  assert.equal((await malformed.run(request(staffPath, 'POST', decision, auth))).status, 503);
  for (const p of [
    '/v2/staff/listing-reports?limit=51',
    '/v2/staff/listing-reports?limit=2&limit=2',
    '/v2/staff/listing-reports?companyId=' + T,
    staffPath + '?version=1',
  ]) {
    const q = fixture();
    assert.equal((await q.run(request(p, 'GET', undefined, auth))).status, 400);
    assert.equal(q.calls.length, 0);
  }
});
