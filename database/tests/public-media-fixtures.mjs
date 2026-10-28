import assert from 'node:assert/strict';
import {
  seedGuardedListingDraft,
  seedGuardedListingSuccessor,
} from '../test-helpers/guarded-listing-fixture.mjs';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import { seedSyntheticSealedMedia } from '../test-helpers/synthetic-sealed-media.mjs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const T = id(1),
  OTHER = id(2),
  ADMIN = id(10),
  AGENT = id(11),
  PEER = id(12),
  CUSTOMER = id(13),
  OTHERADMIN = id(20);
const LISTING = id(100),
  SECOND = id(101),
  OTHERLISTING = id(200),
  ENQUIRY = id(300);
const content = {
  title: 'Synthetic Langata apartment',
  description: 'Synthetic replacement test content only.',
  purpose: 'rent',
  propertyType: 'apartment',
  currency: 'KES',
  amountMinor: 2000000,
  rentPeriod: 'month',
  bedrooms: 8,
  privateBathrooms: 2,
  sharedBathrooms: null,
  country: 'KE',
  locality: 'Langata',
  publicPrecision: 'area',
  latitude: -1.366,
  longitude: 36.75,
  privateAddress: 'PRIVATE TEST ADDRESS',
};
async function fixture() {
  const db = new PGlite();
  await applyTestMigrations(db);
  // Allocation restriction is part of the normal reviewed migration order.
  await db.query(
    `INSERT INTO app_private.tenants(id,slug,display_name) VALUES ($1,'realtime-test','Synthetic Realtime'),($2,'other-test','Synthetic Other')`,
    [T, OTHER],
  );
  for (const [tenant, user, role] of [
    [T, ADMIN, 'admin'],
    [T, AGENT, 'agent'],
    [T, PEER, 'agent'],
    [T, CUSTOMER, 'customer'],
    [OTHER, OTHERADMIN, 'admin'],
  ]) {
    await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
      tenant,
      user,
      role,
    ]);
  }
  return db;
}
async function asActor(db, tenant, actor, callback) {
  await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');
  await db.query(
    `SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),set_config('realtor.correlation_id','synthetic-db-test',true)`,
    [tenant ?? '', actor ?? ''],
  );
  try {
    const result = await callback(db);
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
async function scalar(db, sql, args = []) {
  const result = await db.query(sql, args);
  return Object.values(result.rows[0])[0];
}
async function createDraft(db, listing = LISTING, actor = AGENT) {
  return asActor(db, T, actor, async () => {
    const receipt = await seedGuardedListingDraft(db, {
      listingId: listing,
      slug: `synthetic-${listing.slice(-3)}`,
      actorId: actor,
      content: fullDraft(content),
    });
    return Number(receipt.result.revisionVersion);
  });
}
const fullDraft = (value) => ({
  ...value,
  pricing: { declaration: 'not_declared', charges: [] },
  location: { county: null, town: null, area: null },
});
async function startDraft(db, revision, actor, value) {
  const facts = (
    await db.query(
      'SELECT l.version::text AS listing_version,r.version::text AS revision_version,r.state FROM app_private.listings l JOIN app_private.listing_revisions r ON r.tenant_id=l.tenant_id AND r.listing_id=l.id WHERE l.id=$1 AND r.revision_no=$2',
      [LISTING, revision - 1],
    )
  ).rows[0];
  const receipt = await asActor(db, T, actor, () =>
    seedGuardedListingSuccessor(db, {
      listingId: LISTING,
      actorId: actor,
      expectedListingVersion: facts.listing_version,
      predecessor: { revision: revision - 1, version: facts.revision_version, state: facts.state },
      content: fullDraft(value),
    }),
  );
  return Number(receipt.decision.result.revisionVersion);
}
async function seedMedia(db, listing = LISTING, revision = 1, count = 4) {
  for (let position = 0; position < count; position++) {
    await seedSyntheticSealedMedia(db, {
      tenantId: T,
      listingId: listing,
      revision,
      position,
      mediaId: id(Number(listing.slice(-3)) * 100 + revision * 10 + position),
    });
  }
}
async function publish(db) {
  const version = await createDraft(db);
  await seedMedia(db);
  const pending = await asActor(db, T, AGENT, async () => {
    await db.query(`SELECT app_api.confirm_availability($1,1,'available')`, [LISTING]);
    return scalar(db, 'SELECT app_api.submit_revision($1,1,$2)', [LISTING, version]);
  });
  await asActor(db, T, ADMIN, () =>
    db.query('SELECT app_api.decide_revision($1,1,$2,true)', [LISTING, pending]),
  );
}
const denied = (fn, code = '42501') => assert.rejects(fn, (error) => error.code === code);

export { fixture, publish, asActor, scalar, T, OTHER, ADMIN, AGENT, LISTING };
