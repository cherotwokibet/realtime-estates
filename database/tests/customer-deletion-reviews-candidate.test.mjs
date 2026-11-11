import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture, asActor, scalar, T, OTHER, ADMIN, AGENT } from './public-media-fixtures.mjs';

const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const customer = id(13);
const peer = id(14);
const secondAdmin = id(15);
const OTHERADMIN = id(20);
const request = id(801);
const operation = id(802);
const ready = 'ready_for_privacy_review';
const needsInfo = 'needs_information';
const deny = (call, code) => assert.rejects(call, (error) => error.code === code);
const invoke = (db, sql, args, actor = ADMIN, tenant = T) =>
  asActor(db, tenant, actor, () => scalar(db, sql, args));
const queue = (db, limit = 20, after = null, actor, tenant) =>
  invoke(db, 'SELECT app_api.list_customer_deletion_triage($1,$2)', [limit, after], actor, tenant);
const decide = (
  db,
  { subject = customer, req = request, op = operation, outcome = ready, actor, tenant } = {},
) =>
  invoke(
    db,
    'SELECT app_api.review_customer_deletion($1,$2,$3,$4)',
    [subject, req, op, outcome],
    actor,
    tenant,
  );
const original = (db, actor, tenant) =>
  invoke(
    db,
    'SELECT app_api.read_customer_deletion_review($1,$2,$3)',
    [customer, request, operation],
    actor,
    tenant,
  );
const intake = (db, actor, tenant = T) =>
  invoke(db, 'SELECT app_api.request_customer_deletion($1,true)', [request], actor, tenant);

async function setup(t) {
  const db = await fixture();
  t.after(() => db.close());
  for (const name of [
    'customer-favourites',
    'customer-push-preferences',
    'customer-deletion-requests',
    'customer-deletion-reviews',
  ]) {
    await db.exec(
      await readFile(new URL('../proposals/' + name + '.sql', import.meta.url), 'utf8'),
    );
  }
  await db.query(
    "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'customer'),($3,$4,'customer'),($1,$5,'admin')",
    [T, peer, OTHER, customer, secondAdmin],
  );
  return db;
}

test('current admins see only their company’s unreviewed requests with a bounded cursor', async (t) => {
  const db = await setup(t);
  assert.deepEqual((await queue(db)).items, []);
  await intake(db, customer);
  await intake(db, peer);
  await intake(db, customer, OTHER);
  const first = await queue(db, 1);
  assert.deepEqual(
    first.items.map((x) => x.customerId),
    [customer],
  );
  assert.deepEqual(Object.keys(first.items[0]).sort(), ['customerId', 'requestId', 'requestedAt']);
  assert.equal(first.hasMore, true);
  const next = await queue(db, 1, customer);
  assert.deepEqual(
    next.items.map((x) => x.customerId),
    [peer],
  );
  assert.equal(next.hasMore, false);
  assert.equal((await queue(db, 20, null, OTHERADMIN, OTHER)).items.length, 1);
  await deny(() => queue(db, 51), '23514');
  for (const actor of [null, customer, AGENT, OTHERADMIN]) {
    await deny(() => queue(db, 20, null, actor), '42501');
    await deny(() => decide(db, { actor }), '42501');
    await deny(() => original(db, actor), '42501');
  }
  await deny(() => invoke(db, 'SELECT * FROM app_private.customer_deletion_reviews', []), '42501');
});

test('triage is exact, immutable and actor-bound, with one minimal audit event', async (t) => {
  const db = await setup(t);
  const customerReceipt = await intake(db, customer);
  await intake(db, peer);
  await deny(() => decide(db, { req: id(999) }), 'P0002');
  await deny(() => decide(db, { outcome: 'delete' }), '23514');
  const receipt = await decide(db);
  assert.deepEqual(receipt, {
    policy: 'synthetic-customer-deletion-review-v1',
    tenantId: T,
    customerId: customer,
    requestId: request,
    operationId: operation,
    reviewerId: ADMIN,
    disposition: ready,
    reviewedAt: new Date(receipt.reviewedAt).toISOString(),
  });
  assert.deepEqual(await decide(db), receipt);
  assert.deepEqual(await original(db), receipt);
  await deny(() => original(db, secondAdmin), 'P0002');
  await deny(() => decide(db, { actor: secondAdmin }), '23505');
  await deny(() => decide(db, { outcome: needsInfo }), '23505');
  await deny(() => decide(db, { subject: peer }), '23505');
  assert.deepEqual(
    (await queue(db)).items.map((x) => x.customerId),
    [peer],
  );
  assert.deepEqual(await intake(db, customer), customerReceipt);
  const account = await invoke(db, 'SELECT app_api.customer_account()', [], customer);
  assert.equal(account.customerId, customer);
  const audit = await db.query(
    "SELECT actor_id, object_id, summary FROM app_private.audit_events WHERE action='customer.deletion_triaged'",
  );
  assert.deepEqual(audit.rows, [
    { actor_id: ADMIN, object_id: operation, summary: { disposition: ready } },
  ]);
  await deny(
    () => db.query('UPDATE app_private.customer_deletion_reviews SET disposition=$1', [needsInfo]),
    '23514',
  );
  await db.query(
    'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
    [T, ADMIN],
  );
  await deny(() => original(db), '42501');
  await deny(() => decide(db), '42501');
});

test('a failed audit rolls back the decision and keeps the request in the queue', async (t) => {
  const db = await setup(t);
  await intake(db, customer);
  await db.exec(`
    CREATE FUNCTION app_private.test_fail_triage_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action = 'customer.deletion_triaged' THEN
        RAISE EXCEPTION 'Synthetic audit failure' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER test_fail_triage_audit BEFORE INSERT ON app_private.audit_events
      FOR EACH ROW EXECUTE FUNCTION app_private.test_fail_triage_audit();
  `);
  await deny(() => decide(db), '23514');
  assert.equal((await queue(db)).items.length, 1);
  await deny(() => original(db), 'P0002');
  await db.exec('DROP TRIGGER test_fail_triage_audit ON app_private.audit_events');
  assert.equal((await decide(db, { outcome: needsInfo })).disposition, needsInfo);
  assert.equal((await queue(db)).items.length, 0);
});
