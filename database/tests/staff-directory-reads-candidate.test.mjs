import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import { validateStaffInvitationState } from '../../packages/domain/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture() {
  const db = new PGlite();
  await applyTestMigrations(db);
  for (const f of [
    'staff-branches.sql',
    'staff-invitation-requests.sql',
    'staff-directory-reads.sql',
  ])
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
const page = (db, kind, limit = 2, after = null, t = 1, u = 10) =>
  actor(db, t, u, () => scalar(db, `SELECT app_api.${kind}($1,$2) AS result`, [limit, after]));
test('bounded private invitation pages use stable IDs, omit actor, and retain current revoked/expired states', async () => {
  const db = await fixture();
  try {
    for (const n of [205, 201, 203]) await capture(db, n);
    await capture(db, 202, { t: 2, u: 20 });
    const memberships = (
      await db.query('SELECT * FROM app_private.memberships ORDER BY tenant_id,user_id')
    ).rows;
    const audits = (await db.query('SELECT count(*) AS n FROM app_private.audit_events')).rows[0].n;
    let p = await page(db, 'list_staff_invitation_requests');
    assert.deepEqual(await page(db, 'list_staff_invitation_requests', 2, null, 1, 11), p);
    assert.deepEqual(
      (await db.query('SELECT * FROM app_private.memberships ORDER BY tenant_id,user_id')).rows,
      memberships,
    );
    assert.equal(
      (await db.query('SELECT count(*) AS n FROM app_private.audit_events')).rows[0].n,
      audits,
    );
    assert.deepEqual(
      p.items.map((x) => x.operationId),
      [id(201), id(203)],
    );
    assert.equal(p.nextAfter, id(203));
    for (const x of p.items) {
      validateStaffInvitationState(x);
      assert.equal(Object.hasOwn(x, 'actorId'), false);
      assert.equal(x.membershipGranted, false);
    }
    const last = await page(db, 'list_staff_invitation_requests', 2, p.nextAfter);
    assert.deepEqual(
      last.items.map((x) => x.operationId),
      [id(205)],
    );
    assert.equal(last.nextAfter, null);
    assert.deepEqual((await page(db, 'list_staff_invitation_requests', 2, id(999))).items, []);
    assert.deepEqual(
      (await page(db, 'list_staff_invitation_requests', 2, null, 2, 20)).items.map(
        (x) => x.operationId,
      ),
      [id(202)],
    );
    await actor(db, 1, 10, () =>
      scalar(db, 'SELECT app_api.revoke_staff_invitation_request($1,$2,$3,$4) AS result', [
        id(400),
        id(201),
        1,
        'Synthetic revocation.',
      ]),
    );
    assert.equal((await page(db, 'list_staff_invitation_requests')).items[0].state, 'revoked');
    // Privileged synthetic past-time fixture, not an advanced clock or hosted test.
    await db.query(
      `INSERT INTO app_private.staff_invitation_requests(tenant_id,operation_id,actor_id,recipient_email,requested_role,expires_after_hours,recorded_at) VALUES($1,$2,$3,'past@example.invalid','agent',24,statement_timestamp()-interval '48 hours')`,
      [id(1), id(200), id(10)],
    );
    assert.equal((await page(db, 'list_staff_invitation_requests')).items[0].state, 'expired');
  } finally {
    await db.close();
  }
});
test('branch pages expose latest applied metadata once, including inactive branches, without private operation facts', async () => {
  const db = await fixture();
  try {
    for (const n of [102, 100, 101])
      await actor(db, 1, 10, () =>
        scalar(db, 'SELECT app_api.save_staff_branch($1,$2,0,$3,true,$4) AS result', [
          id(500 + n),
          id(n),
          'Synthetic ' + n,
          'Synthetic seed.',
        ]),
      );
    await branch(db, 700, 1, 'Renamed', false);
    const first = await page(db, 'list_staff_branches');
    assert.deepEqual(
      first.items.map((x) => x.branchId),
      [id(100), id(101)],
    );
    assert.equal(first.nextAfter, id(101));
    assert.equal(first.items[0].name, 'Renamed');
    assert.equal(first.items[0].active, false);
    assert.equal(first.items[0].version, '2');
    assert.deepEqual(Object.keys(first.items[0]).sort(), [
      'active',
      'branchId',
      'name',
      'policy',
      'recordedAt',
      'version',
    ]);
    const last = await page(db, 'list_staff_branches', 2, first.nextAfter);
    assert.deepEqual(
      last.items.map((x) => x.branchId),
      [id(102)],
    );
    assert.equal(last.nextAfter, null);
    assert.deepEqual((await page(db, 'list_staff_branches', 2, null, 2, 20)).items, []);
  } finally {
    await db.close();
  }
});
test('directory pages recheck current role/company and reject unbounded reads without raw table grants', async () => {
  const db = await fixture();
  try {
    for (const kind of ['list_staff_branches', 'list_staff_invitation_requests']) {
      for (const limit of [null, 0, -1, 21, 2147483647])
        await assert.rejects(
          () => page(db, kind, limit),
          (e) => e.code === '23514',
        );
      for (const [t, u] of [
        [1, 12],
        [1, 13],
        [1, null],
        [2, 10],
      ])
        await assert.rejects(
          () => page(db, kind, 2, null, t, u),
          (e) => e.code === '42501',
        );
      await db.query(
        "UPDATE app_private.memberships SET role='agent' WHERE tenant_id=$1 AND user_id=$2",
        [id(1), id(10)],
      );
      await assert.rejects(
        () => page(db, kind),
        (e) => e.code === '42501',
      );
      await db.query(
        "UPDATE app_private.memberships SET role='admin' WHERE tenant_id=$1 AND user_id=$2",
        [id(1), id(10)],
      );
      for (const role of ['media_coordinator', 'media_maintenance'])
        assert.equal(
          (
            await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed", [
              role,
              `app_api.${kind}(integer,uuid)`,
            ])
          ).rows[0].allowed,
          false,
        );
    }
    await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [id(1)]);
    await assert.rejects(
      () => page(db, 'list_staff_branches'),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      () => page(db, 'list_staff_invitation_requests'),
      (e) => e.code === '42501',
    );
  } finally {
    await db.close();
  }
});
