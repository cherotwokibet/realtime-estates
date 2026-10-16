import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedSyntheticSealedMedia } from '../../../database/test-helpers/synthetic-sealed-media.mjs';
import { PGlite } from '@electric-sql/pglite';
import { createApiService } from '../../../apps/api/dist/service.js';
import { PostgresTransactionDatabase } from '../../../apps/api/dist/database.js';
import { ApiClientError, RealtorApiClient } from '../dist/index.js';

const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const TENANT = id(1),
  OTHER = id(2),
  ADMIN = id(10),
  AGENT = id(11),
  CUSTOMER = id(13),
  OTHERADMIN = id(20);
const LISTING = id(100),
  LOST = id(103),
  OTHERLISTING = id(200);
const options = { bearerToken: 'synthetic-admin' };
const content = {
  title: 'Synthetic review integration studio',
  description: 'Synthetic moderation integration fixture, never real inventory.',
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
  privateAddress: 'PRIVATE SYNTHETIC REVIEW ADDRESS',
  pricing: {
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
  },
  location: { county: 'Synthetic County A', town: null, area: null },
};
const replacement = {
  ...content,
  title: 'Synthetic next accepted revision',
  amountMinor: 3000003,
  location: { county: null, town: 'Synthetic Replacement Town', area: null },
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
  // Fabricated privileged provenance, not uploaded bytes or a media-processing run.
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

test('moderation SDK uses actual API/SQL admin gates, snapshot decisions and uncertain committed approval', async (t) => {
  const db = new PGlite();
  try {
    await applyTestMigrations(db);
    await db.query(
      `INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'review-client-a','Synthetic Review A'),($2,'review-client-b','Synthetic Review B')`,
      [TENANT, OTHER],
    );
    for (const [tenant, actor, role] of [
      [TENANT, ADMIN, 'admin'],
      [TENANT, AGENT, 'agent'],
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
      [OTHER, OTHERADMIN, OTHERLISTING],
    ]) {
      await bootstrapAs(db, tenant, actor, async (query) => {
        await query.query('SELECT app_api.create_listing($1,$2)', [
          listing,
          `synthetic-review-${listing.slice(-3)}`,
        ]);
        await query.query('SELECT app_api.save_draft_v2($1,1,0,$2::jsonb)', [
          listing,
          JSON.stringify(content),
        ]);
        await query.query(`SELECT app_api.confirm_availability($1,1,'available')`, [listing]);
      });
      await syntheticMedia(db, tenant, listing, 1);
      await bootstrapAs(db, tenant, actor, (query) =>
        query.query('SELECT app_api.submit_revision($1,1,2)', [listing]),
      );
    }
    await bootstrapAs(db, TENANT, ADMIN, (query) =>
      query.query('SELECT app_api.decide_revision($1,1,3,true)', [LISTING]),
    );
    for (const revision of [2, 3]) {
      await bootstrapAs(db, TENANT, AGENT, (query) =>
        query.query('SELECT app_api.save_draft_v2($1,$2,0,$3::jsonb)', [
          LISTING,
          revision,
          JSON.stringify(revision === 3 ? replacement : { ...content, amountMinor: 2500002 }),
        ]),
      );
      await syntheticMedia(db, TENANT, LISTING, revision);
    }
    await bootstrapAs(db, TENANT, AGENT, (query) =>
      query.query('SELECT app_api.submit_revision($1,2,2)', [LISTING]),
    );
    // A listing-level confirmation changes its own token independently of the pending revision.
    await bootstrapAs(db, TENANT, AGENT, (query) =>
      query.query(`SELECT app_api.confirm_availability($1,3,'available')`, [LISTING]),
    );
    await db.exec(
      'CREATE ROLE api_moderation_client_test_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT api_runtime TO api_moderation_client_test_login; SET SESSION AUTHORIZATION api_moderation_client_test_login;',
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
      ['synthetic-customer', CUSTOMER],
      ['synthetic-other-admin', OTHERADMIN],
    ]);
    // Injected synthetic identity callback; this does not test a real identity provider.
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
        baseUrl: 'https://moderation-a.example.invalid',
        privacyNoticeVersion: 'synthetic-v1',
        fetch,
      });
    const api = makeClient(transport),
      otherApi = makeClient((input, init) => otherService(new Request(input, init)));
    const published = async () => {
      const item = (await api.listPropertiesV2()).items.find((row) => row.id === LISTING);
      assert.ok(item);
      return item;
    };
    const initial = await published();

    await t.test(
      'only current company admins can queue/read/decide and compact queue omits private draft fields',
      async () => {
        const guest = await service(
          new Request('https://moderation-a.example.invalid/v2/staff/reviews'),
        );
        assert.equal(guest.status, 401);
        for (const [bearerToken, status, code] of [
          ['invalid-synthetic', 401, 'UNAUTHENTICATED'],
          ['synthetic-agent', 403, 'FORBIDDEN'],
          ['synthetic-customer', 403, 'FORBIDDEN'],
          ['synthetic-other-admin', 403, 'FORBIDDEN'],
        ]) {
          await assert.rejects(() => api.listReviewsV2({ bearerToken }), isHttp(status, code));
          await assert.rejects(
            () => api.getReviewV2(LISTING, 2, { bearerToken }),
            isHttp(status, code),
          );
          await assert.rejects(
            () =>
              api.decideReviewV2(
                LISTING,
                2,
                { expectedVersion: '3', decision: 'approve', reason: null },
                { bearerToken },
              ),
            isHttp(status, code),
          );
        }
        const queue = await api.listReviewsV2(options);
        assert.deepEqual(
          new Set(queue.items.map((item) => item.listingId)),
          new Set([LISTING, LOST]),
        );
        for (const row of queue.items) {
          assert.equal(row.state, 'pending');
          assert.equal('content' in row, false);
          assert.equal('photos' in row, false);
          assert.equal('privateAddress' in row, false);
        }
        assert.equal(JSON.stringify(queue).includes('PRIVATE SYNTHETIC REVIEW ADDRESS'), false);
        const otherQueue = await otherApi.listReviewsV2({ bearerToken: 'synthetic-other-admin' });
        assert.deepEqual(
          otherQueue.items.map((item) => item.listingId),
          [OTHERLISTING],
        );
        await assert.rejects(
          () => otherApi.getReviewV2(LISTING, 2, { bearerToken: 'synthetic-other-admin' }),
          isHttp(404, 'NOT_FOUND'),
        );
      },
    );

    await t.test(
      'detail preserves exact nullable inputs/photos, admin-only private fields and distinct concurrency tokens',
      async () => {
        const review = await api.getReviewV2(LISTING, 2, options);
        assert.equal(review.version, '3');
        assert.equal(review.state, 'pending');
        assert.equal(review.publishedRevision, 1);
        assert.notEqual(review.listingVersion, review.version);
        assert.equal(review.amountMinor, 2500002);
        assert.equal(review.content.amountMinor, 2500002);
        assert.equal(review.content.privateAddress, content.privateAddress);
        assert.equal(review.content.latitude, -1.3);
        assert.equal(review.content.pricing.charges[1].amountMinor, null);
        assert.equal(review.content.location.town, null);
        assert.equal(review.photos.length, 4);
        assert.equal(review.acceptedPhotoCount, 4);
        assert.equal(review.decidedAt, null);
        assert.equal(review.decisionReason, null);
        const draft = await api.getReviewV2(LISTING, 3, options);
        assert.equal(draft.state, 'draft');
        assert.equal(draft.submittedAt, null);
        assert.equal(draft.submittedBy, null);
        assert.deepEqual(await published(), initial);
      },
    );

    await t.test(
      'stale decisions return a definite conflict and leave the pending review/public snapshot unchanged',
      async () => {
        await assert.rejects(
          () =>
            api.decideReviewV2(
              LISTING,
              2,
              { expectedVersion: '2', decision: 'approve', reason: null },
              options,
            ),
          isHttp(409, 'CONFLICT'),
        );
        const review = await api.getReviewV2(LISTING, 2, options);
        assert.equal(review.version, '3');
        assert.equal(review.state, 'pending');
        assert.deepEqual(await published(), initial);
      },
    );

    await t.test(
      'rejection persists its reason and preserves publication while the next revision awaits review',
      async () => {
        const reason = 'Synthetic correction needed before accepting this revision';
        assert.deepEqual(
          await api.decideReviewV2(
            LISTING,
            2,
            { expectedVersion: '3', decision: 'reject', reason },
            options,
          ),
          { version: '4', state: 'rejected' },
        );
        const rejected = await api.getReviewV2(LISTING, 2, options);
        assert.equal(rejected.state, 'rejected');
        assert.equal(rejected.decisionReason, reason);
        assert.equal(rejected.decidedBy, ADMIN);
        assert.ok(rejected.decidedAt);
        assert.equal(
          (await api.listReviewsV2(options)).items.some((item) => item.listingId === LISTING),
          false,
        );
        assert.deepEqual(await published(), initial);
        assert.deepEqual(
          await api.submitStaffDraftV2(
            LISTING,
            3,
            { expectedVersion: '2' },
            { bearerToken: 'synthetic-agent' },
          ),
          { version: '3' },
        );
        assert.equal(
          (await api.listReviewsV2(options)).items.find((item) => item.listingId === LISTING)
            .revision,
          3,
        );
        assert.deepEqual(await published(), initial);
      },
    );

    await t.test(
      'approval of the exact pending revision replaces the approved public snapshot and cannot be replayed',
      async () => {
        assert.deepEqual(
          await api.decideReviewV2(
            LISTING,
            3,
            { expectedVersion: '3', decision: 'approve', reason: null },
            options,
          ),
          { version: '4', state: 'approved' },
        );
        const approved = await api.getReviewV2(LISTING, 3, options);
        assert.equal(approved.state, 'approved');
        assert.equal(approved.publishedRevision, 3);
        assert.equal(approved.decisionReason, null);
        const current = await published();
        assert.equal(current.revision, 3);
        assert.equal(current.amountMinor, 3000003);
        assert.deepEqual(current.location, replacement.location);
        assert.equal(current.pricing.charges[1].amount, null);
        assert.equal(current.pricing.mandatoryAmountsComplete, false);
        assert.equal('privateAddress' in current, false);
        assert.equal(current.latitude, null);
        await assert.rejects(
          () =>
            api.decideReviewV2(
              LISTING,
              3,
              { expectedVersion: '3', decision: 'approve', reason: null },
              options,
            ),
          isHttp(409, 'CONFLICT'),
        );
      },
    );

    await t.test(
      'lost response after committed approval is uncertain once and reconciles through exact review readback',
      async () => {
        let writes = 0;
        const uncertain = makeClient(async (input, init) => {
          const response = await transport(input, init);
          if (init.method === 'POST') {
            writes++;
            assert.equal(response.status, 200);
            throw new Error('Synthetic lost response after actual approval commit');
          }
          return response;
        });
        await assert.rejects(
          () =>
            uncertain.decideReviewV2(
              LOST,
              1,
              { expectedVersion: '3', decision: 'approve', reason: null },
              options,
            ),
          (error) => error.kind === 'NETWORK' && error.submissionUncertain,
        );
        assert.equal(writes, 1);
        const stored = await api.getReviewV2(LOST, 1, options);
        assert.equal(stored.version, '4');
        assert.equal(stored.state, 'approved');
        assert.equal(stored.decidedBy, ADMIN);
        assert.equal(
          (await api.listReviewsV2(options)).items.some((item) => item.listingId === LOST),
          false,
        );
        await assert.rejects(
          () =>
            api.decideReviewV2(
              LOST,
              1,
              { expectedVersion: '3', decision: 'approve', reason: null },
              options,
            ),
          isHttp(409, 'CONFLICT'),
        );
        assert.equal(
          (await api.listPropertiesV2()).items.find((item) => item.id === LOST).revision,
          1,
        );
      },
    );
  } finally {
    await db.close();
  }
});
