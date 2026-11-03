import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  fixture,
  asActor,
  scalar,
  T,
  OTHER,
  ADMIN,
  AGENT,
  LISTING,
} from './public-media-fixtures.mjs';

const otherAdmin = '00000000-0000-4000-8000-000000000020';
const customer = '00000000-0000-4000-8000-000000000013';
async function setup() {
  const db = await fixture();
  await db.exec(
    await readFile(new URL('../proposals/admin-audit-reads.sql', import.meta.url), 'utf8'),
  );
  return db;
}
async function event(db, tenant = T, actor = ADMIN, object = LISTING) {
  return scalar(
    db,
    `INSERT INTO app_private.audit_events
    (tenant_id,actor_id,action,object_type,object_id,object_version,correlation_id,summary)
    VALUES($1,$2,'listing.reassigned','listing',$3,9007199254740993,
     'PRIVATE CORRELATION', '{"email":"PRIVATE EMAIL","reason":"PRIVATE REASON"}') RETURNING id::text`,
    [tenant, actor, object],
  );
}
const page = (
  db,
  { limit = 20, before = null, actor = null, object = null, tenant = T, user = ADMIN } = {},
) =>
  asActor(db, tenant, user, () =>
    scalar(db, 'SELECT app_api.list_admin_audit_events($1,$2,$3,$4)', [
      limit,
      before,
      actor,
      object,
    ]),
  );
const denied = (fn, code = '42501') => assert.rejects(fn, (e) => e.code === code);

test('audit projection preserves exact metadata and bigint facts without private payloads or foreign events', async () => {
  const db = await setup();
  try {
    const own = await event(db);
    await event(db, OTHER, otherAdmin);
    const result = await page(db);
    assert.equal(result.policy, 'admin-audit-page-v1');
    assert.equal(result.tenantId, T);
    assert.equal(result.items.length, 1);
    assert.equal(result.nextBefore, null);
    const row = result.items[0];
    assert.deepEqual(
      Object.keys(row).sort(),
      ['action', 'actorId', 'id', 'objectId', 'objectType', 'objectVersion', 'occurredAt'].sort(),
    );
    assert.equal(row.id, own);
    assert.equal(row.objectVersion, '9007199254740993');
    assert.equal(row.actorId, ADMIN);
    assert.equal(row.action, 'listing.reassigned');
    assert.equal(row.objectId, LISTING);
    assert.ok(Number.isFinite(Date.parse(row.occurredAt)));
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|summary|correlation|email|reason/);
    assert.equal((await page(db, { tenant: OTHER, user: otherAdmin })).items.length, 1);
    assert.equal((await page(db, { actor: otherAdmin })).items.length, 0);
  } finally {
    await db.close();
  }
});

test('descending bounded pagination and exact UUID filters preserve rows across newer inserts', async () => {
  const db = await setup();
  try {
    const first = await event(db);
    const second = await event(db, T, AGENT);
    const third = await event(db);
    const top = await page(db, { limit: 2 });
    assert.deepEqual(
      top.items.map((x) => x.id),
      [third, second],
    );
    assert.equal(top.nextBefore, second);
    await event(db);
    const tail = await page(db, { limit: 2, before: top.nextBefore });
    assert.deepEqual(
      tail.items.map((x) => x.id),
      [first],
    );
    assert.equal(tail.nextBefore, null);
    assert.equal((await page(db, { actor: AGENT, object: LISTING })).items.length, 1);
    assert.equal((await page(db, { object: customer })).items.length, 0);
    for (const limit of [null, 0, -1, 21]) await denied(() => page(db, { limit }), '23514');
    for (const before of ['0', '-1']) await denied(() => page(db, { before }), '23514');
  } finally {
    await db.close();
  }
});

test('every read rechecks current admin authority and company enablement; audit stays append-only', async () => {
  const db = await setup();
  try {
    await event(db);
    for (const user of [AGENT, customer, otherAdmin, null]) await denied(() => page(db, { user }));
    await denied(() => page(db, { tenant: OTHER }));
    await db.query(
      "UPDATE app_private.memberships SET role='agent' WHERE tenant_id=$1 AND user_id=$2",
      [T, ADMIN],
    );
    await denied(() => page(db));
    await db.query(
      "UPDATE app_private.memberships SET role='admin',active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2",
      [T, ADMIN],
    );
    await denied(() => page(db));
    await db.query(
      'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
      [T, ADMIN],
    );
    await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
    await denied(() => page(db));
    await db.query('UPDATE app_private.tenants SET enabled=true WHERE id=$1', [T]);
    assert.equal((await page(db)).items.length, 1);
    await denied(() =>
      asActor(db, T, ADMIN, () => db.exec('DELETE FROM app_private.audit_events')),
    );
    await denied(() => db.exec('DELETE FROM app_private.audit_events'), '23514');
    await denied(() => db.exec("UPDATE app_private.audit_events SET action='changed'"), '23514');
  } finally {
    await db.close();
  }
});
