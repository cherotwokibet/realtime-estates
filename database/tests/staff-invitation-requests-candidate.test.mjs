import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import {
  validateStaffInvitationEmail,
  validateStaffInvitationRequestRecord,
  validateStaffInvitationState,
  validateStaffInvitationRevocationRecord,
  parseStaffInvitationJson,
} from '../../packages/domain/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture() {
  const db = new PGlite();
  await applyTestMigrations(db);
  for (const f of ['staff-branches.sql', 'staff-invitation-requests.sql'])
    await db.exec(await readFile(new URL('../proposals/' + f, import.meta.url), 'utf8'));
  await db.query(
    "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'invite-a','Synthetic A'),($2,'invite-b','Synthetic B')",
    [id(1), id(2)],
  );
  for (const [t, u, r] of [
    [1, 10, 'admin'],
    [1, 11, 'admin'],
    [1, 12, 'agent'],
    [1, 13, 'customer'],
    [2, 20, 'admin'],
  ])
    await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
      id(t),
      id(u),
      r,
    ]);
  return db;
}
async function actor(db, t, u, fn) {
  await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
  try {
    await db.query(
      "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
      [id(t), u === null ? '' : id(u)],
    );
    const r = await fn();
    await db.exec('COMMIT');
    return r;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}
const scalar = async (db, sql, args = []) => (await db.query(sql, args)).rows[0].result;
const branch = (db, op, expected, name = 'Synthetic branch', active = true) =>
  actor(db, 1, 10, () =>
    scalar(db, 'SELECT app_api.save_staff_branch($1,$2,$3,$4,$5,$6) AS result', [
      id(op),
      id(100),
      expected,
      name,
      active,
      'Synthetic branch change.',
    ]),
  );
const capture = (
  db,
  op = 200,
  {
    email = 'synthetic+staff@example.invalid',
    role = 'agent',
    branch = null,
    hours = 72,
    t = 1,
    u = 10,
  } = {},
) =>
  actor(db, t, u, () =>
    scalar(db, 'SELECT app_api.record_staff_invitation_request($1,$2,$3,$4,$5) AS result', [
      id(op),
      email,
      role,
      branch,
      hours,
    ]),
  );
const original = (db, op = 200, t = 1, u = 10) =>
  actor(db, t, u, () =>
    scalar(db, 'SELECT app_api.read_staff_invitation_request($1) AS result', [id(op)]),
  );
const revoke = (
  db,
  op,
  expected = 1,
  { invitation = 200, reason = 'Synthetic cancellation.', t = 1, u = 10 } = {},
) =>
  actor(db, t, u, () =>
    scalar(db, 'SELECT app_api.revoke_staff_invitation_request($1,$2,$3,$4) AS result', [
      id(op),
      id(invitation),
      expected,
      reason,
    ]),
  );
const state = (db, op = 200, t = 1, u = 10) =>
  actor(db, t, u, () =>
    scalar(db, 'SELECT app_api.read_staff_invitation_state($1) AS result', [id(op)]),
  );
test('capture binds an active branch snapshot and preserves exact original after rename, disable and revocation without delivery or grants', async () => {
  const db = await fixture();
  try {
    const members = (
      await db.query('SELECT * FROM app_private.memberships ORDER BY tenant_id,user_id')
    ).rows;
    await branch(db, 1000, 0);
    const saved = await capture(db, 200, { branch: id(100) });
    assert.deepEqual(saved.branch, { branchId: id(100), version: '1', name: 'Synthetic branch' });
    assert.equal(saved.delivery, 'not_attempted');
    assert.equal(saved.membershipGranted, false);
    await branch(db, 1001, 1, 'Renamed branch', false);
    assert.deepEqual(await capture(db, 200, { branch: id(100) }), saved);
    await assert.rejects(
      () => capture(db, 201, { branch: id(100) }),
      (e) => e.code === 'P0002',
    );
    await revoke(db, 300);
    assert.deepEqual(await original(db), saved);
    assert.equal((await state(db, 200, 1, 11)).state, 'revoked');
    assert.deepEqual(
      (await db.query('SELECT * FROM app_private.memberships ORDER BY tenant_id,user_id')).rows,
      members,
    );
  } finally {
    await db.close();
  }
});
test('revocation conflicts and exact actor-bound originals never upgrade after later work', async () => {
  const db = await fixture();
  try {
    await capture(db);
    const conflict = await revoke(db, 300, 2);
    assert.equal(conflict.outcome, 'conflict');
    const saved = await revoke(db, 301);
    assert.equal(saved.outcome, 'revoked');
    assert.equal(saved.version, '2');
    assert.deepEqual(await revoke(db, 300, 2), conflict);
    assert.deepEqual(await revoke(db, 301), saved);
    assert.equal((await revoke(db, 302, 2)).outcome, 'already_revoked');
    await assert.rejects(
      () => revoke(db, 301, 1, { reason: 'Changed' }),
      (e) => e.code === '23505',
    );
    const recovered = await actor(db, 1, 10, () =>
      scalar(db, 'SELECT app_api.read_staff_invitation_revocation($1) AS result', [id(301)]),
    );
    assert.deepEqual(recovered, saved);
    await assert.rejects(
      () =>
        actor(db, 1, 11, () =>
          scalar(db, 'SELECT app_api.read_staff_invitation_revocation($1) AS result', [id(301)]),
        ),
      (e) => e.code === 'P0002',
    );
    const audit = JSON.stringify(
      (await db.query('SELECT summary FROM app_private.audit_events')).rows,
    );
    assert.ok(!audit.includes('synthetic+staff') && !audit.includes('Synthetic cancellation'));
  } finally {
    await db.close();
  }
});
test('historically expired fixture stays expired and original retrieval never extends its immutable deadline', async () => {
  const db = await fixture();
  try {
    // Privileged synthetic historical fixture; not an advanced clock or an exposed timestamp input.
    await db.query(
      "INSERT INTO app_private.staff_invitation_requests(tenant_id,operation_id,actor_id,recipient_email,requested_role,expires_after_hours,recorded_at) VALUES($1,$2,$3,'past@example.invalid','agent',24,statement_timestamp()-interval '8 days')",
      [id(1), id(200), id(10)],
    );
    const before = await original(db);
    assert.equal((await state(db)).state, 'expired');
    const expired = await revoke(db, 300);
    assert.equal(expired.outcome, 'expired');
    assert.equal(expired.version, '1');
    assert.deepEqual(await original(db), before);
    assert.equal((await state(db)).state, 'expired');
  } finally {
    await db.close();
  }
});

test('invitation capture starts its full lifetime at decision time after a delayed statement', async () => {
  const db = await fixture();
  try {
    const result = await actor(db, 1, 10, () =>
      scalar(
        db,
        `WITH delay AS MATERIALIZED (SELECT pg_sleep(0.15))
        SELECT jsonb_build_object('started', statement_timestamp(),
          'saved', app_api.record_staff_invitation_request($1,$2,'agent',NULL,24)) AS result
        FROM delay`,
        [id(200), 'synthetic+staff@example.invalid'],
      ),
    );
    assert.ok(Date.parse(result.saved.recordedAt) - Date.parse(result.started) >= 100);
    assert.equal(
      Date.parse(result.saved.expiresAt) - Date.parse(result.saved.recordedAt),
      24 * 60 * 60 * 1000,
    );
    assert.deepEqual(await original(db), result.saved);
  } finally {
    await db.close();
  }
});

test('expiry crossed inside one statement prevents late revocation and preserves the original deadline', async () => {
  const db = await fixture();
  try {
    // One real SQL statement creates a synthetic invitation with 100 ms left,
    // waits past its deadline, then calls the actual writer. No clock is mocked.
    // Privileged fixture insertion only; the SECURITY DEFINER writer still
    // checks the configured actor/company. Runtime storage grants stay absent.
    await db.query(
      "SELECT set_config('realtor.tenant_id',$1,false),set_config('realtor.actor_id',$2,false)",
      [id(1), id(10)],
    );
    const result = await scalar(
      db,
      `
      WITH inserted AS (
        INSERT INTO app_private.staff_invitation_requests
          (tenant_id,operation_id,actor_id,recipient_email,requested_role,expires_after_hours,recorded_at)
        VALUES($1,$2,$3,'past@example.invalid','agent',24,
          statement_timestamp()-interval '24 hours'+interval '100 milliseconds')
        RETURNING operation_id
      ), delay AS MATERIALIZED (SELECT operation_id,pg_sleep(0.2) FROM inserted)
      SELECT app_api.revoke_staff_invitation_request($4,operation_id,1,'Synthetic cancellation.') AS result FROM delay
    `,
      [id(1), id(200), id(10), id(300)],
    );
    assert.equal(result.outcome, 'expired');
    assert.equal(result.version, '1');
    assert.equal((await state(db)).state, 'expired');
    assert.deepEqual(await revoke(db, 300), result);
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) AS n FROM app_private.staff_invitation_revocations WHERE outcome='revoked'",
          )
        ).rows[0].n,
      ),
      0,
    );
    assert.equal(
      Number((await db.query('SELECT count(*) AS n FROM app_private.audit_events')).rows[0].n),
      0,
    );
  } finally {
    await db.close();
  }
});

test('authority lost after admission prevents branch, capture and revocation writes atomically', async () => {
  const db = await fixture();
  try {
    await branch(db, 1000, 0);
    await capture(db);
    const before = (await db.query('SELECT * FROM app_private.audit_events ORDER BY id')).rows;
    // Disposable single-session failure injection: lose the actor role just
    // after its first valid admission. This is not a hosted lock-wait test.
    await db.exec(`CREATE OR REPLACE FUNCTION app_private.assert_staff(p_roles text[])
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
      IF NOT coalesce(app_private.staff_role()=ANY(p_roles),false) THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE='42501';
      END IF;
      IF current_setting('realtor.test_admin_loss',true)='armed' THEN
        PERFORM set_config('realtor.test_admin_loss','disarmed',true);
        UPDATE app_private.memberships SET role='agent'
          WHERE tenant_id=app_private.context_tenant() AND user_id=app_private.context_actor();
      END IF;
      END $$`);
    for (const [sql, params] of [
      [
        'SELECT app_api.save_staff_branch($1,$2,1,$3,true,$4)',
        [id(201), id(100), 'Changed branch', 'Synthetic change.'],
      ],
      [
        "SELECT app_api.record_staff_invitation_request($1,$2,'agent',NULL,24)",
        [id(201), 'another@example.invalid'],
      ],
      [
        'SELECT app_api.revoke_staff_invitation_request($1,$2,1,$3)',
        [id(301), id(200), 'Synthetic cancellation.'],
      ],
    ]) {
      await assert.rejects(
        () =>
          actor(db, 1, 10, async () => {
            await db.query("SELECT set_config('realtor.test_admin_loss','armed',true)");
            return db.query(sql, params);
          }),
        (error) => error.code === '42501',
      );
      assert.equal(
        (
          await db.query(
            'SELECT role FROM app_private.memberships WHERE tenant_id=$1 AND user_id=$2',
            [id(1), id(10)],
          )
        ).rows[0].role,
        'admin',
      );
      assert.deepEqual(
        (await db.query('SELECT * FROM app_private.audit_events ORDER BY id')).rows,
        before,
      );
    }
    assert.equal(
      Number(
        (await db.query('SELECT count(*) AS n FROM app_private.staff_branch_operations')).rows[0].n,
      ),
      1,
    );
    assert.equal(
      Number(
        (await db.query('SELECT count(*) AS n FROM app_private.staff_invitation_requests')).rows[0]
          .n,
      ),
      1,
    );
    assert.equal(
      Number(
        (await db.query('SELECT count(*) AS n FROM app_private.staff_invitation_revocations'))
          .rows[0].n,
      ),
      0,
    );
  } finally {
    await db.close();
  }
});
test('current role, tenant, original requester and raw storage restrictions protect private invitation facts', async () => {
  const db = await fixture();
  try {
    await capture(db);
    for (const [t, u] of [
      [1, null],
      [1, 12],
      [1, 13],
      [2, 10],
    ])
      await assert.rejects(
        () => capture(db, 201, { t, u }),
        (e) => e.code === '42501',
      );
    await assert.rejects(
      () => original(db, 200, 1, 11),
      (e) => e.code === 'P0002',
    );
    await assert.rejects(
      () => original(db, 200, 2, 20),
      (e) => e.code === 'P0002',
    );
    await assert.rejects(
      () => revoke(db, 300, 1, { t: 2, u: 20 }),
      (e) => e.code === 'P0002',
    );
    await assert.rejects(
      () => capture(db, 200, { email: 'changed@example.invalid' }),
      (e) => e.code === '23505',
    );
    for (const table of ['staff_invitation_requests', 'staff_invitation_revocations'])
      for (const role of ['api_runtime', 'media_coordinator', 'media_maintenance']) {
        const p = (
          await db.query(
            "SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS granted",
            [role, 'app_private.' + table],
          )
        ).rows[0];
        assert.equal(p.granted, false);
      }
    await assert.rejects(
      async () => {
        await db.exec('BEGIN;SET LOCAL ROLE realtor_owner');
        try {
          await db.exec(
            'UPDATE app_private.staff_invitation_requests SET recipient_email=recipient_email',
          );
        } finally {
          await db.exec('ROLLBACK');
        }
      },
      (e) => e.code === '23514',
    );
    await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [id(1)]);
    await assert.rejects(
      () => original(db),
      (e) => e.code === '42501',
    );
  } finally {
    await db.close();
  }
});
test('SQL recipient validation agrees with shared intent and unsupported role/branch/expiry reserves nothing', async () => {
  const db = await fixture();
  try {
    for (const email of [
      'valid+tag@example.invalid',
      "o'example@example.invalid",
      'UPPER@example.invalid',
      ' spaced@example.invalid',
      'a..b@example.invalid',
      'a.@example.invalid',
      'a@-example.invalid',
      'a@localhost',
      'a@éxample.invalid',
      'a@example.invalid\r\nBcc:x@example.invalid',
      'a'.repeat(65) + '@example.invalid',
    ]) {
      let valid = true;
      try {
        validateStaffInvitationEmail(email);
      } catch {
        valid = false;
      }
      assert.equal(
        await scalar(db, 'SELECT app_private.staff_invitation_email_valid($1) AS result', [email]),
        valid,
        email,
      );
    }
    for (const opts of [
      { email: 'bad' },
      { role: 'owner' },
      { role: 'customer' },
      { role: 'admin', branch: id(100) },
      { branch: id(999) },
      { hours: 0 },
      { hours: 169 },
      { hours: null },
    ])
      await assert.rejects(
        () => capture(db, 200, opts),
        (e) => ['23514', 'P0002'].includes(e.code),
      );
    assert.equal(
      Number(
        (await db.query('SELECT count(*) AS n FROM app_private.staff_invitation_requests')).rows[0]
          .n,
      ),
      0,
    );
  } finally {
    await db.close();
  }
});

test('actual SQL request, state and revocation JSON satisfies exact shared wire contracts', async () => {
  const db = await fixture();
  try {
    await branch(db, 1000, 0);
    const intent = {
      policy: 'staff-invitation-intent-v1',
      operationId: id(200),
      recipientEmail: 'synthetic+staff@example.invalid',
      requestedRole: 'agent',
      branchId: id(100),
      expiresAfterHours: 72,
    };
    const saved = validateStaffInvitationRequestRecord(
      parseStaffInvitationJson(JSON.stringify(await capture(db, 200, { branch: id(100) }))),
      intent,
      id(10),
    );
    assert.equal(saved.branch.name, 'Synthetic branch');
    assert.equal(
      validateStaffInvitationState(
        parseStaffInvitationJson(JSON.stringify(await state(db))),
        id(200),
      ).state,
      'pending',
    );
    const cmd = {
      policy: 'staff-invitation-revocation-command-v1',
      operationId: id(300),
      invitationId: id(200),
      expectedVersion: '1',
      reason: 'Synthetic cancellation.',
    };
    const revoked = validateStaffInvitationRevocationRecord(
      parseStaffInvitationJson(JSON.stringify(await revoke(db, 300))),
      cmd,
      id(10),
    );
    assert.equal(revoked.outcome, 'revoked');
    assert.deepEqual(
      validateStaffInvitationRequestRecord(await original(db), intent, id(10)),
      saved,
    );
    assert.equal(validateStaffInvitationState(await state(db), id(200)).state, 'revoked');
  } finally {
    await db.close();
  }
});
test('C1 control characters cannot be saved into branch snapshots or private revocation reasons', async () => {
  const db = await fixture();
  try {
    for (const code of [0x80, 0x85, 0x9f])
      await assert.rejects(
        () => branch(db, 1000, 0, 'Synthetic' + String.fromCodePoint(code)),
        (e) => e.code === '23514',
      );
    await capture(db);
    for (const code of [0x80, 0x85, 0x9f])
      await assert.rejects(
        () => revoke(db, 300, 1, { reason: 'Synthetic' + String.fromCodePoint(code) }),
        (e) => e.code === '23514',
      );
  } finally {
    await db.close();
  }
});
