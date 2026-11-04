import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fixture,
  publish,
  asActor,
  scalar,
  T,
  OTHER,
  ADMIN,
  AGENT,
  LISTING,
} from './public-media-fixtures.mjs';
import {
  validateListingReportReceipt,
  validateListingReportDecisionReceipt,
} from '../../packages/domain/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOTICE = 'synthetic-report-notice-v1',
  REPORT = id(1000),
  OP = id(2000),
  PEER = id(15),
  CUSTOMER = id(13),
  FOREIGN = id(20);
const command = (operationId = OP) => ({
  policy: 'listing-report-command-v1',
  operationId,
  listingId: LISTING,
  reason: 'suspected_fraud',
  details: 'Synthetic concern for local testing only.',
});
const decide = (operationId = id(3000), expectedVersion = '1') => ({
  policy: 'listing-report-decision-command-v1',
  operationId,
  reportId: REPORT,
  expectedVersion,
  decision: 'reviewed',
  reason: 'Synthetic review; publication is unchanged.',
});
const rejected = (fn, codes = ['42501']) => assert.rejects(fn, (e) => codes.includes(e.code));
const guest = (db, fn, tenant = T) => asActor(db, tenant, null, fn);
const admin = (db, fn, who = ADMIN, tenant = T) => asActor(db, tenant, who, fn);
const capture = (db, c = command(), report = REPORT, notice = NOTICE, tenant = T) =>
  guest(
    db,
    () =>
      scalar(db, 'SELECT app_api.capture_listing_report($1,$2::jsonb,$3)', [
        report,
        JSON.stringify(c),
        notice,
      ]),
    tenant,
  );
const original = (db, c = command(), tenant = T) =>
  guest(
    db,
    () =>
      scalar(db, 'SELECT app_api.read_listing_report_receipt($1,$2)', [c.listingId, c.operationId]),
    tenant,
  );
const queue = (db, limit = 50, before = null, status = 'new', who = ADMIN, tenant = T) =>
  admin(
    db,
    () => scalar(db, 'SELECT app_api.list_listing_reports($1,$2,$3)', [limit, before, status]),
    who,
    tenant,
  );
const decision = (db, c = decide(), who = ADMIN, tenant = T) =>
  admin(
    db,
    () => scalar(db, 'SELECT app_api.decide_listing_report($1::jsonb)', [JSON.stringify(c)]),
    who,
    tenant,
  );
const counts = async (db) =>
  (
    await db.query(
      "SELECT (SELECT count(*)::int FROM app_private.listing_reports) AS reports,(SELECT count(*)::int FROM app_private.listing_report_decisions) AS decisions,(SELECT count(*)::int FROM app_private.audit_events WHERE object_type='listing_report') AS audits",
    )
  ).rows[0];
async function ready() {
  const db = await fixture();
  await publish(db);
  await db.query(
    "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [T, PEER],
  );
  return db;
}
async function pause(db) {
  const version = await scalar(
    db,
    'SELECT version FROM app_private.listings WHERE tenant_id=$1 AND id=$2',
    [T, LISTING],
  );
  await admin(db, () =>
    scalar(db, "SELECT app_api.set_publication($1,$2,'paused')", [LISTING, version]),
  );
}

test('anonymous report is durable/idempotent, minimal and does not change publication or classify an accusation as true', async () => {
  const db = await ready();
  try {
    const before = (
      await db.query(
        'SELECT version,publication_status,published_revision_no FROM app_private.listings WHERE tenant_id=$1 AND id=$2',
        [T, LISTING],
      )
    ).rows;
    const receipt = validateListingReportReceipt(await capture(db), command());
    assert.equal(receipt.status, 'recorded');
    assert.equal(JSON.stringify(receipt).includes('concern'), false);
    assert.equal(Object.hasOwn(receipt, 'reportId'), false);
    assert.equal(Object.hasOwn(receipt, 'decision'), false);
    assert.deepEqual(await original(db), receipt);
    assert.deepEqual(await capture(db, command(), id(1001)), receipt);
    await rejected(() => capture(db, { ...command(), details: 'Changed payload' }), ['23505']);
    await rejected(() => capture(db, command(), REPORT, 'different-notice'), ['23505']);
    assert.deepEqual(await counts(db), { reports: 1, decisions: 0, audits: 1 });
    assert.deepEqual(
      (
        await db.query(
          'SELECT version,publication_status,published_revision_no FROM app_private.listings WHERE tenant_id=$1 AND id=$2',
          [T, LISTING],
        )
      ).rows,
      before,
    );
    const raw = (
      await db.query(
        "SELECT summary FROM app_private.audit_events WHERE object_type='listing_report'",
      )
    ).rows;
    assert.ok(!JSON.stringify(raw).includes(command().details));
    assert.ok(!JSON.stringify(raw).includes(OP));
  } finally {
    await db.close();
  }
});
test('new capture requires enabled/current public stock; saved minimal original survives pause but not foreign company or disabled tenant', async () => {
  const db = await ready();
  try {
    const receipt = await capture(db);
    await rejected(() => capture(db, { ...command(id(2001)), listingId: id(99999) }), ['P0002']);
    await rejected(() => capture(db, command(id(2001)), id(1001), NOTICE, OTHER), ['P0002']);
    await rejected(() => original(db, command(), OTHER), ['P0002']);
    await pause(db);
    await rejected(() => capture(db, command(id(2002)), id(1002)), ['P0002']);
    assert.deepEqual(await original(db), receipt);
    assert.deepEqual(await capture(db), receipt);
    await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
    await rejected(() => original(db));
    await rejected(() => capture(db));
    await rejected(() => queue(db));
    assert.deepEqual(await counts(db), { reports: 1, decisions: 0, audits: 1 });
  } finally {
    await db.close();
  }
});
test('anonymous capture rejects any signed actor; report queue is current admin/company only and excludes operation secrets', async () => {
  const db = await ready();
  try {
    await capture(db);
    for (const who of [ADMIN, AGENT, CUSTOMER, FOREIGN])
      await rejected(() =>
        asActor(db, T, who, () =>
          scalar(db, 'SELECT app_api.capture_listing_report($1,$2::jsonb,$3)', [
            id(1010),
            JSON.stringify(command(id(2010))),
            NOTICE,
          ]),
        ),
      );
    for (const who of [null, AGENT, CUSTOMER, FOREIGN])
      await rejected(() => queue(db, 50, null, 'all', who));
    assert.equal((await queue(db)).items.length, 1);
    assert.deepEqual((await queue(db, 50, null, 'all', FOREIGN, OTHER)).items, []);
    const text = JSON.stringify(await queue(db));
    assert.ok(text.includes(command().details));
    assert.ok(!text.includes(OP));
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [T, ADMIN],
    );
    await rejected(() => queue(db));
  } finally {
    await db.close();
  }
});
test('reasoned triage is exact-version, once-only, original-actor/current-role bound and independent of publication', async () => {
  const db = await ready();
  try {
    const receipt = await capture(db);
    const saved = validateListingReportDecisionReceipt(await decision(db), decide());
    assert.equal(saved.version, '2');
    assert.equal(saved.actorId, ADMIN);
    assert.deepEqual(await decision(db), saved);
    const read = () =>
      admin(db, () =>
        scalar(db, 'SELECT app_api.read_listing_report_decision($1,$2)', [
          REPORT,
          decide().operationId,
        ]),
      );
    assert.deepEqual(await read(), saved);
    await rejected(() => decision(db, { ...decide(), reason: 'Changed' }), ['23505']);
    await rejected(() => decision(db, decide(), PEER));
    await rejected(
      () =>
        admin(
          db,
          () =>
            scalar(db, 'SELECT app_api.read_listing_report_decision($1,$2)', [
              REPORT,
              decide().operationId,
            ]),
          PEER,
        ),
      ['P0002'],
    );
    await rejected(() => decision(db, decide(id(3001))), ['40001']);
    await rejected(() => decision(db, decide(id(3002), '2')), ['23514']);
    assert.equal((await queue(db)).items.length, 0);
    const q = await queue(db, 50, null, 'reviewed');
    assert.equal(q.items.length, 1);
    assert.equal(q.items[0].status, 'reviewed');
    assert.equal(q.items[0].decision.reason, decide().reason);
    assert.deepEqual(await original(db), receipt);
    assert.equal(
      await scalar(
        db,
        'SELECT publication_status FROM app_private.listings WHERE tenant_id=$1 AND id=$2',
        [T, LISTING],
      ),
      'published',
    );
    assert.deepEqual(await counts(db), { reports: 1, decisions: 1, audits: 2 });
    await db.query(
      "UPDATE app_private.memberships SET role='agent' WHERE tenant_id=$1 AND user_id=$2",
      [T, ADMIN],
    );
    await rejected(() => read());
    await rejected(() => decision(db));
    await capture(db, command(id(2001)), id(1001));
    const dismissal = {
      ...decide(id(3003)),
      reportId: id(1001),
      decision: 'dismissed',
    };
    const dismissed = await decision(db, dismissal, PEER);
    assert.equal(dismissed.version, '2');
    assert.deepEqual(await decision(db, dismissal, PEER), dismissed);
    const { rows } = await db.query(
      "SELECT tenant_id, actor_id, action, object_type, object_id, object_version::text, correlation_id, summary FROM app_private.audit_events WHERE action IN ('listing.report_reviewed','listing.report_dismissed') ORDER BY id",
    );
    assert.deepEqual(
      rows,
      [
        [ADMIN, 'reviewed', REPORT],
        [PEER, 'dismissed', id(1001)],
      ].map(([actorId, action, reportId]) => ({
        tenant_id: T,
        actor_id: actorId,
        action: 'listing.report_' + action,
        object_type: 'listing_report',
        object_id: reportId,
        object_version: '2',
        correlation_id: 'synthetic-db-test',
        summary: {},
      })),
    );
  } finally {
    await db.close();
  }
});
test('bounded keyset queue traverses all reports exactly once, preserves filter semantics and rejects foreign/missing cursors', async () => {
  const db = await ready();
  try {
    for (let i = 0; i < 5; i++) await capture(db, command(id(2100 + i)), id(1100 + i));
    const first = await queue(db, 2),
      second = await queue(db, 2, first.items.at(-1).reportId),
      third = await queue(db, 2, second.items.at(-1).reportId);
    assert.equal(first.hasMore, true);
    assert.equal(second.hasMore, true);
    assert.equal(third.hasMore, false);
    assert.deepEqual(
      [first, second, third].map((q) => q.items.length),
      [2, 2, 1],
    );
    assert.equal(
      new Set([...first.items, ...second.items, ...third.items].map((r) => r.reportId)).size,
      5,
    );
    await rejected(() => queue(db, 0), ['23514']);
    await rejected(() => queue(db, 51), ['23514']);
    await rejected(() => queue(db, 2, id(9999)), ['P0002']);
    await rejected(() => queue(db, 2, first.items[0].reportId, 'all', FOREIGN, OTHER), ['P0002']);
    await rejected(() => queue(db, 2, null, 'unknown'), ['23514']);
  } finally {
    await db.close();
  }
});
test('raw tables/private helpers are unavailable to API/media roles; preserved facts and decisions reject owner mutation', async () => {
  const db = await ready();
  try {
    await capture(db);
    await decision(db);
    for (const table of ['listing_reports', 'listing_report_decisions']) {
      for (const role of ['api_runtime', 'media_coordinator'])
        for (const action of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
          assert.equal(
            await scalar(db, 'SELECT has_table_privilege($1,$2,$3)', [
              role,
              'app_private.' + table,
              action,
            ]),
            false,
          );
      await rejected(() => guest(db, () => db.query('SELECT * FROM app_private.' + table)));
      for (const sql of [
        'UPDATE app_private.' + table + ' SET tenant_id=tenant_id',
        'DELETE FROM app_private.' + table,
      ]) {
        await rejected(async () => {
          await db.exec('BEGIN;SET LOCAL ROLE realtor_owner');
          try {
            await db.query("SELECT set_config('realtor.tenant_id',$1,true)", [T]);
            await db.exec(sql);
          } finally {
            await db.exec('ROLLBACK');
          }
        }, ['23514']);
      }
    }
    const flags = (
      await db.query(
        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('app_private.listing_reports'::regclass,'app_private.listing_report_decisions'::regclass)",
      )
    ).rows;
    assert.ok(flags.every((r) => r.relrowsecurity && r.relforcerowsecurity));
    assert.deepEqual(await counts(db), { reports: 1, decisions: 1, audits: 2 });
  } finally {
    await db.close();
  }
});
test('malformed/forged reports and triage cannot write; stale availability refuses new capture', async () => {
  const db = await ready();
  try {
    for (const patch of [
      { tenantId: OTHER },
      { details: '' },
      { details: '<script>' },
      { details: 'e\u0301' },
      { details: 'x\u202ey' },
      { details: 'x'.repeat(1201) },
      { reason: null },
      { operationId: null },
      { policy: null },
    ])
      await rejected(() => capture(db, { ...command(), ...patch }), ['23514']);
    await capture(db);
    for (const patch of [
      { actorId: ADMIN },
      { policy: null },
      { decision: null },
      { reason: null },
      { reason: ' ' },
      { reason: '<b>' },
      { reason: 'x'.repeat(501) },
      { expectedVersion: '0' },
      { expectedVersion: '9007199254740991' },
    ])
      await rejected(() => decision(db, { ...decide(), ...patch }), ['23514']);
    assert.deepEqual(await counts(db), { reports: 1, decisions: 0, audits: 1 });
    // Explicit privileged stale-state fixture, not an advanced real clock or hosted race.
    await db.query(
      "UPDATE app_private.listings SET last_availability_confirmed_at=now()-interval '31 days' WHERE tenant_id=$1 AND id=$2",
      [T, LISTING],
    );
    await rejected(() => capture(db, command(id(2050)), id(1050)), ['P0002']);
    assert.deepEqual(
      await original(db),
      validateListingReportReceipt(await original(db), command()),
    );
  } finally {
    await db.close();
  }
});
