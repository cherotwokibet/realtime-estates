import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  seedGuardedListingDraft,
  seedGuardedListingSuccessor,
} from '../../../database/test-helpers/guarded-listing-fixture.mjs';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedSyntheticSealedMedia } from '../../../database/test-helpers/synthetic-sealed-media.mjs';
import { createApiService } from '../dist/service.js';
import { PostgresTransactionDatabase } from '../dist/database.js';

// Independently authored SQL-only provenance fixtures, never uploaded/decoded photo proof.
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1),
  OTHER = id(2),
  ADMIN = id(10),
  AGENT = id(11),
  CUSTOMER = id(12),
  REVOKED = id(13),
  OTHER_ADMIN = id(20);
const REVIEW = id(100),
  REJECT = id(101),
  PAUSED = id(102),
  ARCHIVED = id(103),
  SUPERSEDED = id(104),
  SELF = id(105),
  BLOCKED = id(106),
  DRAFT = id(107),
  FOREIGN = id(200);
const oldPricing = {
  declaration: 'complete',
  charges: [
    {
      id: 'service',
      name: 'Monthly service',
      amountStatus: 'known',
      amountMinor: 100000,
      timing: 'per_rental_period',
      classification: 'fee',
      mandatory: true,
    },
  ],
};
const newPricing = {
  declaration: 'complete',
  charges: [
    { ...oldPricing.charges[0], amountMinor: 150000 },
    {
      id: 'optional-quote',
      name: 'Optional quoted extra',
      amountStatus: 'quote_required',
      amountMinor: null,
      timing: 'one_off',
      classification: 'fee',
      mandatory: false,
    },
  ],
};
const oldLocation = { county: 'Nairobi', town: 'Synthetic town', area: 'Synthetic original area' },
  newLocation = { ...oldLocation, area: 'Synthetic reviewed area' };
const base = {
  title: 'Synthetic original reviewed studio',
  description: 'Synthetic moderation fixture; no real listing or advertising rights represented.',
  purpose: 'rent',
  propertyType: 'studio',
  currency: 'KES',
  amountMinor: 2000000,
  rentPeriod: 'month',
  bedrooms: 0,
  privateBathrooms: 1,
  sharedBathrooms: null,
  country: 'KE',
  locality: 'Synthetic area',
  publicPrecision: 'area',
  latitude: -1.3,
  longitude: 36.7,
  privateAddress: 'PRIVATE SYNTHETIC MODERATOR ADDRESS',
  pricing: oldPricing,
  location: oldLocation,
};
const updated = {
  ...base,
  title: 'Synthetic new reviewed studio',
  amountMinor: 2500000,
  pricing: newPricing,
  location: newLocation,
};
const reviewPath = (listing = REVIEW, revision = 2) =>
  `/v2/staff/reviews/${listing}/revisions/${revision}`;
const decisionPath = (listing = REVIEW, revision = 2) =>
  reviewPath(listing, revision) + '/decision';
const draftPath = (listing = REVIEW, revision = 2) =>
  `/v2/staff/listings/${listing}/drafts/${revision}`;
function request(path, { actor = 'admin', method = 'GET', body, headers = {} } = {}) {
  return new Request('https://synthetic.invalid' + path, {
    method,
    headers: {
      ...(actor ? { Authorization: `Bearer synthetic-${actor}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}
async function bootstrap(db, tenant, actor, operation) {
  await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');
  try {
    await db.query(
      "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
      [tenant, actor],
    );
    const result = await operation();
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
async function media(db, tenant, listing, revision) {
  for (let position = 0; position < 4; position++)
    await seedSyntheticSealedMedia(db, {
      tenantId: tenant,
      listingId: listing,
      revision,
      mediaId: id(Number(listing.slice(-3)) * 100 + revision * 10 + position),
      position,
    });
}
async function fixture() {
  const db = new PGlite();
  await applyTestMigrations(db);
  // Allocation restriction is part of the normal reviewed migration order.
  await db.query(
    "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'synthetic-review-a','Synthetic A'),($2,'synthetic-review-b','Synthetic B')",
    [T, OTHER],
  );
  for (const [tenant, actor, role, active] of [
    [T, ADMIN, 'admin', true],
    [T, AGENT, 'agent', true],
    [T, CUSTOMER, 'customer', true],
    [T, REVOKED, 'admin', false],
    [OTHER, OTHER_ADMIN, 'admin', true],
  ])
    await db.query(
      `INSERT INTO app_private.memberships(tenant_id,user_id,role,active,revoked_at) VALUES($1,$2,$3,$4,CASE WHEN $4 THEN NULL ELSE now() END)`,
      [tenant, actor, role, active],
    );
  async function seed(
    listing,
    { tenant = T, admin = ADMIN, actor = AGENT, previous = true, confirm = true, status } = {},
  ) {
    await bootstrap(db, tenant, actor, () =>
      seedGuardedListingDraft(db, {
        listingId: listing,
        slug: `synthetic-review-${listing.slice(-3)}`,
        content: base,
        actorId: actor,
      }),
    );
    async function revision(number, value) {
      if (number > 1) {
        const facts = (
          await db.query(
            'SELECT l.version::text AS listing_version,r.version::text AS revision_version,r.state FROM app_private.listings l JOIN app_private.listing_revisions r ON r.tenant_id=l.tenant_id AND r.listing_id=l.id WHERE l.id=$1 AND r.revision_no=$2',
            [listing, number - 1],
          )
        ).rows[0];
        await bootstrap(db, tenant, actor, () =>
          seedGuardedListingSuccessor(db, {
            listingId: listing,
            actorId: actor,
            expectedListingVersion: facts.listing_version,
            predecessor: {
              revision: number - 1,
              version: facts.revision_version,
              state: facts.state,
            },
            content: value,
          }),
        );
      }
      await media(db, tenant, listing, number);
      await bootstrap(db, tenant, actor, () =>
        db.query('SELECT app_api.submit_revision($1,$2,2)', [listing, number]),
      );
    }
    if (confirm)
      await bootstrap(db, tenant, actor, () =>
        db.query("SELECT app_api.confirm_availability($1,1,'available')", [listing]),
      );
    await revision(1, base);
    if (previous) {
      await bootstrap(db, tenant, admin, () =>
        db.query('SELECT app_api.decide_revision($1,1,3,true)', [listing]),
      );
      await revision(2, updated);
    }
    if (status)
      await bootstrap(db, tenant, admin, async () => {
        const current = (
          await db.query('SELECT version FROM app_private.listings WHERE id=$1', [listing])
        ).rows[0].version;
        await db.query('SELECT app_api.set_publication($1,$2,$3)', [listing, current, status]);
      });
    if (listing === SUPERSEDED) {
      // Terminal review before a legitimate successor; older review commands stay stale.
      await bootstrap(db, tenant, admin, () =>
        db.query(
          "SELECT app_api.decide_revision($1,2,3,false,'Synthetic later changes required')",
          [listing],
        ),
      );
      await revision(3, { ...updated, title: 'Synthetic latest approved revision' });
      await bootstrap(db, tenant, admin, () =>
        db.query('SELECT app_api.decide_revision($1,3,3,true)', [listing]),
      );
    }
  }
  for (const listing of [REVIEW, REJECT, SUPERSEDED]) await seed(listing);
  await seed(PAUSED, { status: 'paused' });
  await seed(ARCHIVED, { status: 'archived' });
  await seed(SELF, { actor: ADMIN, previous: false });
  await seed(BLOCKED, { previous: false, confirm: false });
  await seed(FOREIGN, { tenant: OTHER, admin: OTHER_ADMIN, actor: OTHER_ADMIN });
  await bootstrap(db, T, AGENT, () =>
    seedGuardedListingDraft(db, {
      listingId: DRAFT,
      slug: 'synthetic-incomplete-review-draft',
      actorId: AGENT,
      content: {
        purpose: 'rent',
        amountMinor: 2000000,
        rentPeriod: null,
        pricing: { declaration: 'not_declared', charges: [] },
        location: { county: null, town: null, area: null },
      },
    }),
  );
  await db.exec(
    'CREATE ROLE moderation_test_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT api_runtime TO moderation_test_login; SET SESSION AUTHORIZATION moderation_test_login;',
  );
  let tail = Promise.resolve();
  const database = new PostgresTransactionDatabase({
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
        release: () => unlock(),
      };
    },
    end: () => db.close(),
  });
  await database.checkConnection();
  const subjects = {
    'synthetic-admin': ADMIN,
    'synthetic-agent': AGENT,
    'synthetic-customer': CUSTOMER,
    'synthetic-revoked': REVOKED,
    'synthetic-other-admin': OTHER_ADMIN,
  };
  const verifyAuthorization = async (req) => {
    const actorId = subjects[(req.headers.get('authorization') ?? '').replace(/^Bearer /, '')];
    if (!actorId) throw new Error('Synthetic invalid identity');
    return { actorId };
  };
  const service = createApiService({
    database,
    tenantId: T,
    privacyNoticeVersion: 'synthetic-review-notice',
    verifyAuthorization,
  });
  const other = createApiService({
    database,
    tenantId: OTHER,
    privacyNoticeVersion: 'synthetic-review-notice',
    verifyAuthorization,
  });
  const asAdmin = (operation) =>
    database.transaction(
      { tenantId: T, actorId: ADMIN, correlationId: 'synthetic-moderation-proof' },
      operation,
    );
  return { database, service, other, asAdmin };
}
async function json(service, path, options) {
  const result = await service(request(path, options));
  assert.equal(result.status, 200);
  return result.json();
}
const decide = (
  service,
  listing = REVIEW,
  { revision = 2, expectedVersion = 3, decision = 'approve', reason = null, actor = 'admin' } = {},
) =>
  service(
    request(decisionPath(listing, revision), {
      actor,
      method: 'POST',
      body: { expectedVersion, decision, reason },
    }),
  );

test('moderation routes enforce current admin membership and exact reviewed snapshots through restricted PostgreSQL transactions', async (t) => {
  const { database, service, other, asAdmin } = await fixture();
  try {
    await t.test(
      'queue and detail require current admin membership and reject context overrides',
      async () => {
        for (const [actor, status] of [
          [null, 401],
          ['invalid', 401],
          ['agent', 403],
          ['customer', 403],
          ['revoked', 403],
          ['other-admin', 403],
        ]) {
          assert.equal(
            (await service(request('/v2/staff/reviews', { actor }))).status,
            status,
            actor ?? 'guest',
          );
          assert.equal((await service(request(reviewPath(), { actor }))).status, status);
          assert.equal((await decide(service, REVIEW, { actor })).status, status);
        }
        for (const path of [
          '/v2/staff/reviews?tenantId=' + OTHER,
          '/v2/staff/reviews?limit=1&limit=2',
          '/v2/staff/reviews?limit=0',
          '/v2/staff/reviews?limit=101',
          reviewPath() + '?limit=1',
          decisionPath() + '?role=admin',
        ])
          assert.equal(
            (
              await service(
                request(path, {
                  ...(path.includes('/decision')
                    ? {
                        method: 'POST',
                        body: { expectedVersion: 3, decision: 'approve', reason: null },
                      }
                    : {}),
                }),
              )
            ).status,
            400,
            path,
          );
        assert.equal((await service(request(reviewPath(FOREIGN)))).status, 404);
        assert.equal((await decide(service, FOREIGN)).status, 404);
        assert.equal((await other(request(reviewPath(), { actor: 'other-admin' }))).status, 404);
        assert.deepEqual(
          (await json(other, '/v2/staff/reviews', { actor: 'other-admin' })).items.map(
            (row) => row.listingId,
          ),
          [FOREIGN],
        );
      },
    );
    await t.test(
      'queue is bounded and detail exposes exact private review content and accepted reference metadata only',
      async () => {
        const queue = await json(service, '/v2/staff/reviews?limit=100');
        assert.equal(queue.limit, 100);
        assert.equal(queue.items.length, 6);
        assert.ok(
          queue.items.every(
            (row) => row.state === 'pending' && row.version === '3' && row.acceptedPhotoCount === 4,
          ),
        );
        assert.equal((await json(service, '/v2/staff/reviews?limit=1')).items.length, 1);
        const detail = await json(service, reviewPath());
        assert.deepEqual(detail.content, updated);
        assert.equal(detail.listingVersion, '4');
        assert.equal(detail.version, '3');
        assert.equal(detail.publishedRevision, 1);
        assert.equal(detail.publicationStatus, 'published');
        assert.match(detail.submittedAt, /^\d{4}-\d\d-\d\dT.*Z$/);
        assert.match(detail.lastAvailabilityConfirmedAt, /Z$/);
        assert.equal(detail.submittedBy, AGENT);
        assert.deepEqual(
          detail.photos.map((photo) => Object.keys(photo).sort()),
          new Array(4).fill(['alt', 'key']),
        );
        assert.equal(detail.acceptedPhotoCount, 4);
        for (const privateField of [
          'content',
          'privateAddress',
          'decisionReason',
          'photos',
          'tenantId',
        ])
          assert.ok(queue.items.every((row) => !(privateField in row)));
        assert.equal(
          (
            await service(
              request(draftPath(), {
                actor: 'agent',
                method: 'PUT',
                body: {
                  expectedVersion: 3,
                  content: { ...updated, title: 'Pending edit forbidden' },
                },
              }),
            )
          ).status,
          422,
        );
        assert.deepEqual((await json(service, reviewPath())).content, updated);
        assert.equal((await json(service, reviewPath(REVIEW, 1))).state, 'approved');
        const incomplete = await json(service, reviewPath(DRAFT, 1));
        assert.equal(incomplete.state, 'draft');
        assert.equal(incomplete.content.rentPeriod, null);
        assert.equal(incomplete.content.amountMinor, 2000000);
        assert.equal(incomplete.submittedAt, null);
        assert.equal(incomplete.acceptedPhotoCount, 0);
        assert.deepEqual(incomplete.photos, []);
      },
    );
    await t.test(
      'decision input is exact, requires a bounded explicit reject reason, and retains state after invalid attempts',
      async () => {
        const invalid = [
          { expectedVersion: 3, decision: 'reject', reason: '' },
          { expectedVersion: 3, decision: 'reject', reason: ' leading' },
          { expectedVersion: 3, decision: 'reject', reason: 'line\nbreak' },
          { expectedVersion: 3, decision: 'reject', reason: 'x\u0085y' },
          { expectedVersion: 3, decision: 'reject', reason: '\ud800' },
          { expectedVersion: 3, decision: 'reject', reason: '😀'.repeat(1001) },
          { expectedVersion: 3, decision: 'reject', reason: null },
          { expectedVersion: 3, decision: 'approve' },
          { expectedVersion: 3, decision: 'approve', reason: 'ignored reason' },
          { expectedVersion: '3', decision: 'approve', reason: null },
          { expectedVersion: 3, decision: 'approve', reason: null, role: 'admin' },
          { expectedVersion: 3, decision: 'publish', reason: null },
        ];
        for (const body of invalid)
          assert.equal(
            (await service(request(decisionPath(), { method: 'POST', body }))).status,
            400,
          );
        assert.equal(
          (
            await service(
              request(decisionPath(), {
                method: 'POST',
                body: '{"expectedVersion":3,"expectedVersion":3,"decision":"approve","reason":null}',
              }),
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await service(
              request(decisionPath(), {
                method: 'POST',
                body: '{"expectedVersion":3,"decision":"reject","reason":"private","rea\\u0073on":"override"}',
              }),
            )
          ).status,
          400,
        );
        for (const versionToken of ['3.0000000000000001', '3.0', '3e0', '3E+0', '-3', '0']) {
          for (const versionKey of ['expectedVersion', 'expectedVer\\u0073ion']) {
            const raw = `{"${versionKey}":${versionToken},"decision":"approve","reason":null}`;
            const invalidVersion = await service(
              request(decisionPath(), { method: 'POST', body: raw }),
            );
            assert.equal(invalidVersion.status, 400, raw);
            assert.equal((await invalidVersion.json()).error.code, 'INVALID_JSON');
          }
        }
        const wire = JSON.stringify({ expectedVersion: 3, decision: 'approve', reason: null });
        assert.equal(
          (
            await service(
              request(decisionPath(), {
                method: 'POST',
                body: wire + ' '.repeat(8193 - wire.length),
              }),
            )
          ).status,
          413,
        );
        const method = await service(request(decisionPath(), { method: 'PUT', body: {} }));
        assert.equal(method.status, 405);
        assert.equal(method.headers.get('Allow'), 'POST');
        assert.equal((await json(service, reviewPath())).state, 'pending');
      },
    );
    await t.test(
      'approval conflicts safely, publishes exact v2 reviewed values, and supports readback after an ignored receipt',
      async () => {
        const before = (await json(service, '/v2/properties')).items.find(
          (row) => row.id === REVIEW,
        );
        assert.deepEqual(before.pricing, oldPricing);
        assert.deepEqual(before.location, oldLocation);
        assert.equal((await decide(service, REVIEW, { expectedVersion: 2 })).status, 409);
        const receipt = await decide(service);
        assert.equal(receipt.status, 200); // A caller may lose/ignore this receipt; readback remains authoritative.
        const after = await json(service, reviewPath());
        assert.equal(after.state, 'approved');
        assert.equal(after.version, '4');
        assert.equal(after.listingVersion, '5');
        assert.equal(after.decidedBy, ADMIN);
        assert.match(after.decidedAt, /Z$/);
        const published = (await json(service, '/v2/properties')).items.find(
          (row) => row.id === REVIEW,
        );
        assert.equal(published.revision, 2);
        assert.equal(published.amountMinor, updated.amountMinor);
        assert.deepEqual(published.pricing, newPricing);
        assert.deepEqual(published.location, newLocation);
        for (const privateField of ['privateAddress', 'decisionReason', 'submittedBy', 'decidedBy'])
          assert.equal(privateField in published, false);
        assert.equal((await decide(service, REVIEW, { expectedVersion: 4 })).status, 409);
        assert.equal((await decide(service, REVIEW, { expectedVersion: 3 })).status, 409);
        assert.equal(
          (await json(service, '/v2/staff/reviews')).items.some((row) => row.listingId === REVIEW),
          false,
        );
      },
    );
    await t.test(
      'rejection keeps the prior public snapshot and private reason; correction cannot edit the rejected revision',
      async () => {
        const privateReason = 'PRIVATE REJECTION ' + '😀'.repeat(980);
        const receipt = await decide(service, REJECT, {
          decision: 'reject',
          reason: privateReason,
        });
        assert.equal(receipt.status, 200);
        assert.deepEqual(await receipt.json(), { version: '4', state: 'rejected' });
        const detail = await json(service, reviewPath(REJECT));
        assert.equal(detail.decisionReason, privateReason);
        assert.equal(detail.state, 'rejected');
        assert.equal(detail.listingVersion, '4');
        const publicPayload = await json(service, '/v2/properties'),
          old = publicPayload.items.find((row) => row.id === REJECT);
        assert.equal(old.revision, 1);
        assert.deepEqual(old.pricing, oldPricing);
        assert.deepEqual(old.location, oldLocation);
        assert.equal(JSON.stringify(publicPayload).includes('PRIVATE REJECTION'), false);
        assert.equal(
          (
            await service(
              request(draftPath(REJECT), {
                actor: 'agent',
                method: 'PUT',
                body: { expectedVersion: 4, content: updated },
              }),
            )
          ).status,
          422,
        );
        assert.equal((await decide(service, REJECT, { expectedVersion: 4 })).status, 409);
      },
    );
    await t.test(
      'paused and archived approvals preserve operational state and fresh availability remains a separate gate',
      async () => {
        for (const [listing, status] of [
          [PAUSED, 'paused'],
          [ARCHIVED, 'archived'],
        ]) {
          assert.equal((await decide(service, listing)).status, 200);
          const detail = await json(service, reviewPath(listing));
          assert.equal(detail.state, 'approved');
          assert.equal(detail.publicationStatus, status);
          assert.equal(detail.publishedRevision, 2);
          assert.equal(
            (await json(service, '/v2/properties')).items.some((row) => row.id === listing),
            false,
          );
          await asAdmin((query) =>
            query.query("SELECT app_api.set_publication($1,$2,'published')", [
              listing,
              Number(detail.listingVersion),
            ]),
          );
          const restored = (await json(service, '/v2/properties')).items.find(
            (row) => row.id === listing,
          );
          assert.equal(restored.revision, 2);
          assert.deepEqual(restored.pricing, newPricing);
        }
        assert.equal((await decide(service, BLOCKED, { revision: 1 })).status, 422);
        assert.equal((await json(service, reviewPath(BLOCKED, 1))).state, 'pending');
        assert.equal((await decide(service, SUPERSEDED)).status, 409);
        assert.equal(
          (await json(service, '/v2/properties')).items.find((row) => row.id === SUPERSEDED)
            .revision,
          3,
        );
      },
    );
    await t.test(
      'self approval is explicit in append-only audit with the reviewed revision version',
      async () => {
        const receipt = await decide(service, SELF, { revision: 1 });
        assert.equal(receipt.status, 200);
        assert.deepEqual(await receipt.json(), { version: '4', state: 'approved' });
        const audit = await asAdmin((query) =>
          query.query(
            "SELECT object_version::text AS version,summary FROM app_private.audit_events WHERE object_id=$1 AND action='revision.approved'",
            [SELF],
          ),
        );
        assert.deepEqual(audit.rows, [
          { version: '4', summary: { revision: 1, selfApproval: true } },
        ]);
        const ordinary = await asAdmin((query) =>
          query.query(
            "SELECT summary FROM app_private.audit_events WHERE object_id=$1 AND action='revision.approved' ORDER BY object_version",
            [REVIEW],
          ),
        );
        assert.ok(ordinary.rows.every((row) => row.summary.selfApproval === false));
      },
    );
  } finally {
    await database.close();
  }
});
