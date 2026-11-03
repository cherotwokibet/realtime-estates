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
import {
  seedGuardedListingDraft,
  seedGuardedListingSuccessor,
} from '../test-helpers/guarded-listing-fixture.mjs';
import { seedSyntheticSealedMedia } from '../test-helpers/synthetic-sealed-media.mjs';
import { validatePublishedListingVideo } from '../../packages/domain/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function setup() {
  const db = await fixture();
  try {
    for (const f of ['listing-video.sql', 'listing-video-publication.sql'])
      await db.exec(await readFile(new URL('../proposals/' + f, import.meta.url), 'utf8'));
    return db;
  } catch (e) {
    await db.close();
    throw e;
  }
}
const publicRead = (db, listing = LISTING, tenant = T) =>
  asActor(db, tenant, null, () =>
    scalar(db, 'SELECT app_api.read_synthetic_published_listing_video($1,1)', [listing]),
  );
test('approved video captures reviewed metadata atomically and anonymous reads follow current public eligibility', async () => {
  const db = await setup();
  try {
    const content = {
      title: 'Synthetic tour apartment',
      description: 'Synthetic only',
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
      latitude: -1.3,
      longitude: 36.8,
      privateAddress: null,
      pricing: { declaration: 'not_declared', charges: [] },
      location: { county: null, town: null, area: null },
    };
    const r = await asActor(db, T, AGENT, () =>
      seedGuardedListingDraft(db, {
        listingId: LISTING,
        slug: 'synthetic-video-publication',
        actorId: AGENT,
        content,
      }),
    );
    let version = r.result.revisionVersion;
    const video = { provider: 'youtube', videoId: 'abcdefghijk', title: 'Synthetic tour' };
    const command = {
      policy: 'synthetic-listing-video-command-v1',
      operationId: id(999),
      listingId: LISTING,
      revision: 1,
      expectedVersion: version,
      video,
    };
    version = (
      await asActor(db, T, AGENT, () =>
        scalar(db, 'SELECT app_api.save_synthetic_listing_video($1::jsonb)', [
          JSON.stringify(command),
        ]),
      )
    ).resultVersion;
    for (let i = 0; i < 4; i++)
      await seedSyntheticSealedMedia(db, {
        tenantId: T,
        listingId: LISTING,
        revision: 1,
        position: i,
        mediaId: id(800 + i),
      });
    await asActor(db, T, AGENT, () =>
      scalar(db, "SELECT app_api.confirm_availability($1,1,'available')", [LISTING]),
    );
    const pending = await asActor(db, T, AGENT, () =>
      scalar(db, 'SELECT app_api.submit_revision($1,1,$2)', [LISTING, version]),
    );
    await assert.rejects(() => publicRead(db));
    const review = await asActor(db, T, ADMIN, () =>
      scalar(db, 'SELECT app_api.read_synthetic_review_listing_video($1,1,$2)', [LISTING, pending]),
    );
    assert.deepEqual(review.video, video);
    await assert.rejects(
      () =>
        asActor(db, T, AGENT, () =>
          scalar(db, 'SELECT app_api.read_synthetic_review_listing_video($1,1,$2)', [
            LISTING,
            pending,
          ]),
        ),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      () =>
        asActor(db, T, ADMIN, () =>
          scalar(db, 'SELECT app_api.read_synthetic_review_listing_video($1,1,$2)', [LISTING, '1']),
        ),
      (e) => e.code === '40001',
    );
    await assert.rejects(() =>
      asActor(db, T, ADMIN, async () => {
        await scalar(db, 'SELECT app_api.decide_revision($1,1,$2,true)', [LISTING, pending]);
        throw Error('Synthetic after-capture transaction failure');
      }),
    );
    assert.equal(
      await scalar(
        db,
        'SELECT count(*)::integer FROM app_private.synthetic_approved_listing_video',
      ),
      0,
    );
    await assert.rejects(() => publicRead(db));
    assert.deepEqual(
      (
        await asActor(db, T, ADMIN, () =>
          scalar(db, 'SELECT app_api.read_synthetic_review_listing_video($1,1,$2)', [
            LISTING,
            pending,
          ]),
        )
      ).video,
      video,
    );
    await asActor(db, T, ADMIN, () =>
      scalar(db, 'SELECT app_api.decide_revision($1,1,$2,true)', [LISTING, pending]),
    );
    const result = validatePublishedListingVideo(await publicRead(db), LISTING, 1);
    assert.deepEqual(result.video, video);
    assert.ok(!JSON.stringify(result).includes('operationId'));
    await assert.rejects(() => publicRead(db, LISTING, OTHER));
    await assert.rejects(
      () =>
        asActor(db, T, ADMIN, () =>
          db.query('SELECT * FROM app_private.synthetic_approved_listing_video'),
        ),
      (e) => e.code === '42501',
    );
    await assert.rejects(() =>
      db.query("UPDATE app_private.synthetic_approved_listing_video SET video='null'::jsonb"),
    );
    // A successor cannot silently replace the approved predecessor video.
    const listingVersion = await scalar(
      db,
      'SELECT version::text FROM app_private.listings WHERE tenant_id=$1 AND id=$2',
      [T, LISTING],
    );
    const successor = await asActor(db, T, AGENT, () =>
      seedGuardedListingSuccessor(db, {
        listingId: LISTING,
        actorId: AGENT,
        expectedListingVersion: listingVersion,
        predecessor: { revision: 1, version: result.approvedVersion, state: 'approved' },
        content,
      }),
    );
    assert.equal(successor.decision.result.revision, 2);
    assert.deepEqual(await publicRead(db), result);
    const next = await asActor(db, T, AGENT, () =>
      scalar(db, 'SELECT app_api.read_synthetic_listing_video($1,2)', [LISTING]),
    );
    assert.equal(next.video, null, 'No implicit copy of provider metadata into a new draft');
    const clear = {
      ...command,
      operationId: id(1000),
      revision: 2,
      expectedVersion: next.version,
      video: null,
    };
    const cleared = await asActor(db, T, AGENT, () =>
      scalar(db, 'SELECT app_api.save_synthetic_listing_video($1::jsonb)', [JSON.stringify(clear)]),
    );
    assert.deepEqual(
      await publicRead(db),
      result,
      'Explicit private removal must not unpublish predecessor metadata',
    );
    for (let i = 0; i < 4; i++)
      await seedSyntheticSealedMedia(db, {
        tenantId: T,
        listingId: LISTING,
        revision: 2,
        position: i,
        mediaId: id(810 + i),
      });
    const pending2 = await asActor(db, T, AGENT, () =>
      scalar(db, 'SELECT app_api.submit_revision($1,2,$2)', [LISTING, cleared.resultVersion]),
    );
    assert.deepEqual(await publicRead(db), result);
    await asActor(db, T, ADMIN, () =>
      scalar(db, 'SELECT app_api.decide_revision($1,2,$2,true)', [LISTING, pending2]),
    );
    const latest = await asActor(db, T, null, () =>
      scalar(db, 'SELECT app_api.read_synthetic_published_listing_video($1,2)', [LISTING]),
    );
    assert.equal(latest.video, null);
    await assert.rejects(
      () => publicRead(db),
      (e) => e.code === 'P0002',
    );
    const oldSnapshot = await scalar(
      db,
      'SELECT video FROM app_private.synthetic_approved_listing_video WHERE tenant_id=$1 AND listing_id=$2 AND revision_no=1',
      [T, LISTING],
    );
    assert.deepEqual(oldSnapshot, video, 'Historical approved video remains immutable');
    await db.query(
      "UPDATE app_private.listings SET publication_status='paused' WHERE tenant_id=$1 AND id=$2",
      [T, LISTING],
    );
    await assert.rejects(() => publicRead(db));
  } finally {
    await db.close();
  }
});
test('pre-extension approved stock returns no inferred video and no private identifiers', async () => {
  const db = await fixture();
  try {
    await publish(db);
    for (const f of ['listing-video.sql', 'listing-video-publication.sql'])
      await db.exec(await readFile(new URL('../proposals/' + f, import.meta.url), 'utf8'));
    const r = await publicRead(db);
    assert.equal(r.video, null);
    assert.deepEqual(
      Object.keys(r).sort(),
      ['policy', 'listingId', 'revision', 'approvedVersion', 'video'].sort(),
    );
  } finally {
    await db.close();
  }
});
