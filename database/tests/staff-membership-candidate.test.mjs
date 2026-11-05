import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import {
  validateStaffMembershipCommand,
  validateStaffMembershipRecord,
  validateStaffMembershipCurrent,
  validateStaffMembershipPage,
} from '../../packages/domain/dist/index.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const originals = new WeakMap();
async function fixture() {
  const db = new PGlite();
  await applyTestMigrations(db);
  await db.exec(
    await readFile(new URL('../proposals/staff-membership-changes.sql', import.meta.url), 'utf8'),
  );
  await db.query(
    "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'members-a','Synthetic A'),($2,'members-b','Synthetic B')",
    [id(1), id(2)],
  );
  for (const [t, u, role] of [
    [1, 10, 'admin'],
    [1, 11, 'admin'],
    [1, 12, 'agent'],
    [1, 13, 'customer'],
    [2, 20, 'admin'],
    [2, 21, 'agent'],
  ])
    await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
      id(t),
      id(u),
      role,
    ]);
  originals.set(db, new Map());
  return db;
}
async function actor(db, tenant, user, action) {
  await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
  try {
    await db.query(
      "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),set_config('realtor.correlation_id','synthetic-membership-audit',true)",
      [id(tenant), user === null ? '' : id(user)],
    );
    const result = await action();
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
const scalar = async (db, sql, args = []) => (await db.query(sql, args)).rows[0].result;
const save = async (
  db,
  op,
  member,
  expected,
  role = 'agent',
  active = true,
  tenant = 1,
  user = 10,
  reason = 'Synthetic staff administration.',
) => {
  const value = await actor(db, tenant, user, () =>
    scalar(db, 'SELECT app_api.save_staff_membership($1,$2,$3,$4,$5,$6) AS result', [
      id(op),
      id(member),
      expected,
      role,
      active,
      reason,
    ]),
  );
  const command = validateStaffMembershipCommand({
    policy: 'staff-membership-command-v1',
    operationId: id(op),
    memberId: id(member),
    expectedVersion: String(expected),
    requestedRole: role,
    active,
    reason,
  });
  const record = validateStaffMembershipRecord(value, command, id(user));
  originals.get(db).set(`${tenant}:${op}`, command);
  return record;
};
const original = async (db, op, tenant = 1, user = 10) => {
  const value = await actor(db, tenant, user, () =>
    scalar(db, 'SELECT app_api.read_staff_membership_operation($1) AS result', [id(op)]),
  );
  const command = originals.get(db).get(`${tenant}:${op}`);
  assert.ok(command, 'Original read must bind a known submitted command.');
  return validateStaffMembershipRecord(value, command, id(user));
};
const current = async (db, member, tenant = 1, user = 10) => {
  const value = await actor(db, tenant, user, () =>
    scalar(db, 'SELECT app_api.read_staff_membership($1) AS result', [id(member)]),
  );
  return validateStaffMembershipCurrent(value, id(member));
};
const code = (expected) => (error) => error.code === expected;
const page = async (db, query, tenant = 1, user = 10) => {
  const value = await actor(db, tenant, user, () =>
    scalar(db, 'SELECT app_api.list_staff_memberships($1,$2) AS result', [
      query.limit,
      query.after,
    ]),
  );
  return validateStaffMembershipPage(value, query);
};

test('active legacy membership projections omit historical revocation without mutating it', async () => {
  const db = await fixture();
  try {
    await db.query(
      "UPDATE app_private.memberships SET revoked_at='2026-01-02T03:04:05.006Z' WHERE tenant_id=$1 AND user_id=$2",
      [id(1), id(12)],
    );
    const historical = () =>
      db.query('SELECT revoked_at FROM app_private.memberships WHERE tenant_id=$1 AND user_id=$2', [
        id(1),
        id(12),
      ]);
    const before = (await historical()).rows[0];
    assert.equal((await current(db, 12)).revokedAt, null);
    const noop = await save(
      db,
      200,
      12,
      1,
      'agent',
      true,
      1,
      10,
      'NFC café with internal\u00a0space.',
    );
    assert.equal(noop.outcome, 'unchanged');
    assert.deepEqual((await historical()).rows[0], before);
    assert.equal((await current(db, 12)).version, '1');
    assert.equal(
      Number((await db.query('SELECT count(*) AS n FROM app_private.audit_events')).rows[0].n),
      0,
    );
  } finally {
    await db.close();
  }
});

test('existing staff changes retain exact originals, terminal version conflicts and no-ops with applied-only audits', async () => {
  const db = await fixture();
  try {
    assert.deepEqual(await current(db, 12), {
      policy: 'staff-membership-current-v1',
      memberId: id(12),
      role: 'agent',
      active: true,
      version: '1',
      revokedAt: null,
    });
    const first = await save(db, 200, 12, 1, 'admin');
    assert.deepEqual(
      Object.keys(first).sort(),
      [
        'policy',
        'operationId',
        'memberId',
        'actorId',
        'expectedVersion',
        'version',
        'outcome',
        'requestedRole',
        'active',
        'reason',
        'recordedAt',
      ].sort(),
    );
    assert.equal(first.policy, 'staff-membership-record-v1');
    assert.equal(first.actorId, id(10));
    assert.equal(first.memberId, id(12));
    assert.equal(first.expectedVersion, '1');
    assert.equal(first.version, '2');
    assert.equal(first.outcome, 'applied');
    assert.match(first.recordedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.deepEqual(await save(db, 200, 12, 1, 'admin'), first);
    const conflict = await save(db, 201, 12, 1, 'agent');
    assert.equal(conflict.outcome, 'conflict');
    assert.equal(conflict.version, '2');
    const noop = await save(db, 202, 12, 2, 'admin');
    assert.equal(noop.outcome, 'unchanged');
    assert.equal(noop.version, '2');
    const revoked = await save(db, 203, 12, 2, 'admin', false);
    assert.equal(revoked.version, '3');
    const inactive = await current(db, 12);
    assert.equal(inactive.active, false);
    assert.ok(inactive.revokedAt);
    assert.deepEqual(await save(db, 201, 12, 1, 'agent'), conflict);
    const restored = await save(db, 204, 12, 3, 'agent');
    assert.equal(restored.version, '4');
    assert.deepEqual(await original(db, 200), first);
    assert.equal((await current(db, 12)).revokedAt, null);
    await assert.rejects(() => save(db, 200, 12, 1, 'agent'), code('23505'));
    assert.equal(
      Number((await db.query('SELECT count(*) AS n FROM app_private.audit_events')).rows[0].n),
      3,
    );
    assert.equal(
      Number((await db.query('SELECT count(*) AS n FROM app_private.memberships')).rows[0].n),
      6,
    );
    const audit = await db.query(
      'SELECT tenant_id,actor_id,action,object_type,object_id,object_version::text,correlation_id,summary FROM app_private.audit_events ORDER BY id',
    );
    assert.deepEqual(
      audit.rows,
      [
        [200, '2', 'admin', true],
        [203, '3', 'admin', false],
        [204, '4', 'agent', true],
      ].map(([operation, version, role, active]) => ({
        tenant_id: id(1),
        actor_id: id(10),
        action: 'staff.membership_saved',
        object_type: 'staff_membership',
        object_id: id(12),
        object_version: version,
        correlation_id: 'synthetic-membership-audit',
        summary: { operationId: id(operation), role, active },
      })),
    );
  } finally {
    await db.close();
  }
});
test('self changes are refused and serialized peer demotion/revocation always retains an active admin', async () => {
  const db = await fixture();
  try {
    await db.query(
      "INSERT INTO app_private.listings(tenant_id,id,slug,created_by_id,assigned_agent_id) VALUES($1,$2,'synthetic-owned',$3,$3)",
      [id(1), id(100), id(11)],
    );
    await db.query(
      "INSERT INTO app_private.enquiries(tenant_id,id,idempotency_key,assigned_agent_id,contact_name,phone_e164,message,origin,notice_version,status) VALUES($1,$2,$2,$3,'Synthetic Contact','+254700000001','Synthetic private enquiry.','web','synthetic-v1','assigned')",
      [id(1), id(101), id(11)],
    );
    const stock = () =>
      actor(db, 1, 11, () =>
        scalar(db, 'SELECT app_api.read_listing_import_stock($1::text[]) AS result', [
          ['synthetic-owned'],
        ]),
      );
    const activity = () =>
      actor(db, 1, 11, () =>
        scalar(db, 'SELECT app_api.list_enquiry_activity($1,$2) AS result', [id(101), 10]),
      );
    assert.deepEqual(await stock(), ['synthetic-owned']);
    assert.equal((await activity()).items.length, 1);
    for (const [role, active] of [
      ['admin', true],
      ['admin', false],
      ['agent', true],
      ['agent', false],
    ])
      await assert.rejects(() => save(db, 200, 10, 1, role, active), code('42501'));
    await save(db, 201, 11, 1, 'agent');
    assert.equal((await current(db, 11)).role, 'agent');
    await assert.rejects(stock, code('P0002'));
    assert.equal((await activity()).items.length, 1);
    await assert.rejects(() => save(db, 202, 10, 1, 'agent', true, 1, 11), code('42501'));
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) AS n FROM app_private.memberships WHERE tenant_id=$1 AND active AND role='admin'",
            [id(1)],
          )
        ).rows[0].n,
      ),
      1,
    );
    await save(db, 203, 11, 2, 'admin');
    await save(db, 204, 11, 3, 'admin', false);
    await assert.rejects(() => save(db, 205, 10, 1, 'admin', false, 1, 11), code('42501'));
    await assert.rejects(stock, code('P0002'));
    await assert.rejects(activity, code('42501'));
    assert.equal(
      await actor(db, 1, 11, () => scalar(db, 'SELECT app_private.staff_role() AS result')),
      null,
    );
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) AS n FROM app_private.memberships WHERE tenant_id=$1 AND active AND role='admin'",
            [id(1)],
          )
        ).rows[0].n,
      ),
      1,
    );
    await assert.rejects(() => save(db, 206, 10, 1, 'agent'), code('42501'));
    assert.equal(
      Number(
        (await db.query('SELECT count(*) AS n FROM app_private.staff_membership_operations'))
          .rows[0].n,
      ),
      3,
    );
  } finally {
    await db.close();
  }
});
test('current admin/company and original actor fence reads/writes; no new/customer/foreign membership is modified', async () => {
  const db = await fixture();
  try {
    await assert.rejects(() => save(db, 199, 11, 1, 'agent', true, 1, 12), code('42501'));
    await assert.rejects(() => current(db, 11, 1, 12), code('42501'));
    await save(db, 200, 12, 1, 'admin');
    for (const [tenant, user] of [
      [1, null],
      [1, 13],
      [2, 10],
    ]) {
      await assert.rejects(() => save(db, 210, 11, 1, 'agent', true, tenant, user), code('42501'));
      await assert.rejects(() => current(db, 11, tenant, user), code('42501'));
    }
    for (const member of [13, 20, 999]) {
      await assert.rejects(() => save(db, 211, member, 1, 'admin'), code('P0002'));
      await assert.rejects(() => current(db, member), code('P0002'));
    }
    await assert.rejects(() => original(db, 200, 1, 11), code('P0002'));
    await assert.rejects(() => save(db, 200, 12, 1, 'admin', true, 1, 11), code('42501'));
    await assert.rejects(() => original(db, 200, 2, 20), code('P0002'));
    await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [id(1)]);
    await assert.rejects(() => original(db, 200), code('42501'));
    await assert.rejects(() => save(db, 212, 11, 1), code('42501'));
    await db.query('UPDATE app_private.tenants SET enabled=true WHERE id=$1', [id(1)]);
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [id(1), id(10)],
    );
    await assert.rejects(() => original(db, 200), code('42501'));
    await assert.rejects(() => current(db, 12), code('42501'));
    const untouched = (
      await db.query(
        'SELECT role,admin_version::text AS version FROM app_private.memberships WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(13)],
      )
    ).rows[0];
    assert.deepEqual(untouched, { role: 'customer', version: '1' });
  } finally {
    await db.close();
  }
});
test('malformed commands reserve nothing and restricted roles cannot read, mutate or execute private storage functions', async () => {
  const db = await fixture();
  try {
    for (const reason of [
      '',
      ' padded',
      '<b>',
      'e\u0301',
      'x\u202ey',
      'x\nline',
      'x\u0080y',
      '\u00a0padded',
      'padded\ufeff',
      '\u1680padded',
      'x'.repeat(501),
    ]) {
      assert.throws(() =>
        validateStaffMembershipCommand({
          policy: 'staff-membership-command-v1',
          operationId: id(200),
          memberId: id(12),
          expectedVersion: '1',
          requestedRole: 'admin',
          active: true,
          reason,
        }),
      );
      await assert.rejects(() => save(db, 200, 12, 1, 'admin', true, 1, 10, reason), code('23514'));
    }
    for (const expected of [0, -1, '9007199254740991'])
      await assert.rejects(() => save(db, 200, 12, expected), code('23514'));
    for (const role of ['customer', 'owner', 'Admin', ''])
      await assert.rejects(() => save(db, 200, 12, 1, role), code('23514'));
    for (const args of [
      [null, id(12), 1, 'agent', true, 'Synthetic.'],
      [id(200), null, 1, 'agent', true, 'Synthetic.'],
      [id(200), id(12), null, 'agent', true, 'Synthetic.'],
      [id(200), id(12), 1, null, true, 'Synthetic.'],
      [id(200), id(12), 1, 'agent', null, 'Synthetic.'],
      [id(200), id(12), 1, 'agent', true, null],
    ])
      await assert.rejects(
        () =>
          actor(db, 1, 10, () =>
            scalar(db, 'SELECT app_api.save_staff_membership($1,$2,$3,$4,$5,$6) AS result', args),
          ),
        code('23514'),
      );
    assert.equal(
      Number(
        (await db.query('SELECT count(*) AS n FROM app_private.staff_membership_operations'))
          .rows[0].n,
      ),
      0,
    );
    for (const role of ['api_runtime', 'media_coordinator', 'media_maintenance']) {
      const privileges = (
        await db.query(
          "SELECT has_table_privilege($1,'app_private.staff_membership_operations','SELECT') AS read,has_table_privilege($1,'app_private.staff_membership_operations','INSERT,UPDATE,DELETE,TRUNCATE') AS write,has_function_privilege($1,'app_private.staff_membership_record_json(app_private.staff_membership_operations)','EXECUTE') AS private_execute",
          [role],
        )
      ).rows[0];
      assert.deepEqual(privileges, { read: false, write: false, private_execute: false });
    }
    await assert.rejects(
      () =>
        actor(db, 1, 10, () => db.query('SELECT * FROM app_private.staff_membership_operations')),
      code('42501'),
    );
    await assert.rejects(
      () =>
        actor(db, 1, 10, () =>
          db.query(
            "UPDATE app_private.memberships SET role='admin' WHERE tenant_id=$1 AND user_id=$2",
            [id(1), id(12)],
          ),
        ),
      code('42501'),
    );
    await save(db, 201, 12, 1, 'admin');
    for (const sql of [
      'UPDATE app_private.staff_membership_operations SET reason=reason',
      'DELETE FROM app_private.staff_membership_operations',
    ])
      await assert.rejects(async () => {
        await db.exec('BEGIN;SET LOCAL ROLE realtor_owner');
        try {
          await db.exec(sql);
        } finally {
          await db.exec('ROLLBACK');
        }
      }, code('23514'));
  } finally {
    await db.close();
  }
});

test('private membership pages traverse bounded stable IDs including inactive staff without customer/foreign/private-operation data or mutations', async () => {
  const db = await fixture();
  try {
    await db.query(
      "INSERT INTO app_private.memberships(tenant_id,user_id,role,active,revoked_at) VALUES($1,$2,'agent',false,'2026-01-02T03:04:05.006Z'),($1,$3,'customer',true,NULL),($1,$4,'agent',true,NULL)",
      [id(1), id(14), id(15), id(16)],
    );
    await db.query(
      "UPDATE app_private.memberships SET revoked_at='2026-02-03T04:05:06.007Z' WHERE tenant_id=$1 AND user_id=$2",
      [id(1), id(11)],
    );
    await save(db, 300, 12, 1, 'agent', false);
    const before = (
      await db.query('SELECT * FROM app_private.memberships ORDER BY tenant_id,user_id')
    ).rows;
    const beforeAudit = (await db.query('SELECT * FROM app_private.audit_events ORDER BY id')).rows;
    const beforeOperations = (
      await db.query(
        'SELECT * FROM app_private.staff_membership_operations ORDER BY tenant_id,operation_id',
      )
    ).rows;
    const first = await page(db, { limit: 2, after: null });
    assert.deepEqual(
      first.items.map((m) => m.memberId),
      [id(10), id(11)],
    );
    assert.equal(first.nextAfter, id(11));
    assert.equal(first.items[1].revokedAt, null);
    const second = await page(db, { limit: 2, after: first.nextAfter });
    assert.deepEqual(
      second.items.map((m) => m.memberId),
      [id(12), id(14)],
    );
    assert.equal(second.nextAfter, id(14));
    assert.equal(second.items[0].active, false);
    assert.equal(second.items[0].version, '2');
    assert.equal(second.items[1].revokedAt, '2026-01-02T03:04:05.006Z');
    const third = await page(db, { limit: 2, after: second.nextAfter });
    assert.deepEqual(
      third.items.map((m) => m.memberId),
      [id(16)],
    );
    assert.equal(third.nextAfter, null);
    const ids = [...first.items, ...second.items, ...third.items].map((m) => m.memberId);
    assert.equal(new Set(ids).size, 5);
    const all = await page(db, { limit: 5, after: null });
    assert.deepEqual(
      all.items.map((m) => m.memberId),
      ids,
    );
    assert.equal(all.nextAfter, null, 'Exactly full final page must not invent a continuation.');
    assert.deepEqual((await page(db, { limit: 20, after: null })).items, all.items);
    assert.deepEqual(await page(db, { limit: 2, after: id(16) }), {
      policy: 'staff-membership-page-v1',
      items: [],
      nextAfter: null,
    });
    assert.deepEqual(
      (await page(db, { limit: 2, after: id(13) })).items.map((m) => m.memberId),
      [id(14), id(16)],
    );
    for (const member of all.items)
      assert.deepEqual(member, await current(db, Number(member.memberId.slice(-12))));
    const foreign = await page(db, { limit: 20, after: null }, 2, 20);
    assert.deepEqual(
      foreign.items.map((m) => m.memberId),
      [id(20), id(21)],
    );
    assert.deepEqual(
      (await db.query('SELECT * FROM app_private.memberships ORDER BY tenant_id,user_id')).rows,
      before,
    );
    assert.deepEqual(
      (await db.query('SELECT * FROM app_private.audit_events ORDER BY id')).rows,
      beforeAudit,
    );
    assert.deepEqual(
      (
        await db.query(
          'SELECT * FROM app_private.staff_membership_operations ORDER BY tenant_id,operation_id',
        )
      ).rows,
      beforeOperations,
    );
  } finally {
    await db.close();
  }
});

test('membership page bounds, current admin/company and restricted function grants are enforced on every read', async () => {
  const db = await fixture();
  try {
    for (const limit of [null, 0, -1, 21, 2147483647])
      await assert.rejects(() => page(db, { limit, after: null }), code('23514'));
    await assert.rejects(
      () =>
        actor(db, 1, 10, () =>
          scalar(db, 'SELECT app_api.list_staff_memberships($1,$2) AS result', [2, 'not-a-uuid']),
        ),
      code('22P02'),
    );
    const one = await page(db, { limit: 1, after: null });
    assert.deepEqual(
      one.items.map((m) => m.memberId),
      [id(10)],
    );
    assert.equal(one.nextAfter, id(10));
    for (const [tenant, user] of [
      [1, null],
      [1, 12],
      [1, 13],
      [1, 20],
      [2, 10],
    ])
      await assert.rejects(() => page(db, { limit: 2, after: null }, tenant, user), code('42501'));
    for (const role of ['api_runtime', 'media_coordinator', 'media_maintenance']) {
      const grants = (
        await db.query(
          "SELECT has_function_privilege($1,'app_api.list_staff_memberships(integer,uuid)','EXECUTE') AS list,has_function_privilege($1,'app_private.staff_membership_current_json(app_private.memberships)','EXECUTE') AS helper",
          [role],
        )
      ).rows[0];
      assert.deepEqual(grants, { list: role === 'api_runtime', helper: false });
    }
    const publicGrants = (
      await db.query(
        "SELECT count(*)::int AS n FROM pg_proc p,aclexplode(p.proacl) a WHERE p.oid='app_api.list_staff_memberships(integer,uuid)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'",
      )
    ).rows[0].n;
    assert.equal(publicGrants, 0);
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [id(1), id(10)],
    );
    await assert.rejects(() => page(db, { limit: 2, after: null }), code('42501'));
    const peer = await page(db, { limit: 2, after: null }, 1, 11);
    assert.equal(peer.items[0].memberId, id(10));
    assert.equal(peer.items[0].active, false);
    await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [id(1)]);
    await assert.rejects(() => page(db, { limit: 2, after: null }, 1, 11), code('42501'));
    assert.equal(
      Number((await db.query('SELECT count(*) AS n FROM app_private.audit_events')).rows[0].n),
      0,
    );
  } finally {
    await db.close();
  }
});
