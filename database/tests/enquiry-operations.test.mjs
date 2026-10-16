import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1),
  OTHER = id(2),
  ADMIN = id(10),
  AGENT = id(11),
  PEER = id(12),
  CUSTOMER = id(13),
  INACTIVE = id(14),
  ADMIN2 = id(15),
  OTHERADMIN = id(20);
const E = id(100),
  SECOND = id(101),
  FOREIGN = id(200),
  DATE = '2026-01-02T03:04:05.006Z',
  LATER = '2026-01-03T04:05:06.007Z';
async function fixture() {
  const db = new PGlite();
  try {
    await applyTestMigrations(db);
    await db.query(
      `INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'enquiry-test','Synthetic Enquiry'),($2,'foreign-test','Synthetic Other')`,
      [T, OTHER],
    );
    for (const [tenant, user, role, active] of [
      [T, ADMIN, 'admin', true],
      [T, AGENT, 'agent', true],
      [T, PEER, 'agent', true],
      [T, CUSTOMER, 'customer', true],
      [T, INACTIVE, 'agent', false],
      [T, ADMIN2, 'admin', true],
      [OTHER, OTHERADMIN, 'admin', true],
    ])
      await db.query(
        'INSERT INTO app_private.memberships(tenant_id,user_id,role,active,revoked_at) VALUES($1,$2,$3,$4,CASE WHEN $4 THEN NULL ELSE now() END)',
        [tenant, user, role, active],
      );
    await seed(db);
    await seed(db, { enquiry: SECOND });
    await seed(db, { tenant: OTHER, enquiry: FOREIGN });
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
async function seed(
  db,
  {
    tenant = T,
    enquiry = E,
    assigned = null,
    status = 'new',
    next = null,
    reason = null,
    listing = null,
    revision = null,
  } = {},
) {
  await db.query(
    `INSERT INTO app_private.enquiries(tenant_id,id,idempotency_key,listing_id,contacted_revision_no,assigned_agent_id,
    contact_name,phone_e164,email,message,origin,notice_version,status,next_action_at,closure_reason)
    VALUES($1,$2,$2,$3,$4,$5,'Synthetic Contact','+254700000001',NULL,'Synthetic private enquiry text only','web','synthetic-v1',$6,$7,$8)`,
    [tenant, enquiry, listing, revision, assigned, status, next, reason],
  );
}
async function actor(db, user, callback, tenant = T) {
  await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');
  await db.query(
    `SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),set_config('realtor.correlation_id','synthetic-enquiry-operations',true)`,
    [tenant ?? '', user ?? ''],
  );
  try {
    const value = await callback();
    await db.exec('COMMIT');
    return value;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
async function scalar(db, sql, args = []) {
  return Object.values((await db.query(sql, args)).rows[0])[0];
}
function command(
  db,
  {
    user = ADMIN,
    enquiry = E,
    operation = id(1000),
    expected = '1',
    kind = 'assign',
    assigned = AGENT,
    status = null,
    next = null,
    reason = null,
    tenant = T,
  } = {},
) {
  return actor(
    db,
    user,
    () =>
      scalar(db, 'SELECT app_api.execute_enquiry_operation($1,$2,$3,$4,$5,$6,$7,$8)', [
        enquiry,
        operation,
        expected,
        kind,
        assigned,
        status,
        next,
        reason,
      ]),
    tenant,
  );
}
function transition(db, values) {
  return command(db, { kind: 'transition', assigned: null, ...values });
}
function reschedule(db, values) {
  return command(db, { kind: 'reschedule', assigned: null, ...values });
}
function history(db, user = ADMIN, enquiry = E, operation = id(1000), tenant = T) {
  return actor(
    db,
    user,
    () => scalar(db, 'SELECT app_api.read_enquiry_operation($1,$2)', [enquiry, operation]),
    tenant,
  );
}
const denied = (fn, code) => assert.rejects(fn, (error) => error.code === code);
async function totals(db) {
  return (
    await db.query(
      `SELECT (SELECT count(*)::int FROM app_private.enquiry_operations) operations,
  (SELECT count(*)::int FROM app_private.audit_events WHERE object_type='enquiry') audits,
  (SELECT version::text FROM app_private.enquiries WHERE tenant_id=$1 AND id=$2) version`,
      [T, E],
    )
  ).rows[0];
}

test('assignment has an exact narrow receipt and same assignment is a nonmutating noop', async () => {
  const db = await fixture();
  try {
    const receipt = await command(db);
    assert.deepEqual(Object.keys(receipt).sort(), [
      'completedAt',
      'enquiryId',
      'expectedVersion',
      'kind',
      'operationId',
      'outcome',
      'reason',
      'request',
      'result',
    ]);
    assert.deepEqual(receipt.request, {
      assignedAgentId: AGENT,
      status: null,
      nextActionAt: null,
      reason: null,
    });
    assert.deepEqual(receipt.result, {
      version: '2',
      status: 'assigned',
      assignedAgentId: AGENT,
      nextActionAt: null,
      closureReason: null,
    });
    assert.equal(receipt.outcome, 'applied');
    assert.equal(receipt.reason, null);
    assert.match(receipt.completedAt, /^202\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    const before = await totals(db),
      rowBefore = await scalar(db, 'SELECT to_jsonb(e) FROM app_private.enquiries e WHERE id=$1', [
        E,
      ]);
    const noop = await command(db, { operation: id(1001), expected: '2' });
    assert.equal(noop.outcome, 'noop');
    assert.equal(noop.result.version, '2');
    assert.deepEqual(
      await scalar(db, 'SELECT to_jsonb(e) FROM app_private.enquiries e WHERE id=$1', [E]),
      rowBefore,
    );
    assert.deepEqual(await totals(db), { ...before, operations: before.operations + 1 });
    const audits = await scalar(
      db,
      `SELECT jsonb_agg(summary) FROM app_private.audit_events WHERE object_type='enquiry'`,
    );
    assert.ok(!JSON.stringify(audits).includes('Synthetic'));
    assert.ok(!JSON.stringify(audits).includes('reason'));
  } finally {
    await db.close();
  }
});
test('contact, dated reschedule, qualification, closing and reopening use persisted lifecycle', async () => {
  const db = await fixture();
  try {
    await command(db);
    const contacted = await transition(db, {
      user: AGENT,
      operation: id(1001),
      expected: '2',
      status: 'contacted',
      next: DATE,
    });
    assert.deepEqual(contacted.result, {
      version: '3',
      status: 'contacted',
      assignedAgentId: AGENT,
      nextActionAt: DATE,
      closureReason: null,
    });
    const moved = await reschedule(db, {
      user: AGENT,
      operation: id(1002),
      expected: '3',
      next: LATER,
    });
    assert.equal(moved.result.version, '4');
    const before = await totals(db);
    const noop = await reschedule(db, {
      user: AGENT,
      operation: id(1003),
      expected: '4',
      next: LATER,
    });
    assert.equal(noop.outcome, 'noop');
    assert.equal(noop.result.status, 'contacted');
    assert.deepEqual(await totals(db), { ...before, operations: before.operations + 1 });
    await transition(db, {
      user: AGENT,
      operation: id(1004),
      expected: '4',
      status: 'qualified',
      next: LATER,
    });
    const won = await transition(db, {
      user: AGENT,
      operation: id(1005),
      expected: '5',
      status: 'closed_won',
    });
    assert.equal(won.result.version, '6');
    assert.equal(won.result.nextActionAt, null);
    const reopened = await transition(db, {
      user: AGENT,
      operation: id(1006),
      expected: '6',
      status: 'assigned',
      reason: 'Synthetic reopen reason',
    });
    assert.equal(reopened.result.status, 'assigned');
    assert.equal(reopened.result.closureReason, 'Synthetic reopen reason');
    const lost = await transition(db, {
      user: AGENT,
      operation: id(1007),
      expected: '7',
      status: 'closed_lost',
      reason: 'Synthetic loss reason',
    });
    assert.equal(lost.result.version, '8');
    await transition(db, {
      user: AGENT,
      operation: id(1008),
      expected: '8',
      status: 'assigned',
      reason: 'Synthetic reconsideration',
    });
    assert.deepEqual(await history(db, AGENT, E, id(1001)), contacted);
    await transition(db, {
      enquiry: SECOND,
      operation: id(1010),
      status: 'spam',
      reason: 'Synthetic duplicate',
    });
    const unassigned = await transition(db, {
      enquiry: SECOND,
      operation: id(1011),
      expected: '2',
      status: 'new',
      reason: 'Synthetic reopen',
    });
    assert.equal(unassigned.result.status, 'new');
    assert.equal(unassigned.result.assignedAgentId, null);
  } finally {
    await db.close();
  }
});
test('exact original replay and read recover history after later writes without mutation', async () => {
  const db = await fixture();
  try {
    const original = await command(db);
    await transition(db, {
      user: AGENT,
      operation: id(1001),
      expected: '2',
      status: 'contacted',
      next: DATE,
    });
    await command(db, { operation: id(1002), expected: '3', assigned: PEER });
    const before = await totals(db);
    assert.deepEqual(await command(db), original);
    assert.deepEqual(await history(db), original);
    assert.deepEqual(await totals(db), before);
    assert.equal(original.result.version, '2');
    assert.equal(before.version, '4');
    await denied(() => history(db, ADMIN2), 'P0002');
    await denied(() => command(db, { user: ADMIN2 }), '40001');
    for (const changes of [
      { assigned: PEER },
      { expected: '2' },
      { enquiry: SECOND },
      { kind: 'reschedule', assigned: null, next: DATE },
    ])
      await denied(() => command(db, changes), '40001');
    assert.deepEqual(await totals(db), before);
  } finally {
    await db.close();
  }
});
test('conflict and valid business rejection are durable and never update the enquiry', async () => {
  const db = await fixture();
  try {
    const start = await scalar(db, 'SELECT to_jsonb(e) FROM app_private.enquiries e WHERE id=$1', [
      E,
    ]);
    const unavailable = await command(db, { assigned: INACTIVE });
    assert.equal(unavailable.outcome, 'rejected');
    assert.equal(unavailable.reason, 'ASSIGNEE_UNAVAILABLE');
    assert.equal(unavailable.result.version, '1');
    const invalid = await transition(db, { operation: id(1001), status: 'qualified', next: DATE });
    assert.equal(invalid.reason, 'INVALID_TRANSITION');
    const scheduled = await reschedule(db, { operation: id(1002), next: DATE });
    assert.equal(scheduled.reason, 'INVALID_TRANSITION');
    const conflict = await command(db, { operation: id(1003), expected: '2', assigned: INACTIVE });
    assert.equal(conflict.outcome, 'conflict');
    assert.equal(conflict.reason, 'VERSION_CONFLICT');
    assert.deepEqual(
      await scalar(db, 'SELECT to_jsonb(e) FROM app_private.enquiries e WHERE id=$1', [E]),
      start,
    );
    assert.deepEqual(await totals(db), { operations: 4, audits: 0, version: '1' });
    await db.query(
      'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
      [T, INACTIVE],
    );
    assert.deepEqual(await command(db, { assigned: INACTIVE }), unavailable);
    assert.deepEqual(await history(db, ADMIN, E, id(1003)), conflict);
  } finally {
    await db.close();
  }
});
test('current role, assignment, tenant and original requester guard both writes and recovery', async () => {
  const db = await fixture();
  try {
    for (const user of [AGENT, CUSTOMER, null]) await denied(() => command(db, { user }), '42501');
    await denied(() => command(db, { tenant: OTHER, user: OTHERADMIN }), 'P0002');
    await command(db);
    const contacted = await transition(db, {
      user: AGENT,
      operation: id(1001),
      expected: '2',
      status: 'contacted',
      next: DATE,
    });
    await denied(() => history(db, PEER, E, id(1001)), 'P0002');
    await denied(
      () =>
        transition(db, {
          user: PEER,
          operation: id(1002),
          expected: '3',
          status: 'qualified',
          next: DATE,
        }),
      'P0002',
    );
    await denied(() => history(db, ADMIN, E, id(1001)), 'P0002');
    await command(db, { operation: id(1003), expected: '3', assigned: PEER });
    await denied(() => history(db, AGENT, E, id(1001)), 'P0002');
    await denied(
      () =>
        transition(db, {
          user: AGENT,
          operation: id(1001),
          expected: '2',
          status: 'contacted',
          next: DATE,
        }),
      'P0002',
    );
    assert.equal(contacted.result.status, 'contacted');
    await denied(() => history(db, OTHERADMIN, E, id(1000), OTHER), 'P0002');
    await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
    await denied(() => history(db), '42501');
  } finally {
    await db.close();
  }
});
test('assignment history is unavailable after admin downgrade and all history after revocation', async () => {
  const db = await fixture();
  try {
    await command(db, { assigned: ADMIN });
    await db.query(
      `UPDATE app_private.memberships SET role='agent' WHERE tenant_id=$1 AND user_id=$2`,
      [T, ADMIN],
    );
    await denied(() => history(db), 'P0002');
    await denied(() => command(db, { assigned: ADMIN }), '42501');
    const contacted = await transition(db, {
      user: ADMIN,
      operation: id(1001),
      expected: '2',
      status: 'contacted',
      next: DATE,
    });
    assert.equal(contacted.outcome, 'applied');
    await db.query(
      `UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2`,
      [T, ADMIN],
    );
    await denied(() => history(db, ADMIN, E, id(1001)), '42501');
    await denied(
      () =>
        transition(db, {
          user: ADMIN,
          operation: id(1001),
          expected: '2',
          status: 'contacted',
          next: DATE,
        }),
      '42501',
    );
  } finally {
    await db.close();
  }
});
test('malformed or ambiguous request values fail before installing history', async () => {
  const db = await fixture();
  try {
    const bad = [
      { expected: '0' },
      { expected: '9007199254740991' },
      { operation: null },
      { enquiry: null },
      { kind: 'unknown' },
      { assigned: null },
      { status: 'assigned' },
      { next: DATE },
      { reason: 'extra' },
      { kind: 'reschedule', assigned: null, next: null },
      { kind: 'reschedule', assigned: null, next: 'infinity' },
      { kind: 'reschedule', assigned: null, next: '2026-01-02T03:04:05.006001Z' },
      { kind: 'reschedule', assigned: null, next: '10000-01-01T00:00:00.000Z' },
      { kind: 'transition', assigned: null, status: 'contacted', next: null },
      { kind: 'transition', assigned: null, status: 'closed_won', next: DATE },
      { kind: 'transition', assigned: null, status: 'spam', reason: null },
      ...[
        ' padded',
        'padded ',
        '\u00a0padded',
        'bad\nreason',
        'bad\u0085reason',
        'x'.repeat(1001),
      ].map((reason) => ({ kind: 'transition', assigned: null, status: 'spam', reason })),
    ];
    for (const values of bad) await denied(() => command(db, values), '23514');
    assert.deepEqual(await totals(db), { operations: 0, audits: 0, version: '1' });
    const reason = '😀'.repeat(1000);
    const valid = await transition(db, { status: 'spam', assigned: null, reason });
    assert.equal(valid.request.reason, reason);
  } finally {
    await db.close();
  }
});
test('assignment promotes legacy new rows but preserves existing workflow and dates', async () => {
  const db = await fixture();
  try {
    await db.query('UPDATE app_private.enquiries SET assigned_agent_id=$1 WHERE id=$2', [AGENT, E]);
    const promotion = await command(db, { expected: '2' });
    assert.equal(promotion.outcome, 'applied');
    assert.equal(promotion.result.status, 'assigned');
    await transition(db, {
      user: AGENT,
      operation: id(1001),
      expected: '3',
      status: 'contacted',
      next: DATE,
    });
    const assignment = await command(db, { operation: id(1002), expected: '4', assigned: PEER });
    assert.equal(assignment.result.status, 'contacted');
    assert.equal(assignment.result.nextActionAt, DATE);
    const unavailable = await command(db, {
      operation: id(1003),
      expected: '5',
      assigned: OTHERADMIN,
    });
    assert.equal(unavailable.reason, 'ASSIGNEE_UNAVAILABLE');
  } finally {
    await db.close();
  }
});
test('forbidden transitions require explicit reschedule and preserve original state', async () => {
  const db = await fixture();
  try {
    await command(db);
    await transition(db, { operation: id(1001), expected: '2', status: 'contacted', next: DATE });
    const repeated = await transition(db, {
      operation: id(1002),
      expected: '3',
      status: 'contacted',
      next: LATER,
    });
    assert.equal(repeated.outcome, 'rejected');
    assert.equal(repeated.result.nextActionAt, DATE);
    const directWin = await transition(db, {
      operation: id(1003),
      expected: '3',
      status: 'closed_won',
    });
    assert.equal(directWin.reason, 'INVALID_TRANSITION');
    const wrongReopen = await transition(db, {
      operation: id(1004),
      expected: '3',
      status: 'new',
      reason: 'Synthetic invalid reopen',
    });
    assert.equal(wrongReopen.reason, 'INVALID_TRANSITION');
    assert.equal((await totals(db)).version, '3');
  } finally {
    await db.close();
  }
});
test('bounded admin picker is tenant-scoped active real roles without fabricated names', async () => {
  const db = await fixture();
  try {
    const picker = (limit) =>
      actor(db, ADMIN, () => scalar(db, 'SELECT app_api.list_enquiry_assignees($1)', [limit]));
    assert.deepEqual(await picker(2), {
      items: [
        { userId: ADMIN, role: 'admin' },
        { userId: AGENT, role: 'agent' },
      ],
      limit: 2,
      truncated: true,
    });
    assert.deepEqual(await picker(100), {
      items: [
        { userId: ADMIN, role: 'admin' },
        { userId: AGENT, role: 'agent' },
        { userId: PEER, role: 'agent' },
        { userId: ADMIN2, role: 'admin' },
      ],
      limit: 100,
      truncated: false,
    });
    for (const limit of [0, 101, null]) await denied(() => picker(limit), '23514');
    for (const user of [AGENT, CUSTOMER, null, INACTIVE])
      await denied(
        () => actor(db, user, () => db.query('SELECT app_api.list_enquiry_assignees(100)')),
        '42501',
      );
    const other = await actor(
      db,
      OTHERADMIN,
      () => scalar(db, 'SELECT app_api.list_enquiry_assignees(100)'),
      OTHER,
    );
    assert.deepEqual(other.items, [{ userId: OTHERADMIN, role: 'admin' }]);
  } finally {
    await db.close();
  }
});
test('receipt table is forced-RLS, runtime-inaccessible and immutable even to owner', async () => {
  const db = await fixture();
  try {
    await command(db);
    const row = (
      await db.query(
        `SELECT relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app_private' AND relname='enquiry_operations'`,
      )
    ).rows[0];
    assert.deepEqual(row, { relrowsecurity: true, relforcerowsecurity: true });
    for (const sql of [
      'SELECT * FROM app_private.enquiry_operations',
      'DELETE FROM app_private.enquiry_operations',
      `UPDATE app_private.enquiry_operations SET kind='assign'`,
    ])
      await denied(() => actor(db, ADMIN, () => db.query(sql)), '42501');
    await denied(
      () => db.query(`UPDATE app_private.enquiry_operations SET receipt=receipt`),
      '23514',
    );
    await denied(() => db.query('DELETE FROM app_private.enquiry_operations'), '23514');
    assert.deepEqual(await totals(db), { operations: 1, audits: 1, version: '2' });
  } finally {
    await db.close();
  }
});
test('stored receipt constraints reject unknown projection, broken outcome versions, hash and tenancy', async () => {
  const db = await fixture();
  try {
    await command(db);
    const original = (await db.query('SELECT * FROM app_private.enquiry_operations')).rows[0];
    let next = 1100;
    async function forge(change) {
      const operation = id(next++),
        payload = structuredClone(original.request_payload),
        receipt = structuredClone(original.receipt);
      const values = {
        tenant: T,
        enquiry: E,
        requester: ADMIN,
        payload,
        receipt,
        hash: null,
        ...change,
      };
      // Bind identity after overlays so malformed outcome cases reach their own guard.
      values.payload.operationId = operation;
      values.receipt.operationId = operation;
      return db.query(
        `INSERT INTO app_private.enquiry_operations(tenant_id,operation_id,enquiry_id,requester_id,kind,expected_version,request_payload,request_sha256,receipt,created_at)
        VALUES($1,$2,$3,$4,'assign',1,$5::jsonb,coalesce($6,encode(sha256(convert_to(($5::jsonb)::text,'UTF8')),'hex')),$7::jsonb,$8)`,
        [
          values.tenant,
          operation,
          values.enquiry,
          values.requester,
          JSON.stringify(values.payload),
          values.hash,
          JSON.stringify(values.receipt),
          original.created_at,
        ],
      );
    }
    await forge({}); // Positive control: a structurally valid fixture reaches insertion.
    await denied(() => forge({ receipt: { ...original.receipt, private: 'forged' } }), '23514');
    await denied(
      () =>
        forge({
          receipt: { ...original.receipt, result: { ...original.receipt.result, version: '1' } },
        }),
      '23514',
    );
    await denied(
      () =>
        forge({
          receipt: {
            ...original.receipt,
            outcome: 'noop',
            result: { ...original.receipt.result, version: '2' },
          },
        }),
      '23514',
    );
    await denied(() => forge({ hash: '0'.repeat(64) }), '23514');
    // Structurally valid cross-tenant resource still fails its composite FK.
    const operation = id(next++),
      payload = { ...original.request_payload, operationId: operation, enquiryId: FOREIGN },
      receipt = { ...original.receipt, operationId: operation, enquiryId: FOREIGN };
    await denied(
      () =>
        db.query(
          `INSERT INTO app_private.enquiry_operations SELECT tenant_id,$1,$2,requester_id,kind,expected_version,$3::jsonb,
      encode(sha256(convert_to(($3::jsonb)::text,'UTF8')),'hex'),$4::jsonb,created_at FROM app_private.enquiry_operations LIMIT 1`,
          [operation, FOREIGN, JSON.stringify(payload), JSON.stringify(receipt)],
        ),
      '23503',
    );
  } finally {
    await db.close();
  }
});
test('maximum supported current version produces durable conflict without overflow', async () => {
  const db = await fixture();
  try {
    await db.exec('ALTER TABLE app_private.enquiries DISABLE TRIGGER touch_enquiry;');
    await db.query('UPDATE app_private.enquiries SET version=9007199254740991 WHERE id=$1', [E]);
    await db.exec('ALTER TABLE app_private.enquiries ENABLE TRIGGER touch_enquiry;');
    const receipt = await command(db, { expected: '9007199254740990' });
    assert.equal(receipt.outcome, 'conflict');
    assert.equal(receipt.result.version, '9007199254740991');
    assert.deepEqual(await history(db), receipt);
    assert.equal((await totals(db)).audits, 0);
  } finally {
    await db.close();
  }
});
test('original contacted revision survives later listing changes without public listing joins', async () => {
  const db = await fixture();
  try {
    const listing = id(500),
      enquiry = id(501);
    await actor(db, AGENT, () =>
      db.query(`SELECT app_api.create_listing($1,'synthetic-enquiry-history')`, [listing]),
    );
    await db.query(
      'INSERT INTO app_private.listing_revisions(tenant_id,listing_id,revision_no) VALUES($1,$2,1)',
      [T, listing],
    );
    await seed(db, { enquiry, listing, revision: 1 });
    await db.query(
      `UPDATE app_private.listings SET availability='withdrawn' WHERE tenant_id=$1 AND id=$2`,
      [T, listing],
    );
    const result = await command(db, { enquiry, operation: id(1500) });
    assert.equal(result.outcome, 'applied');
    const contact = await actor(db, ADMIN, () =>
      scalar(db, 'SELECT contacted_revision_no FROM app_private.enquiries WHERE id=$1', [enquiry]),
    );
    assert.equal(contact, 1);
    assert.deepEqual(await history(db, ADMIN, enquiry, id(1500)), result);
  } finally {
    await db.close();
  }
});

function activity(db, user = ADMIN, enquiry = E, limit = 50, tenant = T) {
  return actor(
    db,
    user,
    () => scalar(db, 'SELECT app_api.list_enquiry_activity($1,$2)', [enquiry, limit]),
    tenant,
  );
}
test('activity lists only applied minimal attributed changes in bounded version order without mutating records', async () => {
  const db = await fixture();
  try {
    const assignment = await command(db);
    await command(db, { operation: id(2000), expected: '2' }); // noop excluded
    await transition(db, {
      user: AGENT,
      operation: id(2001),
      expected: '2',
      status: 'contacted',
      next: DATE,
    });
    await transition(db, {
      user: AGENT,
      operation: id(2002),
      expected: '3',
      status: 'closed_lost',
      reason: 'Private closure detail',
    });
    const before = await totals(db),
      page = await activity(db);
    assert.equal(page.coverage, 'capture-and-v2-operations');
    assert.equal(page.currentVersion, '4');
    assert.equal(page.limit, 50);
    assert.equal(page.truncated, false);
    assert.deepEqual(
      page.items.map((x) => [x.kind, x.version, x.actorId]),
      [
        ['transition', '4', AGENT],
        ['transition', '3', AGENT],
        ['assign', '2', ADMIN],
        ['received', '1', null],
      ],
    );
    assert.equal(page.items[1].nextActionAt, DATE);
    assert.equal(page.items[2].eventId, assignment.operationId);
    for (const item of page.items)
      assert.deepEqual(
        Object.keys(item).sort(),
        [
          'eventId',
          'kind',
          'actorId',
          'occurredAt',
          'version',
          'status',
          'assignedAgentId',
          'nextActionAt',
        ].sort(),
      );
    assert.doesNotMatch(
      JSON.stringify(page),
      /Private closure|Synthetic private|phone|email|request_payload|closureReason/,
    );
    const bounded = await activity(db, AGENT, E, 2);
    assert.equal(bounded.items.length, 2);
    assert.equal(bounded.truncated, true);
    assert.deepEqual(bounded.items, page.items.slice(0, 2));
    assert.deepEqual(await totals(db), before);
    for (const limit of [null, 0, 101]) await denied(() => activity(db, ADMIN, E, limit), '23514');
  } finally {
    await db.close();
  }
});
test('activity enforces current tenant, membership and assignment independently of original requester', async () => {
  const db = await fixture();
  try {
    await command(db);
    assert.equal((await activity(db, AGENT)).items.length, 2);
    for (const user of [null, CUSTOMER, INACTIVE]) await denied(() => activity(db, user), '42501');
    await denied(() => activity(db, PEER), 'P0002');
    await denied(() => activity(db, OTHERADMIN, E, 50, OTHER), 'P0002');
    await denied(() => activity(db, ADMIN, FOREIGN), 'P0002');
    await command(db, { operation: id(2100), expected: '2', assigned: PEER });
    await denied(() => activity(db, AGENT), 'P0002');
    assert.equal((await activity(db, PEER)).items.length, 3);
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [T, PEER],
    );
    await denied(() => activity(db, PEER), '42501');
  } finally {
    await db.close();
  }
});

test('activity declares bounded v2 coverage rather than inventing missing legacy changes', async () => {
  const db = await fixture();
  try {
    await db.query(
      "UPDATE app_private.enquiries SET contact_name='Synthetic legacy edit' WHERE tenant_id=$1 AND id=$2",
      [T, E],
    );
    const page = await activity(db);
    assert.equal(page.coverage, 'capture-and-v2-operations');
    assert.equal(page.currentVersion, '2');
    assert.deepEqual(
      page.items.map((x) => x.version),
      ['1'],
    );
    assert.equal(page.truncated, false);
  } finally {
    await db.close();
  }
});

function contact(
  db,
  {
    user = ADMIN,
    enquiry = E,
    operation = id(3000),
    expected = '1',
    channel = 'call',
    outcome = 'no_response',
    occurred = DATE,
    notes = '  Original fictional note\nRetain whitespace.  ',
    tenant = T,
  } = {},
) {
  return actor(
    db,
    user,
    () =>
      scalar(db, 'SELECT app_api.record_enquiry_contact($1,$2,$3,$4,$5,$6,$7)', [
        enquiry,
        operation,
        expected,
        channel,
        outcome,
        occurred,
        notes,
      ]),
    tenant,
  );
}
function contactReceipt(db, user = ADMIN, enquiry = E, operation = id(3000)) {
  return actor(db, user, () =>
    scalar(db, 'SELECT app_api.read_enquiry_contact($1,$2)', [enquiry, operation]),
  );
}
function contacts(db, user = ADMIN, enquiry = E, limit = 50) {
  return actor(db, user, () =>
    scalar(db, 'SELECT app_api.list_enquiry_contacts($1,$2)', [enquiry, limit]),
  );
}
test('explicit contact preserves raw facts and actor without changing enquiry state; original receipt replays after later work', async () => {
  const db = await fixture();
  try {
    const before = await totals(db),
      saved = await contact(db);
    assert.equal(saved.outcome, 'applied');
    assert.equal(saved.actorId, ADMIN);
    assert.equal(saved.entry.channel, 'call');
    assert.equal(saved.entry.outcome, 'no_response');
    assert.equal(saved.entry.occurredAt, DATE);
    assert.equal(saved.entry.notes, '  Original fictional note\nRetain whitespace.  ');
    assert.deepEqual(saved.request, {
      channel: 'call',
      outcome: 'no_response',
      occurredAt: DATE,
      notes: saved.entry.notes,
    });
    assert.equal(saved.expectedVersion, '1');
    assert.equal(saved.observedVersion, '1');
    const after = await totals(db);
    assert.equal(after.version, before.version);
    assert.equal(after.audits, before.audits + 1);
    assert.equal(after.operations, before.operations);
    assert.equal(
      (
        await db.query(
          'SELECT status,next_action_at FROM app_private.enquiries WHERE tenant_id=$1 AND id=$2',
          [T, E],
        )
      ).rows[0].status,
      'new',
    );
    await command(db);
    const later = await totals(db);
    assert.deepEqual(await contact(db), saved);
    assert.deepEqual(await contactReceipt(db), saved);
    assert.deepEqual(await totals(db), later);
    await denied(() => contact(db, { notes: 'Different raw note' }), '40001');
    await denied(() => contact(db, { enquiry: SECOND }), '40001');
    await denied(() => contact(db, { user: AGENT }), '40001');
    const page = await contacts(db, AGENT);
    assert.equal(page.items.length, 1);
    assert.deepEqual(page.items[0], saved.entry);
    await denied(() => contactReceipt(db, AGENT), 'P0002');
  } finally {
    await db.close();
  }
});
test('stale contact has durable conflict without an entry or audit and does not become applied on replay', async () => {
  const db = await fixture();
  try {
    await command(db);
    const before = await totals(db),
      conflict = await contact(db);
    assert.equal(conflict.outcome, 'conflict');
    assert.equal(conflict.reason, 'VERSION_CONFLICT');
    assert.equal(conflict.observedVersion, '2');
    assert.equal(conflict.entry, null);
    assert.equal(conflict.request.notes, '  Original fictional note\nRetain whitespace.  ');
    assert.deepEqual(await totals(db), before);
    assert.equal((await contacts(db)).items.length, 0);
    await transition(db, {
      user: AGENT,
      operation: id(3100),
      expected: '2',
      status: 'contacted',
      next: LATER,
    });
    assert.deepEqual(await contact(db), conflict);
    assert.deepEqual(await contactReceipt(db), conflict);
    const applied = await contact(db, {
      user: AGENT,
      operation: id(3101),
      expected: '3',
      channel: 'whatsapp',
      outcome: 'connected',
    });
    assert.equal(applied.outcome, 'applied');
    assert.equal((await contacts(db, AGENT)).items.length, 1);
  } finally {
    await db.close();
  }
});
test('contact reads/writes enforce current assignment, tenant, membership and immutable runtime boundaries', async () => {
  const db = await fixture();
  try {
    for (const user of [null, CUSTOMER, INACTIVE])
      await denied(() => contact(db, { user }), '42501');
    await denied(() => contact(db, { user: PEER }), 'P0002');
    await denied(() => contact(db, { enquiry: FOREIGN }), 'P0002');
    await command(db);
    await contact(db, { user: AGENT, expected: '2' });
    await command(db, { operation: id(3200), expected: '2', assigned: PEER });
    await denied(() => contactReceipt(db, AGENT), 'P0002');
    await denied(() => contacts(db, AGENT), 'P0002');
    assert.equal((await contacts(db, PEER)).items.length, 1);
    await denied(
      () => actor(db, PEER, () => db.query('SELECT * FROM app_private.enquiry_contacts')),
      '42501',
    );
    await denied(() => db.query('DELETE FROM app_private.enquiry_contacts'), '23514');
    const owner = (
      await db.query(
        "SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid='app_api.list_enquiry_activity(uuid,integer)'::regprocedure",
      )
    ).rows[0].owner;
    assert.equal(owner, 'realtor_owner');
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [T, PEER],
    );
    await denied(() => contacts(db, PEER), '42501');
  } finally {
    await db.close();
  }
});
test('contact validation rejects invalid/future facts and bounded private feed does not include conflict attempts', async () => {
  const db = await fixture();
  try {
    for (const bad of [
      { channel: 'sms' },
      { outcome: 'guaranteed_sale' },
      { occurred: '9999-01-01T00:00:00.000Z' },
      { notes: '\t \n' },
      { notes: '\u00a0' },
      { notes: 'bad\u0001text' },
      { notes: 'x'.repeat(2001) },
      { expected: '0' },
    ])
      await denied(() => contact(db, bad), '23514');
    const one = await contact(db),
      two = await contact(db, { operation: id(3300), channel: 'email', outcome: 'left_message' });
    const before = await totals(db),
      page = await contacts(db, ADMIN, E, 1);
    assert.equal(page.items.length, 1);
    assert.equal(page.truncated, true);
    assert.equal(page.limit, 1);
    assert.ok([one.entry.entryId, two.entry.entryId].includes(page.items[0].entryId));
    assert.deepEqual(await totals(db), before);
    for (const limit of [null, 0, 101]) await denied(() => contacts(db, ADMIN, E, limit), '23514');
    const audit = await db.query(
      "SELECT summary FROM app_private.audit_events WHERE action='enquiry.contact_recorded'",
    );
    assert.doesNotMatch(JSON.stringify(audit.rows), /Original fictional|notes|Retain/);
  } finally {
    await db.close();
  }
});
