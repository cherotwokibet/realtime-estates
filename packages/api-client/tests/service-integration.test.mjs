import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  seedGuardedListingDraft,
  seedGuardedListingSuccessor,
} from '../../../database/test-helpers/guarded-listing-fixture.mjs';
import assert from 'node:assert/strict';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedSyntheticSealedMedia } from '../../../database/test-helpers/synthetic-sealed-media.mjs';
import { PGlite } from '@electric-sql/pglite';
import { createApiService, createLocalEnquiryLimiter } from '../../../apps/api/dist/service.js';
import { PostgresTransactionDatabase } from '../../../apps/api/dist/database.js';
import { RealtorApiClient } from '../dist/index.js';

const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const TENANT = id(1),
  OTHER = id(2),
  ADMIN = id(10),
  OTHERADMIN = id(20),
  LISTING = id(100),
  OTHERLISTING = id(200),
  KEY = id(300);
const content = {
  title: 'Synthetic client integration studio',
  description: 'Synthetic migration-backed test, never live inventory.',
  purpose: 'rent',
  propertyType: 'studio',
  currency: 'KES',
  amountMinor: 2000001,
  rentPeriod: 'month',
  bedrooms: 0,
  privateBathrooms: 1,
  sharedBathrooms: null,
  country: 'KE',
  locality: 'Synthetic area',
  publicPrecision: 'area',
  latitude: -1.3,
  longitude: 36.7,
  privateAddress: 'PRIVATE SYNTHETIC ADDRESS',
};
async function bootstrapAs(db, tenant, actor, operation) {
  await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');
  try {
    await db.query(
      `SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)`,
      [tenant, actor],
    );
    await operation(db);
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
test('shared client exercises actual API service, restricted runtime transactions, tenant scope and durable idempotency in PGlite', async () => {
  const db = new PGlite();
  try {
    await applyTestMigrations(db);
    await db.exec(
      await readFile(
        new URL('../../../database/proposals/0024_guarded_draft_allocation.sql', import.meta.url),
        'utf8',
      ),
    );
    await db.query(
      `INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'client-a','Synthetic Client A'),($2,'client-b','Synthetic Client B')`,
      [TENANT, OTHER],
    );
    for (const [tenant, admin, listing] of [
      [TENANT, ADMIN, LISTING],
      [OTHER, OTHERADMIN, OTHERLISTING],
    ]) {
      await db.query(
        `INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')`,
        [tenant, admin],
      );
      await bootstrapAs(db, tenant, admin, async (query) => {
        await seedGuardedListingDraft(query, {
          listingId: listing,
          slug: `synthetic-${listing.slice(-3)}`,
          content: {
            ...content,
            pricing: { declaration: 'not_declared', charges: [] },
            location: { county: null, town: null, area: null },
          },
          actorId: admin,
        });
        await query.query(`SELECT app_api.confirm_availability($1,1,'available')`, [listing]);
      });
      // Privileged SQL-only provenance, not actual uploaded/decoded image bytes.
      for (let position = 0; position < 4; position++)
        await seedSyntheticSealedMedia(db, {
          tenantId: tenant,
          listingId: listing,
          mediaId: id(Number(listing.slice(-3)) * 10 + position),
          position,
        });
      await bootstrapAs(db, tenant, admin, async (query) => {
        await query.query('SELECT app_api.submit_revision($1,1,2)', [listing]);
        await query.query('SELECT app_api.decide_revision($1,1,3,true)', [listing]);
      });
    }
    await db.exec(
      'CREATE ROLE api_client_test_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT api_runtime TO api_client_test_login; SET SESSION AUTHORIZATION api_client_test_login;',
    );
    const pool = {
      async connect() {
        return { query: (sql, values) => db.query(sql, values ? [...values] : []), release() {} };
      },
    };
    const database = new PostgresTransactionDatabase(pool);
    await database.checkConnection();
    const makeService = (tenantId) =>
      createApiService({
        database,
        tenantId,
        privacyNoticeVersion: 'synthetic-v1',
        verifyAuthorization: async () => {
          throw new Error('No identity provider in this guest integration test.');
        },
        limiter: createLocalEnquiryLimiter({ limit: 100 }),
      });
    const service = makeService(TENANT),
      other = makeService(OTHER);
    let calls = 0,
      loseReply = false;
    const fetch = async (input, init) => {
      calls++;
      const response = await service(new Request(input, init));
      if (loseReply) {
        loseReply = false;
        throw Error('Synthetic reply lost after committed service response.');
      }
      return response;
    };
    const api = new RealtorApiClient({
      baseUrl: 'https://client-a.example.invalid',
      privacyNoticeVersion: 'synthetic-v1',
      fetch,
    });
    const page = await api.listProperties();
    assert.deepEqual(
      page.items.map((row) => row.id),
      [LISTING],
    );
    assert.equal(page.items[0].amountMinor, 2000001);
    assert.equal(page.items[0].latitude, null);
    assert.equal('privateAddress' in page.items[0], false);
    const otherClient = new RealtorApiClient({
      baseUrl: 'https://client-b.example.invalid',
      privacyNoticeVersion: 'synthetic-v1',
      fetch: async (input, init) => other(new Request(input, init)),
    });
    assert.deepEqual(
      (await otherClient.listProperties()).items.map((row) => row.id),
      [OTHERLISTING],
    );
    const enquiry = {
      listingId: LISTING,
      name: 'Synthetic Prospect',
      phone: '0700000000',
      message: 'Synthetic client integration request.',
      origin: 'mobile',
      noticeVersion: 'synthetic-v1',
      noticeAcknowledged: true,
    };
    const receipt = await api.submitEnquiry(enquiry, { idempotencyKey: KEY });
    assert.deepEqual(await api.submitEnquiry(enquiry, { idempotencyKey: KEY }), receipt);
    await assert.rejects(
      () =>
        api.submitEnquiry({ ...enquiry, message: 'Changed retry body' }, { idempotencyKey: KEY }),
      (error) => error.kind === 'HTTP' && error.status === 409 && error.serverCode === 'CONFLICT',
    );
    const stored = await database.transaction(
      { tenantId: TENANT, actorId: ADMIN, correlationId: id(500) },
      (query) =>
        query.query('SELECT id,contacted_revision_no,phone_e164 FROM app_private.enquiries'),
    );
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0].id, receipt.id);
    assert.equal(stored.rows[0].contacted_revision_no, 1);
    assert.equal(stored.rows[0].phone_e164, '+254700000000');
    const otherStored = await database.transaction(
      { tenantId: OTHER, actorId: OTHERADMIN, correlationId: id(501) },
      (query) => query.query('SELECT count(*)::integer AS count FROM app_private.enquiries'),
    );
    assert.equal(otherStored.rows[0].count, 0);
    const stale = new RealtorApiClient({
      baseUrl: 'https://client-a.example.invalid',
      privacyNoticeVersion: 'old-notice',
      fetch,
    });
    await assert.rejects(
      () =>
        stale.submitEnquiry(
          { ...enquiry, noticeVersion: 'old-notice' },
          { idempotencyKey: id(301) },
        ),
      (error) =>
        error.kind === 'HTTP' &&
        error.status === 400 &&
        error.serverCode === 'NOTICE_ACKNOWLEDGEMENT_REQUIRED',
    );
    assert.equal(calls, 5); // One list, two equivalent POSTs, one conflict and one stale-notice POST; no hidden retry.
    const raw = {
      ...enquiry,
      name: '  Synthetic retained name  ',
      message: '  Original captured message  ',
    };
    const attempt = api.preparePublicEnquiry(raw, id(302));
    loseReply = true;
    await assert.rejects(attempt.submit(), (error) => error.submissionUncertain);
    assert.equal(attempt.state.status, 'uncertain');
    assert.equal(calls, 6);
    raw.message = 'Changed after the lost reply';
    const beforeRecovery = await database.transaction(
      { tenantId: TENANT, actorId: ADMIN, correlationId: id(502) },
      (query) =>
        query.query('SELECT id,message FROM app_private.enquiries WHERE idempotency_key=$1', [
          id(302),
        ]),
    );
    assert.equal(beforeRecovery.rows.length, 1);
    assert.equal(beforeRecovery.rows[0].message, 'Original captured message');
    const recovered = await attempt.retryOriginal();
    assert.equal(recovered.id, beforeRecovery.rows[0].id);
    assert.equal(attempt.state.status, 'received');
    assert.equal(calls, 7);
    const afterRecovery = await database.transaction(
      { tenantId: TENANT, actorId: ADMIN, correlationId: id(503) },
      (query) =>
        query.query(
          'SELECT count(*)::integer AS count FROM app_private.enquiries WHERE idempotency_key=$1',
          [id(302)],
        ),
    );
    assert.equal(afterRecovery.rows[0].count, 1);
    assert.equal(attempt.input.message, '  Original captured message  ');
  } finally {
    await db.close();
  }
});
