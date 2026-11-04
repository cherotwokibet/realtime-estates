import test from 'node:test';
import { seedGuardedListingDraft } from '../test-helpers/guarded-listing-fixture.mjs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import { seedSyntheticSealedMedia } from '../test-helpers/synthetic-sealed-media.mjs';
import {
  normalizeStaffDraftContentV2,
  validateListingSuccessorReceipt,
} from '../../packages/domain/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1),
  U = id(11),
  A = id(10),
  P = id(12),
  C = id(13),
  L = id(100),
  O = id(200);
async function actor(db, user, work) {
  await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
  try {
    await db.query(
      "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
      [T, user],
    );
    const result = await work();
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
const scalar = async (db, sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const content = () =>
  normalizeStaffDraftContentV2({
    title: 'Explicit synthetic successor',
    pricing: { declaration: 'not_declared', charges: [] },
    location: { county: null, town: null, area: null },
  });
const command = (operationId = O) => ({
  operationId,
  listingId: L,
  expectedListingVersion: '1',
  predecessor: { revision: 1, version: '4', state: 'rejected' },
  content: content(),
});
const start = (db, q = command(), user = U) =>
  actor(db, user, () =>
    scalar(db, 'SELECT app_api.start_listing_revision_v2($1,$2,$3,$4,$5,$6,$7::jsonb)', [
      q.listingId,
      q.operationId,
      q.expectedListingVersion,
      q.predecessor.revision,
      q.predecessor.version,
      q.predecessor.state,
      JSON.stringify(q.content),
    ]),
  );
const read = (db, user = U, operation = O) =>
  actor(db, user, () => scalar(db, 'SELECT app_api.read_listing_successor($1,$2)', [L, operation]));
async function fixture(approve = false) {
  const db = new PGlite();
  await applyTestMigrations(db);
  // Allocation restriction is part of the normal reviewed migration order.
  await db.query(
    "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'synthetic-successor','Synthetic successor')",
    [T],
  );
  for (const [user, role] of [
    [U, 'agent'],
    [A, 'admin'],
    [P, 'agent'],
    [C, 'customer'],
  ])
    await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
      T,
      user,
      role,
    ]);
  const full = {
    title: 'Synthetic predecessor apartment',
    description: 'Synthetic predecessor description only.',
    purpose: 'rent',
    propertyType: 'apartment',
    currency: 'KES',
    amountMinor: 2000000,
    rentPeriod: 'month',
    bedrooms: 1,
    privateBathrooms: 1,
    sharedBathrooms: null,
    country: 'KE',
    locality: 'Synthetic area',
    publicPrecision: 'area',
    latitude: null,
    longitude: null,
    privateAddress: 'PRIVATE FICTIONAL',
  };
  await actor(db, U, async () => {
    await seedGuardedListingDraft(db, {
      listingId: L,
      slug: 'synthetic-successor',
      actorId: U,
      content: {
        ...full,
        pricing: { declaration: 'not_declared', charges: [] },
        location: { county: null, town: null, area: null },
      },
    });
  });
  for (let position = 0; position < 4; position++)
    await seedSyntheticSealedMedia(db, {
      tenantId: T,
      listingId: L,
      revision: 1,
      position,
      mediaId: id(500 + position),
    });
  if (approve)
    await actor(db, U, () =>
      db.query("SELECT app_api.confirm_availability($1,1,'available')", [L]),
    );
  await actor(db, U, () => db.query('SELECT app_api.submit_revision($1,1,2)', [L]));
  await actor(db, A, () =>
    db.query("SELECT app_api.decide_revision($1,1,3,$2,'Synthetic revision required')", [
      L,
      approve,
    ]),
  );
  return db;
}
test('successor SQL allocates once with empty gallery and preserves terminal predecessor and original receipt', async () => {
  const db = await fixture();
  try {
    const before = (
      await db.query(
        'SELECT * FROM app_private.listing_revisions WHERE listing_id=$1 AND revision_no=1',
        [L],
      )
    ).rows[0];
    const q = command(),
      saved = await start(db, q);
    assert.deepEqual(validateListingSuccessorReceipt(saved, q, U), saved);
    assert.deepEqual(saved.decision, {
      outcome: 'applied',
      reason: null,
      result: { listingVersion: '2', revision: 2, revisionVersion: '2' },
    });
    assert.deepEqual(
      (
        await db.query(
          "SELECT tenant_id,actor_id,object_id,object_version::text,summary FROM app_private.audit_events WHERE action='revision.started'",
        )
      ).rows,
      [
        {
          tenant_id: T,
          actor_id: U,
          object_id: L,
          object_version: saved.decision.result.listingVersion,
          summary: { predecessor: 1, revision: 2, contract: 'v2' },
        },
      ],
    );
    assert.equal(
      await scalar(
        db,
        'SELECT count(*)::int FROM app_private.revision_media WHERE listing_id=$1 AND revision_no=2',
        [L],
      ),
      0,
    );
    assert.deepEqual(
      (
        await db.query(
          'SELECT * FROM app_private.listing_revisions WHERE listing_id=$1 AND revision_no=1',
          [L],
        )
      ).rows[0],
      before,
    );
    assert.deepEqual(
      (
        await db.query(
          'SELECT publication_status,published_revision_no FROM app_private.listings WHERE id=$1',
          [L],
        )
      ).rows[0],
      { publication_status: 'unpublished', published_revision_no: null },
    );
    await actor(db, U, () =>
      db.query('SELECT app_api.save_draft_v2($1,2,2,$2::jsonb)', [
        L,
        JSON.stringify({ ...q.content, title: 'Later deliberate edit' }),
      ]),
    );
    const audit = await scalar(db, 'SELECT count(*)::int FROM app_private.audit_events');
    assert.deepEqual(await read(db), saved);
    assert.deepEqual(await start(db, q), saved);
    assert.equal(await scalar(db, 'SELECT count(*)::int FROM app_private.audit_events'), audit);
    assert.equal(await scalar(db, 'SELECT count(*)::int FROM app_private.listing_revisions'), 2);
  } finally {
    await db.close();
  }
});
test('successor SQL retains stale conflict and rejects changed originals and unauthorized recovery', async () => {
  const db = await fixture();
  try {
    const stale = command();
    stale.expectedListingVersion = '2';
    const saved = await start(db, stale);
    assert.equal(saved.decision.outcome, 'conflict');
    assert.deepEqual(validateListingSuccessorReceipt(saved, stale, U), saved);
    assert.equal(await scalar(db, 'SELECT count(*)::int FROM app_private.listing_revisions'), 1);
    await assert.rejects(
      () => start(db, command()),
      (e) => e.code === '40001',
    );
    for (const user of [A, P])
      await assert.rejects(
        () => read(db, user),
        (e) => e.code === 'P0002',
      );
    await assert.rejects(
      () => read(db, C),
      (e) => e.code === '42501',
    );
    await actor(db, A, () => db.query('SELECT app_api.reassign_listing($1,1,$2)', [L, P]));
    await assert.rejects(
      () => read(db),
      (e) => e.code === 'P0002',
    );
    await actor(db, A, () => db.query('SELECT app_api.reassign_listing($1,2,$2)', [L, U]));
    assert.deepEqual(await read(db), saved);
  } finally {
    await db.close();
  }
});
test('successor failure after allocation rolls back revision, listing version, request and audit', async () => {
  const db = await fixture();
  try {
    const audits = await scalar(db, 'SELECT count(*)::int FROM app_private.audit_events');
    await db.exec(
      "CREATE FUNCTION app_private.synthetic_fail_successor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic failure' USING ERRCODE='23514'; END $$; CREATE TRIGGER synthetic_fail BEFORE INSERT ON app_private.listing_successor_results FOR EACH ROW EXECUTE FUNCTION app_private.synthetic_fail_successor()",
    );
    await assert.rejects(
      () => start(db),
      (e) => e.code === '23514',
    );
    assert.equal(await scalar(db, 'SELECT count(*)::int FROM app_private.listing_revisions'), 1);
    assert.equal(
      await scalar(db, 'SELECT count(*)::int FROM app_private.listing_successor_requests'),
      0,
    );
    assert.equal(await scalar(db, 'SELECT version FROM app_private.listings WHERE id=$1', [L]), 1);
    assert.equal(await scalar(db, 'SELECT count(*)::int FROM app_private.audit_events'), audits);
    await db.exec('DROP TRIGGER synthetic_fail ON app_private.listing_successor_results');
    assert.equal((await start(db)).decision.outcome, 'applied');
  } finally {
    await db.close();
  }
});
test('successor private ledgers are forced-RLS, immutable and require a completed reservation', async () => {
  const db = await fixture();
  try {
    await start(db);
    for (const table of ['listing_successor_requests', 'listing_successor_results']) {
      await assert.rejects(
        () => actor(db, U, () => db.query(`SELECT * FROM app_private.${table}`)),
        (e) => e.code === '42501',
      );
      await assert.rejects(() =>
        db.exec(`UPDATE app_private.${table} SET operation_id=operation_id`),
      );
      await assert.rejects(() => db.exec(`DELETE FROM app_private.${table}`));
    }
    await db.exec('BEGIN');
    await db.query(
      'INSERT INTO app_private.listing_successor_requests SELECT tenant_id,$1,listing_id,requester_id,expected_listing_version,predecessor_revision,predecessor_version,predecessor_state,content FROM app_private.listing_successor_requests',
      [id(299)],
    );
    await assert.rejects(
      () => db.exec('COMMIT'),
      (e) => e.code === '23503',
    );
    await db.exec('ROLLBACK');
    assert.equal(
      await scalar(db, 'SELECT count(*)::int FROM app_private.listing_successor_requests'),
      1,
    );
  } finally {
    await db.close();
  }
});

test('approved public snapshot and operational pause or archive survive successor allocation', async () => {
  for (const status of ['published', 'paused', 'archived']) {
    const db = await fixture(true);
    try {
      let v = String(await scalar(db, 'SELECT version FROM app_private.listings WHERE id=$1', [L]));
      if (status !== 'published')
        await actor(db, A, () =>
          db.query('SELECT app_api.set_publication($1,$2,$3)', [L, v, status]),
        );
      v = String(await scalar(db, 'SELECT version FROM app_private.listings WHERE id=$1', [L]));
      const snapshot = (
        await db.query('SELECT * FROM app_private.public_snapshots WHERE listing_id=$1', [L])
      ).rows;
      const operational = (
        await db.query(
          'SELECT availability,publication_status,published_revision_no,last_availability_confirmed_at,archived_at,assigned_agent_id FROM app_private.listings WHERE id=$1',
          [L],
        )
      ).rows;
      const q = command();
      q.expectedListingVersion = v;
      q.predecessor.state = 'approved';
      const saved = await start(db, q);
      assert.equal(saved.decision.outcome, 'applied');
      assert.deepEqual(validateListingSuccessorReceipt(saved, q, U), saved);
      assert.deepEqual(
        (await db.query('SELECT * FROM app_private.public_snapshots WHERE listing_id=$1', [L]))
          .rows,
        snapshot,
      );
      assert.deepEqual(
        (
          await db.query(
            'SELECT availability,publication_status,published_revision_no,last_availability_confirmed_at,archived_at,assigned_agent_id FROM app_private.listings WHERE id=$1',
            [L],
          )
        ).rows,
        operational,
      );
    } finally {
      await db.close();
    }
  }
});
test('candidate zero-version allocation is denied without changing the predecessor or blocking guarded succession', async () => {
  const db = await fixture();
  try {
    const before = (
      await db.query('SELECT * FROM app_private.listing_revisions WHERE listing_id=$1', [L])
    ).rows;
    await assert.rejects(
      () =>
        actor(db, U, () =>
          db.query('SELECT app_api.save_draft_v2($1,2,0,$2::jsonb)', [
            L,
            JSON.stringify(content()),
          ]),
        ),
      (e) => e.code === '40001',
    );
    assert.deepEqual(
      (await db.query('SELECT * FROM app_private.listing_revisions WHERE listing_id=$1', [L])).rows,
      before,
    );
    const result = await start(db);
    assert.equal(result.decision.outcome, 'applied');
    assert.equal(await scalar(db, 'SELECT count(*)::int FROM app_private.listing_revisions'), 2);
    assert.equal(await scalar(db, 'SELECT version FROM app_private.listings WHERE id=$1', [L]), 2);
  } finally {
    await db.close();
  }
});
test('malformed successor facts and denied initial authority leave no private reservation', async () => {
  const db = await fixture();
  try {
    for (const mutate of [
      (q) => (q.predecessor.state = 'draft'),
      (q) => (q.expectedListingVersion = '0'),
      (q) => (q.operationId = '00000000-0000-0000-0000-000000000000'),
      (q) => (q.content = { ...q.content, actorId: U }),
    ]) {
      const q = command();
      mutate(q);
      await assert.rejects(
        () => start(db, q),
        (e) => e.code === '23514',
      );
    }
    await assert.rejects(
      () => start(db, command(), P),
      (e) => e.code === 'P0002',
    );
    await assert.rejects(
      () => start(db, command(), C),
      (e) => e.code === '42501',
    );
    assert.equal(
      await scalar(db, 'SELECT count(*)::int FROM app_private.listing_successor_requests'),
      0,
    );
  } finally {
    await db.close();
  }
});
