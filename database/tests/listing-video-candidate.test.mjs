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
  publish,
} from './public-media-fixtures.mjs';
import { seedGuardedListingDraft } from '../test-helpers/guarded-listing-fixture.mjs';
import {
  normalizeStaffDraftContentV2,
  validateListingVideoRecord,
} from '../../packages/domain/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  L = id(111),
  OP = id(900);
const command = (version = '2', operation = OP) => ({
  policy: 'synthetic-listing-video-command-v1',
  listingId: L,
  revision: 1,
  expectedVersion: version,
  operationId: operation,
  video: { provider: 'youtube', videoId: 'abcdefghijk', title: 'Synthetic tour' },
});
async function setup() {
  const db = await fixture();
  try {
    await db.exec(
      await readFile(new URL('../proposals/listing-video.sql', import.meta.url), 'utf8'),
    );
    await asActor(db, T, AGENT, () =>
      seedGuardedListingDraft(db, {
        listingId: L,
        slug: 'synthetic-video-draft',
        actorId: AGENT,
        content: normalizeStaffDraftContentV2({
          title: 'Synthetic video draft',
          pricing: { declaration: 'not_declared', charges: [] },
          location: { county: null, town: null, area: null },
        }),
      }),
    );
    return db;
  } catch (e) {
    await db.close();
    throw e;
  }
}
const save = (db, c = command(), actor = AGENT, tenant = T) =>
  asActor(db, tenant, actor, () =>
    scalar(db, 'SELECT app_api.save_synthetic_listing_video($1::jsonb)', [JSON.stringify(c)]),
  );
const original = (db, actor = AGENT, tenant = T) =>
  asActor(db, tenant, actor, () =>
    scalar(db, 'SELECT app_api.read_synthetic_listing_video_original($1,$2)', [L, OP]),
  );
const current = (db, actor = AGENT) =>
  asActor(db, T, actor, () => scalar(db, 'SELECT app_api.read_synthetic_listing_video($1,1)', [L]));
test('private video originals replay once, removal is explicit and stale/changed commands never overwrite', async () => {
  const db = await setup();
  try {
    assert.equal((await current(db)).video, null);
    const r = validateListingVideoRecord(await save(db), command());
    assert.equal(r.resultVersion, '3');
    assert.deepEqual(await original(db), r);
    assert.deepEqual(await save(db), r);
    await assert.rejects(
      () => save(db, { ...command(), video: null }),
      (e) => e.code === '40001',
    );
    await assert.rejects(
      () => save(db, command('2', id(901))),
      (e) => e.code === '40001',
    );
    assert.equal((await current(db)).version, '3');
    const clear = { ...command('3', id(902)), video: null };
    assert.equal((await save(db, clear)).resultVersion, '4');
    assert.equal((await current(db)).video, null);
    assert.deepEqual(await original(db), r);
    assert.equal(
      await scalar(
        db,
        'SELECT count(*)::integer FROM app_private.synthetic_listing_video_operations',
      ),
      2,
    );
    const audits = await db.query(
      "SELECT tenant_id,actor_id,object_type,object_id,object_version::text,correlation_id,summary FROM app_private.audit_events WHERE action='listing.private_video_saved' ORDER BY id",
    );
    assert.deepEqual(
      audits.rows,
      [
        [OP, '3'],
        [clear.operationId, '4'],
      ].map(([operationId, version]) => ({
        tenant_id: T,
        actor_id: AGENT,
        object_type: 'listing',
        object_id: L,
        object_version: version,
        correlation_id: 'synthetic-db-test',
        summary: { revision: 1, operationId },
      })),
    );
  } finally {
    await db.close();
  }
});
test('private video SQL rechecks assignment, role, tenant and revocation before originals or replay', async () => {
  const db = await setup();
  try {
    await save(db);
    for (const actor of [id(12), id(13), null])
      await assert.rejects(
        () => original(db, actor),
        (e) => ['42501', 'P0002'].includes(e.code),
      );
    await assert.rejects(
      () => original(db, id(20), OTHER),
      (e) => ['42501', 'P0002'].includes(e.code),
    );
    await db.query(
      'UPDATE app_private.listings SET assigned_agent_id=$1 WHERE tenant_id=$2 AND id=$3',
      [id(12), T, L],
    );
    await assert.rejects(
      () => original(db),
      (e) => e.code === 'P0002',
    );
    await assert.rejects(
      () => save(db),
      (e) => e.code === 'P0002',
    );
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [T, AGENT],
    );
    await assert.rejects(
      () => original(db),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      () =>
        asActor(db, T, ADMIN, () =>
          db.query('SELECT * FROM app_private.synthetic_listing_video_operations'),
        ),
      (e) => e.code === '42501',
    );
  } finally {
    await db.close();
  }
});
test('video transaction rollback and decided revision protection preserve published listing and defaults', async () => {
  const db = await setup();
  try {
    await assert.rejects(() =>
      asActor(db, T, AGENT, async () => {
        await scalar(db, 'SELECT app_api.save_synthetic_listing_video($1::jsonb)', [
          JSON.stringify(command()),
        ]);
        throw Error('Synthetic after-write rollback');
      }),
    );
    assert.equal((await current(db)).version, '2');
    assert.equal((await current(db)).video, null);
    for (const video of [
      { provider: 'youtube', videoId: 'abcdefghijk', title: '<script>' },
      { provider: 'youtube', videoId: 'https://private', title: 'Synthetic' },
    ])
      await assert.rejects(
        () => save(db, { ...command(), video }),
        (e) => e.code === '23514',
      );
    await publish(db);
    const publicBefore = await asActor(db, T, null, () =>
      db.query('SELECT * FROM app_api.public_listings'),
    );
    await assert.rejects(
      () => save(db, { ...command(), listingId: LISTING, expectedVersion: '4' }, ADMIN),
      (e) => e.code === '23514',
    );
    assert.deepEqual(
      await asActor(db, T, null, () => db.query('SELECT * FROM app_api.public_listings')),
      publicBefore,
    );
    assert.equal(
      await scalar(
        db,
        "SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app_api' AND p.proname LIKE '%video%'",
      ),
      3,
    );
  } finally {
    await db.close();
  }
});
