import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createApiService } from '../dist/service.js';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const operationPath = (n = 200) => '/v2/staff/memberships/operations/' + id(n);
const memberPath = (n = 12) => '/v2/staff/memberships/' + id(n);
const command = (patch = {}) => ({
  policy: 'staff-membership-command-v1',
  operationId: id(200),
  memberId: id(12),
  expectedVersion: '1',
  requestedRole: 'admin',
  active: true,
  reason: 'Synthetic existing staff responsibilities.',
  ...patch,
});
const saved = {
  ...command(),
  policy: 'staff-membership-record-v1',
  actorId: id(10),
  version: '2',
  outcome: 'applied',
  recordedAt: '2026-11-02T09:00:00.000Z',
};
const current = {
  policy: 'staff-membership-current-v1',
  memberId: id(12),
  role: 'admin',
  active: true,
  version: '2',
  revokedAt: null,
};
const req = (path = operationPath(), { method = 'GET', body, headers = {} } = {}) =>
  new Request('http://synthetic.invalid' + path, {
    method,
    headers: {
      authorization: 'Bearer synthetic-admin',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
function fixture({ projection, ...overrides } = {}) {
  const calls = [],
    contexts = [];
  let verified = 0,
    commits = 0,
    rollbacks = 0;
  const run = createApiService({
    tenantId: id(1),
    privacyNoticeVersion: 'synthetic-membership-notice-v1',
    staffMembershipMode: 'synthetic-existing-members-v1',
    verifyAuthorization: async () => {
      verified++;
      return { actorId: id(10) };
    },
    database: {
      transaction: async (context, work) => {
        contexts.push(context);
        try {
          const value = await work({
            query: async (sql, args) => {
              calls.push({ sql, args });
              return {
                rows: sql.startsWith('SET ')
                  ? []
                  : [
                      {
                        receipt:
                          projection === undefined
                            ? sql.includes('read_staff_membership(')
                              ? current
                              : saved
                            : projection,
                      },
                    ],
              };
            },
          });
          commits++;
          return value;
        } catch (error) {
          rollbacks++;
          throw error;
        }
      },
    },
    ...overrides,
  });
  return {
    run,
    calls,
    contexts,
    verified: () => verified,
    commits: () => commits,
    rollbacks: () => rollbacks,
  };
}
test('membership candidate defaults off before identity/database and refuses invalid or production configuration', async () => {
  const off = fixture({ staffMembershipMode: undefined });
  for (const [path, method, body] of [
    [operationPath(), 'GET', undefined],
    [operationPath(), 'POST', command()],
    [memberPath(), 'GET', undefined],
    ['/v2/staff/memberships', 'GET', undefined],
  ])
    assert.equal((await off.run(req(path, { method, body }))).status, 404);
  assert.equal(off.verified(), 0);
  assert.equal(off.calls.length, 0);
  assert.throws(() => fixture({ staffMembershipMode: 'enabled' }));
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => fixture());
    assert.doesNotThrow(() => fixture({ staffMembershipMode: undefined }));
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
test('membership commands, current projection and original reads use fixed SQL and verified configured context', async () => {
  const f = fixture();
  const response = await f.run(req(operationPath(), { method: 'POST', body: command() }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.deepEqual(await response.json(), saved);
  assert.deepEqual(await (await f.run(req())).json(), saved);
  assert.deepEqual(await (await f.run(req(memberPath()))).json(), current);
  assert.ok(f.contexts.every((c) => c.tenantId === id(1) && c.actorId === id(10)));
  assert.deepEqual(f.calls[0], { sql: "SET LOCAL statement_timeout = '2s'", args: undefined });
  assert.deepEqual(f.calls[1], {
    sql: 'SELECT app_api.save_staff_membership($1,$2,$3,$4,$5,$6) AS receipt',
    args: [id(200), id(12), '1', 'admin', true, command().reason],
  });
  assert.deepEqual(f.calls[3], {
    sql: 'SELECT app_api.read_staff_membership_operation($1) AS receipt',
    args: [id(200)],
  });
  assert.deepEqual(f.calls[5], {
    sql: 'SELECT app_api.read_staff_membership($1) AS receipt',
    args: [id(12)],
  });
  assert.equal(f.commits(), 3);
});
test('membership body authority, duplicates, unsafe versions, route mismatch and framing are refused before SQL', async () => {
  const f = fixture();
  for (const body of [
    command({ actorId: id(10) }),
    command({ tenantId: id(2) }),
    command({ memberId: 'bad' }),
    command({ operationId: id(201) }),
    command({ expectedVersion: '0' }),
    command({ requestedRole: 'customer' }),
    command({ branchId: null }),
    JSON.stringify(command()).replace('"policy":', '"\\u0070olicy":"bad","policy":'),
  ])
    assert.equal((await f.run(req(operationPath(), { method: 'POST', body }))).status, 400);
  for (const headers of [
    { 'x-tenant-id': id(2) },
    { 'x-actor-id': id(10) },
    { cookie: 'synthetic' },
    { 'if-match': '1' },
    { 'idempotency-key': id(9) },
    { range: 'bytes=0-1' },
    { 'content-encoding': 'gzip' },
  ])
    assert.equal((await f.run(req(operationPath(), { headers }))).status, 400);
  for (const path of [
    operationPath() + '?tenantId=' + id(2),
    operationPath() + '?',
    memberPath() + '#authority',
  ])
    assert.equal((await f.run(req(path))).status, 400);
  for (const headers of [{ 'content-type': 'application/json' }, { 'content-length': '0' }])
    assert.equal((await f.run(req(memberPath(), { headers }))).status, 400);
  assert.equal(
    (
      await f.run(
        req(operationPath(), {
          method: 'POST',
          body: command(),
          headers: { 'content-length': '8193' },
        }),
      )
    ).status,
    413,
  );
  assert.equal(f.calls.length, 0);
});
test('wrong methods, absent identity and unrecognized membership paths perform no database work', async () => {
  const f = fixture();
  assert.equal((await f.run(req(memberPath(), { method: 'POST', body: command() }))).status, 405);
  assert.equal((await f.run(req(operationPath(), { method: 'DELETE' }))).status, 405);
  assert.equal((await f.run(new Request('http://synthetic.invalid' + memberPath()))).status, 401);
  for (const path of [
    '/v2/staff/memberships',
    '/v2/staff/memberships/bad',
    operationPath() + '/extra',
    '/v2/staff/memberships/' + id(12) + '/extra',
  ])
    assert.equal((await f.run(req(path))).status, 404);
  assert.equal(f.calls.length, 0);
  assert.equal(f.verified(), 0);
});
test('malformed SQL originals/current state and changed actor never commit successful membership responses', async () => {
  for (const patch of [
    { actorId: id(11) },
    { memberId: id(10) },
    { operationId: id(201) },
    { version: '1' },
    { requestedRole: 'agent' },
    { reason: 'Changed request' },
    { membershipGranted: true },
  ]) {
    const f = fixture({ projection: { ...saved, ...patch } });
    const response = await f.run(req(operationPath(), { method: 'POST', body: command() }));
    assert.equal(response.status, 503);
    assert.equal(f.commits(), 0);
    assert.equal(f.rollbacks(), 1);
    assert.ok(!JSON.stringify(await response.json()).includes(command().reason));
  }
  for (const projection of [
    { ...saved, operationId: id(201) },
    { ...saved, actorId: id(11) },
    { ...current, memberId: id(99) },
    { ...current, actorId: id(10) },
    { ...current, role: 'customer' },
    { ...current, revokedAt: '2026-11-02T09:00:00.000Z' },
  ]) {
    const f = fixture({ projection });
    const path =
      projection.policy === 'staff-membership-record-v1' ? operationPath() : memberPath();
    assert.equal((await f.run(req(path))).status, 503);
    assert.equal(f.rollbacks(), 1);
  }
  const conflict = { ...saved, outcome: 'conflict' };
  assert.deepEqual(await (await fixture({ projection: conflict }).run(req())).json(), conflict);
});
test('known SQL refusals are sanitized and absent isolated candidate storage fails closed', async () => {
  for (const [code, status] of [
    ['42501', 403],
    ['P0002', 404],
    ['23505', 409],
    ['23514', 422],
    ['42P01', 503],
  ]) {
    const f = fixture({
      database: {
        transaction: async () => {
          throw Object.assign(Error('Private synthetic membership detail'), { code });
        },
      },
    });
    const response = await f.run(req());
    assert.equal(response.status, status);
    assert.ok(
      !JSON.stringify(await response.json()).includes('Private synthetic membership detail'),
    );
  }
});
test('actual restricted SQL rechecks current company/admin, blocks self and customer targets, and rolls back malformed successful projections', async () => {
  const db = new PGlite();
  try {
    await applyTestMigrations(db);
    await db.exec(
      await readFile(
        new URL('../../../database/proposals/staff-membership-changes.sql', import.meta.url),
        'utf8',
      ),
    );
    await db.query(
      "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'member-api-a','Synthetic A'),($2,'member-api-b','Synthetic B')",
      [id(1), id(2)],
    );
    for (const [tenant, member, role] of [
      [1, 10, 'admin'],
      [1, 11, 'admin'],
      [1, 12, 'agent'],
      [1, 13, 'customer'],
      [2, 20, 'admin'],
    ])
      await db.query(
        'INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',
        [id(tenant), id(member), role],
      );
    let corrupt = false;
    const run = createApiService({
      tenantId: id(1),
      privacyNoticeVersion: 'synthetic-membership-notice-v1',
      staffMembershipMode: 'synthetic-existing-members-v1',
      verifyAuthorization: async (request) => {
        const actors = {
          'Bearer synthetic-admin': 10,
          'Bearer synthetic-peer': 11,
          'Bearer synthetic-agent': 12,
          'Bearer synthetic-customer': 13,
          'Bearer synthetic-foreign': 20,
        };
        const member = actors[request.headers.get('authorization')];
        if (!member) throw Error('Invalid synthetic subject');
        return { actorId: id(member) };
      },
      database: {
        transaction: async (context, work) => {
          await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
          try {
            await db.query(
              "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
              [context.tenantId, context.actorId],
            );
            const result = await work({
              query: async (sql, args) => {
                const value = await db.query(sql, args);
                if (corrupt && sql.includes('save_staff_membership'))
                  return { rows: [{ receipt: { ...value.rows[0].receipt, actorId: id(999) } }] };
                return value;
              },
            });
            await db.exec('COMMIT');
            return result;
          } catch (error) {
            await db.exec('ROLLBACK');
            throw error;
          }
        },
      },
    });
    // Validation runs inside the transaction, so a forged result rolls back the real attempted role change.
    corrupt = true;
    assert.equal(
      (await run(req(operationPath(), { method: 'POST', body: command() }))).status,
      503,
    );
    assert.equal(
      (
        await db.query(
          'SELECT role FROM app_private.memberships WHERE tenant_id=$1 AND user_id=$2',
          [id(1), id(12)],
        )
      ).rows[0].role,
      'agent',
    );
    assert.equal(
      Number(
        (await db.query('SELECT count(*) AS n FROM app_private.staff_membership_operations'))
          .rows[0].n,
      ),
      0,
    );
    corrupt = false;
    const applied = await run(req(operationPath(), { method: 'POST', body: command() }));
    assert.equal(applied.status, 200);
    const original = await applied.json();
    assert.equal(original.outcome, 'applied');
    assert.deepEqual(await (await run(req())).json(), original);
    assert.equal((await (await run(req(memberPath()))).json()).role, 'admin');
    const conflict = await run(
      req(operationPath(201), {
        method: 'POST',
        body: command({ operationId: id(201), requestedRole: 'agent' }),
      }),
    );
    assert.equal(conflict.status, 200);
    assert.equal((await conflict.json()).outcome, 'conflict');
    assert.equal(
      (
        await run(
          req(operationPath(202), {
            method: 'POST',
            body: command({ operationId: id(202), memberId: id(10) }),
          }),
        )
      ).status,
      403,
    );
    for (const member of [13, 20, 999])
      assert.equal((await run(req(memberPath(member)))).status, 404);
    assert.equal(
      (
        await run(
          req(operationPath(203), {
            method: 'POST',
            body: command({ operationId: id(203), memberId: id(13) }),
          }),
        )
      ).status,
      404,
    );
    assert.equal(
      (await run(req(operationPath(), { headers: { authorization: 'Bearer synthetic-peer' } })))
        .status,
      404,
    );
    for (const subject of ['synthetic-customer', 'synthetic-foreign'])
      assert.equal(
        (await run(req(memberPath(), { headers: { authorization: 'Bearer ' + subject } }))).status,
        403,
      );
    assert.equal(
      (
        await run(
          req(operationPath(204), {
            method: 'POST',
            body: command({ operationId: id(204), memberId: id(11), requestedRole: 'agent' }),
          }),
        )
      ).status,
      200,
    );
    assert.equal(
      (await run(req(memberPath(), { headers: { authorization: 'Bearer synthetic-peer' } })))
        .status,
      403,
    );
    await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [id(1)]);
    assert.equal((await run(req())).status, 403);
    assert.equal(
      Number((await db.query('SELECT count(*) AS n FROM app_private.memberships')).rows[0].n),
      5,
    );
  } finally {
    await db.close();
  }
});
