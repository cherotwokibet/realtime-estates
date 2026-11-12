import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { fixture, asActor, scalar, T, OTHER, ADMIN } from './public-media-fixtures.mjs';

const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const customer = id(13);
const peer = id(14);
const requestId = id(700);
const device = id(900);
const rejects = (fn, code) => assert.rejects(fn, (error) => error.code === code);
const call = (db, sql, params = [], actor = customer, tenant = T) =>
  asActor(db, tenant, actor, () => scalar(db, sql, params));
const read = (db, actor, tenant) =>
  call(db, 'SELECT app_api.read_customer_deletion_request()', [], actor, tenant);
const submit = (db, request = requestId, confirmed = true, actor, tenant) =>
  call(db, 'SELECT app_api.request_customer_deletion($1,$2)', [request, confirmed], actor, tenant);
const prefs = (db, actor, tenant) =>
  call(db, 'SELECT app_api.read_customer_push_preferences()', [], actor, tenant);
const push = (db, op, version, action, enabled, registration, actor, tenant) =>
  call(
    db,
    'SELECT app_api.change_customer_push_preferences($1,$2,$3,$4,$5)',
    [id(op), version, action, enabled, registration],
    actor,
    tenant,
  );

async function setup(t) {
  const db = await fixture();
  t.after(() => db.close());
  for (const name of [
    'customer-favourites',
    'customer-push-preferences',
    'customer-deletion-requests',
  ]) {
    await db.exec(
      await readFile(new URL('../proposals/' + name + '.sql', import.meta.url), 'utf8'),
    );
  }
  await db.query(
    "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'customer'),($3,$4,'customer')",
    [T, peer, OTHER, customer],
  );
  return db;
}

test('confirmed request tracks review and withdraws current consent, preserving original push receipts', async (t) => {
  const db = await setup(t);
  assert.equal(await read(db), null);
  await push(db, 801, 0, 'consent', true, null);
  const original = await push(db, 802, 1, 'register', null, device);
  const result = await submit(db);
  assert.deepEqual(result, {
    policy: 'synthetic-customer-deletion-request-v1',
    tenantId: T,
    customerId: customer,
    requestId,
    status: 'pending_review',
    requestedAt: new Date(result.requestedAt).toISOString(),
  });
  assert.deepEqual(await read(db), result);
  assert.deepEqual(await submit(db), result);
  await rejects(() => submit(db, id(701)), '23505');
  assert.deepEqual(await prefs(db), {
    ...original.preferences,
    version: '3',
    enabled: false,
    activeDevices: 0,
    consentChangedAt: result.requestedAt,
  });
  assert.deepEqual(await push(db, 802, 1, 'register', null, device), original);
  await rejects(() => push(db, 803, 3, 'consent', true, null), '42501');
  await rejects(() => push(db, 804, 3, 'register', null, device), '42501');
  assert.equal((await prefs(db)).enabled, false);
});

test('requests need confirmation and current customer membership and stay isolated by account and company', async (t) => {
  const db = await setup(t);
  for (const confirmation of [false, null])
    await rejects(() => submit(db, requestId, confirmation), '23514');
  await rejects(() => submit(db, null), '23514');
  for (const actor of [null, ADMIN, id(999)]) {
    await rejects(() => submit(db, requestId, true, actor), '42501');
    await rejects(() => read(db, actor), '42501');
  }
  await rejects(() => call(db, 'SELECT * FROM app_private.customer_deletion_requests'), '42501');
  await push(db, 805, 0, 'consent', true, null, peer);
  await push(db, 805, 0, 'consent', true, null, customer, OTHER);
  await submit(db);
  assert.equal(await read(db, peer), null);
  assert.equal(await read(db, customer, OTHER), null);
  assert.equal((await prefs(db, peer)).enabled, true);
  assert.equal((await prefs(db, customer, OTHER)).enabled, true);
  assert.equal((await submit(db, requestId, true, peer)).customerId, peer);
  assert.equal((await submit(db, requestId, true, customer, OTHER)).tenantId, OTHER);
  await db.query(
    'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
    [T, customer],
  );
  await rejects(() => read(db), '42501');
  await rejects(() => submit(db), '42501');
});

test('an intake failure rolls back both the preference revision and device withdrawal', async (t) => {
  const db = await setup(t);
  await push(db, 801, 0, 'consent', true, null);
  const prior = (await push(db, 802, 1, 'register', null, device)).preferences;
  await db.exec(`
    CREATE FUNCTION app_private.test_reject_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Fixture intake failure' USING ERRCODE='23514'; END $$;
    CREATE TRIGGER test_reject_deletion BEFORE INSERT ON app_private.customer_deletion_requests
      FOR EACH ROW EXECUTE FUNCTION app_private.test_reject_deletion();
  `);
  await rejects(() => submit(db), '23514');
  assert.deepEqual(await prefs(db), prior);
  assert.equal(await read(db), null);
  await db.exec('DROP TRIGGER test_reject_deletion ON app_private.customer_deletion_requests');
  assert.equal((await submit(db)).status, 'pending_review');
  assert.equal((await prefs(db)).activeDevices, 0);
});

test('intake for default-off account keeps default preference state and blocks first opt-in', async (t) => {
  const db = await setup(t);
  const before = await prefs(db);
  await submit(db);
  assert.deepEqual(await prefs(db), before);
  await rejects(() => push(db, 801, 0, 'consent', true, null), '42501');
  assert.deepEqual(await prefs(db), before);
});

test('offline intake recovery restores exact withdrawal and receipt and refuses a divergent snapshot', async (t) => {
  const db = await setup(t);
  await db.exec(
    await readFile(
      new URL('../proposals/customer-deletion-intake-restore.sql', import.meta.url),
      'utf8',
    ),
  );
  await push(db, 801, 0, 'consent', true, null);
  const registration = await push(db, 802, 1, 'register', null, device);
  await push(db, 805, 0, 'consent', true, null, customer, OTHER);
  const otherPrefs = await prefs(db, customer, OTHER);
  const snapshot = await db.dumpDataDir();
  const original = await submit(db);
  const withdrawn = await prefs(db);
  const originalTime = await scalar(
    db,
    'SELECT requested_at::text FROM app_private.customer_deletion_requests WHERE tenant_id=$1 AND customer_id=$2',
    [T, customer],
  );
  const restored = await PGlite.create({ loadDataDir: snapshot });
  t.after(() => restored.close());

  const sql = 'SELECT app_private.replay_synthetic_deletion_intake($1,$2,$3,$4,$5)';
  const replay = (parameters) => scalar(restored, sql, parameters);
  const committed = [T, customer, requestId, originalTime, 2];
  const before = await prefs(restored);
  assert.equal(before.enabled, true);
  assert.equal(before.activeDevices, 1);
  assert.equal(await read(restored), null);
  await rejects(() => call(restored, sql, committed), '42501');
  await rejects(() => replay([T, customer, requestId, originalTime, 1]), '23514');
  assert.deepEqual(await prefs(restored), before);
  assert.equal(await read(restored), null);

  await restored.exec(`
    CREATE FUNCTION app_private.test_restore_abort() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Fixture restore failure' USING ERRCODE='23514'; END $$;
    CREATE TRIGGER test_restore_abort BEFORE INSERT ON app_private.customer_deletion_requests
      FOR EACH ROW EXECUTE FUNCTION app_private.test_restore_abort();
  `);
  await rejects(() => replay(committed), '23514');
  assert.deepEqual(await prefs(restored), before);
  assert.equal(await read(restored), null);
  await restored.exec('DROP TRIGGER test_restore_abort ON app_private.customer_deletion_requests');

  assert.equal(await replay(committed), true);
  assert.equal(await replay(committed), false);
  await rejects(() => replay([T, customer, id(701), originalTime, 2]), '23505');
  assert.deepEqual(await read(restored), original);
  assert.deepEqual(await submit(restored), original);
  assert.deepEqual(await prefs(restored), withdrawn);
  assert.deepEqual(await prefs(restored, customer, OTHER), otherPrefs);
  assert.equal(await read(restored, customer, OTHER), null);
  assert.deepEqual(await push(restored, 802, 1, 'register', null, device), registration);
  await rejects(() => push(restored, 803, 3, 'consent', true, null), '42501');
  assert.deepEqual(await prefs(restored), withdrawn);
});
