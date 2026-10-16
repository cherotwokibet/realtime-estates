import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedSyntheticSealedMedia } from '../../../database/test-helpers/synthetic-sealed-media.mjs';
import { PGlite } from '@electric-sql/pglite';
import { createApiService } from '../../../apps/api/dist/service.js';
import { PostgresTransactionDatabase } from '../../../apps/api/dist/database.js';
import { ApiClientError, RealtorApiClient, validateListingCreationCommand } from '../dist/index.js';

const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const TENANT = id(1),
  OTHER = id(2),
  ADMIN = id(10),
  AGENT = id(11),
  PEER = id(12),
  CUSTOMER = id(13),
  OTHERADMIN = id(20);
const LISTING = id(100),
  PEERLISTING = id(101),
  EMPTY = id(110),
  OTHERLISTING = id(200);
const options = { bearerToken: 'synthetic-agent' };
const pricing = {
  declaration: 'incomplete',
  charges: [
    {
      id: 'service',
      name: 'Service fee',
      amountStatus: 'known',
      amountMinor: 10001,
      timing: 'per_rental_period',
      classification: 'fee',
      mandatory: true,
    },
    {
      id: 'legal',
      name: 'Legal quote',
      amountStatus: 'quote_required',
      amountMinor: null,
      timing: 'one_off',
      classification: 'fee',
      mandatory: true,
    },
  ],
};
const location = { county: 'Synthetic County A', town: null, area: 'Synthetic Area A' };
const content = {
  title: 'Synthetic assigned studio',
  description: 'Synthetic staff integration test, never real inventory.',
  purpose: 'rent',
  propertyType: 'studio',
  currency: 'KES',
  amountMinor: 2000001,
  rentPeriod: 'month',
  bedrooms: 0,
  privateBathrooms: 1,
  sharedBathrooms: null,
  country: 'KE',
  locality: 'Synthetic locality',
  publicPrecision: 'area',
  latitude: -1.3,
  longitude: 36.7,
  privateAddress: 'PRIVATE SYNTHETIC ADDRESS',
  pricing,
  location,
};

async function bootstrapAs(db, tenantId, actorId, operation) {
  await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');
  try {
    await db.query(
      `SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)`,
      [tenantId, actorId],
    );
    const result = await operation(db);
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
async function syntheticMedia(db, tenant, listing, revision) {
  // Fabricated privileged provenance, never uploaded bytes or processor proof.
  for (let position = 0; position < 4; position++)
    await seedSyntheticSealedMedia(db, {
      tenantId: tenant,
      listingId: listing,
      revision,
      mediaId: id(Number(listing.slice(-3)) * 100 + revision * 10 + position),
      position,
    });
}
const isHttp = (status, code) => (error) =>
  error instanceof ApiClientError &&
  error.kind === 'HTTP' &&
  error.status === status &&
  error.serverCode === code &&
  !error.submissionUncertain;

test('staff v2 client integrates with real service, SQL assignment checks and optimistic versions', async (t) => {
  const db = new PGlite();
  try {
    await applyTestMigrations(db);
    await db.query(
      `INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'staff-client-a','Synthetic Staff A'),($2,'staff-client-b','Synthetic Staff B')`,
      [TENANT, OTHER],
    );
    for (const [tenant, actor, role] of [
      [TENANT, ADMIN, 'admin'],
      [TENANT, AGENT, 'agent'],
      [TENANT, PEER, 'agent'],
      [TENANT, CUSTOMER, 'customer'],
      [OTHER, OTHERADMIN, 'admin'],
    ])
      await db.query(
        'INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',
        [tenant, actor, role],
      );
    for (const [tenant, actor, listing] of [
      [TENANT, AGENT, LISTING],
      [TENANT, PEER, PEERLISTING],
      [TENANT, AGENT, EMPTY],
      [OTHER, OTHERADMIN, OTHERLISTING],
    ])
      await bootstrapAs(db, tenant, actor, (query) =>
        query.query('SELECT app_api.create_listing($1,$2)', [
          listing,
          `synthetic-staff-${listing.slice(-3)}`,
        ]),
      );
    for (const [tenant, actor, listing] of [
      [TENANT, AGENT, LISTING],
      [TENANT, PEER, PEERLISTING],
      [OTHER, OTHERADMIN, OTHERLISTING],
    ])
      await bootstrapAs(db, tenant, actor, (query) =>
        query.query('SELECT app_api.save_draft_v2($1,1,0,$2::jsonb)', [
          listing,
          JSON.stringify(content),
        ]),
      );
    await syntheticMedia(db, TENANT, LISTING, 1);
    await bootstrapAs(db, TENANT, AGENT, async (query) => {
      await query.query(`SELECT app_api.confirm_availability($1,1,'available')`, [LISTING]);
      await query.query('SELECT app_api.submit_revision($1,1,2)', [LISTING]);
    });
    await bootstrapAs(db, TENANT, ADMIN, (query) =>
      query.query('SELECT app_api.decide_revision($1,1,3,true)', [LISTING]),
    );
    await bootstrapAs(db, TENANT, AGENT, (query) =>
      query.query('SELECT app_api.save_draft_v2($1,2,0,$2::jsonb)', [
        LISTING,
        JSON.stringify(content),
      ]),
    );
    await syntheticMedia(db, TENANT, LISTING, 2);
    await db.exec(
      'CREATE ROLE api_staff_client_test_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT api_runtime TO api_staff_client_test_login; SET SESSION AUTHORIZATION api_staff_client_test_login;',
    );
    // Single PGlite connection: serialize whole transactions to prevent context interleaving.
    let tail = Promise.resolve();
    const pool = {
      async connect() {
        let unlock;
        const next = new Promise((resolve) => {
          unlock = resolve;
        });
        const previous = tail;
        tail = next;
        await previous;
        return {
          query: (sql, args) => db.query(sql, args ? [...args] : []),
          release() {
            unlock();
          },
        };
      },
    };
    const database = new PostgresTransactionDatabase(pool);
    await database.checkConnection();
    const identities = new Map([
      ['synthetic-agent', AGENT],
      ['synthetic-peer', PEER],
      ['synthetic-customer', CUSTOMER],
      ['synthetic-admin', ADMIN],
      ['synthetic-other-admin', OTHERADMIN],
    ]);
    // Injected synthetic verification only; real provider/JWT verification has its own API tests.
    const makeService = (tenantId) =>
      createApiService({
        database,
        tenantId,
        privacyNoticeVersion: 'synthetic-v1',
        verifyAuthorization: async (request) => {
          const actorId = identities.get(
            (request.headers.get('authorization') ?? '').replace(/^Bearer /, ''),
          );
          if (!actorId) throw new Error('Unknown synthetic identity');
          return { actorId };
        },
      });
    const service = makeService(TENANT),
      otherService = makeService(OTHER);
    const transport = (input, init) => service(new Request(input, init));
    const makeClient = (fetch) =>
      new RealtorApiClient({
        baseUrl: 'https://staff-a.example.invalid',
        privacyNoticeVersion: 'synthetic-v1',
        fetch,
      });
    const api = makeClient(transport),
      otherApi = makeClient((input, init) => otherService(new Request(input, init)));
    const get = () => api.getStaffDraftV2(LISTING, 2, options);
    const published = async () => {
      const item = (await api.listPropertiesV2()).items.find((row) => row.id === LISTING);
      assert.ok(item);
      return item;
    };
    const initialPublic = await published();

    await t.test(
      'bounded listing queue uses current RLS assignment, separates latest draft from public revision and leaks no private content',
      async () => {
        const agent = await api.listStaffListingsV2(options);
        assert.equal(agent.items.length, 2);
        assert.equal(agent.truncated, false);
        const listing = agent.items.find((x) => x.listingId === LISTING),
          empty = agent.items.find((x) => x.listingId === EMPTY);
        assert.equal(listing.latest.revision, 2);
        assert.equal(listing.latest.state, 'draft');
        assert.equal(listing.publishedRevision, 1);
        assert.equal(empty.latest, null);
        assert.equal(JSON.stringify(agent).includes('PRIVATE SYNTHETIC ADDRESS'), false);
        assert.equal(JSON.stringify(agent).includes('latitude'), false);
        const first = await api.listStaffListingsV2({ ...options, limit: 1 });
        assert.equal(first.items.length, 1);
        assert.equal(first.truncated, true);
        assert.equal((await api.listStaffListingsV2({ ...options, limit: 2 })).truncated, false);
        assert.equal(
          (await api.listStaffListingsV2({ bearerToken: 'synthetic-admin' })).items.length,
          3,
        );
        assert.deepEqual(
          (await otherApi.listStaffListingsV2({ bearerToken: 'synthetic-other-admin' })).items.map(
            (x) => x.listingId,
          ),
          [OTHERLISTING],
        );
        await assert.rejects(
          () => api.listStaffListingsV2({ bearerToken: 'synthetic-customer' }),
          isHttp(403, 'FORBIDDEN'),
        );
        await database.transaction({ tenantId: TENANT, actorId: ADMIN }, (query) =>
          query.query('SELECT app_api.reassign_listing($1::uuid,$2::bigint,$3::uuid)', [
            LISTING,
            listing.version,
            PEER,
          ]),
        );
        assert.equal(
          (await api.listStaffListingsV2(options)).items.some((x) => x.listingId === LISTING),
          false,
        );
        const peer = (await api.listStaffListingsV2({ bearerToken: 'synthetic-peer' })).items.find(
          (x) => x.listingId === LISTING,
        );
        assert.ok(peer);
        await database.transaction({ tenantId: TENANT, actorId: ADMIN }, (query) =>
          query.query('SELECT app_api.reassign_listing($1::uuid,$2::bigint,$3::uuid)', [
            LISTING,
            peer.version,
            AGENT,
          ]),
        );
        assert.equal(
          (await api.listStaffListingsV2(options)).items.some((x) => x.listingId === LISTING),
          true,
        );
        assert.deepEqual(await published(), initialPublic);
      },
    );

    await t.test(
      'invalid identity, customer, peer and foreign-company calls cannot read or mutate an assigned draft',
      async () => {
        const guest = await service(
          new Request(`https://staff-a.example.invalid/v2/staff/listings/${LISTING}/drafts/2`),
        );
        assert.equal(guest.status, 401);
        for (const [bearerToken, status, code] of [
          ['invalid-synthetic', 401, 'UNAUTHENTICATED'],
          ['synthetic-customer', 403, 'FORBIDDEN'],
          ['synthetic-peer', 404, 'NOT_FOUND'],
          ['synthetic-other-admin', 403, 'FORBIDDEN'],
        ]) {
          await assert.rejects(
            () => api.getStaffDraftV2(LISTING, 2, { bearerToken }),
            isHttp(status, code),
          );
          await assert.rejects(
            () =>
              api.saveStaffDraftV2(LISTING, 2, { expectedVersion: '2', content }, { bearerToken }),
            isHttp(status, code),
          );
          await assert.rejects(
            () => api.submitStaffDraftV2(LISTING, 2, { expectedVersion: '2' }, { bearerToken }),
            isHttp(status, code),
          );
        }
        await assert.rejects(
          () => otherApi.getStaffDraftV2(LISTING, 2, { bearerToken: 'synthetic-other-admin' }),
          isHttp(404, 'NOT_FOUND'),
        );
        await assert.rejects(
          () => api.getStaffDraftV2(PEERLISTING, 1, options),
          isHttp(404, 'NOT_FOUND'),
        );
        assert.equal((await get()).version, '2');
      },
    );

    await t.test(
      'assigned staff receives exact raw cents, quotes, nullable location and private fields without public leakage',
      async () => {
        const result = await get();
        assert.deepEqual(result, { revision: 2, state: 'draft', version: '2', content });
        assert.equal(result.content.amountMinor, 2000001);
        assert.equal(result.content.pricing.charges[0].amountMinor, 10001);
        assert.equal(result.content.pricing.charges[1].amountMinor, null);
        assert.equal(result.content.location.town, null);
        assert.equal(result.content.privateAddress, content.privateAddress);
        assert.equal(result.content.latitude, -1.3);
        assert.equal(initialPublic.latitude, null);
        assert.equal(initialPublic.longitude, null);
        assert.equal(JSON.stringify(initialPublic).includes('PRIVATE SYNTHETIC ADDRESS'), false);
        assert.equal('privateAddress' in initialPublic, false);
      },
    );

    await t.test(
      'a new incomplete full replacement saves but cannot bypass submit requirements',
      async () => {
        const partial = {
          title: 'Synthetic unfinished draft',
          pricing: { declaration: 'not_declared', charges: [] },
          location: { county: null, town: null, area: null },
        };
        const unfinished = id(111);
        const created = await api.createListingV2(
          validateListingCreationCommand({
            listingId: unfinished,
            operationId: id(9911),
            slug: 'synthetic-guarded-unfinished',
            content: partial,
          }),
          options,
        );
        assert.equal(created.outcome, 'created');
        const saved = await api.saveStaffDraftV2(
          unfinished,
          1,
          { expectedVersion: '2', content: partial },
          options,
        );
        assert.deepEqual(saved, { version: '3' });
        const draft = await api.getStaffDraftV2(unfinished, 1, options);
        assert.equal(draft.version, '3');
        assert.equal(draft.content.amountMinor, null);
        assert.equal(draft.content.purpose, null);
        assert.equal(draft.content.privateAddress, null);
        await assert.rejects(
          () => api.submitStaffDraftV2(unfinished, 1, { expectedVersion: draft.version }, options),
          isHttp(422, 'INVALID_STATE'),
        );
        assert.equal((await api.getStaffDraftV2(unfinished, 1, options)).state, 'draft');
      },
    );

    await t.test(
      'successful full replacement preserves unedited fields and a stale version cannot overwrite it',
      async () => {
        const loaded = await get();
        const next = { ...loaded.content, amountMinor: 2000002 };
        assert.deepEqual(
          await api.saveStaffDraftV2(
            LISTING,
            2,
            { expectedVersion: loaded.version, content: next },
            options,
          ),
          { version: '3' },
        );
        await assert.rejects(
          () =>
            api.saveStaffDraftV2(
              LISTING,
              2,
              { expectedVersion: loaded.version, content: { ...next, amountMinor: 9000001 } },
              options,
            ),
          isHttp(409, 'CONFLICT'),
        );
        const stored = await get();
        assert.equal(stored.version, '3');
        assert.deepEqual(stored.content, next);
        assert.deepEqual(await published(), initialPublic);
      },
    );

    await t.test(
      'a lost response after an actual save commits is uncertain and requires read reconciliation',
      async () => {
        let writes = 0;
        const uncertain = makeClient(async (input, init) => {
          const response = await transport(input, init);
          if (init.method === 'PUT') {
            writes++;
            assert.equal(response.status, 200);
            throw new Error('Synthetic lost response after committed save');
          }
          return response;
        });
        const next = { ...(await get()).content, amountMinor: 2000003 };
        await assert.rejects(
          () =>
            uncertain.saveStaffDraftV2(
              LISTING,
              2,
              { expectedVersion: '3', content: next },
              options,
            ),
          (error) => error.kind === 'NETWORK' && error.submissionUncertain,
        );
        assert.equal(writes, 1);
        const stored = await get();
        assert.equal(stored.version, '4');
        assert.deepEqual(stored.content, next);
        await assert.rejects(
          () => api.saveStaffDraftV2(LISTING, 2, { expectedVersion: '3', content: next }, options),
          isHttp(409, 'CONFLICT'),
        );
        assert.deepEqual(await published(), initialPublic);
      },
    );

    await t.test(
      'a lost submit response leaves pending review, cannot replay or edit, and retains the approved snapshot',
      async () => {
        let writes = 0;
        const uncertain = makeClient(async (input, init) => {
          const response = await transport(input, init);
          if (init.method === 'POST') {
            writes++;
            assert.equal(response.status, 200);
            throw new Error('Synthetic lost response after committed submission');
          }
          return response;
        });
        await assert.rejects(
          () => uncertain.submitStaffDraftV2(LISTING, 2, { expectedVersion: '4' }, options),
          (error) => error.kind === 'NETWORK' && error.submissionUncertain,
        );
        assert.equal(writes, 1);
        const stored = await get();
        assert.equal(stored.state, 'pending');
        assert.equal(stored.version, '5');
        assert.equal(stored.content.amountMinor, 2000003);
        await assert.rejects(
          () => api.submitStaffDraftV2(LISTING, 2, { expectedVersion: '4' }, options),
          isHttp(409, 'CONFLICT'),
        );
        await assert.rejects(
          () =>
            api.saveStaffDraftV2(
              LISTING,
              2,
              { expectedVersion: stored.version, content: stored.content },
              options,
            ),
          isHttp(422, 'INVALID_STATE'),
        );
        assert.deepEqual(await published(), initialPublic);
        assert.deepEqual(
          (
            await otherApi.getStaffDraftV2(OTHERLISTING, 1, {
              bearerToken: 'synthetic-other-admin',
            })
          ).content,
          content,
        );
      },
    );
  } finally {
    await db.close();
  }
});
