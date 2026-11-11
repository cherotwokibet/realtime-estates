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
