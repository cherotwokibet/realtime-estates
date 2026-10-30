import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import { validateStaffInvitationEmail } from '../../packages/domain/dist/index.js';
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
