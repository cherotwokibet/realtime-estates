import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
const body = () => ({
  policy: 'staff-operations-overview-v1',
  asOf: '2026-10-28T08:00:00.000Z',
  freshnessDays: 30,
  limit: 10,
  ...Object.fromEntries(
    ['staleStock', 'pendingReviews', 'overdueEnquiries', 'viewingOutcomes'].map((key) => [
      key,
      { items: [], hasMore: false },
    ]),
  ),
});
const api = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'synthetic-ops',
    fetch,
  });
test('operations SDK sends one fixed private GET with detached credentials and no caller-selected company or body', async () => {
  let calls = 0,
    observed;
  const client = api(async (url, init) => {
    calls++;
    observed = { url, init };
    return Response.json(body());
  });
  const options = { bearerToken: 'original-token' };
  const work = client.getStaffOperationsOverview(options);
  options.bearerToken = 'changed-token';
  const result = await work;
  assert.equal(calls, 1);
  assert.equal(observed.url, 'https://synthetic.invalid/v2/staff/operations/overview');
  assert.equal(observed.init.method, 'GET');
  assert.equal(observed.init.body, undefined);
  assert.equal(observed.init.credentials, 'omit');
  assert.equal(observed.init.cache, 'no-store');
  assert.equal(new Headers(observed.init.headers).get('authorization'), 'Bearer original-token');
  assert.ok(Object.isFrozen(result));
});
test('operations SDK rejects unsupported options and accessors before network IO', async () => {
  let calls = 0,
    reads = 0;
  const client = api(async () => {
    calls++;
    return Response.json(body());
  });
  const getter = {};
  Object.defineProperty(getter, 'bearerToken', {
    enumerable: true,
    get() {
      reads++;
      return 'private';
    },
  });
  for (const options of [
    {},
    { bearerToken: 'token', tenantId: 'foreign' },
    { bearerToken: 'token', limit: 10 },
    getter,
  ])
    await assert.rejects(
      () => client.getStaffOperationsOverview(options),
      (error) => error.kind === 'VALIDATION',
    );
  assert.equal(calls, 0);
  assert.equal(reads, 0);
});
test('operations SDK does not retry or convert malformed/denied reads into write uncertainty', async () => {
  let calls = 0;
  for (const response of [
    () => Response.json({ ...body(), privateMessage: 'must not pass' }),
    () => Response.json({ error: { code: 'FORBIDDEN', message: 'private' } }, { status: 403 }),
  ]) {
    const client = api(async () => {
      calls++;
      return response();
    });
    await assert.rejects(
      () => client.getStaffOperationsOverview({ bearerToken: 'token' }),
      (error) => ['HTTP', 'INVALID_RESPONSE'].includes(error.kind) && !error.submissionUncertain,
    );
  }
  assert.equal(calls, 2);
});
