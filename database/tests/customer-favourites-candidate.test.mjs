import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
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
  validateCustomerFavouriteCommand,
  validateCustomerFavouriteReceipt,
  validateCustomerFavouritesPage,
  validateCustomerAccount,
  validateCustomerFavouriteState,
} from '../../packages/domain/dist/index.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const CUSTOMER = id(13),
  PEER = id(14);
const scope = { tenantId: T, customerId: CUSTOMER };
async function setup() {
  const db = await fixture();
  await publish(db);
  await db.exec(
    await readFile(new URL('../proposals/customer-favourites.sql', import.meta.url), 'utf8'),
  );
  await db.query(
    "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'customer'),($3,$2,'customer'),($3,$4,'customer')",
    [T, PEER, OTHER, CUSTOMER],
  );
  return db;
}
const command = (op = 1000, expected = '0', saved = true, listing = LISTING) =>
  validateCustomerFavouriteCommand({
    policy: 'customer-favourite-command-v1',
    operationId: id(op),
    listingId: listing,
    expectedVersion: expected,
    saved,
  });
const who = (db, fn, u = CUSTOMER, t = T) => asActor(db, t, u, fn);
const save = (db, c = command(), u = CUSTOMER, t = T) =>
  who(
    db,
    () =>
      scalar(db, 'SELECT app_api.set_customer_favourite($1,$2,$3,$4)', [
        c.operationId,
        c.listingId,
        c.expectedVersion,
        c.saved,
      ]),
    u,
    t,
  );
const original = (db, op = 1000, u = CUSTOMER, t = T) =>
  who(db, () => scalar(db, 'SELECT app_api.read_customer_favourite_operation($1)', [id(op)]), u, t);
const page = (db, limit = 20, after = null, u = CUSTOMER, t = T) =>
  who(db, () => scalar(db, 'SELECT app_api.list_customer_favourites($1,$2)', [limit, after]), u, t);
const denied = (fn, code = '42501') => assert.rejects(fn, (e) => e.code === code);
test('desired-state writes retain exact original, no-op, terminal stale conflict and tombstone version', async () => {
  const db = await setup();
  try {
    const initial = validateCustomerFavouriteState(
      await who(db, () => scalar(db, 'SELECT app_api.read_customer_favourite($1)', [LISTING])),
      scope,
      LISTING,
    );
    assert.equal(initial.version, '0');
    assert.equal(initial.saved, false);
    const c = command(),
      r = validateCustomerFavouriteReceipt(await save(db, c), c, scope);
    assert.equal(r.outcome, 'applied');
    assert.equal(r.version, '1');
    assert.deepEqual(await original(db), r);
    assert.deepEqual(await save(db, c), r);
    const stale = command(1001, '0', false);
    assert.equal((await save(db, stale)).outcome, 'conflict');
    const removed = command(1002, '1', false);
    assert.equal((await save(db, removed)).version, '2');
    assert.deepEqual(await save(db, stale), await original(db, 1001));
    assert.equal((await save(db, command(1003, '2', false))).outcome, 'unchanged');
    assert.equal((await save(db, command(1004, '2', true))).version, '3');
    await denied(() => save(db, { ...c, saved: false }), '23505');
    validateCustomerFavouritesPage(await page(db), scope);
    validateCustomerAccount(
      await who(db, () => scalar(db, 'SELECT app_api.customer_account()')),
      scope,
    );
    assert.equal((await page(db)).items.length, 1);
    assert.equal((await page(db, 20, null, PEER)).items.length, 0);
    await denied(() => original(db, 1000, PEER), 'P0002');
  } finally {
    await db.close();
  }
});
test('current customer role, company and raw storage fence reads and writes including original recovery', async () => {
  const db = await setup();
  try {
    await save(db);
    for (const u of [null, AGENT, ADMIN, id(999)]) {
      await denied(() => page(db, 20, null, u));
      await denied(() => save(db, command(2000), u));
      await denied(() => original(db, 1000, u));
    }
    await denied(() => original(db, 1000, CUSTOMER, OTHER), 'P0002');
    assert.deepEqual((await page(db, 20, null, CUSTOMER, OTHER)).items, []);
    await denied(() => save(db, command(2001, '0', true, id(999))), 'P0002');
    await denied(() => save(db, command(2002), PEER, OTHER), 'P0002');
    for (const table of ['customer_favourites', 'customer_favourite_operations'])
      for (const sql of ['SELECT * FROM', 'DELETE FROM'])
        await denied(() => who(db, () => db.query(sql + ' app_private.' + table)));
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [T, CUSTOMER],
    );
    await denied(() => original(db));
    await denied(() => page(db));
    await denied(() => save(db, command(2003, '1', false)));
    await db.query(
      'UPDATE app_private.memberships SET active=true,revoked_at=null WHERE tenant_id=$1 AND user_id=$2',
      [T, CUSTOMER],
    );
    await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
    await denied(() => page(db));
    await denied(() => original(db));
  } finally {
    await db.close();
  }
});
test('saved unavailable property reveals no private snapshot and can still be removed', async () => {
  const db = await setup();
  try {
    await save(db);
    await db.query(
      "UPDATE app_private.listings SET publication_status='paused' WHERE tenant_id=$1 AND id=$2",
      [T, LISTING],
    );
    const p = validateCustomerFavouritesPage(await page(db), scope);
    assert.deepEqual(p.items, [{ listingId: LISTING, version: '1', available: false }]);
    assert.equal(JSON.stringify(p).includes('title'), false);
    await denied(() => save(db, command(3000), PEER), 'P0002');
    assert.equal((await save(db, command(3001, '1', false))).saved, false);
    assert.deepEqual((await page(db)).items, []);
    assert.equal((await original(db)).saved, true);
  } finally {
    await db.close();
  }
});
test('bounded cursor pages and per-customer quota do not expose other customers or allow overflow', async () => {
  const db = await setup();
  try {
    // Privileged fixture creates100 saved rows; runtime never receives direct table permissions.
    for (let n = 0; n < 100; n++) {
      const listing = id(4000 + n);
      await db.query(
        'INSERT INTO app_private.listings(tenant_id,id,slug,created_by_id,assigned_agent_id) VALUES($1,$2,$3,$4,$5)',
        [T, listing, 'quota-' + n, ADMIN, AGENT],
      );
      await db.query('INSERT INTO app_private.customer_favourites VALUES($1,$2,$3,1,true)', [
        T,
        CUSTOMER,
        listing,
      ]);
    }
    const first = validateCustomerFavouritesPage(await page(db, 50), scope, 50);
    assert.equal(first.items.length, 50);
    assert.equal(first.hasMore, true);
    const second = validateCustomerFavouritesPage(
      await page(db, 50, first.items.at(-1).listingId),
      scope,
      50,
      first.items.at(-1).listingId,
    );
    assert.equal(second.items.length, 50);
    assert.equal(second.hasMore, false);
    assert.equal(new Set([...first.items, ...second.items].map((x) => x.listingId)).size, 100);
    await denied(() => save(db), '54000');
    assert.equal((await page(db, 20, null, PEER)).items.length, 0);
    assert.equal((await save(db, command(), PEER)).saved, true);
    for (const limit of [null, 0, 51]) await denied(() => page(db, limit), '23514');
  } finally {
    await db.close();
  }
});
test('receipt is durable across actual close/reopen and rollback cannot leave a saved state without its receipt', async () => {
  const db = await setup();
  let restored;
  try {
    const r = await save(db);
    const snap = await db.dumpDataDir();
    restored = await PGlite.create({ loadDataDir: snap });
    await db.close();
    assert.deepEqual(await original(restored), r);
    assert.equal((await page(restored)).items.length, 1);
    // Force receipt insertion failure after state update; caller transaction must roll both back.
    await restored.exec(
      "CREATE FUNCTION app_private.fail_favourite_receipt() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic receipt fault' USING ERRCODE='23514';END$$;CREATE TRIGGER synthetic_receipt_fault BEFORE INSERT ON app_private.customer_favourite_operations FOR EACH ROW EXECUTE FUNCTION app_private.fail_favourite_receipt();",
    );
    await denied(() => save(restored, command(5000, '1', false)), '23514');
    assert.equal((await page(restored)).items[0].version, '1');
    await denied(() => original(restored, 5000), 'P0002');
  } finally {
    await restored?.close();
    if (!db.closed) await db.close();
  }
});
