import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { validateStaffBranchRecord } from '../../packages/domain/dist/index.js';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture() {
  const db = new PGlite();
  await applyTestMigrations(db);
  await db.exec(
    await readFile(new URL('../proposals/staff-branches.sql', import.meta.url), 'utf8'),
  );
  await db.query(
    "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'branch-a','Synthetic A'),($2,'branch-b','Synthetic B')",
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
const save = async (db, op, expected, name = 'Synthetic branch', active = true, t = 1, u = 10) => {
  const value = await actor(db, t, u, () =>
    scalar(db, 'SELECT app_api.save_staff_branch($1,$2,$3,$4,$5,$6) AS result', [
      id(op),
      id(100),
      expected,
      name,
      active,
      'Synthetic branch change.',
    ]),
  );
  return validateStaffBranchRecord(
    value,
    {
      policy: 'staff-branch-command-v1',
      operationId: id(op),
      branchId: id(100),
      expectedVersion: String(expected),
      name,
      active,
      reason: 'Synthetic branch change.',
    },
    id(u),
  );
};
const original = (db, op, t = 1, u = 10) =>
  actor(db, t, u, () =>
    scalar(db, 'SELECT app_api.read_staff_branch_operation($1) AS result', [id(op)]),
  );
test('isolated branch writes retain original, terminal conflict and no-op without changing memberships', async () => {
  const db = await fixture();
  try {
    const memberships = (
      await db.query('SELECT * FROM app_private.memberships ORDER BY tenant_id,user_id')
    ).rows;
    const first = await save(db, 200, 0);
    assert.equal(first.version, '1');
    assert.equal(first.outcome, 'applied');
    assert.deepEqual(await save(db, 200, 0), first);
    const future = await save(db, 201, 2);
    assert.equal(future.outcome, 'conflict');
    assert.equal(future.version, '1');
    assert.equal((await save(db, 202, 1, 'Renamed synthetic')).version, '2');
    assert.deepEqual(await save(db, 201, 2), future);
    const noop = await save(db, 203, 2, 'Renamed synthetic');
    assert.equal(noop.outcome, 'unchanged');
    assert.equal(noop.version, '2');
    assert.equal((await save(db, 204, 2, 'Renamed synthetic', false)).version, '3');
    assert.deepEqual(await original(db, 200), first);
    assert.deepEqual(
      (await db.query('SELECT * FROM app_private.memberships ORDER BY tenant_id,user_id')).rows,
      memberships,
    );
    assert.equal(
      Number((await db.query('SELECT count(*) AS n FROM app_private.audit_events')).rows[0].n),
      3,
    );
  } finally {
    await db.close();
  }
});
test('current role, company and requester fence branch operations and immutable storage denies direct writes', async () => {
  const db = await fixture();
  try {
    await save(db, 200, 0);
    for (const [t, u] of [
      [1, null],
      [1, 12],
      [1, 13],
      [2, 10],
    ])
      await assert.rejects(
        () => save(db, 210, 0, 'Synthetic', true, t, u),
        (e) => e.code === '42501',
      );
    await assert.rejects(
      () => original(db, 200, 2, 20),
      (e) => e.code === 'P0002',
    );
    await assert.rejects(
      () => original(db, 200, 1, 11),
      (e) => e.code === 'P0002',
    );
    await assert.rejects(
      () => save(db, 200, 0, 'Changed'),
      (e) => e.code === '23505',
    );
    await assert.rejects(
      () => actor(db, 1, 10, () => db.query('SELECT * FROM app_private.staff_branch_operations')),
      (e) => e.code === '42501',
    );
    for (const role of ['api_runtime', 'media_coordinator', 'media_maintenance']) {
      const privileges = (
        await db.query(
          "SELECT has_table_privilege($1,'app_private.staff_branch_operations','SELECT') AS read,has_table_privilege($1,'app_private.staff_branch_operations','INSERT,UPDATE,DELETE,TRUNCATE') AS write",
          [role],
        )
      ).rows[0];
      assert.deepEqual(privileges, { read: false, write: false });
    }
    await assert.rejects(
      async () => {
        await db.exec('BEGIN;SET LOCAL ROLE realtor_owner');
        try {
          await db.exec('UPDATE app_private.staff_branch_operations SET reason=reason');
        } finally {
          await db.exec('ROLLBACK');
        }
      },
      (e) => e.code === '23514',
    );
    await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [id(1)]);
    await assert.rejects(
      () => original(db, 200),
      (e) => e.code === '42501',
    );
    await db.query('UPDATE app_private.tenants SET enabled=true WHERE id=$1', [id(1)]);
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [id(1), id(10)],
    );
    await assert.rejects(
      () => original(db, 200),
      (e) => e.code === '42501',
    );
  } finally {
    await db.close();
  }
});
test('malformed branch facts reserve no operation and current projection contains no review reason or actor', async () => {
  const db = await fixture();
  try {
    for (const name of ['', ' padded', '<b>', 'e\u0301', 'x\u202ey', 'x'.repeat(161)])
      await assert.rejects(
        () => save(db, 200, 0, name),
        (e) => e.code === '23514',
      );
    assert.equal(
      Number(
        (await db.query('SELECT count(*) AS n FROM app_private.staff_branch_operations')).rows[0].n,
      ),
      0,
    );
    await save(db, 200, 0);
    const current = await actor(db, 1, 10, () =>
      scalar(db, 'SELECT app_api.read_staff_branch($1) AS result', [id(100)]),
    );
    assert.equal(current.version, '1');
    assert.equal(current.policy, 'staff-branch-current-v1');
    for (const key of ['reason', 'actorId', 'operationId', 'expectedVersion', 'outcome'])
      assert.equal(Object.hasOwn(current, key), false);
    await assert.rejects(
      () =>
        actor(db, 2, 20, () =>
          scalar(db, 'SELECT app_api.read_staff_branch($1) AS result', [id(100)]),
        ),
      (e) => e.code === 'P0002',
    );
  } finally {
    await db.close();
  }
});
