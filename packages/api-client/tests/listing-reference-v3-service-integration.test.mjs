import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { RealtorApiClient } from '../dist/index.js';
import { createApiService } from '../../../apps/api/dist/service.js';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedGuardedListingDraft } from '../../../database/test-helpers/guarded-listing-fixture.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('reference SDK through opt-in API and restricted SQL recovers committed originals without automatic rewrite', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await applyTestMigrations(db);
  for (const f of [
    'listing-reference-draft.sql',
    'listing-reference-catalogue-install.sql',
    'listing-reference-read.sql',
  ])
    await db.exec(
      await readFile(new URL('../../../database/proposals/' + f, import.meta.url), 'utf8'),
    );
  await db.query('INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,$2,$2)', [
    id(1),
    'synthetic-reference-sdk',
  ]);
  for (const [user, role] of [
    [10, 'agent'],
    [11, 'agent'],
    [12, 'customer'],
    [13, 'admin'],
  ])
    await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
      id(1),
      id(user),
      role,
    ]);
  const cat = {
    policy: 'synthetic-reference-catalogue-v1',
    version: '1',
    country: 'KE',
    locations: [],
    amenities: [],
  };
  await db.query('SELECT app_private.install_synthetic_reference_catalogue(0,$1::jsonb)', [
    JSON.stringify(cat),
  ]);
  const content = normalizeStaffDraftContentV2({
    title: 'Synthetic SDK integration draft',
    pricing: { declaration: 'not_declared', charges: [] },
    location: { county: null, town: null, area: null },
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
  await database.transaction({ tenantId: id(1), actorId: id(10) }, (q) =>
    seedGuardedListingDraft(q, {
      listingId: id(100),
      slug: 'synthetic-reference-sdk-stock',
      actorId: id(10),
      content,
    }),
  );
  let actor = 10,
    lose = false;
  const calls = [];
  const service = createApiService({
    tenantId: id(1),
    privacyNoticeVersion: 'synthetic',
    referenceDraftMode: 'synthetic-reference-draft-v1',
    database,
    verifyAuthorization: async () => ({ actorId: id(actor) }),
  });
  const sdk = new RealtorApiClient({
      baseUrl: 'https://synthetic.invalid',
      privacyNoticeVersion: 'synthetic',
      fetch: async (url, init) => {
        calls.push({ url, method: init.method });
        const response = await service(new Request(url, init));
        if (lose && init.method === 'POST')
          throw Error('Synthetic response lost after API committed');
        return response;
      },
    }),
    options = { bearerToken: 'synthetic' };
  const command = {
    policy: 'synthetic-reference-draft-v1',
    operationId: id(300),
    listingId: id(100),
    revision: 1,
    expectedVersion: '2',
    content,
    selection: {
      catalogueVersion: '1',
      location: { countyId: null, localityId: null, neighbourhoodId: null },
      amenityIds: [],
    },
  };
  let original;
  await t.test(
    'lost committed POST returns uncertainty and performs no automatic replay',
    async () => {
      const catalogue = await sdk.getSyntheticReferenceCatalogueV3('current', options);
      assert.deepEqual(catalogue, cat);
      lose = true;
      await assert.rejects(
        () => sdk.saveSyntheticReferenceDraftV3(command, catalogue, id(10), options),
        (e) => e.kind === 'NETWORK' && e.submissionUncertain,
      );
      lose = false;
      assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
      assert.equal(
        (await db.query('SELECT version FROM app_private.listing_revisions')).rows[0].version,
        3,
      );
    },
  );
  await t.test(
    'explicit GET original and explicit identical replay retain one saved version',
    async () => {
      const before = calls.filter((c) => c.method === 'POST').length;
      original = await sdk.getSyntheticReferenceDraftReceiptV3(command, cat, id(10), options);
      assert.equal(original.revisionVersion, '3');
      assert.equal(calls.filter((c) => c.method === 'POST').length, before);
      assert.deepEqual(
        await sdk.saveSyntheticReferenceDraftV3(command, cat, id(10), options),
        original,
      );
      assert.equal(
        (await db.query('SELECT count(*) AS n FROM app_private.synthetic_reference_draft_receipts'))
          .rows[0].n,
        1,
      );
    },
  );
  await t.test(
    'new catalogue does not remap original recovery; stale new write conflicts',
    async () => {
      await db.query('SELECT app_private.install_synthetic_reference_catalogue(1,$1::jsonb)', [
        JSON.stringify({ ...cat, version: '2' }),
      ]);
      assert.equal((await sdk.getSyntheticReferenceCatalogueV3('current', options)).version, '2');
      assert.equal((await sdk.getSyntheticReferenceCatalogueV3('1', options)).version, '1');
      assert.deepEqual(
        await sdk.getSyntheticReferenceDraftReceiptV3(command, cat, id(10), options),
        original,
      );
      await assert.rejects(
        () =>
          sdk.saveSyntheticReferenceDraftV3(
            { ...command, operationId: id(301), expectedVersion: '3' },
            cat,
            id(10),
            options,
          ),
        (e) => e.kind === 'HTTP' && e.status === 409 && !e.submissionUncertain,
      );
      const before = calls.length;
      await assert.rejects(
        () =>
          sdk.getSyntheticReferenceDraftReceiptV3(
            command,
            { ...cat, version: '2' },
            id(10),
            options,
          ),
        (e) => e.kind === 'VALIDATION',
      );
      assert.equal(calls.length, before);
    },
  );
  await t.test(
    'current membership and assignment loss prevents original reads independently of saved ownership',
    async () => {
      await db.query(
        'UPDATE app_private.listings SET assigned_agent_id=$1 WHERE tenant_id=$2 AND id=$3',
        [id(11), id(1), id(100)],
      );
      await assert.rejects(
        () => sdk.getSyntheticReferenceDraftReceiptV3(command, cat, id(10), options),
        (e) => e.kind === 'HTTP' && e.status === 404,
      );
      await db.query(
        'UPDATE app_private.listings SET assigned_agent_id=$1 WHERE tenant_id=$2 AND id=$3',
        [id(10), id(1), id(100)],
      );
      await db.query(
        'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(10)],
      );
      await assert.rejects(
        () => sdk.getSyntheticReferenceDraftReceiptV3(command, cat, id(10), options),
        (e) => e.kind === 'HTTP' && e.status === 403,
      );
      await db.query(
        'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(10)],
      );
      actor = 13;
      await assert.rejects(
        () => sdk.getSyntheticReferenceDraftReceiptV3(command, cat, id(10), options),
        (e) => e.kind === 'HTTP' && e.status === 404,
      );
      actor = 10;
    },
  );
  await t.test(
    'current staff-checked catalogue over1MiB passes SDK6MiB transport and frozen validator',
    async () => {
      const large = {
        ...cat,
        version: '3',
        locations: Array.from({ length: 1800 }, (_, n) => ({
          id: id(1000 + n),
          kind: 'county',
          parentId: null,
          label: '🙂'.repeat(160),
        })),
      };
      await db.query('SELECT app_private.install_synthetic_reference_catalogue(2,$1::jsonb)', [
        JSON.stringify(large),
      ]);
      const value = await sdk.getSyntheticReferenceCatalogueV3('current', options);
      assert.equal(value.locations.length, 1800);
      assert.ok(Object.isFrozen(value.locations[0]));
      assert.ok(new TextEncoder().encode(JSON.stringify(value)).length > 1024 * 1024);
      actor = 12;
      await assert.rejects(
        () => sdk.getSyntheticReferenceCatalogueV3('current', options),
        (e) => e.kind === 'HTTP' && e.status === 403,
      );
      actor = 10;
    },
  );
});
