import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { RealtorApiClient } from '../dist/index.js';
import { createApiService } from '../../../apps/api/dist/service.js';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedGuardedListingDraft } from '../../../database/test-helpers/guarded-listing-fixture.mjs';
import { seedSyntheticSealedMedia } from '../../../database/test-helpers/synthetic-sealed-media.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('moderation SDK composes with opt-in API and restricted SQL through original uncertainty and current access', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await applyTestMigrations(db);
  for (const f of [
    'listing-reference-draft.sql',
    'listing-reference-catalogue-install.sql',
    'listing-reference-read.sql',
    'listing-reference-moderation.sql',
  ])
    await db.exec(
      await readFile(new URL('../../../database/proposals/' + f, import.meta.url), 'utf8'),
    );
  await db.query('INSERT INTO app_private.tenants(id,slug,display_name)VALUES($1,$2,$2)', [
    id(1),
    'synthetic-moderation-sdk',
  ]);
  for (const [user, role] of [
    [10, 'agent'],
    [11, 'agent'],
    [12, 'customer'],
    [13, 'admin'],
  ])
    await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role)VALUES($1,$2,$3)', [
      id(1),
      id(user),
      role,
    ]);
  const cat = {
    policy: 'synthetic-reference-catalogue-v1',
    version: '1',
    country: 'KE',
    locations: [
      { id: id(200), kind: 'county', parentId: null, label: 'Synthetic original county' },
    ],
    amenities: [],
  };
  await db.query('SELECT app_private.install_synthetic_reference_catalogue(0,$1::jsonb)', [
    JSON.stringify(cat),
  ]);
  const content = normalizeStaffDraftContentV2({
    title: 'Synthetic SDK moderation',
    description: 'Independent synthetic integration fixture.',
    purpose: 'rent',
    propertyType: 'apartment',
    currency: 'KES',
    amountMinor: 2000000,
    rentPeriod: 'month',
    bedrooms: 2,
    locality: 'Synthetic original county',
    location: { county: 'Synthetic original county', town: null, area: null },
    pricing: { declaration: 'complete', charges: [] },
    privateAddress: 'PRIVATE SDK REVIEW',
  });
  const database = {
    async transaction(context, work) {
      await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
      try {
        await db.query(
          "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
          [context.tenantId, context.actorId],
        );
        const result = await work(db);
        await db.exec('COMMIT');
        return result;
      } catch (e) {
        await db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  const as = (user, work) => database.transaction({ tenantId: id(1), actorId: id(user) }, work);
  await as(10, (q) =>
    seedGuardedListingDraft(q, {
      listingId: id(100),
      slug: 'synthetic-moderation-sdk-stock',
      actorId: id(10),
      content,
    }),
  );
  for (let position = 0; position < 4; position++)
    await seedSyntheticSealedMedia(db, { tenantId: id(1), listingId: id(100), position });
  await as(10, (q) =>
    q.query('SELECT app_api.save_synthetic_reference_draft($1,1,2,$2,$3::jsonb,$4::jsonb)', [
      id(100),
      id(2000),
      JSON.stringify(content),
      JSON.stringify({
        catalogueVersion: '1',
        location: { countyId: id(200), localityId: null, neighbourhoodId: null },
        amenityIds: [],
      }),
    ]),
  );
  await as(10, (q) => q.query("SELECT app_api.confirm_availability($1,1,'available')", [id(100)]));
  let actor = 10,
    fault = null;
  const calls = [];
  const service = createApiService({
    tenantId: id(1),
    privacyNoticeVersion: 'synthetic',
    referenceDraftMode: 'synthetic-reference-draft-v1',
    referenceModerationMode: 'synthetic-reference-transition-v1',
    database,
    verifyAuthorization: async () => ({ actorId: id(actor) }),
  });
  const sdk = new RealtorApiClient({
      baseUrl: 'https://synthetic.invalid',
      privacyNoticeVersion: 'synthetic',
      fetch: async (url, init) => {
        calls.push({ url, method: init.method });
        const response = await service(new Request(url, init));
        if (response.ok && init.method === 'POST' && fault === 'lost') {
          await response.body.cancel();
          throw Error('Synthetic response lost after commit');
        }
        if (response.ok && init.method === 'POST' && fault === 'malformed') {
          const r = await response.json();
          r.actorId = id(99);
          return Response.json(r);
        }
        return response;
      },
    }),
    options = { bearerToken: 'synthetic' };
  const command = (review, action, operation) => ({
    policy: 'synthetic-reference-transition-v1',
    operationId: id(operation),
    listingId: id(100),
    revision: 1,
    action,
    review,
    reason: null,
  });
  const write = (c) => sdk.transitionSyntheticReferenceRevisionV3(c, cat, id(actor), options),
    recover = (c) => sdk.getSyntheticReferenceTransitionReceiptV3(c, cat, id(actor), options);
  const draft = (version) => sdk.getSyntheticReferenceRevisionV3(id(100), 1, version, cat, options),
    review = (version) => sdk.getSyntheticReferenceReviewV3(id(100), 1, version, cat, options);
  const version = async () =>
    (await db.query('SELECT version FROM app_private.listing_revisions')).rows[0].version;
  let submission, original, pending, withdrawal, approval;
  await t.test(
    'lost committed submission remains uncertain with one POST and explicit GET recovers exact original',
    async () => {
      const d = await draft('3');
      assert.equal(d.content.privateAddress, 'PRIVATE SDK REVIEW');
      assert.equal(d.photos.length, 4);
      submission = command(d, 'submit', 300);
      fault = 'lost';
      await assert.rejects(
        () => write(submission),
        (e) => e.kind === 'NETWORK' && e.submissionUncertain,
      );
      fault = null;
      assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
      assert.equal(await version(), 4);
      const before = calls.filter((c) => c.method === 'POST').length;
      original = await recover(submission);
      assert.equal(original.state, 'pending');
      assert.equal(calls.filter((c) => c.method === 'POST').length, before);
      assert.deepEqual(await write(submission), original);
      assert.equal(await version(), 4);
    },
  );
  await t.test(
    'catalogue activation keeps original labels; caller retained-original mismatch cannot settle recovery',
    async () => {
      await db.query('SELECT app_private.install_synthetic_reference_catalogue(1,$1::jsonb)', [
        JSON.stringify({
          ...cat,
          version: '2',
          locations: cat.locations.map((r) => ({ ...r, label: 'Synthetic renamed county' })),
        }),
      ]);
      assert.deepEqual(await recover(submission), original);
      const changed = structuredClone(submission);
      changed.review.content.privateAddress = 'Changed retained command';
      await assert.rejects(
        () => recover(changed),
        (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
      );
      actor = 13;
      pending = await review('4');
      const initial = await sdk.getSyntheticReferenceReviewContextV3(id(100), 1, '4', options);
      assert.deepEqual(initial.review, pending);
      assert.deepEqual(initial.catalogue, cat);
      assert.equal(initial.catalogue.version, '1');
      assert.equal(pending.attributes.location.county.label, 'Synthetic original county');
      assert.deepEqual(pending.content, content);
      await assert.rejects(
        () => recover(submission),
        (e) => e.kind === 'HTTP' && e.status === 404,
      );
      actor = 10;
      await assert.rejects(
        () => sdk.getSyntheticReferenceReviewContextV3(id(100), 1, '4', options),
        (e) => e.kind === 'HTTP' && e.status === 403,
      );
      await assert.rejects(
        () => review('4'),
        (e) => e.kind === 'HTTP' && e.status === 403,
      );
    },
  );
  await t.test(
    'malformed committed withdrawal response stays uncertain and GET recovery does not resubmit',
    async () => {
      withdrawal = command(pending, 'withdraw', 301);
      fault = 'malformed';
      await assert.rejects(
        () => write(withdrawal),
        (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain,
      );
      fault = null;
      assert.equal(await version(), 5);
      const before = calls.filter((c) => c.method === 'POST').length;
      assert.equal((await recover(withdrawal)).state, 'draft');
      assert.equal(calls.filter((c) => c.method === 'POST').length, before);
      assert.equal((await write(command(await draft('5'), 'submit', 302))).state, 'pending');
      assert.equal(await version(), 6);
    },
  );
  await t.test(
    'current editorial and operational context bind approval, with original recovery after lost success',
    async () => {
      actor = 13;
      await assert.rejects(
        () => write(command(pending, 'approve', 303)),
        (e) => e.kind === 'HTTP' && e.status === 409 && !e.submissionUncertain,
      );
      const stale = await review('6');
      await as(13, (q) => q.query("SELECT app_api.set_publication($1,2,'paused')", [id(100)]));
      await assert.rejects(
        () => write(command(stale, 'approve', 303)),
        (e) => e.kind === 'HTTP' && e.status === 409 && !e.submissionUncertain,
      );
      approval = command(await review('6'), 'approve', 303);
      fault = 'lost';
      await assert.rejects(
        () => write(approval),
        (e) => e.kind === 'NETWORK' && e.submissionUncertain,
      );
      fault = null;
      assert.equal(await version(), 7);
      const r = await recover(approval);
      assert.equal(r.state, 'approved');
      assert.equal(r.actorId, id(13));
      assert.equal(r.review.attributes.location.county.label, 'Synthetic original county');
      assert.deepEqual(await write(approval), r);
      assert.equal(await version(), 7);
    },
  );
  await t.test(
    'paused approval remains private until explicit restore; approved reference sidecar retains original facts',
    async () => {
      assert.deepEqual((await sdk.getSyntheticReferencePropertiesV3({ limit: 10 })).items, []);
      assert.equal(
        (await as(12, (q) => q.query('SELECT * FROM app_api.public_listings_reference_v3'))).rows
          .length,
        0,
      );
      const lv = (await db.query('SELECT version FROM app_private.listings')).rows[0].version;
      await as(13, (q) =>
        q.query("SELECT app_api.set_publication($1,$2,'published')", [id(100), lv]),
      );
      const row = (
        await as(12, (q) => q.query('SELECT * FROM app_api.public_listings_reference_v3'))
      ).rows[0];
      assert.equal(row.reference_revision_version, '7');
      assert.deepEqual(row.reference_attributes, approval.review.attributes);
      assert.ok(!JSON.stringify(row).includes('PRIVATE SDK REVIEW'));
      const page = await sdk.getSyntheticReferencePropertiesV3({ limit: 10 });
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0].reference.revisionVersion, '7');
      assert.deepEqual(page.items[0].reference.attributes, approval.review.attributes);
      assert.ok(!JSON.stringify(page).includes('PRIVATE SDK REVIEW'));
      assert.ok(!JSON.stringify(page).includes('referenceCatalogue'));
    },
  );
  await t.test(
    'current revocation and reassignment refuse original GET and explicit replay without another revision',
    async () => {
      await db.query(
        'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(13)],
      );
      await assert.rejects(
        () => recover(approval),
        (e) => e.kind === 'HTTP' && e.status === 403,
      );
      await assert.rejects(
        () => write(approval),
        (e) => e.kind === 'HTTP' && e.status === 403 && !e.submissionUncertain,
      );
      actor = 10;
      await db.query('UPDATE app_private.listings SET assigned_agent_id=$1 WHERE id=$2', [
        id(11),
        id(100),
      ]);
      await assert.rejects(
        () => recover(submission),
        (e) => e.kind === 'HTTP' && e.status === 404,
      );
      await assert.rejects(
        () => write(submission),
        (e) => e.kind === 'HTTP' && e.status === 404 && !e.submissionUncertain,
      );
      assert.equal(await version(), 7);
    },
  );
});
