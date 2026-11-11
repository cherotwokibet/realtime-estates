import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture, asActor, scalar, T, OTHER, ADMIN, AGENT } from './public-media-fixtures.mjs';

const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const primary = id(13);
const peer = id(14);
const third = id(16);
const otherAdmin = id(20);
const requestId = id(850);
const ready = 'ready_for_privacy_review';
const info = 'needs_information';
const deny = (call, code) => assert.rejects(call, (error) => error.code === code);
const query = (db, sql, args, actor, tenant = T) =>
  asActor(db, tenant, actor, () => scalar(db, sql, args));
const queue = (db, disposition, limit, after, actor = ADMIN, tenant = T) =>
  query(
    db,
    'SELECT app_api.list_customer_deletion_follow_up($1,$2,$3)',
    [disposition, limit, after],
    actor,
    tenant,
  );
const progress = (db, actor = primary, tenant = T) =>
  query(db, 'SELECT app_api.read_customer_deletion_progress()', [], actor, tenant);
const intake = (db, actor, tenant = T) =>
  query(db, 'SELECT app_api.request_customer_deletion($1,true)', [requestId], actor, tenant);
const review = (db, customer, decision, reviewer = ADMIN, tenant = T) =>
  query(
    db,
    'SELECT app_api.review_customer_deletion($1,$2,$3,$4)',
    [customer, requestId, customer, decision],
    reviewer,
    tenant,
  );

async function setup(t) {
  const db = await fixture();
  t.after(() => db.close());
  for (const name of [
    'customer-favourites',
    'customer-push-preferences',
    'customer-deletion-requests',
    'customer-deletion-reviews',
    'customer-deletion-follow-up',
  ]) {
    await db.exec(
      await readFile(new URL('../proposals/' + name + '.sql', import.meta.url), 'utf8'),
    );
  }
  await db.query(
    "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'customer'),($1,$3,'customer'),($4,$5,'customer')",
    [T, peer, third, OTHER, primary],
  );
  return db;
}

test('admin follow-up separates decisions and pages within the current company', async (t) => {
  const db = await setup(t);
  for (const customer of [primary, peer, third]) await intake(db, customer);
  await intake(db, primary, OTHER);
  assert.deepEqual((await queue(db, ready, 1, null)).items, []);
  await review(db, primary, ready);
  await review(db, peer, info);
  await review(db, third, ready);
  await review(db, primary, info, otherAdmin, OTHER);
  const page = await queue(db, ready, 1, null);
  assert.equal(page.tenantId, T);
  assert.equal(page.disposition, ready);
  assert.equal(page.hasMore, true);
  assert.equal(page.items[0].customerId, primary);
  assert.deepEqual(Object.keys(page.items[0]).sort(), ['customerId', 'requestId', 'reviewedAt']);
  const next = await queue(db, ready, 1, primary);
  assert.equal(next.hasMore, false);
  assert.equal(next.items[0].customerId, third);
  assert.deepEqual(
    (await queue(db, info, 20, null)).items.map((item) => item.customerId),
    [peer],
  );
  assert.deepEqual(
    (await queue(db, info, 20, null, otherAdmin, OTHER)).items.map((item) => item.customerId),
    [primary],
  );
  await deny(() => queue(db, info, 51, null), '23514');
  await deny(() => queue(db, 'any', 1, null), '23514');
  for (const actor of [null, AGENT, primary, otherAdmin])
    await deny(() => queue(db, info, 1, null, actor), '42501');
  await db.query(
    'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
    [T, ADMIN],
  );
  await deny(() => queue(db, info, 1, null), '42501');
});

test('customer progress reveals only a scoped status and preserves the original intake receipt', async (t) => {
  const db = await setup(t);
  assert.equal(await progress(db), null);
  const receipt = await intake(db, primary);
  await intake(db, peer);
  assert.equal((await progress(db)).status, 'pending_review');
  await review(db, primary, ready);
  await review(db, peer, info);
  assert.deepEqual(await progress(db), {
    policy: 'synthetic-customer-deletion-progress-v1',
    tenantId: T,
    customerId: primary,
    requestId,
    status: 'privacy_review_pending',
  });
  assert.equal((await progress(db, peer)).status, 'staff_follow_up_pending');
  assert.equal(await progress(db, primary, OTHER), null);
  assert.deepEqual(await intake(db, primary), receipt);
  await deny(() => progress(db, ADMIN), '42501');
  await db.query(
    'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
    [T, primary],
  );
  await deny(() => progress(db), '42501');
});
const returnOperation = id(851);
const returnToReview = (db, actor = ADMIN, tenant = T, op = returnOperation, customer = primary) =>
  query(
    db,
    'SELECT app_api.return_customer_deletion_to_review($1,$2,$3)',
    [customer, requestId, op],
    actor,
    tenant,
  );
const originalReturn = (db, actor = ADMIN) =>
  query(
    db,
    'SELECT app_api.read_customer_deletion_review_return($1,$2,$3)',
    [primary, requestId, returnOperation],
    actor,
  );

test('a current company admin can return a request to privacy review while preserving its original decisions', async (t) => {
  const db = await setup(t);
  const handoffAdmin = id(31);
  await db.query(
    "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [T, handoffAdmin],
  );
  const intakeReceipt = await intake(db, primary);
  await intake(db, peer);
  await intake(db, primary, OTHER);
  await deny(() => returnToReview(db), '23514');
  const initialDecision = await review(db, primary, info);
  await review(db, peer, ready);
  await deny(() => returnToReview(db, ADMIN, T, returnOperation, peer), '23514');
  await deny(() => returnToReview(db, AGENT), '42501');
  await deny(() => returnToReview(db, otherAdmin, OTHER), '23514');
  await db.query(
    'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
    [T, ADMIN],
  );
  await deny(() => returnToReview(db), '42501');
  const receipt = await returnToReview(db, handoffAdmin);
  assert.equal(receipt.reviewerId, handoffAdmin);
  assert.equal(receipt.requestId, requestId);
  assert.deepEqual(await originalReturn(db, handoffAdmin), receipt);
  assert.deepEqual(await returnToReview(db, handoffAdmin), receipt);
  await deny(() => returnToReview(db, handoffAdmin, T, id(852)), '23505');
  assert.deepEqual((await queue(db, info, 20, null, handoffAdmin)).items, []);
  const readyPage = await queue(db, ready, 20, null, handoffAdmin);
  assert.equal(readyPage.items[0].reviewedAt, receipt.returnedAt);
  assert.deepEqual(
    readyPage.items.map((item) => item.customerId),
    [primary, peer],
  );
  assert.equal((await progress(db)).status, 'privacy_review_pending');
  assert.equal((await progress(db, primary, OTHER)).status, 'pending_review');
  assert.deepEqual(await intake(db, primary), intakeReceipt);
  const persisted = await db.query(
    'SELECT disposition, operation_id FROM app_private.customer_deletion_reviews WHERE tenant_id=$1 AND customer_id=$2',
    [T, primary],
  );
  assert.deepEqual(persisted.rows, [
    { disposition: initialDecision.disposition, operation_id: initialDecision.operationId },
  ]);
  const audit = await db.query(
    "SELECT actor_id,object_id,summary FROM app_private.audit_events WHERE action='customer.deletion_returned_to_review'",
  );
  assert.deepEqual(audit.rows, [
    { actor_id: handoffAdmin, object_id: returnOperation, summary: { from: info, to: ready } },
  ]);
});

test('failed return audit leaves the request in follow-up and another admin cannot recover the receipt', async (t) => {
  const db = await setup(t);
  const secondAdmin = id(31);
  await db.query(
    "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [T, secondAdmin],
  );
  await intake(db, primary);
  await review(db, primary, info);
  await db.exec(`
    CREATE FUNCTION app_private.reject_return_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action = 'customer.deletion_returned_to_review' THEN
        RAISE EXCEPTION 'Synthetic audit failure' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER reject_return_audit BEFORE INSERT ON app_private.audit_events
      FOR EACH ROW EXECUTE FUNCTION app_private.reject_return_audit();
  `);
  await deny(() => returnToReview(db), '23514');
  await deny(() => originalReturn(db), 'P0002');
  assert.equal((await progress(db)).status, 'staff_follow_up_pending');
  assert.equal((await queue(db, info, 20, null)).items.length, 1);
  await db.exec('DROP TRIGGER reject_return_audit ON app_private.audit_events');
  await returnToReview(db);
  await deny(() => originalReturn(db, secondAdmin), 'P0002');
  await deny(() => returnToReview(db, secondAdmin), '23505');
});
const privacyOperation = id(870);
const privacyOfficer = id(32);
const privacyAlternate = id(33);
const decidePrivacy = (
  db,
  decision = 'plan_review',
  actor = privacyOfficer,
  op = privacyOperation,
) =>
  query(
    db,
    'SELECT app_api.record_synthetic_deletion_privacy_decision($1,$2,$3,$4)',
    [primary, requestId, op, decision],
    actor,
  );
const readPrivacy = (db, actor = privacyOfficer) =>
  query(
    db,
    'SELECT app_api.read_synthetic_deletion_privacy_decision($1,$2,$3)',
    [primary, requestId, privacyOperation],
    actor,
  );

async function setupPrivacy(t) {
  const db = await setup(t);
  await db.exec(
    await readFile(
      new URL('../proposals/customer-deletion-privacy-decisions.sql', import.meta.url),
      'utf8',
    ),
  );
  for (const actor of [privacyOfficer, privacyAlternate]) {
    await db.query(
      "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
      [T, actor],
    );
  }
  for (const actor of [ADMIN, privacyOfficer, privacyAlternate]) {
    await db.query(
      'INSERT INTO app_private.synthetic_deletion_privacy_reviewers(tenant_id,reviewer_id) VALUES($1,$2)',
      [T, actor],
    );
  }
  return db;
}

test('only an independent designated company reviewer records and recovers a planning decision', async (t) => {
  const db = await setupPrivacy(t);
  const intakeReceipt = await intake(db, primary);
  await deny(() => decidePrivacy(db), '23514');
  await review(db, primary, info);
  await deny(() => decidePrivacy(db), '23514');
  await returnToReview(db, privacyAlternate);
  await deny(() => decidePrivacy(db, 'plan_review', ADMIN), '42501');
  await deny(() => decidePrivacy(db, 'plan_review', privacyAlternate), '42501');
  await deny(() => decidePrivacy(db, 'plan_review', otherAdmin), '42501');
  await deny(() => decidePrivacy(db, 'plan_review', primary), '42501');
  await deny(() => decidePrivacy(db, 'delete'), '23514');
  const receipt = await decidePrivacy(db);
  assert.equal(receipt.decision, 'plan_review');
  assert.equal(receipt.retentionProfile, 'synthetic-retention-review-v1');
  assert.equal(receipt.reviewerId, privacyOfficer);
  assert.deepEqual(await decidePrivacy(db), receipt);
  assert.deepEqual(await readPrivacy(db), receipt);
  await deny(() => readPrivacy(db, privacyAlternate), 'P0002');
  await deny(() => decidePrivacy(db, 'hold'), '23505');
  await deny(() => decidePrivacy(db, 'plan_review', privacyOfficer, id(871)), '23505');
  assert.deepEqual(await intake(db, primary), intakeReceipt);
  assert.equal(
    (await query(db, 'SELECT app_api.customer_account()', [], primary)).customerId,
    primary,
  );
  assert.equal((await progress(db)).status, 'privacy_review_pending');
  const audit = await db.query(
    "SELECT actor_id,object_id,summary FROM app_private.audit_events WHERE action='customer.deletion_privacy_decided'",
  );
  assert.deepEqual(audit.rows, [
    {
      actor_id: privacyOfficer,
      object_id: privacyOperation,
      summary: { decision: 'plan_review', retentionProfile: 'synthetic-retention-review-v1' },
    },
  ]);
  await deny(
    () => db.query("UPDATE app_private.synthetic_deletion_privacy_decisions SET decision='hold'"),
    '23514',
  );
  await db.query(
    'DELETE FROM app_private.synthetic_deletion_privacy_reviewers WHERE tenant_id=$1 AND reviewer_id=$2',
    [T, privacyOfficer],
  );
  await deny(() => readPrivacy(db), '42501');
  await deny(() => decidePrivacy(db), '42501');
});

test('a failed audit rolls back a hold and private decision tables stay unavailable to runtime', async (t) => {
  const db = await setupPrivacy(t);
  await intake(db, primary);
  await review(db, primary, ready);
  await deny(
    () =>
      query(
        db,
        'SELECT * FROM app_private.synthetic_deletion_privacy_decisions',
        [],
        privacyOfficer,
      ),
    '42501',
  );
  await db.exec(`
    CREATE FUNCTION app_private.reject_privacy_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action = 'customer.deletion_privacy_decided' THEN
        RAISE EXCEPTION 'Synthetic audit failure' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER reject_privacy_audit BEFORE INSERT ON app_private.audit_events
      FOR EACH ROW EXECUTE FUNCTION app_private.reject_privacy_audit();
  `);
  await deny(() => decidePrivacy(db, 'hold'), '23514');
  await deny(() => readPrivacy(db), 'P0002');
  await db.exec('DROP TRIGGER reject_privacy_audit ON app_private.audit_events');
  const held = await decidePrivacy(db, 'hold');
  assert.equal(held.decision, 'hold');
  assert.equal((await progress(db)).status, 'privacy_review_pending');
  await db.query(
    'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
    [T, privacyOfficer],
  );
  await deny(() => readPrivacy(db), '42501');
});
