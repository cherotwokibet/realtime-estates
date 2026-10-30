import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../dist/service.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const request = (path, extra = {}) =>
  new Request('http://synthetic.invalid' + path, {
    headers: { authorization: 'Bearer synthetic', ...extra },
  });
function fixture(
  page = { policy: 'staff-branch-page-v1', items: [], nextAfter: null },
  enabled = true,
) {
  const calls = [],
    contexts = [];
  let verified = 0;
  const service = createApiService({
    tenantId: id(1),
    privacyNoticeVersion: 'synthetic-staff-notice-v1',
    ...(enabled ? { staffInvitationMode: 'synthetic-capture-only-v1' } : {}),
    verifyAuthorization: async () => {
      verified++;
      return { actorId: id(10) };
    },
    database: {
      transaction: async (ctx, work) => {
        contexts.push(ctx);
        return work({
          query: async (sql, args) => {
            calls.push({ sql, args });
            return { rows: sql.startsWith('SET ') ? [] : [{ page }] };
          },
        });
      },
    },
  });
  return { service, calls, contexts, verified: () => verified };
}
test('directory read uses fixed SQL and configured company plus verified subject, validates exact output', async () => {
  const f = fixture();
  let r = await f.service(request('/v2/staff/branches?limit=2&after=' + id(3)));
  assert.equal(r.status, 200);
  assert.deepEqual(f.calls[1], {
    sql: 'SELECT app_api.list_staff_branches($1,$2) AS page',
    args: [2, id(3)],
  });
  assert.equal(f.contexts[0].tenantId, id(1));
  assert.equal(f.contexts[0].actorId, id(10));
  const i = fixture({ policy: 'staff-invitation-page-v1', items: [], nextAfter: null });
  r = await i.service(request('/v2/staff/invitation-requests?limit=20'));
  assert.equal(r.status, 200);
  assert.equal(i.calls[1].sql, 'SELECT app_api.list_staff_invitation_requests($1,$2) AS page');
  for (const page of [
    { policy: 'staff-branch-page-v1', items: [], nextAfter: id(2) },
    { policy: 'staff-branch-page-v1', items: [], nextAfter: null, tenantId: id(2) },
  ])
    assert.equal((await fixture(page).service(request('/v2/staff/branches?limit=2'))).status, 503);
});
test('default-off and malformed directory authority/query are rejected before DB/identity', async () => {
  const off = fixture(undefined, false);
  assert.equal((await off.service(request('/v2/staff/branches?limit=2'))).status, 404);
  assert.equal(off.verified(), 0);
  for (const query of [
    '',
    '?limit=0',
    '?limit=21',
    '?limit=02',
    '?limit=2&limit=2',
    '?after=' + id(1) + '&limit=2',
    '?limit=2&after=bad',
    '?limit=2&tenantId=' + id(1),
    '?limit=2&after=' + id(1) + '&actorId=' + id(2),
  ]) {
    const f = fixture();
    assert.equal((await f.service(request('/v2/staff/branches' + query))).status, 400);
    assert.equal(f.calls.length, 0);
    assert.equal(f.verified(), 0);
  }
  for (const extra of [
    { 'x-tenant-id': id(2) },
    { cookie: 'synthetic' },
    { 'if-match': '1' },
    { 'content-type': 'application/json' },
  ]) {
    const f = fixture();
    assert.equal((await f.service(request('/v2/staff/branches?limit=2', extra))).status, 400);
    assert.equal(f.calls.length, 0);
  }
});
