import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService, createLocalEnquiryLimiter } from '../dist/service.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function service(overrides = {}) {
  const calls = { database: 0, identity: 0 };
  const handler = createApiService({
    tenantId: id(1),
    privacyNoticeVersion: 'synthetic-budget-v1',
    database: {
      async transaction(context, run) {
        calls.database++;
        return run({
          async query() {
            return { rows: [] };
          },
        });
      },
    },
    async verifyAuthorization() {
      calls.identity++;
      return { actorId: id(10) };
    },
    clientKey: () => 'trusted-socket',
    ...overrides,
  });
  return { handler, calls };
}
const request = (path) =>
  new Request('https://synthetic.invalid' + path, {
    headers: { 'x-forwarded-for': 'spoofed-peer', 'x-tenant-id': 'spoofed-company' },
  });

test('general budget covers public reads and denies before database or identity work with safe retry feedback', async () => {
  const { handler, calls } = service({
    requestLimiter: createLocalEnquiryLimiter({ limit: 1, windowMs: 60000 }),
  });
  assert.equal((await handler(request('/v2/properties'))).status, 200);
  const denied = await handler(request('/v2/staff/listings'));
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get('retry-after'), '60');
  assert.equal(denied.headers.get('cache-control'), 'no-store');
  assert.ok(!(await denied.text()).includes('trusted-socket'));
  assert.deepEqual(calls, { database: 1, identity: 0 });
});

test('shared provider budgets isolate configured company and trusted peer while request headers cannot select either', async () => {
  const limiter = createLocalEnquiryLimiter({ limit: 1 });
  const a = service({ requestLimiter: limiter });
  const same = service({ requestLimiter: limiter });
  const b = service({ tenantId: id(2), requestLimiter: limiter });
  const otherPeer = service({ clientKey: () => 'another-trusted-socket', requestLimiter: limiter });
  assert.equal((await a.handler(request('/v2/properties'))).status, 200);
  assert.equal(
    (
      await same.handler(
        new Request('https://different.invalid/v2/properties', {
          headers: { 'x-forwarded-for': 'different-spoof', 'x-tenant-id': id(2) },
        }),
      )
    ).status,
    429,
  );
  assert.equal((await b.handler(request('/v2/properties'))).status, 200);
  assert.equal((await otherPeer.handler(request('/v2/properties'))).status, 200);
});

test('broken budget providers and malformed trusted keys fail closed without leaking details or doing business IO', async () => {
  for (const overrides of [
    {
      requestLimiter: {
        consume() {
          throw Error('PRIVATE-BACKEND-DETAIL');
        },
      },
    },
    ...[
      { allowed: 'yes', retryAfterSeconds: 0 },
      { allowed: false, retryAfterSeconds: 0 },
      { allowed: false, retryAfterSeconds: 1.5 },
      { allowed: false, retryAfterSeconds: Infinity },
      { allowed: false, retryAfterSeconds: 3601 },
    ].map((value) => ({ requestLimiter: { consume: () => value } })),
    { clientKey: () => 'x'.repeat(201) },
    { clientKey: () => 'untrusted\nkey' },
  ]) {
    const { handler, calls } = service(overrides);
    const response = await handler(request('/v2/properties'));
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes('PRIVATE-BACKEND-DETAIL'));
    assert.deepEqual(calls, { database: 0, identity: 0 });
  }
});
