import { RealtorApiClient } from '../../../packages/api-client/dist/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../dist/service.js';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const capturePath = `/v2/staff/invitation-requests/operations/${id(200)}`,
  statePath = `/v2/staff/invitation-requests/${id(200)}`,
  revokePath = statePath + `/revocations/${id(300)}`;
const intent = {
  policy: 'staff-invitation-intent-v1',
  operationId: id(200),
  recipientEmail: 'synthetic@example.invalid',
  requestedRole: 'agent',
  branchId: null,
  expiresAfterHours: 72,
};
const command = {
  policy: 'staff-invitation-revocation-command-v1',
  operationId: id(300),
  invitationId: id(200),
  expectedVersion: '1',
  reason: 'Synthetic cancellation.',
};
const saved = {
  policy: 'staff-invitation-request-record-v1',
  operationId: id(200),
  actorId: id(10),
  recipientEmail: intent.recipientEmail,
  requestedRole: 'agent',
  expiresAfterHours: 72,
  branch: null,
  recordedAt: '2026-10-30T06:00:00.000Z',
  expiresAt: '2026-11-02T06:00:00.000Z',
  status: 'recorded',
  delivery: 'not_attempted',
  membershipGranted: false,
};
const revoked = {
  policy: 'staff-invitation-revocation-record-v1',
  operationId: id(300),
  invitationId: id(200),
  actorId: id(10),
  expectedVersion: '1',
  version: '2',
  reason: command.reason,
  outcome: 'revoked',
  recordedAt: '2026-10-30T07:00:00.000Z',
};
const req = (path = capturePath, { method = 'GET', body, headers = {} } = {}) =>
  new Request('http://synthetic.invalid' + path, {
    method,
    headers: {
      authorization: 'Bearer synthetic-admin',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
function fixture(overrides = {}) {
  const calls = [],
    contexts = [];
  let verified = 0;
  const options = {
    tenantId: id(1),
    privacyNoticeVersion: 'synthetic-staff-notice-v1',
    staffInvitationMode: 'synthetic-capture-only-v1',
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
            if (sql.startsWith('SET ')) return { rows: [] };
            let result = saved;
            if (sql.includes('invitation_revocation') || sql.includes('revoke_staff_invitation'))
              result = revoked;
            else if (sql.includes('invitation_state')) {
              const { actorId, ...r } = saved;
              result = {
                ...r,
                policy: 'staff-invitation-state-v1',
                version: '1',
                state: 'pending',
              };
            }
            return { rows: [{ receipt: result }] };
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
test('invitation routes default off and reject unsupported/production configuration without identity or database work', async () => {
  const f = fixture({ staffInvitationMode: undefined });
  for (const path of [capturePath, statePath, revokePath])
    assert.equal((await f.run(req(path))).status, 404);
  assert.equal(f.verified, 0);
  assert.equal(f.calls.length, 0);
  assert.throws(() => fixture({ staffInvitationMode: 'enabled' }));
  const before = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => fixture());
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
});
test('capture, original read, current state and revocation use fixed authenticated context and exact validated projections', async () => {
  const f = fixture();
  assert.equal((await f.run(req(capturePath, { method: 'POST', body: intent }))).status, 202);
  assert.deepEqual(await (await f.run(req())).json(), saved);
  assert.equal((await (await f.run(req(statePath))).json()).state, 'pending');
  assert.deepEqual(
    await (await f.run(req(revokePath, { method: 'POST', body: command }))).json(),
    revoked,
  );
  assert.deepEqual(await (await f.run(req(revokePath))).json(), revoked);
  assert.ok(f.contexts.every((c) => c.tenantId === id(1) && c.actorId === id(10)));
  assert.deepEqual(f.calls.find((c) => c.sql.includes('record_staff_invitation_request')).args, [
    id(200),
    intent.recipientEmail,
    'agent',
    null,
    72,
  ]);
  assert.equal(f.calls.filter((c) => c.sql.includes('record_staff_invitation_request')).length, 1);
});
test('authority, duplicate keys, rounded hours, route mismatch and excessive bodies are refused before SQL', async () => {
  const f = fixture();
  for (const body of [
    { ...intent, tenantId: id(2) },
    { ...intent, operationId: id(201) },
    JSON.stringify(intent).replace('"expiresAfterHours":72', '"expiresAfterHours":7.2e1'),
    JSON.stringify(intent).replace('"policy":', '"\\u0070olicy":"bad","policy":'),
  ])
    assert.equal((await f.run(req(capturePath, { method: 'POST', body }))).status, 400);
  for (const headers of [
    { 'x-tenant-id': id(2) },
    { cookie: 'session=ignored' },
    { 'idempotency-key': id(9) },
    { 'content-encoding': 'gzip' },
  ])
    assert.equal((await f.run(req(capturePath, { headers }))).status, 400);
  assert.equal((await f.run(req(capturePath + '?company=other'))).status, 400);
  assert.equal((await f.run(req(capturePath, { headers: { 'content-length': '0' } }))).status, 400);
  assert.equal(
    (
      await f.run(
        req(capturePath, { method: 'POST', body: intent, headers: { 'content-length': '8193' } }),
      )
    ).status,
    413,
  );
  assert.equal(f.calls.length, 0);
});
test('malformed successful SQL projection or changed original actor never becomes saved invitation success', async () => {
  for (const patch of [
    { actorId: id(11) },
    { membershipGranted: true },
    { delivery: 'sent' },
    { operationId: id(201) },
    { expiresAt: '2026-11-02T06:00:00.001Z' },
  ]) {
    const f = fixture({
      database: {
        transaction: async (_ctx, work) =>
          work({
            query: async (sql) => ({
              rows: sql.startsWith('SET ') ? [] : [{ receipt: { ...saved, ...patch } }],
            }),
          }),
      },
    });
    const response = await f.run(req(capturePath, { method: 'POST', body: intent }));
    assert.equal(response.status, 503);
    assert.ok(!JSON.stringify(await response.json()).includes(intent.recipientEmail));
  }
});
test('known SQL denials stay private and absent candidate storage fails closed without installing anything', async () => {
  for (const [code, status] of [
    ['42501', 403],
    ['P0002', 404],
    ['23505', 409],
    ['42P01', 503],
  ]) {
    const f = fixture({
      database: {
        transaction: async () => {
          throw Object.assign(Error('Private synthetic detail'), { code });
        },
      },
    });
    const r = await f.run(req());
    assert.equal(r.status, status);
    assert.ok(!JSON.stringify(await r.json()).includes('Private synthetic detail'));
  }
});
test('actual restricted candidate SQL captures and revokes without grants; current role/company and original requester are enforced', async () => {
  const db = new PGlite();
  try {
    await applyTestMigrations(db);
    for (const f of ['staff-branches.sql', 'staff-invitation-requests.sql'])
      await db.exec(
        await readFile(new URL('../../../database/proposals/' + f, import.meta.url), 'utf8'),
      );
    await db.query(
      "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'invite-api-a','Synthetic A'),($2,'invite-api-b','Synthetic B')",
      [id(1), id(2)],
    );
    for (const [t, u, role] of [
      [1, 10, 'admin'],
      [1, 11, 'admin'],
      [1, 12, 'agent'],
      [1, 13, 'customer'],
      [2, 20, 'admin'],
    ])
      await db.query(
        'INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',
        [id(t), id(u), role],
      );
    const before = (
      await db.query('SELECT * FROM app_private.memberships ORDER BY tenant_id,user_id')
    ).rows;
    const run = createApiService({
      tenantId: id(1),
      privacyNoticeVersion: 'synthetic-staff-notice-v1',
      staffInvitationMode: 'synthetic-capture-only-v1',
      verifyAuthorization: async (request) => {
        const key = request.headers.get('authorization');
        const actors = {
          'Bearer synthetic-admin': 10,
          'Bearer synthetic-peer': 11,
          'Bearer synthetic-agent': 12,
          'Bearer synthetic-customer': 13,
          'Bearer synthetic-foreign': 20,
        };
        if (!actors[key]) throw Error('Synthetic invalid identity');
        return { actorId: id(actors[key]) };
      },
      database: {
        transaction: async (ctx, work) => {
          await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
          try {
            await db.query(
              "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
              [ctx.tenantId, ctx.actorId],
            );
            const r = await work(db);
            await db.exec('COMMIT');
            return r;
          } catch (e) {
            await db.exec('ROLLBACK');
            throw e;
          }
        },
      },
    });
    const first = await run(req(capturePath, { method: 'POST', body: intent }));
    assert.equal(first.status, 202);
    const original = await first.json();
    assert.equal(original.delivery, 'not_attempted');
    assert.equal(original.membershipGranted, false);
    assert.deepEqual(await (await run(req())).json(), original);
    for (const actor of ['agent', 'customer', 'foreign'])
      assert.equal(
        (await run(req(statePath, { headers: { authorization: 'Bearer synthetic-' + actor } })))
          .status,
        403,
      );
    assert.equal(
      (await run(req(capturePath, { headers: { authorization: 'Bearer synthetic-peer' } }))).status,
      404,
    );
    assert.equal(
      (await run(req(statePath, { headers: { authorization: 'Bearer synthetic-peer' } }))).status,
      200,
    );
    assert.equal((await run(req(revokePath, { method: 'POST', body: command }))).status, 200);
    assert.equal((await (await run(req(statePath))).json()).state, 'revoked');
    assert.deepEqual(await (await run(req())).json(), original);
    // Actual SDK-to-service Request transport and restricted SQL; this is not a signed HTTP/provider proof.
    const client = new RealtorApiClient({
      baseUrl: 'https://synthetic.invalid',
      privacyNoticeVersion: 'synthetic-staff-notice-v1',
      fetch: (url, init) => run(new Request(url, init)),
    });
    const auth = { bearerToken: 'synthetic-admin' };
    assert.deepEqual(await client.recordStaffInvitationRequest(intent, auth), original);
    assert.deepEqual(await client.getStaffInvitationRequest(id(200), auth), original);
    assert.equal((await client.getStaffInvitationState(id(200), auth)).state, 'revoked');
    assert.equal(
      (
        await client.revokeStaffInvitationRequest(
          { ...command, operationId: id(301), expectedVersion: '2' },
          auth,
        )
      ).outcome,
      'already_revoked',
    );
    assert.equal(
      (await client.getStaffInvitationRevocation(id(200), id(301), auth)).outcome,
      'already_revoked',
    );
    await assert.rejects(
      () => client.getStaffInvitationState(id(200), { bearerToken: 'synthetic-agent' }),
      (e) => e.status === 403,
    );
    assert.deepEqual(
      (await db.query('SELECT * FROM app_private.memberships ORDER BY tenant_id,user_id')).rows,
      before,
    );
  } finally {
    await db.close();
  }
});
