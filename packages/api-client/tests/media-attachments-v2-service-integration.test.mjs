import test from 'node:test';
import { seedGuardedListingDraft } from '../../../database/test-helpers/guarded-listing-fixture.mjs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { createApiService } from '../../../apps/api/dist/service.js';
import { PostgresTransactionDatabase } from '../../../apps/api/dist/database.js';
import { ApiClientError, RealtorApiClient } from '../dist/index.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TENANT = id(1),
  OTHER = id(2),
  ADMIN = id(10),
  AGENT = id(11),
  PEER = id(12),
  CUSTOMER = id(13),
  OTHERADMIN = id(20);
const MAIN = id(100),
  LOST = id(101),
  REASSIGN = id(102),
  FOREIGN = id(200),
  options = { bearerToken: 'synthetic-agent' };
const content = {
  title: 'Synthetic attachment SDK draft',
  description: 'Synthetic authorization fixture, never real inventory or decoder evidence.',
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
  pricing: { declaration: 'not_declared', charges: [] },
  location: { county: 'Synthetic County', town: null, area: null },
};
const isHttp = (status, code) => (error) =>
  error instanceof ApiClientError &&
  error.kind === 'HTTP' &&
  error.status === status &&
  error.serverCode === code &&
  !error.submissionUncertain;
async function asRole(db, role, operation) {
  await db.exec('BEGIN');
  try {
    await db.exec(`SET LOCAL ROLE ${role}`);
    const result = await operation(db);
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
async function asActor(db, tenant, actor, operation) {
  return asRole(db, 'api_runtime', async (query) => {
    await query.query(
      "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
      [tenant, actor],
    );
    return operation(query);
  });
}

test('attach SDK uses actual restricted API/SQL intent, finalize readback and original-operation recovery', async (t) => {
  const db = new PGlite();
  try {
    const fixtureSession = (await db.query('SELECT session_user AS name')).rows[0].name,
      quotedOwner = '"' + fixtureSession.replaceAll('"', '""') + '"';
    await applyTestMigrations(db);
    // Allocation restriction is part of the normal reviewed migration order.
    await db.query(
      "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'attach-sdk-a','Synthetic Attach SDK A'),($2,'attach-sdk-b','Synthetic Attach SDK B')",
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
      [TENANT, AGENT, MAIN],
      [TENANT, AGENT, LOST],
      [TENANT, AGENT, REASSIGN],
      [OTHER, OTHERADMIN, FOREIGN],
    ])
      await asActor(db, tenant, actor, async (query) => {
        await seedGuardedListingDraft(query, {
          listingId: listing,
          slug: `synthetic-attach-sdk-${listing.slice(-3)}`,
          content,
          actorId: actor,
        });
      });
    await db.exec(
      'CREATE ROLE api_attach_sdk_test_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT api_runtime TO api_attach_sdk_test_login; SET SESSION AUTHORIZATION api_attach_sdk_test_login;',
    );
    let tail = Promise.resolve();
    const pool = {
      async connect() {
        let unlock;
        const next = new Promise((resolve) => {
            unlock = resolve;
          }),
          previous = tail;
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
      ['synthetic-admin', ADMIN],
      ['synthetic-peer', PEER],
      ['synthetic-customer', CUSTOMER],
      ['synthetic-other-admin', OTHERADMIN],
    ]);
    // Injected identities test policy only. The serialized PGlite harness does not
    // prove JWT verification or independent PostgreSQL connection races.
    const serviceFor = (tenantId) =>
      createApiService({
        tenantId,
        database,
        privacyNoticeVersion: 'synthetic-v1',
        verifyAuthorization: async (request) => {
          const actorId = identities.get(
            (request.headers.get('authorization') ?? '').replace(/^Bearer /, ''),
          );
          if (!actorId) throw new Error('Unknown synthetic token');
          return { actorId };
        },
      });
    const service = serviceFor(TENANT),
      otherService = serviceFor(OTHER),
      transport = (input, init) => service(new Request(input, init));
    const makeClient = (fetch) =>
      new RealtorApiClient({
        baseUrl: 'https://attach-sdk.example.invalid',
        privacyNoticeVersion: 'synthetic-v1',
        fetch,
      });
    const api = makeClient(transport),
      foreignApi = makeClient((input, init) => otherService(new Request(input, init)));
    async function asFixtureOwner(operation) {
      await tail;
      await db.exec(`SET SESSION AUTHORIZATION ${quotedOwner}; RESET ROLE;`);
      try {
        return await operation(db);
      } finally {
        await db.exec('SET SESSION AUTHORIZATION api_attach_sdk_test_login; RESET ROLE;');
        await database.checkConnection();
      }
    }
    // These are deliberately fabricated metadata-only coordinator attestations.
    // They prove SQL/API policy and receipt behavior, never image bytes, decoding,
    // native containment, durable storage, or publicly deliverable photographs.
    async function verifiedJob(listing, registrationId, expectedVersion, ordinal) {
      const registered = await api.registerMediaUploadV2(
        listing,
        1,
        { registrationId, expectedVersion, altText: `Synthetic metadata-only entrance ${ordinal}` },
        options,
      );
      await asFixtureOwner((query) =>
        asRole(query, 'media_coordinator', async (coordinator) => {
          const inputSha256 = ordinal.toString(16).padStart(64, '0'),
            outputSha256 = (ordinal + 100).toString(16).padStart(64, '0');
          await coordinator.query('SELECT app_media.capture_input($1,$2,100,$3)', [
            registered.jobId,
            id(2000 + ordinal),
            inputSha256,
          ]);
          const lease = (
            await coordinator.query('SELECT app_media.claim_processing($1,$2) AS receipt', [
              registered.jobId,
              id(3000 + ordinal),
            ])
          ).rows[0].receipt;
          const manifest = {
            pipeline: 'synthetic-codec-v1',
            sourceFormat: 'png',
            inputSha256,
            inputBytes: 100,
            format: 'webp',
            mimeType: 'image/webp',
            sha256: outputSha256,
            width: 100,
            height: 100,
            bytes: 100,
            encoder: { sharp: '0.35.5', vips: '8.18.7' },
            operations: [
              'auto-orient',
              'resize-inside-1920-without-enlargement',
              'strip-metadata',
              'webp-quality-82-effort-4',
            ],
          };
          await coordinator.query('SELECT app_media.seal_output($1,$2,$3,$4::jsonb)', [
            registered.jobId,
            lease.attempt,
            lease.leaseNonce,
            JSON.stringify(manifest),
          ]);
        }),
      );
      return registered;
    }
    const finalize = (operation) =>
      asFixtureOwner((query) =>
        asRole(
          query,
          'media_coordinator',
          async (coordinator) =>
            (await coordinator.query('SELECT app_media.finalize_media($1) AS receipt', [operation]))
              .rows[0].receipt,
        ),
      );
    const countIntent = (operation) =>
      asFixtureOwner(
        async (query) =>
          (
            await query.query(
              'SELECT count(*)::integer AS count FROM app_private.media_attach_intents WHERE operation_id=$1',
              [operation],
            )
          ).rows[0].count,
      );
    let first, firstIntent;

    await t.test(
      'tuple validation and original explicit version precede intent allocation',
      async () => {
        first = await verifiedJob(MAIN, id(500), '2', 1);
        await assert.rejects(
          () =>
            api.createMediaAttachIntentV2(
              LOST,
              1,
              { operationId: id(600), jobId: first.jobId, expectedVersion: '2' },
              options,
            ),
          isHttp(404, 'NOT_FOUND'),
        );
        assert.equal(await countIntent(id(600)), 0);
        await assert.rejects(
          () =>
            api.createMediaAttachIntentV2(
              MAIN,
              2,
              { operationId: id(601), jobId: first.jobId, expectedVersion: '2' },
              options,
            ),
          isHttp(404, 'NOT_FOUND'),
        );
        assert.equal(await countIntent(id(601)), 0);
        await assert.rejects(
          () =>
            api.createMediaAttachIntentV2(
              MAIN,
              1,
              { operationId: id(602), jobId: first.jobId, expectedVersion: '1' },
              options,
            ),
          isHttp(409, 'CONFLICT'),
        );
        assert.equal(await countIntent(id(602)), 0);
        await assert.rejects(
          () =>
            api.createMediaAttachIntentV2(
              MAIN,
              1,
              { operationId: first.operationId, jobId: first.jobId, expectedVersion: '2' },
              options,
            ),
          isHttp(409, 'CONFLICT'),
        );
      },
    );
    await t.test(
      'ready acknowledgement creates no media/token change; finalize applies exactly once',
      async () => {
        const before = await api.getStaffDraftV2(MAIN, 1, options),
          request = { operationId: id(610), jobId: first.jobId, expectedVersion: '2' };
        firstIntent = await api.createMediaAttachIntentV2(MAIN, 1, request, options);
        assert.equal(firstIntent.status, 'ready');
        assert.equal(firstIntent.receipt, null);
        assert.equal(firstIntent.altText, first.altText);
        assert.deepEqual(await api.getStaffDraftV2(MAIN, 1, options), before);
        const count = await asFixtureOwner(
          async (query) =>
            (
              await query.query(
                'SELECT count(*)::integer AS count FROM app_private.revision_media WHERE listing_id=$1',
                [MAIN],
              )
            ).rows[0].count,
        );
        assert.equal(count, 0);
        await finalize(request.operationId);
        const result = await api.getMediaAttachIntentV2(MAIN, 1, request.operationId, options);
        assert.equal(result.status, 'applied');
        assert.equal(result.receipt.version, '3');
        assert.equal(result.receipt.position, 0);
        assert.ok(Object.isFrozen(result.receipt));
        assert.deepEqual(await api.createMediaAttachIntentV2(MAIN, 1, request, options), result);
        await finalize(request.operationId);
        assert.deepEqual(
          await api.getMediaAttachIntentV2(MAIN, 1, request.operationId, options),
          result,
        );
        for (const projection of [result, result.receipt])
          for (const key of [
            'tenantId',
            'requesterId',
            'outputId',
            'quarantineId',
            'manifest',
            'sha256',
            'storageKey',
            'public_object_key',
          ])
            assert.equal(key in projection, false, key);
        assert.equal((await api.getStaffDraftV2(MAIN, 1, options)).version, '3');
        const rows = await asFixtureOwner((query) =>
          query.query(
            'SELECT (SELECT count(*) FROM app_private.revision_media WHERE listing_id=$1)::integer AS photos,(SELECT count(*) FROM app_private.media_attach_results WHERE operation_id=$2)::integer AS results',
            [MAIN, request.operationId],
          ),
        );
        assert.deepEqual(rows.rows[0], { photos: 1, results: 1 });
        await api.saveStaffDraftV2(
          MAIN,
          1,
          {
            expectedVersion: '3',
            content: { ...content, title: 'Synthetic content saved after attachment' },
          },
          options,
        );
        assert.deepEqual(
          await api.getMediaAttachIntentV2(MAIN, 1, request.operationId, options),
          result,
        );
        await assert.rejects(
          () =>
            api.createMediaAttachIntentV2(MAIN, 1, { ...request, expectedVersion: '4' }, options),
          isHttp(409, 'CONFLICT'),
        );
      },
    );
    await t.test(
      'same-token intents serialize to applied and durable conflict; reuse needs explicit new operation/version',
      async () => {
        const one = await verifiedJob(MAIN, id(501), '4', 2),
          two = await verifiedJob(MAIN, id(502), '4', 3),
          a = { operationId: id(611), jobId: one.jobId, expectedVersion: '4' },
          b = { operationId: id(612), jobId: two.jobId, expectedVersion: '4' };
        await api.createMediaAttachIntentV2(MAIN, 1, a, options);
        await api.createMediaAttachIntentV2(MAIN, 1, b, options);
        await finalize(a.operationId);
        await finalize(b.operationId);
        const winner = await api.getMediaAttachIntentV2(MAIN, 1, a.operationId, options),
          conflict = await api.getMediaAttachIntentV2(MAIN, 1, b.operationId, options);
        assert.equal(winner.status, 'applied');
        assert.equal(winner.receipt.version, '5');
        assert.equal(winner.receipt.position, 1);
        assert.equal(conflict.status, 'conflict');
        assert.equal(conflict.receipt.reason, 'VERSION_CONFLICT');
        assert.equal(conflict.receipt.version, '5');
        assert.equal(conflict.receipt.mediaId, null);
        assert.deepEqual(await api.createMediaAttachIntentV2(MAIN, 1, b, options), conflict);
        await assert.rejects(
          () => api.createMediaAttachIntentV2(MAIN, 1, { ...b, expectedVersion: '5' }, options),
          isHttp(409, 'CONFLICT'),
        );
        const fresh = { ...b, operationId: id(613), expectedVersion: '5' };
        assert.equal(
          (await api.createMediaAttachIntentV2(MAIN, 1, fresh, options)).status,
          'ready',
        );
        await finalize(fresh.operationId);
        assert.equal(
          (await api.getMediaAttachIntentV2(MAIN, 1, fresh.operationId, options)).receipt.version,
          '6',
        );
        assert.deepEqual(
          await api.getMediaAttachIntentV2(MAIN, 1, b.operationId, options),
          conflict,
        );
      },
    );
    await t.test(
      'lost committed creation acknowledgement is uncertain once and recoverable by authorized original readback',
      async () => {
        const registered = await verifiedJob(LOST, id(503), '2', 4),
          request = { operationId: id(614), jobId: registered.jobId, expectedVersion: '2' };
        let writes = 0;
        const uncertain = makeClient(async (input, init) => {
          const response = await transport(input, init);
          if (init.method === 'POST') {
            writes++;
            assert.equal(response.status, 200);
            throw new Error('Synthetic loss after commit');
          }
          return response;
        });
        await assert.rejects(
          () => uncertain.createMediaAttachIntentV2(LOST, 1, request, options),
          (error) => error.kind === 'NETWORK' && error.submissionUncertain,
        );
        assert.equal(writes, 1);
        assert.equal(
          (await api.getMediaAttachIntentV2(LOST, 1, request.operationId, options)).status,
          'ready',
        );
        await finalize(request.operationId);
        const terminal = await api.getMediaAttachIntentV2(LOST, 1, request.operationId, options);
        assert.equal(terminal.status, 'applied');
        await api.saveStaffDraftV2(
          LOST,
          1,
          { expectedVersion: '3', content: { ...content, title: 'Synthetic later version' } },
          options,
        );
        assert.deepEqual(
          await api.getMediaAttachIntentV2(LOST, 1, request.operationId, options),
          terminal,
        );
        assert.deepEqual(await api.createMediaAttachIntentV2(LOST, 1, request, options), terminal);
        assert.equal(writes, 1);
      },
    );
    await t.test(
      'current principal/company/assignment authorization protects ready and historical receipt facts',
      async () => {
        const registered = await verifiedJob(REASSIGN, id(504), '2', 5),
          request = { operationId: id(615), jobId: registered.jobId, expectedVersion: '2' };
        await api.createMediaAttachIntentV2(REASSIGN, 1, request, options);
        for (const [bearerToken, status, code] of [
          ['unknown', 401, 'UNAUTHENTICATED'],
          ['synthetic-customer', 403, 'FORBIDDEN'],
          ['synthetic-other-admin', 403, 'FORBIDDEN'],
          ['synthetic-peer', 404, 'NOT_FOUND'],
          ['synthetic-admin', 404, 'NOT_FOUND'],
        ])
          await assert.rejects(
            () => api.getMediaAttachIntentV2(REASSIGN, 1, request.operationId, { bearerToken }),
            isHttp(status, code),
          );
        await assert.rejects(
          () =>
            foreignApi.getMediaAttachIntentV2(REASSIGN, 1, request.operationId, {
              bearerToken: 'synthetic-other-admin',
            }),
          isHttp(404, 'NOT_FOUND'),
        );
        await assert.rejects(
          () => api.getMediaAttachIntentV2(MAIN, 1, request.operationId, options),
          isHttp(404, 'NOT_FOUND'),
        );
        await asFixtureOwner((query) =>
          asActor(query, TENANT, ADMIN, (actor) =>
            actor.query('SELECT app_api.reassign_listing($1,1,$2)', [REASSIGN, PEER]),
          ),
        );
        await assert.rejects(
          () => api.getMediaAttachIntentV2(REASSIGN, 1, request.operationId, options),
          isHttp(404, 'NOT_FOUND'),
        );
        await assert.rejects(
          () => api.createMediaAttachIntentV2(REASSIGN, 1, request, options),
          isHttp(404, 'NOT_FOUND'),
        );
        await asFixtureOwner((query) =>
          query.query(
            'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
            [TENANT, AGENT],
          ),
        );
        await assert.rejects(
          () => api.getMediaAttachIntentV2(MAIN, 1, id(610), options),
          isHttp(403, 'FORBIDDEN'),
        );
        await asFixtureOwner((query) =>
          query.query(
            'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
            [TENANT, AGENT],
          ),
        );
      },
    );
    await t.test(
      'API login has no direct coordinator/table authority or public finalize route; disabled tenant blocks historical recovery',
      async () => {
        for (const sql of [
          'SELECT app_media.finalize_media($1)',
          'SELECT * FROM app_private.media_attach_intents WHERE operation_id=$1',
        ])
          await assert.rejects(
            () => db.query(sql, [id(610)]),
            (error) => error.code === '42501',
          );
        const response = await service(
          new Request(
            `https://attach-sdk.example.invalid/v2/staff/listings/${MAIN}/revisions/1/media-finalize`,
            {
              method: 'POST',
              headers: {
                Authorization: 'Bearer synthetic-agent',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ operationId: id(610) }),
            },
          ),
        );
        assert.equal(response.status, 404);
        await asFixtureOwner((query) =>
          query.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [TENANT]),
        );
        await assert.rejects(
          () => api.getMediaAttachIntentV2(MAIN, 1, id(610), options),
          isHttp(403, 'FORBIDDEN'),
        );
      },
    );
  } finally {
    await db.close();
  }
});
