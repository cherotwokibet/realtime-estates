import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { seedGuardedListingDraft } from '../../../database/test-helpers/guarded-listing-fixture.mjs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedSyntheticSealedMedia } from '../../../database/test-helpers/synthetic-sealed-media.mjs';
import { createApiService } from '../../../apps/api/dist/service.js';
import { PostgresTransactionDatabase } from '../../../apps/api/dist/database.js';
import { ApiClientError, RealtorApiClient } from '../dist/index.js';

const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const TENANT = id(1),
  OTHER = id(2),
  ADMIN = id(10),
  AGENT = id(11),
  PEER = id(12),
  CUSTOMER = id(13),
  OTHERADMIN = id(20);
const LISTING = id(100),
  LOST = id(101),
  SUBMITTED = id(102),
  REASSIGNED = id(103),
  REVOKED = id(104),
  DISABLED = id(105),
  OTHERLISTING = id(200);
const OP = id(500),
  LOSTOP = id(501),
  SUBMITOP = id(502),
  REASSIGNOP = id(503),
  REVOKEOP = id(504),
  DISABLEOP = id(505);
const options = { bearerToken: 'synthetic-agent' };
const content = {
  title: 'Synthetic media SDK draft',
  description: 'Synthetic registration integration fixture, never real inventory.',
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
  privateAddress: 'PRIVATE SYNTHETIC MEDIA ADDRESS',
  pricing: { declaration: 'not_declared', charges: [] },
  location: { county: 'Synthetic County', town: null, area: null },
};
const registration = (registrationId) => ({
  registrationId,
  expectedVersion: '2',
  altText: 'Synthetic independent entrance photo',
});
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
const isHttp = (status, code) => (error) =>
  error instanceof ApiClientError &&
  error.kind === 'HTTP' &&
  error.status === status &&
  error.serverCode === code &&
  !error.submissionUncertain;

test('media SDK executes actual restricted API/SQL registration and historical reconciliation without media mutation', async (t) => {
  const db = new PGlite();
  try {
    const fixtureSession = (await db.query('SELECT session_user AS name')).rows[0].name;
    assert.equal(typeof fixtureSession, 'string');
    const fixtureSessionIdentifier = '"' + fixtureSession.replaceAll('"', '""') + '"';
    await applyTestMigrations(db);
    // Explicit candidate schema until 0024 enters normal migration order.
    await db.exec(
      await readFile(
        new URL('../../../database/proposals/0024_guarded_draft_allocation.sql', import.meta.url),
        'utf8',
      ),
    );
    await db.query(
      `INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'media-sdk-a','Synthetic Media SDK A'),($2,'media-sdk-b','Synthetic Media SDK B')`,
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
      [TENANT, AGENT, LOST],
      [TENANT, AGENT, SUBMITTED],
      [TENANT, AGENT, REASSIGNED],
      [TENANT, AGENT, REVOKED],
      [TENANT, AGENT, DISABLED],
      [OTHER, OTHERADMIN, OTHERLISTING],
    ])
      await bootstrapAs(db, tenant, actor, async (query) => {
        await seedGuardedListingDraft(query, {
          listingId: listing,
          slug: `synthetic-media-sdk-${listing.slice(-3)}`,
          content,
          actorId: actor,
        });
      });
    // Privileged fabricated SQL provenance isolates registration recovery after
    // submission; no uploaded bytes/decoder/native process is represented.
    for (let position = 0; position < 4; position++)
      await seedSyntheticSealedMedia(db, {
        tenantId: TENANT,
        listingId: SUBMITTED,
        mediaId: id(1000 + position),
        position,
      });
    await db.exec(
      'CREATE ROLE api_media_sdk_test_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT api_runtime TO api_media_sdk_test_login; SET SESSION AUTHORIZATION api_media_sdk_test_login;',
    );
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
      ['synthetic-admin', ADMIN],
      ['synthetic-agent', AGENT],
      ['synthetic-peer', PEER],
      ['synthetic-customer', CUSTOMER],
      ['synthetic-other-admin', OTHERADMIN],
    ]);
    // An injected synthetic identity callback exercises application policy, not
    // an external identity provider. This serialized PGlite harness is not a
    // real independent-connection concurrency test.
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
      otherService = makeService(OTHER),
      transport = (input, init) => service(new Request(input, init));
    const makeClient = (fetch) =>
      new RealtorApiClient({
        baseUrl: 'https://media-sdk.example.invalid',
        privacyNoticeVersion: 'synthetic-v1',
        fetch,
      });
    const api = makeClient(transport),
      otherApi = makeClient((input, init) => otherService(new Request(input, init)));
    // Owner access is limited to serial synthetic fixture inspection/changes;
    // every SDK/API transaction still runs through the restricted test login.
    async function asFixtureOwner(operation) {
      await tail;
      // Restore the captured bootstrap session explicitly. RESET SESSION
      // AUTHORIZATION alone did not restore that owner in the first PGlite probe.
      await db.exec(`SET SESSION AUTHORIZATION ${fixtureSessionIdentifier}; RESET ROLE;`);
      try {
        return await operation(db);
      } finally {
        await db.exec('SET SESSION AUTHORIZATION api_media_sdk_test_login; RESET ROLE;');
        await database.checkConnection();
      }
    }
    let first;

    await t.test(
      'current assigned requester registers one private job and reads exact capability-free projections',
      async () => {
        const before = await api.getStaffDraftV2(LISTING, 1, options);
        first = await api.registerMediaUploadV2(LISTING, 1, registration(OP), options);
        assert.equal(first.operationId, OP);
        assert.notEqual(first.jobId, OP);
        assert.equal(first.outcome, 'registered');
        assert.equal(first.expectedVersion, '2');
        assert.equal(Date.parse(first.expiresAt) - Date.parse(first.registeredAt), 86400000);
        assert.equal(new Date(first.registeredAt).toISOString(), first.registeredAt);
        assert.deepEqual(await api.getMediaRegistrationV2(LISTING, 1, OP, options), first);
        const job = await api.getMediaJobV2(LISTING, 1, first.jobId, options);
        assert.equal(job.state, 'registered');
        assert.equal(job.operationId, OP);
        assert.equal('outcome' in job, false);
        for (const projection of [first, job])
          for (const key of [
            'tenantId',
            'requesterId',
            'registeredAssignedAgentId',
            'quarantineId',
            'outputId',
            'uploadUrl',
            'manifest',
            'accepted',
            'privateAddress',
          ])
            assert.equal(key in projection, false, key);
        assert.deepEqual(await api.getStaffDraftV2(LISTING, 1, options), before);
        const rows = await asFixtureOwner((query) =>
          query.query(
            'SELECT (SELECT count(*) FROM app_private.media_jobs WHERE tenant_id=$1 AND registration_id=$2)::integer AS jobs,(SELECT count(*) FROM app_private.revision_media WHERE tenant_id=$1 AND listing_id=$3)::integer AS photos',
            [TENANT, OP, LISTING],
          ),
        );
        assert.equal(rows.rows[0].jobs, 1);
        assert.equal(rows.rows[0].photos, 0);
      },
    );

    await t.test(
      'foreign, unassigned, customer and different-principal access cannot recover or repurpose the receipt',
      async () => {
        for (const [bearerToken, status, code] of [
          ['unknown-synthetic', 401, 'UNAUTHENTICATED'],
          ['synthetic-customer', 403, 'FORBIDDEN'],
          ['synthetic-other-admin', 403, 'FORBIDDEN'],
          ['synthetic-peer', 404, 'NOT_FOUND'],
        ]) {
          await assert.rejects(
            () => api.getMediaRegistrationV2(LISTING, 1, OP, { bearerToken }),
            isHttp(status, code),
          );
          await assert.rejects(
            () => api.getMediaJobV2(LISTING, 1, first.jobId, { bearerToken }),
            isHttp(status, code),
          );
        }
        await assert.rejects(
          () => api.getMediaRegistrationV2(LISTING, 1, OP, { bearerToken: 'synthetic-admin' }),
          isHttp(404, 'NOT_FOUND'),
        );
        await assert.rejects(
          () =>
            api.registerMediaUploadV2(LISTING, 1, registration(OP), {
              bearerToken: 'synthetic-admin',
            }),
          isHttp(409, 'CONFLICT'),
        );
        await assert.rejects(
          () =>
            otherApi.getMediaRegistrationV2(LISTING, 1, OP, {
              bearerToken: 'synthetic-other-admin',
            }),
          isHttp(404, 'NOT_FOUND'),
        );
        await assert.rejects(
          () => api.getMediaRegistrationV2(LOST, 1, OP, options),
          isHttp(404, 'NOT_FOUND'),
        );
        await assert.rejects(
          () => api.getMediaJobV2(LISTING, 2, first.jobId, options),
          isHttp(404, 'NOT_FOUND'),
        );
      },
    );

    await t.test(
      'explicit same-body replay is stable while changed body/version and new stale registrations are definite conflicts',
      async () => {
        assert.deepEqual(
          await api.registerMediaUploadV2(LISTING, 1, registration(OP), options),
          first,
        );
        await assert.rejects(
          () =>
            api.registerMediaUploadV2(
              LISTING,
              1,
              { ...registration(OP), altText: 'Changed canonical description' },
              options,
            ),
          isHttp(409, 'CONFLICT'),
        );
        await assert.rejects(
          () =>
            api.registerMediaUploadV2(
              LISTING,
              1,
              { ...registration(OP), expectedVersion: '3' },
              options,
            ),
          isHttp(409, 'CONFLICT'),
        );
        await assert.rejects(
          () =>
            api.registerMediaUploadV2(
              LISTING,
              1,
              { ...registration(id(510)), expectedVersion: '1' },
              options,
            ),
          isHttp(409, 'CONFLICT'),
        );
        assert.equal((await api.getStaffDraftV2(LISTING, 1, options)).version, '2');
        const rows = await asFixtureOwner((query) =>
          query.query(
            'SELECT count(*)::integer AS jobs FROM app_private.media_jobs WHERE tenant_id=$1 AND listing_id=$2',
            [TENANT, LISTING],
          ),
        );
        assert.equal(rows.rows[0].jobs, 1);
      },
    );

    await t.test(
      'lost committed registration response stays uncertain once and reconciles after a later draft save',
      async () => {
        let writes = 0;
        const uncertain = makeClient(async (input, init) => {
          const response = await transport(input, init);
          if (init.method === 'POST') {
            writes++;
            assert.equal(response.status, 200);
            throw new Error('Synthetic response loss after registration commit');
          }
          return response;
        });
        await assert.rejects(
          () => uncertain.registerMediaUploadV2(LOST, 1, registration(LOSTOP), options),
          (error) => error.kind === 'NETWORK' && error.submissionUncertain,
        );
        assert.equal(writes, 1);
        const stored = await api.getMediaRegistrationV2(LOST, 1, LOSTOP, options);
        assert.equal(stored.expectedVersion, '2');
        assert.deepEqual(
          await api.saveStaffDraftV2(
            LOST,
            1,
            { expectedVersion: '2', content: { ...content, title: 'Synthetic later save' } },
            options,
          ),
          { version: '3' },
        );
        assert.deepEqual(
          await api.registerMediaUploadV2(LOST, 1, registration(LOSTOP), options),
          stored,
        );
        assert.deepEqual(await api.getMediaRegistrationV2(LOST, 1, LOSTOP, options), stored);
        assert.equal(
          (await api.getMediaJobV2(LOST, 1, stored.jobId, options)).expectedVersion,
          '2',
        );
        await assert.rejects(
          () =>
            api.registerMediaUploadV2(
              LOST,
              1,
              { ...registration(LOSTOP), expectedVersion: '3' },
              options,
            ),
          isHttp(409, 'CONFLICT'),
        );
        assert.equal((await api.getStaffDraftV2(LOST, 1, options)).version, '3');
      },
    );

    await t.test(
      'historical receipt survives submission without renewing job or allowing a fresh registration',
      async () => {
        const stored = await api.registerMediaUploadV2(
          SUBMITTED,
          1,
          registration(SUBMITOP),
          options,
        );
        assert.deepEqual(
          await api.submitStaffDraftV2(SUBMITTED, 1, { expectedVersion: '2' }, options),
          { version: '3' },
        );
        assert.deepEqual(await api.getMediaRegistrationV2(SUBMITTED, 1, SUBMITOP, options), stored);
        assert.deepEqual(
          await api.registerMediaUploadV2(SUBMITTED, 1, registration(SUBMITOP), options),
          stored,
        );
        assert.equal(
          (await api.getMediaJobV2(SUBMITTED, 1, stored.jobId, options)).expiresAt,
          stored.expiresAt,
        );
        await assert.rejects(
          () =>
            api.registerMediaUploadV2(
              SUBMITTED,
              1,
              { ...registration(id(511)), expectedVersion: '3' },
              options,
            ),
          isHttp(422, 'INVALID_STATE'),
        );
        assert.equal((await api.getStaffDraftV2(SUBMITTED, 1, options)).state, 'pending');
      },
    );

    await t.test(
      'current reassignment, membership revocation and company disablement remove historical read/replay access',
      async () => {
        const reassigned = await api.registerMediaUploadV2(
          REASSIGNED,
          1,
          registration(REASSIGNOP),
          options,
        );
        const revoked = await api.registerMediaUploadV2(
          REVOKED,
          1,
          registration(REVOKEOP),
          options,
        );
        const disabled = await api.registerMediaUploadV2(
          DISABLED,
          1,
          registration(DISABLEOP),
          options,
        );
        await asFixtureOwner((query) =>
          bootstrapAs(query, TENANT, ADMIN, (actor) =>
            actor.query('SELECT app_api.reassign_listing($1,1,$2)', [REASSIGNED, PEER]),
          ),
        );
        await assert.rejects(
          () => api.getMediaRegistrationV2(REASSIGNED, 1, REASSIGNOP, options),
          isHttp(404, 'NOT_FOUND'),
        );
        await assert.rejects(
          () => api.getMediaJobV2(REASSIGNED, 1, reassigned.jobId, options),
          isHttp(404, 'NOT_FOUND'),
        );
        await assert.rejects(
          () => api.registerMediaUploadV2(REASSIGNED, 1, registration(REASSIGNOP), options),
          isHttp(404, 'NOT_FOUND'),
        );
        await asFixtureOwner((query) =>
          query.query(
            'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
            [TENANT, AGENT],
          ),
        );
        await assert.rejects(
          () => api.getMediaRegistrationV2(REVOKED, 1, REVOKEOP, options),
          isHttp(403, 'FORBIDDEN'),
        );
        await assert.rejects(
          () => api.getMediaJobV2(REVOKED, 1, revoked.jobId, options),
          isHttp(403, 'FORBIDDEN'),
        );
        await asFixtureOwner((query) =>
          query.query(
            'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
            [TENANT, AGENT],
          ),
        );
        await asFixtureOwner((query) =>
          query.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [TENANT]),
        );
        await assert.rejects(
          () => api.getMediaRegistrationV2(DISABLED, 1, DISABLEOP, options),
          isHttp(403, 'FORBIDDEN'),
        );
        await assert.rejects(
          () => api.getMediaJobV2(DISABLED, 1, disabled.jobId, options),
          isHttp(403, 'FORBIDDEN'),
        );
        await assert.rejects(
          () => api.registerMediaUploadV2(DISABLED, 1, registration(DISABLEOP), options),
          isHttp(403, 'FORBIDDEN'),
        );
      },
    );
  } finally {
    await db.close();
  }
});
