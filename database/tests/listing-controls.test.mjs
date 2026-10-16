import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import { validateListingControlReceipt } from '../../packages/domain/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1),
  A = id(10),
  U = id(11),
  P = id(12),
  C = id(13),
  L = id(100),
  O = id(200);
const scalar = async (db, sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
async function actor(db, user, work, tenant = T) {
  await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
  try {
    await db.query(
      "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
      [tenant, user],
    );
    const r = await work();
    await db.exec('COMMIT');
    return r;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}
async function fixture(version = '1') {
  const db = new PGlite();
  await applyTestMigrations(db);
  await db.query(
    "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'synthetic-controls','Synthetic controls')",
    [T],
  );
  for (const [u, r] of [
    [A, 'admin'],
    [U, 'agent'],
    [P, 'agent'],
    [C, 'customer'],
  ])
    await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
      T,
      u,
      r,
    ]);
  // Explicit privileged synthetic listing facts; control tests do not allocate/edit drafts.
  await db.query(
    "INSERT INTO app_private.listings(tenant_id,id,slug,created_by_id,assigned_agent_id,version) VALUES($1,$2,'synthetic-control-listing',$3,$3,$4)",
    [T, L, U, version],
  );
  return db;
}
const cmd = (
  kind = 'confirm_availability',
  target = 'available',
  expected = '1',
  operation = O,
) => ({
  operationId: operation,
  listingId: L,
  kind,
  expectedListingVersion: expected,
  ...(kind === 'confirm_availability' ? { availability: target } : { publicationStatus: target }),
});
async function write(db, q = cmd(), u = U) {
  const r = await actor(db, u, () =>
    scalar(db, 'SELECT app_api.control_listing($1,$2,$3,$4,$5)', [
      q.listingId,
      q.operationId,
      q.kind,
      q.expectedListingVersion,
      q.availability ?? q.publicationStatus,
    ]),
  );
  return validateListingControlReceipt(r, q, u);
}
const read = (db, u = U, kind = 'confirm_availability', operation = O) =>
  actor(db, u, () =>
    scalar(db, 'SELECT app_api.read_listing_control($1,$2,$3)', [L, operation, kind]),
  );
const count = (db, table) => scalar(db, `SELECT count(*)::int FROM app_private.${table}`);
test('original confirmation is immutable and exactly replayed after later publication changes', async () => {
  const db = await fixture();
  try {
    const q = cmd(),
      r = await write(db, q);
    assert.equal(r.decision.result.listingVersion, '2');
    await write(db, cmd('set_publication', 'archived', '2', id(201)), A);
    assert.deepEqual(await write(db, q), r);
    assert.deepEqual(await read(db), r);
    assert.equal(await count(db, 'audit_events'), 2);
    await assert.rejects(write(db, cmd('confirm_availability', 'sold')), (e) => e.code === '40001');
    await assert.rejects(write(db, cmd('set_publication', 'paused')), (e) => e.code === 'P0002');
    await assert.rejects(read(db, P), (e) => e.code === 'P0002');
    await actor(db, A, () => scalar(db, 'SELECT app_api.reassign_listing($1,3,$2)', [L, P]));
    await assert.rejects(read(db), (e) => e.code === 'P0002');
    await assert.rejects(write(db, q), (e) => e.code === 'P0002');
  } finally {
    await db.close();
  }
});
test('pause recovery survives later archive but fresh agent work and demoted admin history are denied', async () => {
  const db = await fixture();
  try {
    const q = cmd('set_publication', 'paused');
    const r = await write(db, q);
    await write(db, cmd('set_publication', 'archived', '2', id(201)), A);
    assert.deepEqual(await write(db, q), r);
    await assert.rejects(
      write(db, cmd('set_publication', 'paused', '3', id(202))),
      (e) => e.code === '42501',
    );
    assert.equal(await count(db, 'listing_control_requests'), 2);
    await db.query(
      "UPDATE app_private.memberships SET role='agent' WHERE tenant_id=$1 AND user_id=$2",
      [T, A],
    );
    await assert.rejects(read(db, A, 'set_publication', id(201)), (e) => e.code === 'P0002');
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [T, U],
    );
    await assert.rejects(read(db, U, 'set_publication'), (e) => e.code === '42501');
  } finally {
    await db.close();
  }
});
test('stale conflicts precede future clocks, confirmation refuses future clocks, safety archive remains possible', async () => {
  const db = await fixture();
  try {
    await db.query(
      "UPDATE app_private.listings SET last_availability_confirmed_at=now()+interval '1 day' WHERE tenant_id=$1 AND id=$2",
      [T, L],
    );
    const version = await scalar(db, 'SELECT version::text FROM app_private.listings WHERE id=$1', [
      L,
    ]);
    assert.equal((await write(db, cmd())).decision.reason, 'LISTING_CHANGED');
    assert.equal(
      (await write(db, cmd('confirm_availability', 'sold', version, id(201)))).decision.reason,
      'CONFIRMATION_CLOCK_INVALID',
    );
    assert.equal(
      (await write(db, cmd('set_publication', 'published', version, id(202)), A)).decision.reason,
      'CONFIRMATION_CLOCK_INVALID',
    );
    assert.equal(
      (await write(db, cmd('set_publication', 'archived', version, id(203)), A)).decision.outcome,
      'applied',
    );
    assert.equal(await count(db, 'audit_events'), 1);
  } finally {
    await db.close();
  }
});
test('publish requires an independently stored approved snapshot; nonavailable confirmation pauses without republishing', async () => {
  const db = await fixture();
  try {
    await write(db);
    assert.equal(
      (await write(db, cmd('set_publication', 'published', '2', id(201)), A)).decision.reason,
      'APPROVED_PUBLICATION_REQUIRED',
    );
    // Synthetic source fixture deliberately models published stock to exercise safety semantics.
    await db.query("UPDATE app_private.listings SET publication_status='published' WHERE id=$1", [
      L,
    ]);
    const v = await scalar(db, 'SELECT version::text FROM app_private.listings WHERE id=$1', [L]);
    await write(db, cmd('confirm_availability', 'sold', v, id(202)));
    assert.equal(
      await scalar(db, 'SELECT publication_status FROM app_private.listings WHERE id=$1', [L]),
      'paused',
    );
    await write(db, cmd('confirm_availability', 'available', String(BigInt(v) + 1n), id(203)));
    assert.equal(
      await scalar(db, 'SELECT publication_status FROM app_private.listings WHERE id=$1', [L]),
      'paused',
    );
  } finally {
    await db.close();
  }
});
test('unknown completion failure rolls back listing, audit and reservation; ledger tables deny runtime DML', async () => {
  const db = await fixture();
  try {
    await db.exec(
      "CREATE FUNCTION app_private.fail_control_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$;CREATE TRIGGER fail_control_test BEFORE INSERT ON app_private.listing_control_results FOR EACH ROW EXECUTE FUNCTION app_private.fail_control_test()",
    );
    await assert.rejects(write(db), /synthetic failure/);
    assert.equal(await count(db, 'listing_control_requests'), 0);
    assert.equal(await count(db, 'audit_events'), 0);
    assert.equal(
      await scalar(db, 'SELECT version::text FROM app_private.listings WHERE id=$1', [L]),
      '1',
    );
    await db.exec('DROP TRIGGER fail_control_test ON app_private.listing_control_results');
    await write(db);
    for (const table of ['listing_control_requests', 'listing_control_results']) {
      await assert.rejects(
        actor(db, U, () => db.query(`SELECT * FROM app_private.${table}`)),
        (e) => e.code === '42501',
      );
      await assert.rejects(db.query(`DELETE FROM app_private.${table}`), (e) => e.code === '23514');
      assert.equal(
        await scalar(db, 'SELECT relforcerowsecurity FROM pg_class WHERE oid=$1::regclass', [
          `app_private.${table}`,
        ]),
        true,
      );
    }
  } finally {
    await db.close();
  }
});
test('safe version exhaustion is durable without mutation and unauthorized malformed work never reserves', async () => {
  const db = await fixture('9007199254740991');
  try {
    assert.equal(
      await scalar(db, 'SELECT version::text FROM app_private.listings WHERE id=$1', [L]),
      '9007199254740991',
    );
    const q = cmd('confirm_availability', 'available', '9007199254740991');
    const r = await write(db, q);
    assert.equal(r.decision.reason, 'VERSION_LIMIT');
    assert.deepEqual(await write(db, q), r);
    await assert.rejects(
      write(db, cmd('set_publication', 'published', '9007199254740991', id(201))),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      write(db, cmd('confirm_availability', 'invalid', '1', id(202))),
      (e) => e.code === '23514',
    );
    await assert.rejects(
      write(db, cmd('confirm_availability', 'available', '1', id(203)), C),
      (e) => e.code === '42501',
    );
    assert.equal(await count(db, 'listing_control_requests'), 1);
    assert.equal(await count(db, 'audit_events'), 0);
  } finally {
    await db.close();
  }
});
test('admin publication selects existing approved snapshot without renewing confirmation; archive/reopen preserves it', async () => {
  const db = await fixture();
  try {
    await db.query(
      "INSERT INTO app_private.listing_revisions(tenant_id,listing_id,revision_no,state,title,description,purpose,property_type,currency,amount_minor,rent_period,bedrooms,country,locality) VALUES($1,$2,1,'approved','Synthetic approved','Fictional only','rent','apartment','KES',2000000,'month',1,'KE','Fictional area')",
      [T, L],
    );
    await db.query(
      "INSERT INTO app_private.public_snapshots(tenant_id,listing_id,revision_no,title,description,purpose,property_type,currency,amount_minor,rent_period,bedrooms,country,locality,public_precision,photo_refs,approved_at) VALUES($1,$2,1,'Synthetic approved','Fictional only','rent','apartment','KES',2000000,'month',1,'KE','Fictional area','area','[]',now())",
      [T, L],
    );
    await db.query(
      "UPDATE app_private.listings SET published_revision_no=1,last_availability_confirmed_at=now()-interval '1 day' WHERE id=$1",
      [L],
    );
    const before = (await db.query('SELECT * FROM app_private.listings WHERE id=$1', [L])).rows[0];
    const snapshot = (
      await db.query('SELECT * FROM app_private.public_snapshots WHERE listing_id=$1', [L])
    ).rows[0];
    const r = await write(db, cmd('set_publication', 'published', String(before.version)), A);
    assert.equal(r.decision.outcome, 'applied');
    const after = (await db.query('SELECT * FROM app_private.listings WHERE id=$1', [L])).rows[0];
    assert.equal(after.publication_status, 'published');
    assert.deepEqual(after.last_availability_confirmed_at, before.last_availability_confirmed_at);
    await write(db, cmd('set_publication', 'archived', String(after.version), id(201)), A);
    await write(
      db,
      cmd('confirm_availability', 'available', String(BigInt(after.version) + 1n), id(202)),
    );
    assert.equal(
      await scalar(db, 'SELECT publication_status FROM app_private.listings WHERE id=$1', [L]),
      'archived',
    );
    await write(
      db,
      cmd('set_publication', 'published', String(BigInt(after.version) + 2n), id(203)),
      A,
    );
    assert.equal(
      await scalar(db, 'SELECT archived_at FROM app_private.listings WHERE id=$1', [L]),
      null,
    );
    assert.deepEqual(
      (await db.query('SELECT * FROM app_private.public_snapshots WHERE listing_id=$1', [L]))
        .rows[0],
      snapshot,
    );
    await db.query(
      "UPDATE app_private.listings SET last_availability_confirmed_at=now()-interval '30 days' WHERE id=$1",
      [L],
    );
    const v = await scalar(db, 'SELECT version::text FROM app_private.listings WHERE id=$1', [L]);
    assert.equal(
      (await write(db, cmd('set_publication', 'published', v, id(204)), A)).decision.reason,
      'APPROVED_PUBLICATION_REQUIRED',
    );
  } finally {
    await db.close();
  }
});
test('incomplete reservations and incompatible results cannot commit; disabled tenants cannot read history', async () => {
  const db = await fixture();
  try {
    await assert.rejects(
      db.exec(
        `BEGIN;INSERT INTO app_private.listing_control_requests VALUES('${T}','${O}','${L}','${U}','confirm_availability',1,'available');COMMIT`,
      ),
      (e) => e.code === '23503',
    );
    await db.exec('ROLLBACK');
    assert.equal(await count(db, 'listing_control_requests'), 0);
    await assert.rejects(
      db.exec(
        `BEGIN;INSERT INTO app_private.listing_control_requests VALUES('${T}','${O}','${L}','${U}','confirm_availability',1,'available');INSERT INTO app_private.listing_control_results VALUES('${T}','${O}','${L}','applied',NULL,3,now());COMMIT`,
      ),
      (e) => e.code === '23514',
    );
    await db.exec('ROLLBACK');
    assert.equal(await count(db, 'listing_control_results'), 0);
    await write(db);
    await assert.rejects(
      actor(
        db,
        U,
        () =>
          scalar(db, 'SELECT app_api.read_listing_control($1,$2,$3)', [
            L,
            O,
            'confirm_availability',
          ]),
        id(2),
      ),
      (e) => ['42501', 'P0002'].includes(e.code),
    );
    await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
    await assert.rejects(read(db), (e) => e.code === '42501');
  } finally {
    await db.close();
  }
});
test('original receipt preserves six-digit UTC completion precision', async () => {
  const db = await fixture();
  try {
    await db.exec(
      `BEGIN;INSERT INTO app_private.listing_control_requests VALUES('${T}','${O}','${L}','${U}','confirm_availability',2,'available');INSERT INTO app_private.listing_control_results VALUES('${T}','${O}','${L}','conflict','LISTING_CHANGED',NULL,'2026-10-16T16:00:00.123456Z');COMMIT`,
    );
    const r = await read(db);
    assert.equal(r.completedAt, '2026-10-16T16:00:00.123456Z');
    assert.equal(
      validateListingControlReceipt(r, cmd('confirm_availability', 'available', '2'), U).decision
        .reason,
      'LISTING_CHANGED',
    );
  } finally {
    await db.close();
  }
});
