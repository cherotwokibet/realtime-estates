import test from 'node:test';
import { readFile } from 'node:fs/promises';
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
  LOSTREMOVE = id(101),
  LOSTORDER = id(102),
  PENDING = id(103),
  REASSIGN = id(104),
  EMPTY = id(105),
  FOREIGN = id(200),
  options = { bearerToken: 'synthetic-agent' };
const content = {
  title: 'Synthetic gallery SDK draft',
  description: 'Synthetic policy fixture, never real inventory, bytes or decoder evidence.',
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

test('gallery SDK uses actual restricted API login, immutable SQL receipts and explicit readback recovery', async (t) => {
  const db = new PGlite();
  try {
    const fixtureSession = (await db.query('SELECT session_user AS name')).rows[0].name,
      quotedOwner = '"' + fixtureSession.replaceAll('"', '""') + '"';
    await applyTestMigrations(db);
    // Explicit candidate schema until 0024 enters normal migration order.
    await db.exec(
      await readFile(
        new URL('../../../database/proposals/0024_guarded_draft_allocation.sql', import.meta.url),
        'utf8',
      ),
    );
    await db.query(
      "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'gallery-sdk-a','Synthetic Gallery SDK A'),($2,'gallery-sdk-b','Synthetic Gallery SDK B')",
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
    for (const [tenant, actor, listings] of [
      [TENANT, AGENT, [MAIN, LOSTREMOVE, LOSTORDER, PENDING, REASSIGN, EMPTY]],
      [OTHER, OTHERADMIN, [FOREIGN]],
    ])
      for (const listing of listings)
        await asActor(db, tenant, actor, async (query) => {
          await seedGuardedListingDraft(query, {
            listingId: listing,
            slug: `synthetic-gallery-sdk-${listing.slice(-3)}`,
            content,
            actorId: actor,
          });
        });
    await db.exec(
      'CREATE ROLE api_gallery_sdk_test_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT api_runtime TO api_gallery_sdk_test_login; SET SESSION AUTHORIZATION api_gallery_sdk_test_login;',
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
    // Injected identity tests authorization, not JWT verification. Serialized PGlite
    // proves real privilege boundaries, not independent PostgreSQL connection races.
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
          baseUrl: 'https://gallery-sdk.example.invalid',
          privacyNoticeVersion: 'synthetic-v1',
          fetch,
        }),
      api = makeClient(transport),
      foreignApi = makeClient((input, init) => otherService(new Request(input, init)));
    async function asFixtureOwner(operation) {
      await tail;
      await db.exec(`SET SESSION AUTHORIZATION ${quotedOwner}; RESET ROLE;`);
      try {
        return await operation(db);
      } finally {
        await db.exec('SET SESSION AUTHORIZATION api_gallery_sdk_test_login; RESET ROLE;');
        await database.checkConnection();
      }
    }
    let ordinal = 0;
    // These are deliberately fabricated metadata-only coordinator attestations.
    // Native bytes/decoding/storage proof belongs to the separate actual-byte tests.
    async function attach(listing) {
      const index = ++ordinal,
        expectedVersion = (await api.getStaffDraftV2(listing, 1, options)).version,
        registered = await api.registerMediaUploadV2(
          listing,
          1,
          {
            registrationId: id(1000 + index),
            expectedVersion,
            altText: `Synthetic metadata-only photo ${index}`,
          },
          options,
        );
      await asFixtureOwner((query) =>
        asRole(query, 'media_coordinator', async (coordinator) => {
          const inputSha256 = index.toString(16).padStart(64, '0'),
            sha256 = (index + 100).toString(16).padStart(64, '0');
          await coordinator.query('SELECT app_media.capture_input($1,$2,100,$3)', [
            registered.jobId,
            id(2000 + index),
            inputSha256,
          ]);
          const lease = (
            await coordinator.query('SELECT app_media.claim_processing($1,$2) AS receipt', [
              registered.jobId,
              id(3000 + index),
            ])
          ).rows[0].receipt;
          const manifest = {
            pipeline: 'synthetic-codec-v1',
            sourceFormat: 'png',
            inputSha256,
            inputBytes: 100,
            format: 'webp',
            mimeType: 'image/webp',
            sha256,
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
      const operationId = id(4000 + index);
      await api.createMediaAttachIntentV2(
        listing,
        1,
        { operationId, jobId: registered.jobId, expectedVersion },
        options,
      );
      await asFixtureOwner((query) =>
        asRole(query, 'media_coordinator', (coordinator) =>
          coordinator.query('SELECT app_media.finalize_media($1)', [operationId]),
        ),
      );
      return (await api.getMediaAttachIntentV2(listing, 1, operationId, options)).receipt.mediaId;
    }
    const rows = (listing) =>
      asFixtureOwner(
        async (query) =>
          (
            await query.query(
              'SELECT id,position,public_object_key AS key FROM app_private.revision_media WHERE listing_id=$1 AND revision_no=1 ORDER BY position',
              [listing],
            )
          ).rows,
      );
    const counts = (listing) =>
      asFixtureOwner(
        async (query) =>
          (
            await query.query(
              "SELECT (SELECT version::text FROM app_private.listings WHERE id=$1) AS listing_version,(SELECT version::text FROM app_private.listing_revisions WHERE listing_id=$1 AND revision_no=1) AS revision_version,(SELECT count(*)::integer FROM app_private.audit_events WHERE object_id=$1 AND action IN ('media.removed','media.reordered')) AS gallery_audits",
              [listing],
            )
          ).rows[0],
      );
    const photos = [];
    for (let n = 0; n < 3; n++) photos.push(await attach(MAIN));
    const lostRemovePhotos = [await attach(LOSTREMOVE), await attach(LOSTREMOVE)],
      lostOrderPhotos = [await attach(LOSTORDER), await attach(LOSTORDER)];
    const pendingPhotos = [];
    for (let n = 0; n < 4; n++) pendingPhotos.push(await attach(PENDING));
    const reassignedPhoto = await attach(REASSIGN);
    let reordered, removed;

    await t.test(
      'complete permutation applies one token and one audit; replay is historical',
      async () => {
        const orderedIds = [photos[2], photos[0], photos[1]],
          request = { operationId: id(5000), orderedIds, expectedVersion: '5' };
        reordered = await api.reorderDraftMediaV2(MAIN, 1, request, options);
        assert.equal(reordered.outcome, 'applied');
        assert.equal(reordered.version, '6');
        assert.deepEqual(reordered.orderedIds, orderedIds);
        assert.ok(Object.isFrozen(reordered.orderedIds));
        assert.deepEqual(
          (await rows(MAIN)).map((row) => [row.id, row.position]),
          orderedIds.map((id, n) => [id, n]),
        );
        assert.deepEqual(await counts(MAIN), {
          listing_version: '1',
          revision_version: '6',
          gallery_audits: 1,
        });
        assert.deepEqual(await api.reorderDraftMediaV2(MAIN, 1, request, options), reordered);
        assert.deepEqual(
          await api.getMediaOperationV2(MAIN, 1, request.operationId, options),
          reordered,
        );
        assert.deepEqual(await counts(MAIN), {
          listing_version: '1',
          revision_version: '6',
          gallery_audits: 1,
        });
        await assert.rejects(
          () =>
            api.reorderDraftMediaV2(
              MAIN,
              1,
              { ...request, orderedIds: [...orderedIds].reverse() },
              options,
            ),
          isHttp(409, 'CONFLICT'),
        );
      },
    );
    await t.test('explicit exact-order and empty-order noop preserve token and audit', async () => {
      const request = {
          operationId: id(5001),
          orderedIds: reordered.orderedIds,
          expectedVersion: '6',
        },
        noop = await api.reorderDraftMediaV2(MAIN, 1, request, options);
      assert.equal(noop.outcome, 'noop');
      assert.equal(noop.version, '6');
      assert.deepEqual(await api.reorderDraftMediaV2(MAIN, 1, request, options), noop);
      assert.equal((await counts(MAIN)).gallery_audits, 1);
      const empty = await api.reorderDraftMediaV2(
        EMPTY,
        1,
        { operationId: id(5002), orderedIds: [], expectedVersion: '2' },
        options,
      );
      assert.equal(empty.outcome, 'noop');
      assert.equal(empty.version, '2');
      assert.equal((await counts(EMPTY)).gallery_audits, 0);
    });
    await t.test(
      'middle removal compacts positions once, retains provenance and later historical order',
      async () => {
        const request = { operationId: id(5003), mediaId: photos[0], expectedVersion: '6' };
        removed = await api.removeDraftMediaV2(MAIN, 1, request, options);
        assert.equal(removed.outcome, 'applied');
        assert.equal(removed.version, '7');
        assert.equal(removed.mediaId, photos[0]);
        assert.deepEqual(removed.orderedIds, [photos[2], photos[1]]);
        assert.deepEqual(
          (await rows(MAIN)).map((row) => [row.id, row.position]),
          [
            [photos[2], 0],
            [photos[1], 1],
          ],
        );
        assert.deepEqual(await counts(MAIN), {
          listing_version: '1',
          revision_version: '7',
          gallery_audits: 2,
        });
        assert.deepEqual(await api.removeDraftMediaV2(MAIN, 1, request, options), removed);
        const retained = await asFixtureOwner(
          async (query) =>
            (
              await query.query(
                'SELECT count(*)::integer AS count FROM app_private.media_attachments WHERE listing_id=$1',
                [MAIN],
              )
            ).rows[0].count,
        );
        assert.equal(retained, 3);
        await api.saveStaffDraftV2(
          MAIN,
          1,
          { expectedVersion: '7', content: { ...content, title: 'Synthetic later saved draft' } },
          options,
        );
        assert.deepEqual(
          await api.getMediaOperationV2(MAIN, 1, request.operationId, options),
          removed,
        );
        assert.deepEqual(await api.getMediaOperationV2(MAIN, 1, id(5000), options), reordered);
        assert.deepEqual(await api.removeDraftMediaV2(MAIN, 1, request, options), removed);
        await assert.rejects(
          () => api.removeDraftMediaV2(MAIN, 1, { ...request, expectedVersion: '8' }, options),
          isHttp(409, 'CONFLICT'),
        );
      },
    );
    await t.test(
      'stale version and absent/full-set failures remain durable facts without mutation',
      async () => {
        const before = await rows(MAIN),
          state = await counts(MAIN),
          conflictRequest = { operationId: id(5004), mediaId: photos[2], expectedVersion: '7' },
          conflict = await api.removeDraftMediaV2(MAIN, 1, conflictRequest, options);
        assert.equal(conflict.outcome, 'conflict');
        assert.equal(conflict.reason, 'VERSION_CONFLICT');
        assert.equal(conflict.version, '8');
        assert.deepEqual(conflict.orderedIds, [photos[2], photos[1]]);
        assert.deepEqual(await api.removeDraftMediaV2(MAIN, 1, conflictRequest, options), conflict);
        const absent = await api.removeDraftMediaV2(
          MAIN,
          1,
          { operationId: id(5005), mediaId: photos[0], expectedVersion: '8' },
          options,
        );
        assert.equal(absent.outcome, 'rejected');
        assert.equal(absent.reason, 'MEDIA_NOT_FOUND');
        const wrongOrder = await api.reorderDraftMediaV2(
          MAIN,
          1,
          { operationId: id(5006), orderedIds: [photos[2]], expectedVersion: '8' },
          options,
        );
        assert.equal(wrongOrder.outcome, 'rejected');
        assert.equal(wrongOrder.reason, 'MEDIA_SET_CHANGED');
        assert.deepEqual(wrongOrder.orderedIds, [photos[2]]);
        assert.deepEqual(await rows(MAIN), before);
        assert.deepEqual(await counts(MAIN), state);
        await assert.rejects(
          () =>
            api.removeDraftMediaV2(MAIN, 1, { ...conflictRequest, expectedVersion: '8' }, options),
          isHttp(409, 'CONFLICT'),
        );
      },
    );
    await t.test(
      'both lost committed removal and reorder replies recover once without automatic retry',
      async () => {
        for (const [listing, method, request] of [
          [
            LOSTREMOVE,
            'removeDraftMediaV2',
            { operationId: id(5010), mediaId: lostRemovePhotos[0], expectedVersion: '4' },
          ],
          [
            LOSTORDER,
            'reorderDraftMediaV2',
            {
              operationId: id(5011),
              orderedIds: [...lostOrderPhotos].reverse(),
              expectedVersion: '4',
            },
          ],
        ]) {
          let writes = 0;
          const uncertain = makeClient(async (input, init) => {
            const response = await transport(input, init);
            if (init.method === 'POST') {
              writes++;
              assert.equal(response.status, 200);
              throw new Error('Synthetic loss after SQL commit');
            }
            return response;
          });
          await assert.rejects(
            () => uncertain[method](listing, 1, request, options),
            (error) => error.kind === 'NETWORK' && error.submissionUncertain,
          );
          assert.equal(writes, 1);
          const recovered = await api.getMediaOperationV2(listing, 1, request.operationId, options);
          assert.equal(recovered.outcome, 'applied');
          assert.equal(recovered.version, '5');
          assert.equal((await counts(listing)).gallery_audits, 1);
          await api.saveStaffDraftV2(
            listing,
            1,
            {
              expectedVersion: '5',
              content: { ...content, title: 'Synthetic later content after lost response' },
            },
            options,
          );
          assert.deepEqual(
            await api.getMediaOperationV2(listing, 1, request.operationId, options),
            recovered,
          );
          assert.deepEqual(await api[method](listing, 1, request, options), recovered);
          assert.equal(writes, 1);
          assert.equal((await counts(listing)).gallery_audits, 1);
        }
      },
    );
    await t.test(
      'historical order survives submission/approval while new commands cannot alter reviewed or public photos',
      async () => {
        const order = [...pendingPhotos].reverse(),
          request = { operationId: id(5020), orderedIds: order, expectedVersion: '6' },
          historical = await api.reorderDraftMediaV2(PENDING, 1, request, options);
        assert.equal(historical.version, '7');
        await api.submitStaffDraftV2(PENDING, 1, { expectedVersion: '7' }, options);
        assert.deepEqual(
          await api.getMediaOperationV2(PENDING, 1, request.operationId, options),
          historical,
        );
        const rejected = await api.removeDraftMediaV2(
          PENDING,
          1,
          { operationId: id(5021), mediaId: order[1], expectedVersion: '8' },
          options,
        );
        assert.equal(rejected.outcome, 'rejected');
        assert.equal(rejected.reason, 'REVISION_NOT_DRAFT');
        assert.equal(rejected.version, '8');
        await asFixtureOwner((query) =>
          asActor(query, TENANT, ADMIN, (actor) =>
            actor.query("SELECT app_api.confirm_availability($1,1,'available')", [PENDING]),
          ),
        );
        await api.decideReviewV2(
          PENDING,
          1,
          { expectedVersion: '8', decision: 'approve', reason: null },
          { bearerToken: 'synthetic-admin' },
        );
        const publicBefore = await api.listPropertiesV2();
        assert.equal(publicBefore.items.length, 1);
        assert.equal(publicBefore.items[0].id, PENDING);
        const persisted = await rows(PENDING);
        assert.deepEqual(
          publicBefore.items[0].photos.map((photo) => photo.key),
          persisted.map((row) => row.key),
        );
        const failure = await api.reorderDraftMediaV2(
          PENDING,
          1,
          { operationId: id(5022), orderedIds: pendingPhotos, expectedVersion: '9' },
          options,
        );
        assert.equal(failure.reason, 'REVISION_NOT_DRAFT');
        assert.deepEqual(await api.listPropertiesV2(), publicBefore);
        assert.deepEqual(await rows(PENDING), persisted);
        assert.deepEqual(
          await api.getMediaOperationV2(PENDING, 1, request.operationId, options),
          historical,
        );
        assert.deepEqual(await api.reorderDraftMediaV2(PENDING, 1, request, options), historical);
      },
    );
    await t.test(
      'current same-principal authorization guards receipts, writes, assignment, tenant and membership',
      async () => {
        for (const [bearerToken, status, code] of [
          ['unknown', 401, 'UNAUTHENTICATED'],
          ['synthetic-customer', 403, 'FORBIDDEN'],
          ['synthetic-other-admin', 403, 'FORBIDDEN'],
          ['synthetic-peer', 404, 'NOT_FOUND'],
          ['synthetic-admin', 404, 'NOT_FOUND'],
        ])
          await assert.rejects(
            () => api.getMediaOperationV2(MAIN, 1, id(5003), { bearerToken }),
            isHttp(status, code),
          );
        await assert.rejects(
          () =>
            foreignApi.getMediaOperationV2(MAIN, 1, id(5003), {
              bearerToken: 'synthetic-other-admin',
            }),
          isHttp(404, 'NOT_FOUND'),
        );
        await assert.rejects(
          () => api.getMediaOperationV2(LOSTREMOVE, 1, id(5003), options),
          isHttp(404, 'NOT_FOUND'),
        );
        await assert.rejects(
          () => api.getMediaOperationV2(MAIN, 2, id(5003), options),
          isHttp(404, 'NOT_FOUND'),
        );
        const request = { operationId: id(5030), mediaId: reassignedPhoto, expectedVersion: '3' };
        await api.removeDraftMediaV2(REASSIGN, 1, request, options);
        await asFixtureOwner((query) =>
          asActor(query, TENANT, ADMIN, (actor) =>
            actor.query('SELECT app_api.reassign_listing($1,1,$2)', [REASSIGN, PEER]),
          ),
        );
        await assert.rejects(
          () => api.getMediaOperationV2(REASSIGN, 1, request.operationId, options),
          isHttp(404, 'NOT_FOUND'),
        );
        await assert.rejects(
          () => api.removeDraftMediaV2(REASSIGN, 1, request, options),
          isHttp(404, 'NOT_FOUND'),
        );
        await asFixtureOwner((query) =>
          query.query(
            'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
            [TENANT, AGENT],
          ),
        );
        await assert.rejects(
          () => api.getMediaOperationV2(MAIN, 1, id(5003), options),
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
      'restricted API login has no receipt table DML or coordinator authority; disabled tenant blocks history',
      async () => {
        for (const sql of [
          'SELECT app_media.finalize_media($1)',
          'SELECT * FROM app_private.media_operations WHERE operation_id=$1',
          'DELETE FROM app_private.revision_media WHERE id=$1',
          'DELETE FROM app_private.media_attachments WHERE operation_id=$1',
        ])
          await assert.rejects(
            () => db.query(sql, [id(5003)]),
            (error) => error.code === '42501',
          );
        await asFixtureOwner((query) =>
          query.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [TENANT]),
        );
        await assert.rejects(
          () => api.getMediaOperationV2(MAIN, 1, id(5003), options),
          isHttp(403, 'FORBIDDEN'),
        );
      },
    );
  } finally {
    await db.close();
  }
});
