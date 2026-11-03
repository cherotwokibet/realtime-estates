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
    const r = await asActor(db, T, AGENT, () =>
      seedGuardedListingDraft(db, {
        listingId: LISTING,
        slug: 'synthetic-video-publication',
        actorId: AGENT,
        content: {
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
        },
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
