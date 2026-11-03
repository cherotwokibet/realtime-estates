import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adminAuditHostAllowed,
  adminAuditSearch,
  adminAuditHref,
  loadAdminAuditWorkspace,
} from '../dist/tests/lib/admin-audit-server.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_AUDIT_PREVIEW_MODE: 'synthetic-admin-audit-v1',
  STAFF_AUDIT_WEB_ORIGIN: 'http://127.0.0.1:3138',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
  STAFF_PREVIEW_TOKEN: 'synthetic.bearer.signature',
  STAFF_PREVIEW_INSTANCE: id(600),
};
const page = { policy: 'admin-audit-page-v1', tenantId: id(1), items: [], nextBefore: null };
const reply = (data) => Response.json(data, { headers: { 'cache-control': 'no-store' } });
test('audit server pins session company and server-held bearer, snapshots exact filters and returns no credentials', async () => {
  const calls = [],
    input = { limit: '5', actorId: id(10) };
  const result = await loadAdminAuditWorkspace(input, env, async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.cache, 'no-store');
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.equal(init.credentials, 'omit');
    assert.equal(
      new Headers(init.headers).get('authorization'),
      'Bearer ' + env.STAFF_PREVIEW_TOKEN,
    );
    input.actorId = id(20);
    return reply(
      calls.length === 1
        ? { policy: 'current-staff-session-v2', tenantId: id(1), actorId: id(10) }
        : page,
    );
  });
  assert.equal(calls.length, 2);
  assert.equal(
    calls[1].url,
    'http://127.0.0.1:4101/v2/staff/audit-events?limit=5&actorId=' + id(10),
  );
  assert.equal(result.query.actorId, id(10));
  assert.doesNotMatch(JSON.stringify(result), /bearer|signature|4101/);
  assert.equal(
    adminAuditHref(result.query, '22'),
    '/audit?limit=5&actorId=' + id(10) + '&before=22',
  );
});
test('audit server refuses foreign/malformed/denied replies and rechecks on every navigation', async () => {
  let calls = 0;
  const transport = async () => {
    calls++;
    if (calls % 2 === 1)
      return reply({ policy: 'current-staff-session-v2', tenantId: id(1), actorId: id(10) });
    if (calls === 2) return reply(page);
    return reply({ ...page, tenantId: id(2) });
  };
  await loadAdminAuditWorkspace({}, env, transport);
  await assert.rejects(() => loadAdminAuditWorkspace({}, env, transport));
  assert.equal(calls, 4);
  await assert.rejects(() =>
    loadAdminAuditWorkspace({}, env, async () => new Response('', { status: 403 })),
  );
});
test('audit input and preview host fences reject caller authority, arrays, getters and production without transport', async () => {
  let getters = 0,
    calls = 0;
  const getter = {};
  Object.defineProperty(getter, 'actorId', {
    enumerable: true,
    get() {
      getters++;
      return id(10);
    },
  });
  for (const input of [
    { tenantId: id(2) },
    { actorId: [id(10)] },
    { limit: '21' },
    { before: '0' },
    getter,
  ])
    assert.throws(() => adminAuditSearch(input));
  assert.deepEqual(adminAuditSearch({ actorId: '', objectId: '', before: '' }), {
    limit: 20,
    before: null,
    actorId: null,
    objectId: null,
  });
  assert.equal(getters, 0);
  assert.equal(adminAuditHostAllowed('127.0.0.1:3138', env), true);
  for (const host of ['localhost:3138', '127.0.0.1:3139', 'foreign.invalid', null])
    assert.equal(adminAuditHostAllowed(host, env), false);
  for (const patch of [
    { NODE_ENV: 'production' },
    { STAFF_AUDIT_PREVIEW_MODE: '' },
    { STAFF_PREVIEW_MODE: '' },
    { STAFF_AUDIT_WEB_ORIGIN: 'http://127.0.0.1:3138/other' },
  ])
    assert.equal(adminAuditHostAllowed('127.0.0.1:3138', { ...env, ...patch }), false);
  for (const patch of [
    { NODE_ENV: 'production' },
    { STAFF_AUDIT_PREVIEW_MODE: '' },
    { STAFF_PREVIEW_TOKEN: 'bad' },
  ])
    await assert.rejects(() =>
      loadAdminAuditWorkspace({}, { ...env, ...patch }, async () => {
        calls++;
        return reply(page);
      }),
    );
  assert.equal(calls, 0);
});
