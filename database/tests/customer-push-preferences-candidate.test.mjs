import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture, asActor, scalar, T, OTHER, ADMIN, AGENT } from './public-media-fixtures.mjs';

const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const customer = id(13);
const peer = id(14);
const registration = id(3001);
const denied = (call, code = '42501') => assert.rejects(call, (error) => error.code === code);
const read = (db, actor = customer, tenant = T) =>
  asActor(db, tenant, actor, () => scalar(db, 'SELECT app_api.read_customer_push_preferences()'));
const write = (db, expected, action, enabled, key, actor = customer, tenant = T) =>
  asActor(db, tenant, actor, () =>
    scalar(db, 'SELECT app_api.change_customer_push_preferences($1,$2,$3,$4)', [
      expected,
      action,
      enabled,
      key,
    ]),
  );

async function setup() {
  const db = await fixture();
  try {
    for (const file of ['customer-favourites.sql', 'customer-push-preferences.sql'])
      await db.exec(await readFile(new URL('../proposals/' + file, import.meta.url), 'utf8'));
    await db.query(
      "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'customer'),($3,$4,'customer')",
      [T, peer, OTHER, customer],
    );
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

test('push is off by default and opt-out deactivates devices without revival on later consent', async () => {
  const db = await setup();
  try {
    assert.deepEqual(await read(db), {
      policy: 'synthetic-customer-push-preferences-v1',
      tenantId: T,
      customerId: customer,
      version: '0',
      enabled: false,
      activeDevices: 0,
      consentChangedAt: null,
    });
    await denied(() => write(db, 0, 'register', null, registration));
    assert.equal((await write(db, 0, 'consent', false, null)).outcome, 'unchanged');
    const optedIn = await write(db, 0, 'consent', true, null);
    assert.equal(optedIn.version, '1');
    assert.equal(new Date(optedIn.consentChangedAt).toISOString(), optedIn.consentChangedAt);
    const enrolled = await write(db, 1, 'register', null, registration);
    assert.equal(enrolled.version, '2');
    assert.equal(enrolled.activeDevices, 1);
    assert.equal(enrolled.consentChangedAt, optedIn.consentChangedAt);
    assert.equal((await write(db, 1, 'register', null, registration)).outcome, 'conflict');
    assert.equal((await write(db, 2, 'register', null, registration)).outcome, 'unchanged');
    const disabled = await write(db, 2, 'consent', false, null);
    assert.equal(disabled.version, '3');
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.activeDevices, 0);
    const restored = await write(db, 3, 'consent', true, null);
    assert.equal(restored.activeDevices, 0);
    assert.equal((await write(db, 2, 'register', null, registration)).outcome, 'conflict');
    assert.equal((await write(db, 4, 'register', null, registration)).activeDevices, 1);
    const removed = await write(db, 5, 'revoke', null, registration);
    assert.equal(removed.activeDevices, 0);
    assert.equal(removed.version, '6');
    assert.equal((await write(db, 6, 'revoke', null, registration)).outcome, 'unchanged');
  } finally {
    await db.close();
  }
});

test('registration ownership survives opt-out and prevents account and brand reassignment', async () => {
  const db = await setup();
  try {
    await write(db, 0, 'consent', true, null);
    await write(db, 1, 'register', null, registration);
    await write(db, 0, 'consent', true, null, peer);
    await write(db, 0, 'consent', true, null, customer, OTHER);
    await denied(() => write(db, 1, 'register', null, registration, peer));
    await denied(() => write(db, 1, 'register', null, registration, customer, OTHER));
    assert.deepEqual(
      await write(db, 1, 'revoke', null, registration, peer),
      await write(db, 1, 'revoke', null, id(4000), peer),
    );
    assert.equal((await read(db)).activeDevices, 1);
    await write(db, 2, 'consent', false, null);
    await denied(() => write(db, 1, 'register', null, registration, peer));
    assert.equal((await read(db, peer)).activeDevices, 0);
    assert.equal((await read(db, customer, OTHER)).activeDevices, 0);
  } finally {
    await db.close();
  }
});

test('current customer access, command shape, version and active device limit are enforced in SQL', async () => {
  const db = await setup();
  try {
    for (const actor of [null, ADMIN, AGENT, id(999)]) {
      await denied(() => read(db, actor));
      await denied(() => write(db, 0, 'consent', true, null, actor));
    }
    await denied(() =>
      asActor(db, T, customer, () =>
        db.query('SELECT * FROM app_private.customer_push_registrations'),
      ),
    );
    await denied(() =>
      asActor(db, T, customer, () =>
        db.query('SELECT * FROM app_private.customer_push_preferences'),
      ),
    );
    for (const command of [
      [-1, 'consent', true, null],
      [0, 'register', true, registration],
      [0, 'consent', true, registration],
      [0, 'unknown', null, registration],
    ])
      await denied(() => write(db, ...command), '23514');
    await write(db, 0, 'consent', true, null);
    for (let i = 0; i < 10; i++) {
      const value = await write(db, i + 1, 'register', null, id(5000 + i));
      assert.equal(value.activeDevices, i + 1);
    }
    await denied(() => write(db, 11, 'register', null, id(5010)), '54000');
    assert.equal((await read(db)).version, '11');
    assert.equal((await write(db, 11, 'register', null, id(5000))).outcome, 'unchanged');
    await write(db, 11, 'revoke', null, id(5000));
    await db.query(
      'INSERT INTO app_private.customer_push_registrations SELECT id, $1, $2, false FROM unnest($3::uuid[]) AS id',
      [T, customer, Array.from({ length: 40 }, (_, i) => id(6000 + i))],
    );
    await denied(() => write(db, 12, 'register', null, id(5010)), '54000');
    assert.equal((await write(db, 12, 'register', null, id(5000))).activeDevices, 10);
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [T, customer],
    );
    await denied(() => read(db));
    await denied(() => write(db, 13, 'consent', false, null));
  } finally {
    await db.close();
  }
});
