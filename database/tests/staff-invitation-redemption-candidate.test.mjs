import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const issuer = 'https://synthetic-issuer.example.invalid';
const email = 'new-staff@example.invalid';
const digest = createHash('sha256').update('synthetic-secret-only').digest('hex');
const otherDigest = createHash('sha256').update('different-secret-only').digest('hex');
async function fixture() {
  const db = new PGlite();
  await applyTestMigrations(db);
  for (const file of [
    'staff-branches.sql',
    'staff-invitation-requests.sql',
    'staff-membership-changes.sql',
    'staff-invitation-redemption.sql',
  ])
    await db.exec(await readFile(new URL('../proposals/' + file, import.meta.url), 'utf8'));
  await db.query(
    "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'redeem-a','Synthetic A'),($2,'redeem-b','Synthetic B')",
    [id(1), id(2)],
  );
  for (const [tenant, user, role] of [
    [1, 10, 'admin'],
    [1, 11, 'admin'],
    [1, 12, 'agent'],
    [1, 13, 'customer'],
    [1, 14, 'agent'],
    [2, 20, 'admin'],
  ])
    await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
      id(tenant),
      id(user),
      role,
    ]);
  await db.query(
    'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE user_id=$1',
    [id(14)],
  );
  return db;
}
async function actor(db, user, fn, tenant = 1) {
  await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
  try {
    await db.query(
      "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
      [id(tenant), user === null ? '' : id(user)],
    );
    const result = await fn();
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
const scalar = async (db, sql, args = []) => (await db.query(sql, args)).rows[0].result;
const call = (db, user, sql, args = [], tenant = 1) =>
  actor(db, user, () => scalar(db, sql, args), tenant);
const capture = (db, op = 200, role = 'agent', branch = null, recipient = email) =>
  call(db, 10, 'SELECT app_api.record_staff_invitation_request($1,$2,$3,$4,24) AS result', [
    id(op),
    recipient,
    role,
    branch,
  ]);
const issue = (db, op = 300, invitation = 200, hash = digest, user = 10) =>
  call(db, user, 'SELECT app_api.issue_staff_invitation($1,$2,$3,$4) AS result', [
    id(op),
    id(invitation),
    issuer,
    hash,
  ]);
const redeem = (
  db,
  {
    op = 400,
    invitation = 200,
    user = 50,
    tenant = 1,
    recipient = email,
    iss = issuer,
    hash = digest,
  } = {},
) =>
  call(
    db,
    user,
    'SELECT app_api.redeem_staff_invitation($1,$2,$3,$4,$5) AS result',
    [id(op), id(invitation), iss, recipient, hash],
    tenant,
  );
const readIssue = (db, op = 300, user = 10, tenant = 1) =>
  call(db, user, 'SELECT app_api.read_staff_invitation_issue($1) AS result', [id(op)], tenant);
const readUsed = (db, op = 400, user = 50, recipient = email, tenant = 1) =>
  call(
    db,
    user,
    'SELECT app_api.read_staff_invitation_redemption($1,$2,$3) AS result',
    [id(op), issuer, recipient],
    tenant,
  );
const state = (db, invitation = 200) =>
  call(db, 10, 'SELECT app_api.read_issued_staff_invitation($1) AS result', [id(invitation)]);
const cancel = (db, op = 500, invitation = 200) =>
  call(db, 10, 'SELECT app_api.revoke_staff_invitation_request($1,$2,1,$3) AS result', [
    id(op),
    id(invitation),
    'Synthetic cancellation.',
  ]);
const branch = (db, op = 1000, version = 0, name = 'Synthetic branch', active = true) =>
  call(db, 10, 'SELECT app_api.save_staff_branch($1,$2,$3,$4,$5,$6) AS result', [
    id(op),
    id(100),
    version,
    name,
    active,
    'Synthetic branch change.',
  ]);
const unavailable = (error) => error.code === 'P0002';
const conflict = (error) => error.code === '23505';
const count = async (db, table) =>
  Number((await db.query('SELECT count(*) AS n FROM app_private.' + table)).rows[0].n);

test('atomic redemption grants once, preserves capture history and never reactivates on original replay', async () => {
  const db = await fixture();
  try {
    await branch(db);
    const captured = await capture(db, 200, 'agent', id(100));
    const issued = await issue(db);
    assert.equal(issued.membershipGranted, false);
    assert.equal(issued.expiresAt, captured.expiresAt);
    assert.equal(issued.secretRecovery, 'revoke_and_replace');
    assert.ok(!JSON.stringify(issued).includes(digest));
    assert.equal((await state(db)).state, 'issued');
    const saved = await redeem(db);
    assert.equal(saved.membershipGranted, true);
    assert.equal(saved.memberId, id(50));
    assert.equal(saved.branchId, id(100));
    assert.deepEqual(
      (
        await db.query(
          'SELECT role,active,admin_version FROM app_private.memberships WHERE tenant_id=$1 AND user_id=$2',
          [id(1), id(50)],
        )
      ).rows,
      [{ role: 'agent', active: true, admin_version: 1 }],
    );
    assert.deepEqual(await redeem(db), saved);
    assert.deepEqual(await readUsed(db), saved);
    assert.equal((await state(db)).state, 'used');
    assert.deepEqual(
      await call(db, 10, 'SELECT app_api.read_staff_invitation_request($1) AS result', [id(200)]),
      captured,
    );
    await assert.rejects(() => redeem(db, { op: 401 }), unavailable);
    await assert.rejects(
      () => cancel(db),
      (e) => e.code === '23514',
    );
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now(),admin_version=2 WHERE tenant_id=$1 AND user_id=$2',
      [id(1), id(50)],
    );
    assert.deepEqual(await redeem(db), saved);
    assert.deepEqual(await readUsed(db), saved);
    assert.equal(
      (
        await db.query(
          'SELECT active FROM app_private.memberships WHERE tenant_id=$1 AND user_id=$2',
          [id(1), id(50)],
        )
      ).rows[0].active,
      false,
    );
    const audit = (
      await db.query(
        "SELECT action,summary FROM app_private.audit_events WHERE action IN ('staff.invitation_issued','staff.invitation_redeemed') ORDER BY action",
      )
    ).rows;
    assert.equal(audit.length, 2);
    assert.ok(!JSON.stringify(audit).includes(email));
    assert.ok(!JSON.stringify(audit).includes(digest));
  } finally {
    await db.close();
  }
});

test('issuance originals expose no digest and lost secrets require cancellation and a fresh capture', async () => {
  const db = await fixture();
  try {
    await capture(db);
    const saved = await issue(db);
    assert.deepEqual(await issue(db), saved);
    assert.deepEqual(await readIssue(db), saved);
    await assert.rejects(() => issue(db, 300, 200, otherDigest), conflict);
    await assert.rejects(() => issue(db, 301, 200, otherDigest), conflict);
    await assert.rejects(() => readIssue(db, 300, 11), unavailable);
    await assert.rejects(() => readIssue(db, 300, 20, 2), unavailable);
    assert.equal(await count(db, 'staff_invitation_issues'), 1);
    await cancel(db);
    assert.equal((await state(db)).state, 'revoked');
    assert.deepEqual(await readIssue(db), saved);
    await assert.rejects(() => redeem(db), unavailable);
    await capture(db, 201);
    await issue(db, 301, 201, otherDigest);
    assert.equal((await redeem(db, { invitation: 201, hash: otherDigest })).memberId, id(50));
  } finally {
    await db.close();
  }
});

test('wrong recipient, issuer, digest, company and existing memberships cannot receive a grant', async () => {
  const db = await fixture();
  try {
    await capture(db, 200, 'admin');
    await issue(db);
    for (const opts of [
      { recipient: 'wrong@example.invalid' },
      { iss: issuer + '/foreign' },
      { hash: otherDigest },
      { tenant: 2 },
      { user: null },
      { user: 12 },
      { user: 13 },
      { user: 14 },
    ])
      await assert.rejects(
        () => redeem(db, opts),
        (e) => ['P0002', '23514'].includes(e.code),
      );
    assert.equal(await count(db, 'staff_invitation_redemptions'), 0);
    const saved = await redeem(db);
    assert.equal(saved.requestedRole, 'admin');
    assert.equal(saved.branchId, null);
    await assert.rejects(() => readUsed(db, 400, 51), unavailable);
    await assert.rejects(() => readUsed(db, 400, 50, 'changed@example.invalid'), unavailable);
    await assert.rejects(() => redeem(db, { user: 51 }), unavailable);
    assert.equal(await count(db, 'staff_invitation_redemptions'), 1);
  } finally {
    await db.close();
  }
});

test('current company and creator authority fence both issue and consume decisions', async () => {
  const db = await fixture();
  try {
    await capture(db);
    await assert.rejects(() => issue(db, 300, 200, digest, 11), unavailable);
    await db.query(
      "UPDATE app_private.memberships SET role='agent' WHERE tenant_id=$1 AND user_id=$2",
      [id(1), id(10)],
    );
    await assert.rejects(
      () => issue(db),
      (e) => e.code === '42501',
    );
    await db.query(
      "UPDATE app_private.memberships SET role='admin' WHERE tenant_id=$1 AND user_id=$2",
      [id(1), id(10)],
    );
    await issue(db);
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [id(1), id(10)],
    );
    await assert.rejects(() => redeem(db), unavailable);
    await db.query(
      'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
      [id(1), id(10)],
    );
    await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [id(1)]);
    await assert.rejects(() => redeem(db), unavailable);
    assert.equal(await count(db, 'staff_invitation_redemptions'), 0);
  } finally {
    await db.close();
  }
});

test('a renamed or disabled branch requires a new snapshot before issue or redemption', async () => {
  const db = await fixture();
  try {
    await branch(db);
    await capture(db, 200, 'agent', id(100));
    await branch(db, 1001, 1, 'Renamed branch');
    await assert.rejects(() => issue(db), unavailable);
    await capture(db, 201, 'agent', id(100));
    await issue(db, 301, 201);
    await branch(db, 1002, 2, 'Renamed branch', false);
    await assert.rejects(() => redeem(db, { invitation: 201 }), unavailable);
    assert.equal(await count(db, 'staff_invitation_redemptions'), 0);
  } finally {
    await db.close();
  }
});

test('decision wall time refuses expiry crossed inside a delayed redemption statement', async () => {
  const db = await fixture();
  try {
    // Privileged short-lived historical fixture only. Both immutable rows are
    // created in this statement, then the actual command waits past expiry.
    await db.query(
      "SELECT set_config('realtor.tenant_id',$1,false),set_config('realtor.actor_id',$2,false)",
      [id(1), id(50)],
    );
    await assert.rejects(
      () =>
        scalar(
          db,
          `WITH captured AS (
      INSERT INTO app_private.staff_invitation_requests(tenant_id,operation_id,actor_id,recipient_email,requested_role,expires_after_hours,recorded_at)
      VALUES($1,$2,$3,$4,'agent',24,statement_timestamp()-interval '24 hours'+interval '100 milliseconds') RETURNING tenant_id,operation_id
    ), issued AS (
      INSERT INTO app_private.staff_invitation_issues(tenant_id,operation_id,invitation_id,actor_id,issuer,secret_digest,recorded_at,expires_at)
      SELECT tenant_id,$5,operation_id,$3,$6,$7,statement_timestamp()-interval '1 second',statement_timestamp()+interval '100 milliseconds' FROM captured RETURNING invitation_id
    ), delay AS MATERIALIZED (SELECT invitation_id,pg_sleep(0.2) FROM issued)
    SELECT app_api.redeem_staff_invitation($8,invitation_id,$6,$4,$7) AS result FROM delay`,
          [id(1), id(200), id(10), email, id(300), issuer, digest, id(400)],
        ),
      unavailable,
    );
    assert.equal(await count(db, 'staff_invitation_redemptions'), 0);
    assert.equal(await count(db, 'staff_invitation_issues'), 0);
    assert.equal(
      (
        await db.query('SELECT count(*) AS n FROM app_private.memberships WHERE user_id=$1', [
          id(50),
        ])
      ).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});

test('audit failure rolls back consume, membership and receipt and leaves the same secret usable', async () => {
  const db = await fixture();
  try {
    await capture(db);
    await issue(db);
    await db.exec(`CREATE FUNCTION public.fail_synthetic_redemption_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='staff.invitation_redeemed' THEN RAISE EXCEPTION 'Synthetic audit failure' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_synthetic_redemption_audit BEFORE INSERT ON app_private.audit_events FOR EACH ROW EXECUTE FUNCTION public.fail_synthetic_redemption_audit()`);
    await assert.rejects(
      () => redeem(db),
      (e) => e.code === 'P0001',
    );
    assert.equal(await count(db, 'staff_invitation_redemptions'), 0);
    assert.equal((await state(db)).state, 'issued');
    assert.equal(
      (
        await db.query('SELECT count(*) AS n FROM app_private.memberships WHERE user_id=$1', [
          id(50),
        ])
      ).rows[0].n,
      0,
    );
    await db.exec('DROP TRIGGER fail_synthetic_redemption_audit ON app_private.audit_events');
    assert.equal((await redeem(db)).membershipGranted, true);
  } finally {
    await db.close();
  }
});

test('private rows are immutable and raw storage/helper grants remain absent', async () => {
  const db = await fixture();
  try {
    await capture(db);
    await issue(db);
    await redeem(db);
    for (const table of ['staff_invitation_issues', 'staff_invitation_redemptions']) {
      for (const role of ['api_runtime', 'media_coordinator', 'media_maintenance'])
        assert.equal(
          (
            await db.query('SELECT has_table_privilege($1,$2,$3) AS granted', [
              role,
              'app_private.' + table,
              'SELECT,INSERT,UPDATE,DELETE,TRUNCATE',
            ])
          ).rows[0].granted,
          false,
        );
      await assert.rejects(
        () => db.exec('UPDATE app_private.' + table + ' SET recorded_at=recorded_at'),
        (e) => e.code === '23514',
      );
      await assert.rejects(
        () => db.exec('DELETE FROM app_private.' + table),
        (e) => e.code === '23514',
      );
    }
    assert.equal(
      (
        await db.query(
          "SELECT has_function_privilege('media_coordinator','app_api.redeem_staff_invitation(uuid,uuid,text,text,text)','EXECUTE') AS granted",
        )
      ).rows[0].granted,
      false,
    );
  } finally {
    await db.close();
  }
});

test('expired or revoked captures and malformed issuance reserve no secret or membership', async () => {
  const db = await fixture();
  try {
    await db.query(
      "INSERT INTO app_private.staff_invitation_requests(tenant_id,operation_id,actor_id,recipient_email,requested_role,expires_after_hours,recorded_at) VALUES($1,$2,$3,$4,'agent',24,clock_timestamp()-interval '2 days')",
      [id(1), id(200), id(10), email],
    );
    await assert.rejects(() => issue(db), unavailable);
    await capture(db, 201);
    await cancel(db, 501, 201);
    await assert.rejects(() => issue(db, 301, 201), unavailable);
    await capture(db, 202);
    for (const badDigest of [null, '', digest.toUpperCase(), digest + '0', ' secret '])
      await assert.rejects(
        () => issue(db, 302, 202, badDigest),
        (e) => e.code === '23514',
      );
    assert.equal(await count(db, 'staff_invitation_issues'), 0);
    assert.equal(await count(db, 'staff_invitation_redemptions'), 0);
    assert.equal((await issue(db, 302, 202)).membershipGranted, false);
  } finally {
    await db.close();
  }
});
