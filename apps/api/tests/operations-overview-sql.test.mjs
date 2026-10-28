import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedGuardedListingDraft } from '../../../database/test-helpers/guarded-listing-fixture.mjs';
import { seedSyntheticSealedMedia } from '../../../database/test-helpers/synthetic-sealed-media.mjs';
import { PostgresTransactionDatabase } from '../dist/database.js';
import { validateStaffOperationsOverview } from '@realtor/domain';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('restricted SQL summary enforces current admin, keeps viewing tables private and bounds old work without data writes', async () => {
  const db = new PGlite();
  try {
    await applyTestMigrations(db);
    const original = (await db.query('SELECT session_user AS name')).rows[0].name;
    const quoted = '"' + original.replaceAll('"', '""') + '"';
    const companies = [
      { tenant: id(1), admin: id(10), agent: id(11) },
      { tenant: id(2), admin: id(20), agent: id(21) },
    ];
    for (const [index, company] of companies.entries()) {
      await db.query('INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,$2,$3)', [
        company.tenant,
        'ops-' + index,
        'Synthetic operations ' + index,
      ]);
      for (const [actor, role, active] of [
        [company.admin, 'admin', true],
        [company.agent, 'agent', true],
        [id(30 + index), 'customer', true],
        [id(40 + index), 'admin', false],
      ])
        await db.query(
          'INSERT INTO app_private.memberships(tenant_id,user_id,role,active,revoked_at) VALUES($1,$2,$3,$4,CASE WHEN $4 THEN NULL ELSE now() END)',
          [company.tenant, actor, role, active],
        );
    }
    async function as(company, actor, work) {
      await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');
      try {
        await db.query(
          "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
          [company.tenant, actor],
        );
        const value = await work();
        await db.exec('COMMIT');
        return value;
      } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
      }
    }
    async function listing(company, n, pending = false) {
      const listingId = id(n);
      await as(company, company.agent, () =>
        seedGuardedListingDraft(db, {
          listingId,
          actorId: company.agent,
          slug: 'synthetic-operations-' + n,
          content: {
            title: 'Synthetic operations ' + n,
            description: 'Fictional operations read fixture.',
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
            latitude: null,
            longitude: null,
            privateAddress: 'PRIVATE SYNTHETIC ADDRESS',
            pricing: { declaration: 'complete', charges: [] },
            location: { county: 'Synthetic county', town: null, area: null },
          },
        }),
      );
      for (let position = 0; position < 4; position++)
        await seedSyntheticSealedMedia(db, {
          tenantId: company.tenant,
          listingId,
          mediaId: id(n * 10 + position),
          position,
        });
      await as(company, company.agent, () =>
        db.query("SELECT app_api.confirm_availability($1,1,'available')", [listingId]),
      );
      const submitted = await as(company, company.agent, () =>
        db.query('SELECT app_api.submit_revision($1,1,2) AS version', [listingId]),
      );
      if (!pending)
        await as(company, company.admin, () =>
          db.query('SELECT app_api.decide_revision($1,1,$2,true)', [
            listingId,
            submitted.rows[0].version,
          ]),
        );
      return listingId;
    }
    const a = companies[0],
      b = companies[1];
    const stale = await listing(a, 400),
      fresh = await listing(a, 401),
      paused = await listing(a, 402),
      review = await listing(a, 403, true),
      foreign = await listing(b, 500);
    // Privileged, explicitly dated synthetic read fixtures. This is not a past
    // execution/availability audit claim; no runtime permission is added.
    await db.query(
      "UPDATE app_private.listings SET last_availability_confirmed_at=date_trunc('milliseconds',statement_timestamp()-interval '744 hours') WHERE id=ANY($1::uuid[])",
      [[stale, paused, foreign]],
    );
    const pausedVersion = (
      await db.query('SELECT version FROM app_private.listings WHERE id=$1', [paused])
    ).rows[0].version;
    await as(a, a.admin, () =>
      db.query("SELECT app_api.set_publication($1,$2,'paused')", [paused, pausedVersion]),
    );
    for (const company of companies) {
      for (let n = 0; n < 12; n++) {
        const enquiryId = id((company === a ? 700 : 800) + n);
        await as(company, company.admin, () =>
          db.query('SELECT app_api.record_enquiry($1,$2,NULL,$3,NULL,$4,$5,$6,$7)', [
            enquiryId,
            randomUUID(),
            'Synthetic prospect ' + n,
            'synthetic-' + n + '@example.invalid',
            'PRIVATE SYNTHETIC MESSAGE',
            'staff',
            'synthetic-ops-v1',
          ]),
        );
        await as(company, company.admin, () =>
          db.query("SELECT app_api.execute_enquiry_operation($1,$2,1,'assign',$3,NULL,NULL,NULL)", [
            enquiryId,
            randomUUID(),
            company.agent,
          ]),
        );
        const due = new Date(Date.now() - (n + 1) * 3600000).toISOString();
        await as(company, company.agent, () =>
          db.query(
            "SELECT app_api.execute_enquiry_operation($1,$2,2,'transition',NULL,'contacted',$3,NULL)",
            [enquiryId, randomUUID(), due],
          ),
        );
      }
    }
    const before = (await db.query('SELECT count(*)::int AS count FROM app_private.audit_events'))
      .rows[0].count;
    await db.exec(
      'CREATE ROLE operations_test_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT api_runtime TO operations_test_login; SET SESSION AUTHORIZATION operations_test_login;',
    );
    const database = new PostgresTransactionDatabase({
      connect: async () => ({
        query: (sql, values) => db.query(sql, values ? [...values] : []),
        release() {},
      }),
    });
    await database.checkConnection();
    const context = (tenantId, actorId) => ({
      tenantId,
      actorId,
      correlationId: 'synthetic-operations-test',
    });
    const read = (tenantId, actorId) =>
      database.transaction(context(tenantId, actorId), async (query) =>
        validateStaffOperationsOverview(
          (await query.query('SELECT app_api.read_operations_overview() AS overview')).rows[0]
            .overview,
        ),
      );
    const result = await read(a.tenant, a.admin);
    assert.deepEqual(
      result.staleStock.items.map((item) => item.listingId),
      [stale],
    );
    assert.ok(
      !result.staleStock.items.some((item) => [fresh, paused, foreign].includes(item.listingId)),
    );
    assert.deepEqual(
      result.pendingReviews.items.map((item) => item.listingId),
      [review],
    );
    assert.equal(result.overdueEnquiries.items.length, 10);
    assert.equal(result.overdueEnquiries.hasMore, true);
    assert.deepEqual(
      result.overdueEnquiries.items.map((item) => item.enquiryId),
      Array.from({ length: 10 }, (_, n) => id(711 - n)),
    );
    const other = await read(b.tenant, b.admin);
    assert.deepEqual(
      other.staleStock.items.map((item) => item.listingId),
      [foreign],
    );
    for (const actor of [a.agent, id(30), id(40), b.admin])
      await assert.rejects(
        () => read(a.tenant, actor),
        (error) => error.code === '42501',
      );
    await assert.rejects(
      () =>
        database.transaction(context(a.tenant, a.admin), (query) =>
          query.query('SELECT * FROM app_private.viewings'),
        ),
      (error) => error.code === '42501',
    );
    const reset = (await db.query("SELECT current_setting('realtor.tenant_id',true) AS tenant"))
      .rows[0].tenant;
    assert.ok(reset === null || reset === '');
    await db.exec(`SET SESSION AUTHORIZATION ${quoted}; RESET ROLE;`);
    assert.equal(
      (await db.query('SELECT count(*)::int AS count FROM app_private.audit_events')).rows[0].count,
      before,
    );
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [a.tenant, a.admin],
    );
    await db.exec('SET SESSION AUTHORIZATION operations_test_login;');
    await assert.rejects(
      () => read(a.tenant, a.admin),
      (error) => error.code === '42501',
    );
  } finally {
    await db.close();
  }
});
