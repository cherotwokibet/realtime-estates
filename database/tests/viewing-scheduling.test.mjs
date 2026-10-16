import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { seedGuardedListingDraft } from '../test-helpers/guarded-listing-fixture.mjs';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import { seedSyntheticSealedMedia } from '../test-helpers/synthetic-sealed-media.mjs';
import {
  validateViewingOutcomeReceipt,
  validateViewingRescheduleReceipt,
  validateViewingHistoryPage,
  validateViewingSchedule,
  validateViewingDetail,
  validateViewingConfirmationReceipt,
  validateViewingTerminationReceipt,
} from '../../packages/domain/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1),
  OTHER = id(2),
  ADMIN = id(10),
  AGENT = id(11),
  PEER = id(12),
  CUSTOMER = id(13),
  ADMIN2 = id(14),
  OTHERADMIN = id(20);
const L = id(100),
  SECOND_L = id(101),
  FOREIGN_L = id(200),
  E = id(300),
  GENERAL = id(301),
  FOREIGN_E = id(400);
const NOTES = '  Synthetic viewing notes.\nPreserve the original.  ';
const PHONE_NOTES = '  Fictional completed phone agreement.\nPreserve exact evidence.  ';
const END_REASON = '  Fictional cancellation reason.\nPreserve exact history.  ';
const slot = (startAt = '2090-01-01T09:00:00.000Z', endAt = '2090-01-01T10:00:00.000Z') => ({
  startAt,
  endAt,
  timeZone: 'Africa/Nairobi',
});
const content = {
  title: 'Synthetic viewing studio',
  description: 'Disposable scheduling SQL fixture only.',
  purpose: 'rent',
  propertyType: 'studio',
  currency: 'KES',
  amountMinor: 2000000,
  rentPeriod: 'month',
  bedrooms: 0,
  privateBathrooms: 1,
  sharedBathrooms: null,
  country: 'KE',
  locality: 'Synthetic Nairobi',
  publicPrecision: 'area',
  latitude: null,
  longitude: null,
  privateAddress: null,
};
async function scalar(db, sql, args = []) {
  return Object.values((await db.query(sql, args)).rows[0])[0];
}
async function actor(db, user, callback, tenant = T) {
  await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');
  try {
    await db.query(
      "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),set_config('realtor.correlation_id','synthetic-viewing',true)",
      [tenant ?? '', user ?? ''],
    );
    const value = await callback();
    await db.exec('COMMIT');
    return value;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
async function publish(db, listing, user, tenant) {
  const version = await actor(
    db,
    user,
    async () => {
      const receipt = await seedGuardedListingDraft(db, {
        listingId: listing,
        slug: 'synthetic-' + listing.slice(-3),
        actorId: user,
        content: {
          ...content,
          pricing: { declaration: 'not_declared', charges: [] },
          location: { county: null, town: null, area: null },
        },
      });
      return Number(receipt.result.revisionVersion);
    },
    tenant,
  );
  for (let position = 0; position < 4; position++)
    await seedSyntheticSealedMedia(db, {
      tenantId: tenant,
      listingId: listing,
      position,
      mediaId: id(Number(listing.slice(-3)) * 100 + position),
    });
  const pending = await actor(
    db,
    user,
    async () => {
      await db.query("SELECT app_api.confirm_availability($1,1,'available')", [listing]);
      return scalar(db, 'SELECT app_api.submit_revision($1,1,$2)', [listing, version]);
    },
    tenant,
  );
  await actor(
    db,
    tenant === T ? ADMIN : OTHERADMIN,
    () => db.query('SELECT app_api.decide_revision($1,1,$2,true)', [listing, pending]),
    tenant,
  );
}
async function fixture() {
  const db = new PGlite();
  try {
    await applyTestMigrations(db);
    await db.exec(
      await readFile(
        new URL('../proposals/0024_guarded_draft_allocation.sql', import.meta.url),
        'utf8',
      ),
    );
    await db.query(
      "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'viewing-test','Synthetic Viewing'),($2,'foreign-viewing','Synthetic Foreign')",
      [T, OTHER],
    );
    for (const [tenant, user, role] of [
      [T, ADMIN, 'admin'],
      [T, AGENT, 'agent'],
      [T, PEER, 'agent'],
      [T, CUSTOMER, 'customer'],
      [T, ADMIN2, 'admin'],
      [OTHER, OTHERADMIN, 'admin'],
    ])
      await db.query(
        'INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',
        [tenant, user, role],
      );
    await publish(db, L, AGENT, T);
    await publish(db, SECOND_L, PEER, T);
    await publish(db, FOREIGN_L, OTHERADMIN, OTHER);
    for (const [tenant, enquiry, listing, assigned] of [
      [T, E, L, AGENT],
      [T, GENERAL, null, AGENT],
      [OTHER, FOREIGN_E, FOREIGN_L, OTHERADMIN],
    ])
      await db.query(
        `INSERT INTO app_private.enquiries(tenant_id,id,idempotency_key,listing_id,contacted_revision_no,assigned_agent_id,contact_name,email,message,origin,notice_version,status)
   VALUES($1,$2,$2,$3,CASE WHEN $3::uuid IS NULL THEN NULL ELSE 1 END,$4,'Synthetic prospect','synthetic@example.invalid','Synthetic viewing interest','staff','synthetic-v1','assigned')`,
        [tenant, enquiry, listing, assigned],
      );
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
function command(
  db,
  {
    kind = 'request',
    user = AGENT,
    enquiry = E,
    viewing = null,
    operation = id(1000),
    expected = '1',
    listing = kind === 'request' ? L : null,
    preferences = kind === 'request' ? [slot()] : null,
    notes = kind === 'request' ? NOTES : null,
    proposalSlot = kind === 'propose' ? slot() : null,
    tenant = T,
  } = {},
) {
  return actor(
    db,
    user,
    () =>
      scalar(
        db,
        'SELECT app_api.execute_viewing_operation($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb)',
        [
          enquiry,
          viewing,
          operation,
          expected,
          kind,
          listing,
          preferences === null ? null : JSON.stringify(preferences),
          notes,
          proposalSlot === null ? null : JSON.stringify(proposalSlot),
        ],
      ),
    tenant,
  );
}
const history = (db, operation = id(1000), user = AGENT, enquiry = E, tenant = T) =>
  actor(
    db,
    user,
    () => scalar(db, 'SELECT app_api.read_viewing_operation($1,$2)', [enquiry, operation]),
    tenant,
  );
const read = (db, viewing, user = AGENT, enquiry = E, tenant = T) =>
  actor(
    db,
    user,
    () => scalar(db, 'SELECT app_api.read_viewing($1,$2)', [enquiry, viewing]),
    tenant,
  );
const denied = (fn, code) => assert.rejects(fn, (error) => error.code === code);
const totals = (db) =>
  db
    .query(
      "SELECT (SELECT count(*)::int FROM app_private.viewings) viewings,(SELECT count(*)::int FROM app_private.viewing_operations) operations,(SELECT count(*)::int FROM app_private.audit_events WHERE object_type='viewing') audits,(SELECT version::text FROM app_private.enquiries WHERE id=$1) enquiry_version",
      [E],
    )
    .then((r) => r.rows[0]);
function confirmation(
  db,
  {
    viewing,
    user = AGENT,
    enquiry = E,
    operation = id(2000),
    expected = '2',
    proposalSlot = slot(),
    channel = 'phone',
    agreedAt = new Date().toISOString(),
    notes = PHONE_NOTES,
    tenant = T,
  } = {},
) {
  return actor(
    db,
    user,
    () =>
      scalar(db, 'SELECT app_api.confirm_viewing_phone($1,$2,$3,$4,$5::jsonb,$6,$7,$8)', [
        enquiry,
        viewing,
        operation,
        expected,
        JSON.stringify(proposalSlot),
        channel,
        agreedAt,
        notes,
      ]),
    tenant,
  );
}
async function proposed(db) {
  const requested = await command(db);
  const proposal = await command(db, {
    kind: 'propose',
    viewing: requested.viewingId,
    operation: id(1001),
  });
  return { requested, proposal };
}
function terminate(
  db,
  {
    viewing,
    user = AGENT,
    enquiry = E,
    operation = id(3000),
    expected = '2',
    kind = 'cancel',
    reason = END_REASON,
    tenant = T,
  } = {},
) {
  return actor(
    db,
    user,
    () =>
      scalar(db, 'SELECT app_api.terminate_viewing($1,$2,$3,$4,$5,$6)', [
        enquiry,
        viewing,
        operation,
        expected,
        kind,
        reason,
      ]),
    tenant,
  );
}
const savedHistory = (db, viewing, { user = AGENT, enquiry = E, tenant = T, limit = 25 } = {}) =>
  actor(
    db,
    user,
    () => scalar(db, 'SELECT app_api.read_viewing_history($1,$2,$3)', [enquiry, viewing, limit]),
    tenant,
  );

// Owner-seeded historical fixtures use the normal insert/update guards and constraints.
// They model already saved 2020 states; they are not a claim of past HTTP execution.
async function historicalConfirmed(db, { later = false, year = '2020' } = {}) {
  const viewing = id(9000),
    at = (day, time) => `${year}-01-0${day}T${time}:00.000Z`,
    firstSlot = slot(at(1, '09:00'), at(1, '10:00')),
    secondSlot = slot(at(2, '09:00'), at(2, '10:00')),
    receipts = [];
  const seed = async (kind, expected, payload, recordedAt) => {
    const result = await scalar(
        db,
        'SELECT app_private.viewing_snapshot(v) FROM app_private.viewings v WHERE id=$1',
        [viewing],
      ),
      operation = id(9001 + receipts.length),
      receipt = {
        operationId: operation,
        enquiryId: E,
        viewingId: viewing,
        actorId: AGENT,
        kind,
        expectedVersion: String(expected),
        observedVersion: String(expected),
        request: payload,
        outcome: 'applied',
        reason: null,
        result,
        completedAt: recordedAt,
      };
    await db.query(
      'INSERT INTO app_private.viewing_operations(tenant_id,operation_id,enquiry_id,requester_id,kind,target_viewing_id,viewing_id,expected_version,request_payload,receipt,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)',
      [
        T,
        operation,
        E,
        AGENT,
        kind,
        kind === 'request' ? null : viewing,
        viewing,
        expected,
        JSON.stringify(payload),
        JSON.stringify(receipt),
        recordedAt,
      ],
    );
    receipts.push(receipt);
    return receipt;
  };
  await db.query(
    "INSERT INTO app_private.viewings(tenant_id,id,enquiry_id,listing_id,requested_by_id,status,version,preferred_slots,notes,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'requested',1,'[]'::jsonb,$6,$7,$7)",
    [T, viewing, E, L, AGENT, NOTES, at(1, '07:00')],
  );
  await seed('request', 1, { listingId: L, preferredSlots: [], notes: NOTES }, at(1, '07:00'));
  await db.query(
    "UPDATE app_private.viewings SET status='proposed',version=2,proposed_slot=$2::jsonb,updated_at=$3 WHERE id=$1",
    [viewing, JSON.stringify(firstSlot), at(1, '08:00')],
  );
  await seed('propose', 1, { slot: firstSlot }, at(1, '08:00'));
  const firstAgreement = { channel: 'phone', agreedAt: at(1, '08:15'), notes: PHONE_NOTES };
  await db.query(
    "UPDATE app_private.viewings SET status='confirmed',version=3,phone_agreement=$2::jsonb,confirmed_by_id=$3,proposed_at=updated_at,confirmed_at=$4,updated_at=$4 WHERE id=$1",
    [viewing, JSON.stringify(firstAgreement), AGENT, at(1, '08:30')],
  );
  await seed('confirm', 2, { slot: firstSlot, ...firstAgreement }, at(1, '08:30'));
  if (later) {
    const cycle = {
      number: '2',
      proposalVersion: '4',
      slot: secondSlot,
      proposedAt: at(2, '08:00'),
      reason: 'Historical synthetic new slot.',
      previousStatus: 'confirmed',
      previousUpdatedAt: at(1, '08:30'),
      agreement: null,
      confirmedAt: null,
    };
    await db.query(
      "UPDATE app_private.viewings SET status='proposed',version=4,current_cycle=$2::jsonb,first_cycle_status=status,first_cycle_updated_at=updated_at,updated_at=$3 WHERE id=$1",
      [viewing, JSON.stringify(cycle), at(2, '08:00')],
    );
    await seed('reschedule', 3, { slot: secondSlot, reason: cycle.reason }, at(2, '08:00'));
    const agreement = {
      channel: 'phone',
      agreedAt: at(2, '08:15'),
      notes: 'Historical second-slot phone agreement.',
    };
    await db.query(
      "UPDATE app_private.viewings SET status='confirmed',version=5,current_cycle=$2::jsonb,cycle_confirmed_by_id=$3,updated_at=$4 WHERE id=$1",
      [
        viewing,
        JSON.stringify({ ...cycle, agreement, confirmedAt: at(2, '08:30') }),
        AGENT,
        at(2, '08:30'),
      ],
    );
    await seed('confirm', 4, { slot: secondSlot, ...agreement }, at(2, '08:30'));
  }
  return { viewing, receipts, occurredAt: at(later ? 2 : 1, '10:00'), expected: later ? '5' : '3' };
}
function attendance(
  db,
  {
    viewing,
    user = AGENT,
    enquiry = E,
    operation = id(10000),
    expected = '3',
    kind = 'complete',
    occurredAt = '2020-01-01T10:00:00.000Z',
    reason = '  Synthetic outcome reason.\nKeep exact.  ',
    tenant = T,
  } = {},
) {
  return actor(
    db,
    user,
    () =>
      scalar(db, 'SELECT app_api.record_viewing_outcome($1,$2,$3,$4,$5,$6,$7)', [
        enquiry,
        viewing,
        operation,
        expected,
        kind,
        occurredAt,
        reason,
      ]),
    tenant,
  );
}

test('stored completion preserves historical agreement and current detail clocks with exact immutable recovery', async () => {
  const db = await fixture();
  try {
    const f = await historicalConfirmed(db),
      before = await read(db, f.viewing),
      saved = await attendance(db, f);
    assert.equal(saved.result.status, 'completed');
    assert.equal(saved.result.version, '4');
    assert.deepEqual(saved.result.agreement, before.schedule.agreement);
    assert.equal(saved.result.outcome.previousUpdatedAt, before.updatedAt);
    assert.equal(saved.result.outcome.occurredAt, f.occurredAt);
    assert.equal(saved.result.outcome.recordedAt, saved.completedAt);
    validateViewingOutcomeReceipt(saved, E, f.viewing, 'complete', {
      operationId: id(10000),
      expectedVersion: f.expected,
      occurredAt: f.occurredAt,
      reason: saved.request.reason,
    });
    const current = await read(db, f.viewing);
    validateViewingDetail(current, E, f.viewing);
    assert.deepEqual(current.confirmation, before.confirmation);
    assert.equal(current.updatedAt, saved.completedAt);
    assert.deepEqual(current.outcomeRecord, { recordedById: AGENT });
    assert.equal(current.notes, NOTES);
    assert.deepEqual(await history(db, id(10000)), saved);
    assert.deepEqual(await attendance(db, f), saved);
    assert.equal((await totals(db)).enquiry_version, '1');
    const page = await savedHistory(db, f.viewing);
    validateViewingHistoryPage(page, E, f.viewing, 25);
    assert.equal(page.items.length, 4);
    assert.deepEqual(
      page.items.map((x) => x.kind),
      ['complete', 'confirm', 'propose', 'request'],
    );
    assert.deepEqual(page.items[1].schedule, f.receipts[2].result);
    assert.deepEqual(await history(db, f.receipts[2].operationId), f.receipts[2]);
  } finally {
    await db.close();
  }
});
test('stored no-show retains superseded and current cycle agreements and rejects later mutations', async () => {
  const db = await fixture();
  try {
    const f = await historicalConfirmed(db, { later: true }),
      before = await read(db, f.viewing),
      saved = await attendance(db, { ...f, kind: 'no_show' });
    validateViewingOutcomeReceipt(saved, E, f.viewing, 'no_show', {
      operationId: id(10000),
      expectedVersion: f.expected,
      occurredAt: f.occurredAt,
      reason: saved.request.reason,
    });
    validateViewingDetail(await read(db, f.viewing), E, f.viewing);
    assert.equal(saved.result.version, '6');
    assert.equal(saved.result.status, 'no_show');
    assert.deepEqual(saved.result.cycle, before.schedule.cycle);
    assert.deepEqual(saved.result.agreement, before.schedule.agreement);
    assert.deepEqual((await read(db, f.viewing)).confirmation, before.confirmation);
    const page = await savedHistory(db, f.viewing);
    validateViewingHistoryPage(page, E, f.viewing, 25);
    assert.equal(page.items.length, 6);
    assert.deepEqual(page.items[3].schedule.agreement, f.receipts[2].result.agreement);
    assert.deepEqual(page.items[1].schedule.agreement, f.receipts[4].result.agreement);
    assert.equal(
      (await attendance(db, { ...f, kind: 'complete', expected: '6', operation: id(10001) }))
        .reason,
      'INVALID_STATE',
    );
    assert.equal(
      (await terminate(db, { viewing: f.viewing, expected: '6' })).reason,
      'INVALID_STATE',
    );
    assert.equal(
      (await reschedule(db, { viewing: f.viewing, expected: '6' })).reason,
      'INVALID_STATE',
    );
  } finally {
    await db.close();
  }
});
test('attendance stale-first and unconfirmed or future-slot refusals are durable and do not infer attendance', async () => {
  const db = await fixture();
  try {
    const { requested, proposal } = await proposed(db),
      viewing = requested.viewingId;
    assert.equal((await attendance(db, { viewing, expected: '1' })).reason, 'VERSION_CONFLICT');
    assert.equal(
      (await attendance(db, { viewing, expected: '2', operation: id(10001) })).reason,
      'INVALID_STATE',
    );
    await confirmation(db, { viewing, agreedAt: proposal.completedAt });
    const refused = await attendance(db, { viewing, operation: id(10002) });
    assert.equal(refused.reason, 'SLOT_NOT_ENDED');
    assert.equal(refused.result, null);
    assert.deepEqual(await attendance(db, { viewing, operation: id(10002) }), refused);
    assert.equal((await read(db, viewing)).schedule.status, 'confirmed');
  } finally {
    await db.close();
  }
});
test('attendance occurrence bounds and record clock refusals remain saved decisions without state changes', async () => {
  const db = await fixture();
  try {
    const f = await historicalConfirmed(db);
    const before = await attendance(db, { ...f, occurredAt: '2020-01-01T09:59:59.999Z' }),
      future = await attendance(db, {
        ...f,
        operation: id(10001),
        occurredAt: '2090-01-01T10:00:00.000Z',
      });
    assert.equal(before.reason, 'OUTCOME_BEFORE_SLOT_END');
    assert.equal(future.reason, 'OUTCOME_IN_FUTURE');
    assert.deepEqual(
      await attendance(db, { ...f, occurredAt: '2020-01-01T09:59:59.999Z' }),
      before,
    );
    assert.equal((await read(db, f.viewing)).schedule.version, '3');
  } finally {
    await db.close();
  }
  const futureDb = await fixture();
  try {
    const f = await historicalConfirmed(futureDb, { year: '2089' });
    assert.equal((await attendance(futureDb, f)).reason, 'RECORD_TIME_IN_FUTURE');
  } finally {
    await futureDb.close();
  }
});
test('attendance current role company assignment and requester-private receipt guards survive access restoration', async () => {
  const db = await fixture();
  try {
    const f = await historicalConfirmed(db),
      before = await totals(db);
    for (const user of [CUSTOMER, PEER]) await assert.rejects(() => attendance(db, { ...f, user }));
    await denied(() => attendance(db, { ...f, user: OTHERADMIN, tenant: OTHER }), 'P0002');
    assert.deepEqual(await totals(db), before);
    const saved = await attendance(db, f);
    await denied(() => history(db, id(10000), ADMIN), 'P0002');
    await denied(() => attendance(db, { ...f, user: ADMIN }), '40001');
    await db.query('UPDATE app_private.enquiries SET assigned_agent_id=$1 WHERE id=$2', [PEER, E]);
    await denied(() => attendance(db, f), 'P0002');
    await denied(() => history(db, id(10000)), 'P0002');
    await denied(() => savedHistory(db, f.viewing), 'P0002');
    await db.query('UPDATE app_private.enquiries SET assigned_agent_id=$1 WHERE id=$2', [AGENT, E]);
    assert.deepEqual(await attendance(db, f), saved);
  } finally {
    await db.close();
  }
});
test('attendance exact operation identity binds kind target original version occurrence and raw reason', async () => {
  const db = await fixture();
  try {
    const f = await historicalConfirmed(db),
      saved = await attendance(db, f);
    for (const patch of [
      { kind: 'no_show' },
      { expected: '4' },
      { reason: 'Changed' },
      { occurredAt: '2020-01-01T10:01:00.000Z' },
    ])
      await denied(() => attendance(db, { ...f, ...patch }), '40001');
    await denied(
      () => terminate(db, { viewing: f.viewing, operation: id(10000), expected: '3' }),
      '40001',
    );
    await denied(() => attendance(db, { ...f, operation: f.receipts[2].operationId }), '40001');
    assert.deepEqual(await history(db, id(10000)), saved);
  } finally {
    await db.close();
  }
});
test('attendance cleanup remains possible after closure and withdrawn stock and audit excludes private reason', async () => {
  const db = await fixture();
  try {
    const f = await historicalConfirmed(db);
    await db.query(
      "UPDATE app_private.enquiries SET status='closed_lost',closure_reason='Synthetic closure' WHERE id=$1",
      [E],
    );
    await db.query(
      "UPDATE app_private.listings SET publication_status='paused',availability='withdrawn' WHERE id=$1",
      [L],
    );
    const before = await totals(db),
      saved = await attendance(db, f);
    assert.equal(saved.outcome, 'applied');
    assert.deepEqual(await attendance(db, f), saved);
    const events = (
      await db.query(
        "SELECT to_jsonb(a) value FROM app_private.audit_events a WHERE object_type='viewing'",
      )
    ).rows;
    assert.equal(events.length, 1);
    assert.equal(JSON.stringify(events).includes(saved.request.reason), false);
    assert.equal((await totals(db)).enquiry_version, before.enquiry_version);
  } finally {
    await db.close();
  }
});
test('attendance evidence cannot be edited erased rewritten or directly read and changed by runtime', async () => {
  const db = await fixture();
  try {
    const f = await historicalConfirmed(db);
    await attendance(db, f);
    for (const sql of [
      "UPDATE app_private.viewings SET outcome_reason='Changed' WHERE id=$1",
      'UPDATE app_private.viewings SET outcome_kind=NULL WHERE id=$1',
      "UPDATE app_private.viewings SET status='confirmed',version=3 WHERE id=$1",
      'UPDATE app_private.viewings SET phone_agreement=NULL WHERE id=$1',
      'DELETE FROM app_private.viewings WHERE id=$1',
    ])
      await assert.rejects(() => db.query(sql, [f.viewing]));
    await denied(
      () => actor(db, AGENT, () => db.query('SELECT outcome_reason FROM app_private.viewings')),
      '42501',
    );
    await denied(
      () => actor(db, AGENT, () => db.query('UPDATE app_private.viewings SET outcome_kind=NULL')),
      '42501',
    );
    assert.equal((await read(db, f.viewing)).schedule.status, 'completed');
  } finally {
    await db.close();
  }
});
test('malformed attendance commands reserve no operation and maximum raw Unicode evidence survives', async () => {
  const db = await fixture();
  try {
    const f = await historicalConfirmed(db),
      before = await totals(db);
    for (const patch of [
      { expected: null },
      { expected: '9007199254740991' },
      { kind: 'completed' },
      { occurredAt: null },
      { occurredAt: '2020-01-01T10:00:00.000001Z' },
      { reason: ' ' },
      { reason: '😀'.repeat(1001) },
    ])
      await assert.rejects(() => attendance(db, { ...f, ...patch }));
    assert.deepEqual(await totals(db), before);
    const saved = await attendance(db, { ...f, reason: '😀'.repeat(1000) });
    assert.equal([...saved.result.outcome.reason].length, 1000);
    assert.deepEqual(await attendance(db, { ...f, reason: '😀'.repeat(1000) }), saved);
  } finally {
    await db.close();
  }
});
test('attendance audit and receipt insertion failures roll back evidence state and operation identity together', async () => {
  const db = await fixture();
  try {
    const f = await historicalConfirmed(db),
      before = await totals(db);
    await db.exec(
      "CREATE FUNCTION app_private.fail_attendance_test() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Synthetic transaction failure';END$$;",
    );
    for (const table of ['audit_events', 'viewing_operations']) {
      await db.exec(
        'CREATE TRIGGER fail_attendance_test BEFORE INSERT ON app_private.' +
          table +
          ' FOR EACH ROW EXECUTE FUNCTION app_private.fail_attendance_test()',
      );
      await assert.rejects(() => attendance(db, f));
      await db.exec('DROP TRIGGER fail_attendance_test ON app_private.' + table);
      assert.deepEqual(await totals(db), before);
      assert.equal((await read(db, f.viewing)).schedule.version, '3');
    }
    assert.equal((await attendance(db, f)).outcome, 'applied');
  } finally {
    await db.close();
  }
});
test('current staff history reads immutable applied snapshots through cancellation without original command IDs or writes', async () => {
  const db = await fixture();
  try {
    const { requested, proposal } = await proposed(db),
      confirmed = await confirmation(db, {
        viewing: requested.viewingId,
        agreedAt: proposal.completedAt,
      }),
      ended = await terminate(db, { viewing: requested.viewingId, expected: '3' });
    await terminate(db, { viewing: requested.viewingId, operation: id(3001), expected: '3' });
    const before = await totals(db),
      page = await savedHistory(db, requested.viewingId, { user: ADMIN });
    validateViewingHistoryPage(page, E, requested.viewingId, 25);
    assert.equal(page.currentVersion, '4');
    assert.deepEqual(
      page.items.map((x) => x.schedule),
      [ended.result, confirmed.result, proposal.result, requested.result],
    );
    assert.deepEqual(
      page.items.map((x) => x.kind),
      ['cancel', 'confirm', 'propose', 'request'],
    );
    assert.equal(page.items[0].actorId, AGENT);
    assert.deepEqual(
      page.items.map((x) => x.recordedAt),
      [ended.completedAt, confirmed.completedAt, proposal.completedAt, requested.completedAt],
    );
    assert.ok(
      page.items.every((x) => !Object.hasOwn(x, 'operationId') && !Object.hasOwn(x, 'request')),
    );
    assert.deepEqual(await totals(db), before);
    await denied(() => history(db, id(3000), ADMIN), 'P0002');
  } finally {
    await db.close();
  }
});
test('saved viewing history has canonical bounded newest versions and excludes refused or conflicted commands', async () => {
  const db = await fixture();
  try {
    const { requested } = await proposed(db);
    await terminate(db, { viewing: requested.viewingId });
    await terminate(db, { viewing: requested.viewingId, expected: '3', operation: id(3001) });
    const page = await savedHistory(db, requested.viewingId, { limit: 2 });
    validateViewingHistoryPage(page, E, requested.viewingId, 2);
    assert.equal(page.truncated, true);
    assert.deepEqual(
      page.items.map((x) => x.schedule.version),
      ['3', '2'],
    );
    for (const limit of [0, 26, null])
      await denied(() => savedHistory(db, requested.viewingId, { limit }), '23514');
    assert.equal((await savedHistory(db, requested.viewingId)).items.length, 3);
  } finally {
    await db.close();
  }
});
test('viewing history enforces current company role assignment and revocation independently of original requester', async () => {
  const db = await fixture();
  try {
    const requested = await command(db);
    for (const user of [PEER, CUSTOMER])
      await denied(
        () => savedHistory(db, requested.viewingId, { user }),
        user === CUSTOMER ? '42501' : 'P0002',
      );
    await denied(
      () => savedHistory(db, requested.viewingId, { user: OTHERADMIN, tenant: OTHER }),
      'P0002',
    );
    await db.query('UPDATE app_private.enquiries SET assigned_agent_id=$1 WHERE id=$2', [PEER, E]);
    await denied(() => savedHistory(db, requested.viewingId), 'P0002');
    assert.equal(
      (await savedHistory(db, requested.viewingId, { user: PEER })).items[0].actorId,
      AGENT,
    );
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [T, PEER],
    );
    await denied(() => savedHistory(db, requested.viewingId, { user: PEER }), '42501');
  } finally {
    await db.close();
  }
});
test('viewing history remains readable for closed or unavailable stock and never grants direct ledger privileges', async () => {
  const db = await fixture();
  try {
    const { requested } = await proposed(db);
    await db.query(
      "UPDATE app_private.enquiries SET status='closed_lost',closure_reason='Synthetic closure' WHERE id=$1",
      [E],
    );
    await db.query(
      "UPDATE app_private.listings SET publication_status='paused',availability='withdrawn' WHERE id=$1",
      [L],
    );
    const before = await totals(db);
    assert.equal((await savedHistory(db, requested.viewingId)).items.length, 2);
    await denied(
      () => actor(db, AGENT, () => db.query('SELECT * FROM app_private.viewing_operations')),
      '42501',
    );
    await denied(() => savedHistory(db, id(9999)), 'P0002');
    await denied(() => savedHistory(db, requested.viewingId, { enquiry: GENERAL }), 'P0002');
    assert.deepEqual(await totals(db), before);
  } finally {
    await db.close();
  }
});
test('reasoned cancellation preserves confirmed phone evidence and all original receipts without enquiry mutation', async () => {
  const db = await fixture();
  try {
    const { requested, proposal } = await proposed(db),
      confirmed = await confirmation(db, {
        viewing: requested.viewingId,
        agreedAt: proposal.completedAt,
      }),
      before = await read(db, requested.viewingId);
    const receipt = await terminate(db, { viewing: requested.viewingId, expected: '3' });
    assert.equal(receipt.result.status, 'cancelled');
    assert.equal(receipt.result.version, '4');
    assert.equal(receipt.result.termination.reason, END_REASON);
    assert.equal(receipt.result.termination.fromStatus, 'confirmed');
    assert.equal(receipt.result.termination.previousUpdatedAt, confirmed.completedAt);
    validateViewingTerminationReceipt(receipt, E, requested.viewingId, 'cancel', {
      operationId: id(3000),
      expectedVersion: '3',
      reason: END_REASON,
    });
    const after = await read(db, requested.viewingId);
    validateViewingDetail(after, E);
    assert.deepEqual(after.schedule.agreement, before.schedule.agreement);
    assert.deepEqual(after.confirmation, before.confirmation);
    assert.equal(after.notes, before.notes);
    assert.equal(after.terminationRecord.recordedById, AGENT);
    assert.deepEqual(await history(db), requested);
    assert.deepEqual(await history(db, id(1001)), proposal);
    assert.deepEqual(await history(db, id(2000)), confirmed);
    assert.deepEqual(await history(db, id(3000)), receipt);
    assert.deepEqual(await command(db), requested);
    assert.deepEqual(
      await command(db, { kind: 'propose', viewing: requested.viewingId, operation: id(1001) }),
      proposal,
    );
    assert.deepEqual(
      await confirmation(db, { viewing: requested.viewingId, agreedAt: proposal.completedAt }),
      confirmed,
    );
    assert.deepEqual(await totals(db), {
      viewings: 1,
      operations: 4,
      audits: 4,
      enquiry_version: '1',
    });
    const audits = await db.query(
      "SELECT summary FROM app_private.audit_events WHERE object_type='viewing'",
    );
    assert.ok(
      audits.rows.every(
        (x) =>
          !JSON.stringify(x.summary).includes(END_REASON) && !Object.hasOwn(x.summary, 'reason'),
      ),
    );
  } finally {
    await db.close();
  }
});
test('cancellation remains possible for closed enquiry and paused unavailable listing and exact terminal replay stays original', async () => {
  const db = await fixture();
  try {
    const { requested } = await proposed(db),
      options = { viewing: requested.viewingId };
    await db.query(
      "UPDATE app_private.enquiries SET status='closed_lost',closure_reason='Synthetic closed' WHERE tenant_id=$1 AND id=$2",
      [T, E],
    );
    await db.query(
      "UPDATE app_private.listings SET publication_status='paused',availability='withdrawn' WHERE tenant_id=$1 AND id=$2",
      [T, L],
    );
    const receipt = await terminate(db, options);
    assert.equal(receipt.outcome, 'applied');
    assert.deepEqual(await terminate(db, options), receipt);
    assert.deepEqual(await history(db, id(3000)), receipt);
    await denied(() => terminate(db, { ...options, reason: 'Changed history.' }), '40001');
    await denied(() => terminate(db, { ...options, kind: 'decline' }), '40001');
    await denied(() => terminate(db, { ...options, user: ADMIN }), '40001');
  } finally {
    await db.close();
  }
});
test('decline is allowed before confirmation and cannot erase a recorded phone agreement', async () => {
  const db = await fixture();
  try {
    const requested = await command(db),
      declined = await terminate(db, {
        viewing: requested.viewingId,
        expected: '1',
        kind: 'decline',
      });
    assert.equal(declined.result.status, 'declined');
    assert.equal(declined.result.version, '2');
    assert.equal(declined.result.proposedSlot, null);
    const second = await command(db, { operation: id(1010) }),
      proposal = await command(db, {
        kind: 'propose',
        viewing: second.viewingId,
        operation: id(1011),
      }),
      confirmed = await confirmation(db, {
        viewing: second.viewingId,
        agreedAt: proposal.completedAt,
      });
    const refused = await terminate(db, {
      viewing: second.viewingId,
      operation: id(3001),
      kind: 'decline',
      expected: '3',
    });
    assert.equal(refused.reason, 'INVALID_STATE');
    assert.equal(refused.result, null);
    assert.deepEqual((await read(db, second.viewingId)).schedule, confirmed.result);
  } finally {
    await db.close();
  }
});
test('stale terminal attempts and repeated new termination decisions are durable without another mutation', async () => {
  const db = await fixture();
  try {
    const { requested } = await proposed(db),
      stale = await terminate(db, { viewing: requested.viewingId, expected: '1' });
    assert.equal(stale.reason, 'VERSION_CONFLICT');
    assert.equal(stale.result, null);
    const ended = await terminate(db, { viewing: requested.viewingId, operation: id(3001) });
    assert.equal(ended.result.version, '3');
    assert.deepEqual(await terminate(db, { viewing: requested.viewingId, expected: '1' }), stale);
    const again = await terminate(db, {
      viewing: requested.viewingId,
      operation: id(3002),
      expected: '3',
    });
    assert.equal(again.reason, 'INVALID_STATE');
    assert.equal((await read(db, requested.viewingId)).schedule.version, '3');
    assert.equal((await totals(db)).audits, 3);
  } finally {
    await db.close();
  }
});
test('terminal receipts and reads enforce current assignment,company,active role and original requester', async () => {
  const db = await fixture();
  try {
    const { requested } = await proposed(db),
      options = { viewing: requested.viewingId };
    for (const user of [PEER, CUSTOMER, OTHERADMIN])
      await assert.rejects(() => terminate(db, { ...options, user }));
    await denied(() => terminate(db, { ...options, enquiry: GENERAL }), 'P0002');
    await denied(() => terminate(db, { ...options, user: OTHERADMIN, tenant: OTHER }), 'P0002');
    const receipt = await terminate(db, options);
    await denied(() => history(db, id(3000), ADMIN), 'P0002');
    await db.query(
      'UPDATE app_private.enquiries SET assigned_agent_id=$1 WHERE tenant_id=$2 AND id=$3',
      [PEER, T, E],
    );
    await denied(() => history(db, id(3000)), 'P0002');
    await denied(() => terminate(db, options), 'P0002');
    assert.equal((await read(db, requested.viewingId, PEER)).schedule.status, 'cancelled');
    await db.query(
      'UPDATE app_private.enquiries SET assigned_agent_id=$1 WHERE tenant_id=$2 AND id=$3',
      [AGENT, T, E],
    );
    assert.deepEqual(await terminate(db, options), receipt);
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [T, AGENT],
    );
    await assert.rejects(() => history(db, id(3000)));
  } finally {
    await db.close();
  }
});
test('terminal reason,state,ending metadata and original evidence cannot be edited,reverted or deleted', async () => {
  const db = await fixture();
  try {
    const { requested } = await proposed(db);
    await terminate(db, { viewing: requested.viewingId });
    for (const sql of [
      "UPDATE app_private.viewings SET termination_reason='Changed' WHERE id=$1",
      "UPDATE app_private.viewings SET status='proposed',version=2 WHERE id=$1",
      "UPDATE app_private.viewings SET previous_updated_at=previous_updated_at-interval '1 second' WHERE id=$1",
      'DELETE FROM app_private.viewings WHERE id=$1',
    ])
      await denied(() => db.query(sql, [requested.viewingId]), '23514');
    await denied(
      () =>
        actor(db, AGENT, () =>
          db.query("UPDATE app_private.viewings SET termination_reason='Changed' WHERE id=$1", [
            requested.viewingId,
          ]),
        ),
      '42501',
    );
  } finally {
    await db.close();
  }
});
test('invalid terminal commands reserve no ledger entry and existing operation kind cannot be replaced', async () => {
  const db = await fixture();
  try {
    const { requested } = await proposed(db),
      options = { viewing: requested.viewingId },
      before = await totals(db);
    for (const patch of [
      { reason: null },
      { reason: ' ' },
      { reason: '😀'.repeat(1001) },
      { kind: 'delete' },
      { kind: null },
      { expected: null },
      { expected: '9007199254740991' },
    ])
      await denied(() => terminate(db, { ...options, ...patch }), '23514');
    await denied(() => terminate(db, { ...options, operation: id(1000) }), '40001');
    assert.deepEqual(await totals(db), before);
    const max = await terminate(db, { ...options, reason: '😀'.repeat(1000) });
    assert.equal([...max.request.reason].length, 1000);
  } finally {
    await db.close();
  }
});
test('historical proposed slot can be explicitly cancelled after its start without changing its saved time', async () => {
  const db = await fixture();
  try {
    const viewing = id(9001),
      oldSlot = slot('2001-01-01T09:00:00.000Z', '2001-01-01T10:00:00.000Z');
    await db.query(
      "INSERT INTO app_private.viewings(tenant_id,id,enquiry_id,listing_id,requested_by_id,status,version,preferred_slots,notes,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'requested',1,'[]',$6,'2000-01-01T00:00:00Z','2000-01-01T00:00:00Z')",
      [T, viewing, E, L, AGENT, NOTES],
    );
    await db.query(
      "UPDATE app_private.viewings SET status='proposed',version=2,proposed_slot=$1::jsonb,updated_at='2000-01-02T00:00:00Z' WHERE tenant_id=$2 AND id=$3",
      [JSON.stringify(oldSlot), T, viewing],
    );
    const receipt = await terminate(db, { viewing });
    assert.equal(receipt.outcome, 'applied');
    assert.deepEqual(receipt.result.proposedSlot, oldSlot);
    const detail = await read(db, viewing);
    validateViewingDetail(detail, E);
    assert.equal(detail.schedule.status, 'cancelled');
  } finally {
    await db.close();
  }
});
test('requested cancellation and proposed decline retain distinct prior stages and exact original times', async () => {
  const db = await fixture();
  try {
    const requested = await command(db),
      cancelled = await terminate(db, { viewing: requested.viewingId, expected: '1' });
    assert.equal(cancelled.result.status, 'cancelled');
    assert.equal(cancelled.result.version, '2');
    assert.equal(cancelled.result.proposedSlot, null);
    assert.equal(cancelled.result.termination.previousUpdatedAt, requested.completedAt);
    validateViewingDetail(await read(db, requested.viewingId), E);
    const second = await command(db, { operation: id(1010) }),
      proposal = await command(db, {
        kind: 'propose',
        viewing: second.viewingId,
        operation: id(1011),
      }),
      declined = await terminate(db, {
        viewing: second.viewingId,
        operation: id(3001),
        kind: 'decline',
      });
    assert.equal(declined.result.status, 'declined');
    assert.equal(declined.result.version, '3');
    assert.deepEqual(declined.result.proposedSlot, proposal.result.proposedSlot);
    assert.equal(declined.result.termination.previousUpdatedAt, proposal.completedAt);
    validateViewingDetail(await read(db, second.viewingId), E);
  } finally {
    await db.close();
  }
});
test('future saved-record clock refuses terminal mutation and retains its original refusal receipt', async () => {
  const db = await fixture();
  try {
    const viewing = id(9002);
    await db.query(
      "INSERT INTO app_private.viewings(tenant_id,id,enquiry_id,listing_id,requested_by_id,status,version,preferred_slots,notes,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'requested',1,'[]',$6,'2090-01-01T00:00:00Z','2090-01-01T00:00:00Z')",
      [T, viewing, E, L, AGENT, NOTES],
    );
    const receipt = await terminate(db, { viewing, expected: '1' });
    assert.equal(receipt.reason, 'RECORD_TIME_IN_FUTURE');
    assert.equal(receipt.result, null);
    assert.equal((await read(db, viewing)).schedule.status, 'requested');
    assert.deepEqual(await history(db, id(3000)), receipt);
  } finally {
    await db.close();
  }
});

test('phone agreement confirms only exact proposal and retains private attributable evidence and historical originals', async () => {
  const db = await fixture();
  try {
    const { requested, proposal } = await proposed(db),
      agreedAt = proposal.completedAt,
      receipt = await confirmation(db, { viewing: requested.viewingId, agreedAt });
    assert.equal(receipt.outcome, 'applied');
    assert.equal(receipt.kind, 'confirm');
    assert.equal(receipt.result.status, 'confirmed');
    assert.equal(receipt.result.version, '3');
    assert.equal(receipt.result.agreement.notes, PHONE_NOTES);
    validateViewingConfirmationReceipt(receipt, E, requested.viewingId, {
      operationId: id(2000),
      expectedVersion: '2',
      slot: slot(),
      channel: 'phone',
      agreedAt,
      notes: PHONE_NOTES,
    });
    const detail = await read(db, requested.viewingId);
    validateViewingDetail(detail, E, requested.viewingId);
    assert.equal(detail.confirmation.recordedById, AGENT);
    assert.equal(detail.confirmation.proposedAt, proposal.completedAt);
    assert.equal(detail.confirmation.recordedAt, receipt.completedAt);
    assert.equal(detail.notes, NOTES);
    assert.deepEqual(await history(db), requested);
    assert.deepEqual(await history(db, id(1001)), proposal);
    assert.deepEqual(await history(db, id(2000)), receipt);
    assert.deepEqual(await command(db), requested);
    assert.deepEqual(
      await command(db, { kind: 'propose', viewing: requested.viewingId, operation: id(1001) }),
      proposal,
    );
    assert.deepEqual(await totals(db), {
      viewings: 1,
      operations: 3,
      audits: 3,
      enquiry_version: '1',
    });
    const audits = await db.query(
      "SELECT summary FROM app_private.audit_events WHERE object_type='viewing'",
    );
    assert.ok(
      audits.rows.every(
        (x) =>
          !JSON.stringify(x.summary).includes('evidence') &&
          !JSON.stringify(x.summary).includes('Preserve'),
      ),
    );
  } finally {
    await db.close();
  }
});
test('phone confirmation original replay survives later closure and listing pause but changed facts/requester conflict', async () => {
  const db = await fixture();
  try {
    const { requested, proposal } = await proposed(db),
      options = { viewing: requested.viewingId, agreedAt: proposal.completedAt },
      receipt = await confirmation(db, options);
    await db.query(
      "UPDATE app_private.enquiries SET status='closed_lost',closure_reason='Synthetic closure' WHERE tenant_id=$1 AND id=$2",
      [T, E],
    );
    await db.query(
      "UPDATE app_private.listings SET publication_status='paused' WHERE tenant_id=$1 AND id=$2",
      [T, L],
    );
    assert.deepEqual(await confirmation(db, options), receipt);
    assert.deepEqual(await history(db, id(2000)), receipt);
    await denied(() => confirmation(db, { ...options, notes: 'Changed agreement.' }), '40001');
    await denied(() => confirmation(db, { ...options, user: ADMIN }), '40001');
    await denied(
      () => command(db, { kind: 'propose', viewing: requested.viewingId, operation: id(2000) }),
      '40001',
    );
  } finally {
    await db.close();
  }
});
test('stale and invalid-state confirmation decisions are durable and never create an agreement', async () => {
  const db = await fixture();
  try {
    const requested = await command(db),
      initial = await confirmation(db, { viewing: requested.viewingId, expected: '1' });
    assert.equal(initial.reason, 'INVALID_STATE');
    assert.equal(initial.result, null);
    const proposal = await command(db, {
      kind: 'propose',
      viewing: requested.viewingId,
      operation: id(1001),
    });
    assert.deepEqual(
      await confirmation(db, {
        viewing: requested.viewingId,
        expected: '1',
        agreedAt: initial.request.agreedAt,
      }),
      initial,
    );
    const stale = await confirmation(db, {
      viewing: requested.viewingId,
      operation: id(2001),
      expected: '1',
    });
    assert.equal(stale.reason, 'VERSION_CONFLICT');
    assert.equal(stale.observedVersion, '2');
    const applied = await confirmation(db, {
      viewing: requested.viewingId,
      operation: id(2002),
      agreedAt: proposal.completedAt,
    });
    assert.equal(applied.result.version, '3');
    const again = await confirmation(db, {
      viewing: requested.viewingId,
      operation: id(2003),
      expected: '3',
    });
    assert.equal(again.reason, 'INVALID_STATE');
    assert.equal((await read(db, requested.viewingId)).schedule.agreement.notes, PHONE_NOTES);
  } finally {
    await db.close();
  }
});
test('changed slot,agreement before proposal and future agreement are durable refusals with no viewing mutation', async () => {
  const db = await fixture();
  try {
    const { requested, proposal } = await proposed(db),
      before = await read(db, requested.viewingId),
      changed = slot('2090-01-01T10:00:00.000Z', '2090-01-01T11:00:00.000Z');
    const mismatch = await confirmation(db, {
      viewing: requested.viewingId,
      proposalSlot: changed,
    });
    assert.equal(mismatch.reason, 'PROPOSED_SLOT_MISMATCH');
    const early = await confirmation(db, {
      viewing: requested.viewingId,
      operation: id(2001),
      agreedAt: new Date(Date.parse(proposal.completedAt) - 1).toISOString(),
    });
    assert.equal(early.reason, 'AGREEMENT_BEFORE_PROPOSAL');
    const future = await confirmation(db, {
      viewing: requested.viewingId,
      operation: id(2002),
      agreedAt: '2080-01-01T00:00:00.000Z',
    });
    assert.equal(future.reason, 'AGREEMENT_IN_FUTURE');
    assert.equal(future.result, null);
    assert.deepEqual(await read(db, requested.viewingId), before);
    assert.deepEqual(await history(db, id(2002)), future);
  } finally {
    await db.close();
  }
});
test('phone confirmation enforces current staff assignment and requester-private recovery without consuming denied operations', async () => {
  const db = await fixture();
  try {
    const { requested, proposal } = await proposed(db),
      options = { viewing: requested.viewingId, agreedAt: proposal.completedAt };
    for (const user of [PEER, CUSTOMER, OTHERADMIN])
      await assert.rejects(() => confirmation(db, { ...options, user }));
    await denied(() => confirmation(db, { ...options, enquiry: GENERAL }), 'P0002');
    await denied(() => confirmation(db, { ...options, tenant: OTHER, user: OTHERADMIN }), 'P0002');
    const receipt = await confirmation(db, options);
    await denied(() => history(db, id(2000), ADMIN), 'P0002');
    await db.query(
      'UPDATE app_private.enquiries SET assigned_agent_id=$1 WHERE tenant_id=$2 AND id=$3',
      [PEER, T, E],
    );
    await denied(() => confirmation(db, options), 'P0002');
    await denied(() => history(db, id(2000)), 'P0002');
    assert.equal((await read(db, requested.viewingId, PEER)).schedule.status, 'confirmed');
    await db.query(
      'UPDATE app_private.enquiries SET assigned_agent_id=$1 WHERE tenant_id=$2 AND id=$3',
      [AGENT, T, E],
    );
    assert.deepEqual(await confirmation(db, options), receipt);
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [T, AGENT],
    );
    await assert.rejects(() => confirmation(db, options));
  } finally {
    await db.close();
  }
});
test('confirmation evidence and confirmed slot remain immutable and runtime cannot write tables', async () => {
  const db = await fixture();
  try {
    const { requested, proposal } = await proposed(db);
    await confirmation(db, { viewing: requested.viewingId, agreedAt: proposal.completedAt });
    for (const sql of [
      "UPDATE app_private.viewings SET phone_agreement=jsonb_set(phone_agreement,'{notes}','\"Changed\"') WHERE id=$1",
      "UPDATE app_private.viewings SET status='proposed',version=2 WHERE id=$1",
      'DELETE FROM app_private.viewings WHERE id=$1',
    ])
      await denied(() => db.query(sql, [requested.viewingId]), '23514');
    await denied(
      () =>
        actor(db, AGENT, () =>
          db.query('UPDATE app_private.viewings SET version=version+1 WHERE id=$1', [
            requested.viewingId,
          ]),
        ),
      '42501',
    );
    await denied(
      () => actor(db, AGENT, () => db.query('SELECT * FROM app_private.viewing_operations')),
      '42501',
    );
  } finally {
    await db.close();
  }
});
test('malformed phone agreement arguments fail before ledger reservation and existing operation IDs cannot change kind', async () => {
  const db = await fixture();
  try {
    const { requested } = await proposed(db),
      options = { viewing: requested.viewingId },
      before = await totals(db);
    for (const patch of [
      { channel: 'email' },
      { channel: null },
      { notes: ' ' },
      { notes: 'x'.repeat(2001) },
      { agreedAt: null },
      { expected: null },
      { expected: '9007199254740991' },
      { proposalSlot: { ...slot(), confirmed: true } },
    ])
      await denied(() => confirmation(db, { ...options, ...patch }), '23514');
    await denied(() => confirmation(db, { ...options, operation: id(1000) }), '40001');
    assert.deepEqual(await totals(db), before);
  } finally {
    await db.close();
  }
});
test('new confirmations refuse unavailable listing and closed enquiry while retaining durable no-mutation decisions', async () => {
  const db = await fixture();
  try {
    const { requested, proposal } = await proposed(db),
      options = { viewing: requested.viewingId, agreedAt: proposal.completedAt };
    await db.query(
      "UPDATE app_private.listings SET publication_status='paused' WHERE tenant_id=$1 AND id=$2",
      [T, L],
    );
    const unavailable = await confirmation(db, options);
    assert.equal(unavailable.reason, 'LISTING_UNAVAILABLE');
    assert.equal(unavailable.result, null);
    await db.query(
      "UPDATE app_private.listings SET publication_status='published' WHERE tenant_id=$1 AND id=$2",
      [T, L],
    );
    assert.deepEqual(await confirmation(db, options), unavailable);
    await db.query(
      "UPDATE app_private.enquiries SET status='closed_lost',closure_reason='Synthetic closed' WHERE tenant_id=$1 AND id=$2",
      [T, E],
    );
    const closed = await confirmation(db, { ...options, operation: id(2001) });
    assert.equal(closed.reason, 'ENQUIRY_CLOSED');
    assert.equal((await read(db, requested.viewingId)).schedule.status, 'proposed');
    assert.equal((await totals(db)).audits, 2);
  } finally {
    await db.close();
  }
});
test('historical proposed slot cannot be newly confirmed after its start time', async () => {
  const db = await fixture();
  try {
    const viewing = id(9000),
      oldSlot = slot('2001-01-01T09:00:00.000Z', '2001-01-01T10:00:00.000Z');
    await db.query(
      "INSERT INTO app_private.viewings(tenant_id,id,enquiry_id,listing_id,requested_by_id,status,version,preferred_slots,notes,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'requested',1,'[]',$6,'2000-01-01T00:00:00Z','2000-01-01T00:00:00Z')",
      [T, viewing, E, L, AGENT, NOTES],
    );
    await db.query(
      "UPDATE app_private.viewings SET status='proposed',version=2,proposed_slot=$1::jsonb,updated_at='2000-01-02T00:00:00Z' WHERE tenant_id=$2 AND id=$3",
      [JSON.stringify(oldSlot), T, viewing],
    );
    const refused = await confirmation(db, {
      viewing,
      proposalSlot: oldSlot,
      agreedAt: '2000-01-03T00:00:00.000Z',
    });
    assert.equal(refused.reason, 'SLOT_NOT_FUTURE');
    assert.equal(refused.result, null);
    assert.equal((await read(db, viewing)).schedule.status, 'proposed');
  } finally {
    await db.close();
  }
});

test('request and first proposal are private,attributable and independent of enquiry version', async () => {
  const db = await fixture();
  try {
    const requested = await command(db);
    assert.equal(requested.outcome, 'applied');
    assert.equal(requested.actorId, AGENT);
    assert.equal(requested.result.status, 'requested');
    assert.equal(requested.result.version, '1');
    assert.equal(requested.result.proposedSlot, null);
    validateViewingSchedule(requested.result);
    const proposed = await command(db, {
      kind: 'propose',
      viewing: requested.viewingId,
      operation: id(1001),
    });
    assert.equal(proposed.result.status, 'proposed');
    assert.equal(proposed.result.version, '2');
    assert.deepEqual(proposed.result.proposedSlot, slot());
    validateViewingSchedule(proposed.result);
    const detail = await read(db, requested.viewingId, ADMIN);
    assert.equal(detail.notes, NOTES);
    assert.equal(detail.requestedById, AGENT);
    assert.equal(detail.assignedAgentId, AGENT);
    assert.equal(detail.schedule.version, '2');
    assert.equal(Object.hasOwn(detail.schedule, 'confirmedSlot'), false);
    assert.deepEqual(await totals(db), {
      viewings: 1,
      operations: 2,
      audits: 2,
      enquiry_version: '1',
    });
    const audits = await db.query(
      "SELECT summary FROM app_private.audit_events WHERE object_type='viewing'",
    );
    assert.ok(
      audits.rows.every(
        (x) => !JSON.stringify(x).includes('Preserve') && !Object.hasOwn(x.summary, 'notes'),
      ),
    );
  } finally {
    await db.close();
  }
});
test('original request and proposal replay recover historical results after later closure and listing pause', async () => {
  const db = await fixture();
  try {
    const request = await command(db),
      proposalOptions = { kind: 'propose', viewing: request.viewingId, operation: id(1001) },
      proposed = await command(db, proposalOptions);
    await db.query("UPDATE app_private.listings SET publication_status='paused' WHERE id=$1", [L]);
    await db.query(
      "UPDATE app_private.enquiries SET status='closed_lost',closure_reason='Synthetic closed later' WHERE id=$1",
      [E],
    );
    const before = await totals(db);
    assert.deepEqual(await command(db), request);
    assert.deepEqual(await command(db, proposalOptions), proposed);
    assert.deepEqual(await history(db), request);
    assert.deepEqual(await history(db, id(1001)), proposed);
    assert.deepEqual(await totals(db), before);
    assert.equal(request.result.status, 'requested');
    assert.equal((await read(db, request.viewingId)).schedule.status, 'proposed');
    for (const changes of [
      { notes: NOTES + 'changed' },
      { expected: '2' },
      { listing: SECOND_L },
      { preferences: [] },
      { user: ADMIN },
      { enquiry: GENERAL },
    ])
      await denied(() => command(db, changes), '40001');
  } finally {
    await db.close();
  }
});
test('stale request and proposal conflicts are durable and cannot be upgraded by replay', async () => {
  const db = await fixture();
  try {
    const stale = await command(db, { expected: '2' });
    assert.equal(stale.outcome, 'conflict');
    assert.equal(stale.reason, 'VERSION_CONFLICT');
    assert.equal(stale.result, null);
    assert.equal(stale.viewingId, null);
    assert.equal((await totals(db)).viewings, 0);
    await db.query(
      "UPDATE app_private.enquiries SET contact_name='Synthetic later version' WHERE id=$1",
      [E],
    );
    assert.deepEqual(await command(db, { expected: '2' }), stale);
    const saved = await command(db, { operation: id(1001), expected: '2' });
    const proposed = await command(db, {
      kind: 'propose',
      viewing: saved.viewingId,
      operation: id(1002),
    });
    const conflict = await command(db, {
      kind: 'propose',
      viewing: saved.viewingId,
      operation: id(1003),
      expected: '1',
    });
    assert.equal(conflict.outcome, 'conflict');
    assert.equal(conflict.observedVersion, '2');
    assert.equal(conflict.result, null);
    const refused = await command(db, {
      kind: 'propose',
      viewing: saved.viewingId,
      operation: id(1004),
      expected: '2',
    });
    assert.equal(refused.reason, 'INVALID_STATE');
    assert.equal((await read(db, saved.viewingId)).schedule.version, proposed.result.version);
  } finally {
    await db.close();
  }
});
test('new commands require current open enquiry,own bound listing and fresh available publication', async () => {
  const db = await fixture();
  try {
    assert.equal((await command(db, { listing: SECOND_L })).reason, 'LISTING_MISMATCH');
    assert.equal(
      (
        await command(db, {
          enquiry: GENERAL,
          listing: SECOND_L,
          operation: id(1001),
          preferences: [],
        })
      ).outcome,
      'applied',
    );
    await denied(() => command(db, { listing: FOREIGN_L, operation: id(1002) }), 'P0002');
    await db.query("UPDATE app_private.listings SET publication_status='paused' WHERE id=$1", [L]);
    const refused = await command(db, { operation: id(1003) });
    assert.equal(refused.reason, 'LISTING_UNAVAILABLE');
    await db.query("UPDATE app_private.listings SET publication_status='published' WHERE id=$1", [
      L,
    ]);
    assert.deepEqual(await command(db, { operation: id(1003) }), refused);
    await db.query(
      "UPDATE app_private.listings SET last_availability_confirmed_at=now()-interval '31 days' WHERE id=$1",
      [L],
    );
    assert.equal((await command(db, { operation: id(1004) })).reason, 'LISTING_UNAVAILABLE');
    await db.query(
      "UPDATE app_private.enquiries SET status='closed_lost',closure_reason='Synthetic no longer interested' WHERE id=$1",
      [E],
    );
    assert.equal(
      (await command(db, { operation: id(1005), expected: '2' })).reason,
      'ENQUIRY_CLOSED',
    );
  } finally {
    await db.close();
  }
});
test('requester-private receipts,current assignment,revocation and company guards apply to reads and replay', async () => {
  const db = await fixture();
  try {
    const original = await command(db);
    for (const user of [CUSTOMER, null])
      await denied(() => command(db, { user, operation: id(1010) }), '42501');
    await denied(() => command(db, { user: PEER, operation: id(1011) }), 'P0002');
    await denied(() => history(db, id(1000), ADMIN), 'P0002');
    await denied(() => read(db, original.viewingId, PEER), 'P0002');
    await denied(() => read(db, original.viewingId, OTHERADMIN, E, OTHER), 'P0002');
    await denied(
      () => command(db, { tenant: OTHER, user: OTHERADMIN, operation: id(1012) }),
      'P0002',
    );
    await db.query('UPDATE app_private.enquiries SET assigned_agent_id=$1 WHERE id=$2', [PEER, E]);
    await denied(() => history(db), 'P0002');
    await denied(() => command(db), 'P0002');
    assert.equal((await read(db, original.viewingId, PEER)).assignedAgentId, PEER);
    await denied(() => history(db, id(1000), PEER), 'P0002');
    await db.query('UPDATE app_private.enquiries SET assigned_agent_id=$1 WHERE id=$2', [AGENT, E]);
    assert.deepEqual(await history(db), original);
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [T, AGENT],
    );
    await denied(() => history(db), '42501');
    await denied(() => read(db, original.viewingId), '42501');
  } finally {
    await db.close();
  }
});
test('slot structure,bounds,original notes and future execution are independently enforced in SQL', async () => {
  const db = await fixture();
  try {
    for (const bad of [
      { ...slot(), timeZone: null },
      { ...slot(), timeZone: 'UTC' },
      { ...slot(), confirmed: true },
      slot('2090-02-30T09:00:00.000Z'),
      slot('2090-01-01T09:00:00.000Z', '2090-01-01T09:14:59.999Z'),
      slot('2090-01-01T09:00:00.000Z', '2090-01-01T13:00:00.001Z'),
    ])
      await denied(() => command(db, { preferences: [bad] }), '23514');
    for (const preferences of [[slot(), slot()], Array(4).fill(slot()), null])
      await denied(() => command(db, { preferences }), '23514');
    for (const notes of ['   ', '😀'.repeat(2001), null])
      await denied(() => command(db, { notes }), '23514');
    const past = slot('2026-01-01T09:00:00.000Z', '2026-01-01T10:00:00.000Z'),
      refused = await command(db, { preferences: [past] });
    assert.equal(refused.reason, 'SLOT_NOT_FUTURE');
    assert.deepEqual(await history(db), refused);
    const saved = await command(db, {
      operation: id(1001),
      preferences: [],
      notes: '😀'.repeat(2000),
    });
    assert.equal((await read(db, saved.viewingId)).notes, '😀'.repeat(2000));
    const rejected = await command(db, {
      kind: 'propose',
      viewing: saved.viewingId,
      operation: id(1002),
      proposalSlot: past,
    });
    assert.equal(rejected.reason, 'SLOT_NOT_FUTURE');
    assert.equal((await read(db, saved.viewingId)).schedule.status, 'requested');
  } finally {
    await db.close();
  }
});
test('forced RLS,runtime privilege denial and immutable original records prevent direct bypass', async () => {
  const db = await fixture();
  try {
    const saved = await command(db);
    const rows = await db.query(
      "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('viewings','viewing_operations')",
    );
    assert.equal(rows.rows.length, 2);
    assert.ok(rows.rows.every((x) => x.relrowsecurity && x.relforcerowsecurity));
    for (const table of ['viewings', 'viewing_operations'])
      for (const sql of [
        `SELECT * FROM app_private.${table}`,
        `DELETE FROM app_private.${table}`,
        `UPDATE app_private.${table} SET tenant_id=tenant_id`,
      ])
        await denied(() => actor(db, ADMIN, () => db.query(sql)), '42501');
    await denied(
      () =>
        db.query("UPDATE app_private.viewings SET notes='altered' WHERE id=$1", [saved.viewingId]),
      '23514',
    );
    await denied(
      () => db.query('DELETE FROM app_private.viewings WHERE id=$1', [saved.viewingId]),
      '23514',
    );
    await denied(
      () => db.query("UPDATE app_private.viewing_operations SET receipt='{}'::jsonb"),
      '23514',
    );
    await denied(() => db.query('DELETE FROM app_private.viewing_operations'), '23514');
    const functions = await db.query(
      "SELECT p.proname,r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.proname IN ('execute_viewing_operation','read_viewing_operation','read_viewing','list_enquiry_viewings')",
    );
    assert.equal(functions.rows.length, 4);
    assert.ok(functions.rows.every((x) => x.rolname === 'realtor_owner'));
  } finally {
    await db.close();
  }
});
test('bounded viewing feed includes current assignment and only saved schedules,with truthful truncation', async () => {
  const db = await fixture();
  try {
    const list = (limit = 1, user = AGENT) =>
      actor(db, user, () => scalar(db, 'SELECT app_api.list_enquiry_viewings($1,$2)', [E, limit]));
    assert.deepEqual(await list(), { items: [], limit: 1, truncated: false });
    await command(db);
    await command(db, { operation: id(1001) });
    await command(db, { operation: id(1002), expected: '9' });
    const page = await list();
    assert.equal(page.items.length, 1);
    assert.equal(page.truncated, true);
    assert.equal(page.items[0].notes, NOTES);
    const all = await list(25);
    assert.equal(all.items.length, 2);
    assert.equal(all.truncated, false);
    assert.ok(all.items.every((x) => x.assignedAgentId === AGENT && x.requestedById === AGENT));
    await denied(() => list(26), '23514');
    await denied(() => list(0), '23514');
    await denied(() => list(1, PEER), 'P0002');
    await db.query('UPDATE app_private.enquiries SET assigned_agent_id=$1 WHERE id=$2', [PEER, E]);
    await denied(() => list(), 'P0002');
    assert.ok((await list(25, PEER)).items.every((x) => x.assignedAgentId === PEER));
  } finally {
    await db.close();
  }
});

const replacementSlot = () => slot('2090-01-02T09:00:00.000Z', '2090-01-02T10:00:00.000Z');
const thirdSlot = () => slot('2090-01-03T09:00:00.000Z', '2090-01-03T10:00:00.000Z');
const RESCHEDULE_REASON = '  Synthetic change of time.\nKeep the original agreement history.  ';
function reschedule(
  db,
  {
    viewing,
    user = AGENT,
    enquiry = E,
    operation = id(4000),
    expected = '3',
    newSlot = replacementSlot(),
    reason = RESCHEDULE_REASON,
    tenant = T,
  } = {},
) {
  return actor(
    db,
    user,
    () =>
      scalar(db, 'SELECT app_api.reschedule_viewing($1,$2,$3,$4,$5::jsonb,$6)', [
        enquiry,
        viewing,
        operation,
        expected,
        JSON.stringify(newSlot),
        reason,
      ]),
    tenant,
  );
}
const rescheduleOriginal = (receipt) => ({
  operationId: receipt.operationId,
  expectedVersion: receipt.expectedVersion,
  slot: receipt.request.slot,
  reason: receipt.request.reason,
});
test('stored repeated reschedules retain every old agreement and exact receipt while each new cycle starts unagreed', async () => {
  const db = await fixture();
  try {
    const { requested, proposal } = await proposed(db),
      viewing = requested.viewingId,
      first = await confirmation(db, { viewing, agreedAt: proposal.completedAt });
    const columns =
      'proposed_slot,phone_agreement,confirmed_by_id,proposed_at,confirmed_at,preferred_slots,notes,created_at';
    const original = (
      await db.query('SELECT ' + columns + ' FROM app_private.viewings WHERE id=$1', [viewing])
    ).rows[0];
    const second = await reschedule(db, { viewing });
    validateViewingRescheduleReceipt(second, E, viewing, rescheduleOriginal(second));
    assert.equal(second.result.version, '4');
    assert.equal(second.result.cycle.number, '2');
    assert.equal(second.result.cycle.previousStatus, 'confirmed');
    assert.equal(Object.hasOwn(second.result, 'agreement'), false);
    assert.equal(Object.hasOwn(await read(db, viewing), 'confirmation'), false);
    const secondPhone = await confirmation(db, {
      viewing,
      operation: id(2001),
      expected: '4',
      proposalSlot: replacementSlot(),
      agreedAt: second.completedAt,
      notes: 'New agreement for the second exact slot.',
    });
    validateViewingConfirmationReceipt(secondPhone, E, viewing, {
      operationId: id(2001),
      expectedVersion: '4',
      slot: replacementSlot(),
      channel: 'phone',
      agreedAt: second.completedAt,
      notes: 'New agreement for the second exact slot.',
    });
    assert.equal(secondPhone.result.version, '5');
    const third = await reschedule(db, {
      viewing,
      operation: id(4001),
      expected: '5',
      newSlot: thirdSlot(),
    });
    assert.equal(third.result.version, '6');
    assert.equal(third.result.cycle.number, '3');
    assert.equal(Object.hasOwn(third.result, 'agreement'), false);
    const thirdPhone = await confirmation(db, {
      viewing,
      operation: id(2002),
      expected: '6',
      proposalSlot: thirdSlot(),
      agreedAt: third.completedAt,
      notes: 'Third slot requires its own agreement.',
    });
    assert.equal(thirdPhone.result.version, '7');
    const ended = await terminate(db, { viewing, expected: '7' });
    validateViewingTerminationReceipt(ended, E, viewing, 'cancel', {
      operationId: id(3000),
      expectedVersion: '7',
      reason: END_REASON,
    });
    assert.equal(ended.result.version, '8');
    assert.deepEqual(ended.result.agreement, thirdPhone.result.agreement);
    validateViewingDetail(await read(db, viewing), E);
    assert.deepEqual(
      (await db.query('SELECT ' + columns + ' FROM app_private.viewings WHERE id=$1', [viewing]))
        .rows[0],
      original,
    );
    const page = await savedHistory(db, viewing);
    validateViewingHistoryPage(page, E, viewing, 25);
    assert.deepEqual(
      page.items.map((x) => x.kind),
      ['cancel', 'confirm', 'reschedule', 'confirm', 'reschedule', 'confirm', 'propose', 'request'],
    );
    assert.deepEqual(page.items[2].schedule, third.result);
    assert.deepEqual(page.items[4].schedule, second.result);
    assert.deepEqual(page.items[5].schedule, first.result);
    assert.deepEqual(await history(db, id(2000)), first);
    assert.deepEqual(await history(db, id(2001)), secondPhone);
    assert.deepEqual(await history(db, id(4000)), second);
    assert.deepEqual(await history(db, id(4001)), third);
    assert.deepEqual(await reschedule(db, { viewing }), second);
    assert.deepEqual(await command(db), requested);
    assert.deepEqual(
      await command(db, { kind: 'propose', viewing, operation: id(1001) }),
      proposal,
    );
    assert.deepEqual(await totals(db), {
      viewings: 1,
      operations: 8,
      audits: 8,
      enquiry_version: '1',
    });
  } finally {
    await db.close();
  }
});
test('proposed reschedules can repeat without fabricated agreement and the current cycle can be declined', async () => {
  const db = await fixture();
  try {
    const { requested } = await proposed(db),
      viewing = requested.viewingId,
      second = await reschedule(db, { viewing, expected: '2' }),
      third = await reschedule(db, {
        viewing,
        expected: '3',
        operation: id(4001),
        newSlot: thirdSlot(),
      });
    assert.equal(second.result.version, '3');
    assert.equal(third.result.version, '4');
    assert.equal(third.result.cycle.number, '3');
    const ended = await terminate(db, { viewing, kind: 'decline', expected: '4' });
    assert.equal(ended.result.status, 'declined');
    assert.equal(ended.result.version, '5');
    assert.equal(Object.hasOwn(ended.result, 'agreement'), false);
    validateViewingDetail(await read(db, viewing), E);
    validateViewingHistoryPage(await savedHistory(db, viewing), E, viewing, 25);
  } finally {
    await db.close();
  }
});
test('reschedule stale,unchanged,requested and already ended decisions remain durable without new states', async () => {
  const db = await fixture();
  try {
    const request = await command(db),
      viewing = request.viewingId;
    assert.equal((await reschedule(db, { viewing, expected: '1' })).reason, 'INVALID_STATE');
    await command(db, { kind: 'propose', viewing, operation: id(1001) });
    const same = await reschedule(db, {
      viewing,
      expected: '2',
      operation: id(4001),
      newSlot: slot(),
    });
    assert.equal(same.reason, 'SLOT_UNCHANGED');
    const stale = await reschedule(db, { viewing, expected: '1', operation: id(4002) });
    assert.equal(stale.outcome, 'conflict');
    assert.deepEqual(await reschedule(db, { viewing, expected: '1', operation: id(4002) }), stale);
    await terminate(db, { viewing });
    assert.equal(
      (await reschedule(db, { viewing, expected: '3', operation: id(4003) })).reason,
      'INVALID_STATE',
    );
    assert.equal((await savedHistory(db, viewing)).items.length, 3);
  } finally {
    await db.close();
  }
});
test('reschedule requires current eligible stock and open enquiry but original replay survives closure and pause', async () => {
  const db = await fixture();
  try {
    const { requested } = await proposed(db),
      viewing = requested.viewingId,
      saved = await reschedule(db, { viewing, expected: '2' });
    await db.query("UPDATE app_private.listings SET publication_status='paused' WHERE id=$1", [L]);
    assert.equal(
      (await reschedule(db, { viewing, expected: '3', operation: id(4001), newSlot: thirdSlot() }))
        .reason,
      'LISTING_UNAVAILABLE',
    );
    await db.query(
      "UPDATE app_private.enquiries SET status='closed_lost',closure_reason='Synthetic closure' WHERE id=$1",
      [E],
    );
    assert.equal(
      (await reschedule(db, { viewing, expected: '3', operation: id(4002), newSlot: thirdSlot() }))
        .reason,
      'ENQUIRY_CLOSED',
    );
    assert.deepEqual(await reschedule(db, { viewing, expected: '2' }), saved);
    assert.equal((await read(db, viewing)).schedule.version, '3');
  } finally {
    await db.close();
  }
});
test('reschedule checks current company role assignment and original requester without consuming denied IDs', async () => {
  const db = await fixture();
  try {
    const { requested } = await proposed(db),
      viewing = requested.viewingId,
      before = await totals(db);
    for (const user of [PEER, CUSTOMER])
      await assert.rejects(() => reschedule(db, { viewing, expected: '2', user }));
    await denied(
      () => reschedule(db, { viewing, expected: '2', user: OTHERADMIN, tenant: OTHER }),
      'P0002',
    );
    assert.deepEqual(await totals(db), before);
    const saved = await reschedule(db, { viewing, expected: '2' });
    await denied(() => reschedule(db, { viewing, expected: '2', user: ADMIN }), '40001');
    await db.query('UPDATE app_private.enquiries SET assigned_agent_id=$1 WHERE id=$2', [PEER, E]);
    await denied(() => history(db, id(4000)), 'P0002');
    await denied(() => reschedule(db, { viewing, expected: '2' }), 'P0002');
    await db.query('UPDATE app_private.enquiries SET assigned_agent_id=$1 WHERE id=$2', [AGENT, E]);
    assert.deepEqual(await reschedule(db, { viewing, expected: '2' }), saved);
  } finally {
    await db.close();
  }
});
test('reschedule operation IDs bind exact kind,target,version,slot and raw reason across later cycles', async () => {
  const db = await fixture();
  try {
    const { requested } = await proposed(db),
      viewing = requested.viewingId,
      saved = await reschedule(db, { viewing, expected: '2' });
    for (const patch of [{ reason: 'changed' }, { newSlot: thirdSlot() }, { expected: '3' }])
      await denied(() => reschedule(db, { viewing, expected: '2', ...patch }), '40001');
    await denied(() => terminate(db, { viewing, expected: '2', operation: id(4000) }), '40001');
    await denied(() => reschedule(db, { viewing, expected: '2', operation: id(1001) }), '40001');
    assert.deepEqual(await history(db, id(4000)), saved);
  } finally {
    await db.close();
  }
});
test('stored cycle and original first-cycle evidence cannot be edited,erased,rewritten or accessed by runtime tables', async () => {
  const db = await fixture();
  try {
    const { requested } = await proposed(db),
      viewing = requested.viewingId;
    await reschedule(db, { viewing, expected: '2' });
    for (const sql of [
      "UPDATE app_private.viewings SET current_cycle=jsonb_set(current_cycle,'{reason}','\"changed\"') WHERE id=$1",
      'UPDATE app_private.viewings SET current_cycle=NULL WHERE id=$1',
      "UPDATE app_private.viewings SET notes='changed' WHERE id=$1",
      'UPDATE app_private.viewings SET proposed_slot=$2::jsonb WHERE id=$1',
      'DELETE FROM app_private.viewings WHERE id=$1',
    ])
      await assert.rejects(() =>
        db.query(sql, sql.includes('$2') ? [viewing, JSON.stringify(thirdSlot())] : [viewing]),
      );
    await denied(
      () => actor(db, AGENT, () => db.query('SELECT current_cycle FROM app_private.viewings')),
      '42501',
    );
    await denied(
      () => actor(db, AGENT, () => db.query('UPDATE app_private.viewings SET current_cycle=NULL')),
      '42501',
    );
    assert.equal((await read(db, viewing)).schedule.cycle.number, '2');
  } finally {
    await db.close();
  }
});
test('malformed reschedule commands reserve no operation and maximum bounded raw Unicode reason survives', async () => {
  const db = await fixture();
  try {
    const { requested } = await proposed(db),
      viewing = requested.viewingId,
      before = await totals(db);
    for (const patch of [
      { expected: null },
      { expected: '9007199254740991' },
      { reason: ' ' },
      { reason: '😀'.repeat(1001) },
      { newSlot: { ...replacementSlot(), timeZone: 'UTC' } },
    ])
      await assert.rejects(() => reschedule(db, { viewing, expected: '2', ...patch }));
    assert.deepEqual(await totals(db), before);
    const receipt = await reschedule(db, { viewing, expected: '2', reason: '😀'.repeat(1000) });
    assert.equal([...receipt.result.cycle.reason].length, 1000);
    assert.deepEqual(
      await reschedule(db, { viewing, expected: '2', reason: '😀'.repeat(1000) }),
      receipt,
    );
  } finally {
    await db.close();
  }
});
test('reschedule audit or receipt failures roll back current cycle and operation atomically', async () => {
  const db = await fixture();
  try {
    const { requested } = await proposed(db),
      viewing = requested.viewingId,
      before = await totals(db);
    await db.exec(
      "CREATE FUNCTION app_private.fail_reschedule_test() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Synthetic transaction failure';END$$;",
    );
    for (const table of ['audit_events', 'viewing_operations']) {
      await db.exec(
        'CREATE TRIGGER fail_reschedule_test BEFORE INSERT ON app_private.' +
          table +
          ' FOR EACH ROW EXECUTE FUNCTION app_private.fail_reschedule_test()',
      );
      await assert.rejects(() => reschedule(db, { viewing, expected: '2' }));
      await db.exec('DROP TRIGGER fail_reschedule_test ON app_private.' + table);
      assert.deepEqual(await totals(db), before);
      assert.equal((await read(db, viewing)).schedule.version, '2');
    }
    assert.equal((await reschedule(db, { viewing, expected: '2' })).outcome, 'applied');
  } finally {
    await db.close();
  }
});
test('new cycle requires its own exact phone agreement and confirmed cleanup remains possible after closure', async () => {
  const db = await fixture();
  try {
    const { requested, proposal } = await proposed(db),
      viewing = requested.viewingId;
    await confirmation(db, { viewing, agreedAt: proposal.completedAt });
    const second = await reschedule(db, { viewing });
    assert.equal(
      (
        await confirmation(db, {
          viewing,
          expected: '4',
          operation: id(2001),
          proposalSlot: slot(),
          agreedAt: second.completedAt,
        })
      ).reason,
      'PROPOSED_SLOT_MISMATCH',
    );
    assert.equal(
      (
        await confirmation(db, {
          viewing,
          expected: '4',
          operation: id(2002),
          proposalSlot: replacementSlot(),
          agreedAt: proposal.completedAt,
        })
      ).reason,
      'AGREEMENT_BEFORE_PROPOSAL',
    );
    const agreed = await confirmation(db, {
      viewing,
      expected: '4',
      operation: id(2003),
      proposalSlot: replacementSlot(),
      agreedAt: second.completedAt,
      notes: 'New second-cycle agreement.',
    });
    assert.equal(
      (await terminate(db, { viewing, kind: 'decline', expected: '5', operation: id(3001) }))
        .reason,
      'INVALID_STATE',
    );
    await db.query(
      "UPDATE app_private.enquiries SET status='closed_lost',closure_reason='Synthetic closure' WHERE id=$1",
      [E],
    );
    await db.query(
      "UPDATE app_private.listings SET publication_status='paused',availability='withdrawn' WHERE id=$1",
      [L],
    );
    const ended = await terminate(db, { viewing, expected: '5' });
    assert.equal(ended.result.version, '6');
    assert.deepEqual(ended.result.agreement, agreed.result.agreement);
    validateViewingDetail(await read(db, viewing), E);
    validateViewingHistoryPage(await savedHistory(db, viewing), E, viewing, 25);
  } finally {
    await db.close();
  }
});

test('reschedule refuses past new starts and a clock before the saved proposal without consuming later decisions', async () => {
  const db = await fixture();
  try {
    const { requested } = await proposed(db),
      viewing = requested.viewingId;
    const past = await reschedule(db, {
      viewing,
      expected: '2',
      newSlot: slot('2020-01-01T09:00:00.000Z', '2020-01-01T10:00:00.000Z'),
    });
    assert.equal(past.reason, 'SLOT_NOT_FUTURE');
    assert.equal(past.result, null);
    await db.exec('ALTER TABLE app_private.viewings DISABLE TRIGGER guard_viewing');
    await db.query(
      "UPDATE app_private.viewings SET updated_at='2089-01-01T00:00:00Z' WHERE id=$1",
      [viewing],
    );
    await db.exec('ALTER TABLE app_private.viewings ENABLE TRIGGER guard_viewing');
    const ahead = await reschedule(db, { viewing, expected: '2', operation: id(4001) });
    assert.equal(ahead.reason, 'RECORD_TIME_IN_FUTURE');
    assert.deepEqual(await reschedule(db, { viewing, expected: '2', operation: id(4001) }), ahead);
    assert.equal((await read(db, viewing)).schedule.version, '2');
  } finally {
    await db.close();
  }
});
