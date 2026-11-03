import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../dist/service.js';
const tenant = '00000000-0000-4000-8000-000000000001',
  actor = '00000000-0000-4000-8000-000000000010';
const headers = { authorization: 'Bearer synthetic.header.signature' };
const url = 'https://synthetic.invalid/v2/staff/audit-events';
const base = {
  tenantId: tenant,
  privacyNoticeVersion: 'audit319',
  adminAuditMode: 'synthetic-admin-audit-v1',
};
test('audit route default-off, production/method/filter/authority input refusals never verify or query', async () => {
  let reads = 0;
  const opts = {
    ...base,
    verifyAuthorization: async () => {
      reads++;
      return { actorId: actor };
    },
    database: {
      transaction: async () => {
        reads++;
        throw Error('unexpected');
      },
    },
  };
  const { adminAuditMode, ...off } = opts;
  assert.equal((await createApiService(off)(new Request(url, { headers }))).status, 404);
  const s = createApiService(opts);
  assert.equal((await s(new Request(url, { method: 'POST', headers }))).status, 405);
  for (const query of ['?limit=21', '?limit=2&limit=2', '?before=0', '?tenantId=' + tenant])
    assert.equal((await s(new Request(url + query, { headers }))).status, 400);
  for (const name of [
    'x-actor-id',
    'x-company-id',
    'x-role',
    'cookie',
    'range',
    'if-match',
    'content-type',
  ])
    assert.equal(
      (await s(new Request(url, { headers: { ...headers, [name]: 'untrusted' } }))).status,
      400,
    );
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => createApiService(opts));
    assert.equal((await s(new Request(url, { headers }))).status, 404);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
  assert.equal(reads, 0);
});
test('audit authenticates before SQL, rechecks current admin and parameterizes exact filters', async () => {
  let sql = [];
  let role = 'admin';
  let verifications = 0;
  const s = createApiService({
    ...base,
    verifyAuthorization: async () => {
      verifications++;
      return { actorId: actor };
    },
    database: {
      transaction: async (context, fn) => {
        assert.equal(context.tenantId, tenant);
        assert.equal(context.actorId, actor);
        return fn({
          query: async (q, args) => {
            sql.push([q, args]);
            if (q.includes('staff_role')) return { rows: [{ role }] };
            if (q.includes('list_admin_audit'))
              return {
                rows: [
                  {
                    page: {
                      policy: 'admin-audit-page-v1',
                      tenantId: tenant,
                      items: [],
                      nextBefore: null,
                    },
                  },
                ],
              };
            return { rows: [] };
          },
        });
      },
    },
  });
  assert.equal((await s(new Request(url))).status, 401);
  assert.equal(sql.length, 0);
  let r = await s(
    new Request(url + '?limit=2&before=9007199254740993&actorId=' + actor, { headers }),
  );
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(sql.at(-1)[1], [2, '9007199254740993', actor, null]);
  role = 'agent';
  sql = [];
  r = await s(new Request(url, { headers }));
  assert.equal(r.status, 403);
  assert.equal(sql.length, 1);
  assert.equal(verifications, 2);
});
test('audit malformed database responses and SQL messages never expose private payloads or invoke getters', async () => {
  let getters = 0;
  const evil = {};
  Object.defineProperty(evil, 'policy', {
    enumerable: true,
    get() {
      getters++;
      throw Error('PRIVATE');
    },
  });
  for (const result of [
    evil,
    {
      policy: 'admin-audit-page-v1',
      tenantId: tenant,
      items: [],
      nextBefore: null,
      summary: 'PRIVATE',
    },
  ]) {
    const s = createApiService({
      ...base,
      verifyAuthorization: async () => ({ actorId: actor }),
      database: {
        transaction: async (c, fn) =>
          fn({
            query: async (q) => ({
              rows: q.includes('staff_role') ? [{ role: 'admin' }] : [{ page: result }],
            }),
          }),
      },
    });
    const r = await s(new Request(url, { headers }));
    assert.equal(r.status, 503);
    assert.doesNotMatch(await r.text(), /PRIVATE|summary/);
  }
  assert.equal(getters, 0);
});
