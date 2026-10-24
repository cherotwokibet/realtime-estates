import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../dist/service.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const contexts = [],
    sql = [];
  let role = 'agent',
    actor = id(2),
    verifications = 0;
  const service = createApiService({
    tenantId: id(1),
    privacyNoticeVersion: 'synthetic',
    verifyAuthorization: async (r) => {
      verifications++;
      if (r.headers.get('authorization') !== 'Bearer synthetic') throw Error('PRIVATE');
      return { actorId: actor };
    },
    database: {
      async transaction(context, work) {
        contexts.push(context);
        return work({
          async query(statement) {
            sql.push(statement);
            return { rows: [{ role }] };
          },
        });
      },
    },
  });
  return {
    service,
    contexts,
    sql,
    get verifications() {
      return verifications;
    },
    role: (v) => (role = v),
    actor: (v) => (actor = v),
  };
}
const request = (suffix = '', init = {}) =>
  new Request('https://synthetic.invalid/v2/staff/session' + suffix, {
    ...init,
    headers: { authorization: 'Bearer synthetic', ...init.headers },
  });
test('ordinary staff context uses configured tenant/verified actor/current SQL role on every read, without reference mode', async () => {
  const f = fixture();
  for (const role of ['agent', 'admin']) {
    f.role(role);
    const r = await f.service(request());
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      policy: 'current-staff-session-v2',
      tenantId: id(1),
      actorId: id(2),
    });
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  assert.equal(f.verifications, 2);
  assert.equal(f.sql.length, 2);
  assert.ok(f.sql.every((s) => s === 'SELECT app_private.staff_role() AS role'));
  assert.ok(f.contexts.every((c) => c.tenantId === id(1) && c.actorId === id(2)));
  f.role('customer');
  assert.equal((await f.service(request())).status, 403);
  f.role(null);
  assert.equal((await f.service(request())).status, 403);
  f.role('agent');
  f.actor(id(3));
  assert.equal((await (await f.service(request())).json()).actorId, id(3));
});
test('staff context refuses mutation, caller authority, cookies, conditional/framing headers and aliases before SQL', async () => {
  const f = fixture();
  for (const suffix of ['?tenant=' + id(2), '?', '#scope'])
    assert.equal((await f.service(request(suffix))).status, 400);
  for (const name of [
    'cookie',
    'content-type',
    'content-length',
    'content-encoding',
    'transfer-encoding',
    'expect',
    'range',
    'idempotency-key',
    'x-actor-id',
    'x-tenant-id',
    'x-role',
    'x-actor',
    'x-tenant',
    'x-company-id',
    'x-assigned-agent-id',
    'x-revision-version',
    'if-none-match',
  ])
    assert.equal(
      (
        await f.service(
          request('', { headers: { [name]: name === 'content-length' ? '0' : 'synthetic' } }),
        )
      ).status,
      400,
      name,
    );
  for (const method of ['POST', 'PUT', 'DELETE'])
    assert.equal((await f.service(request('', { method }))).status, 405);
  assert.equal((await f.service(request('/'))).status, 404);
  assert.equal(f.sql.length, 0);
  assert.equal(f.contexts.length, 0);
});
test('missing or rejected bearer never reaches staff session projection', async () => {
  const f = fixture();
  for (const authorization of ['', 'Bearer forged'])
    assert.equal((await f.service(request('', { headers: { authorization } }))).status, 401);
  assert.equal(f.contexts.length, 0);
});
