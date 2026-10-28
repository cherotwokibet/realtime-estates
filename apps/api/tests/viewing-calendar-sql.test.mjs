import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedGuardedListingDraft } from '../../../database/test-helpers/guarded-listing-fixture.mjs';
import { seedHistoricalConfirmedViewing } from '../../../database/test-helpers/historical-confirmed-viewing.mjs';
import { validateStaffViewingCalendar } from '@realtor/domain';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const window = {
  fromAt: '2020-01-01T00:00:00.000Z',
  untilAt: '2020-01-03T00:00:00.000Z',
  timeZone: 'Africa/Nairobi',
};
test('restricted calendar SQL bounds both queues, denies nonstaff/revoked/raw tables and leaves audit unchanged', async () => {
  const db = new PGlite();
  try {
    await applyTestMigrations(db);
    const a = { tenant: id(1), admin: id(10), agent: id(11), listing: id(400), enquiry: id(700) },
      b = { tenant: id(2), admin: id(20), agent: id(21), listing: id(500), enquiry: id(800) };
    async function as(company, actor, work) {
      await db.exec('BEGIN;SET LOCAL ROLE api_runtime;');
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
    for (const company of [a, b]) {
      await db.query('INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,$2,$3)', [
        company.tenant,
        'calendar-' + company.tenant.slice(-1),
        'Synthetic calendar company',
      ]);
      for (const [actor, role, active] of [
        [company.admin, 'admin', true],
        [company.agent, 'agent', true],
        ...(company === a
          ? [
              [id(12), 'agent', true],
              [id(13), 'customer', true],
              [id(14), 'agent', false],
            ]
          : []),
      ])
        await db.query(
          'INSERT INTO app_private.memberships(tenant_id,user_id,role,active,revoked_at) VALUES($1,$2,$3,$4,CASE WHEN $4 THEN NULL ELSE now() END)',
          [company.tenant, actor, role, active],
        );
      await as(company, company.agent, () =>
        seedGuardedListingDraft(db, {
          listingId: company.listing,
          slug: 'synthetic-calendar-' + company.listing.slice(-3),
          actorId: company.agent,
          content: {
            title: 'Synthetic calendar read fixture',
            pricing: { declaration: 'incomplete', charges: [] },
            location: { county: null, town: null, area: null },
          },
        }),
      );
      await as(company, company.admin, () =>
        db.query('SELECT app_api.record_enquiry($1,$2,NULL,$3,NULL,$4,$5,$6,$7)', [
          company.enquiry,
          randomUUID(),
          'Synthetic calendar prospect',
          'synthetic@example.invalid',
          'PRIVATE SYNTHETIC MESSAGE',
          'staff',
          'synthetic-calendar-v1',
        ]),
      );
      await as(company, company.admin, () =>
        db.query("SELECT app_api.execute_enquiry_operation($1,$2,1,'assign',$3,NULL,NULL,NULL)", [
          company.enquiry,
          randomUUID(),
          company.agent,
        ]),
      );
    }
    // Explicit owner-seeded historical read fixtures. They establish projection bounds,
    // not normal request/publication eligibility, real attendance or past command execution.
    for (let n = 0; n < 101; n++)
      await seedHistoricalConfirmedViewing(db, {
        tenantId: a.tenant,
        enquiryId: a.enquiry,
        listingId: a.listing,
        actorId: a.agent,
        viewingId: id(1000 + n),
        offset: 20000 + n * 10,
        later: n % 2 === 1,
      });
    await seedHistoricalConfirmedViewing(db, {
      tenantId: b.tenant,
      enquiryId: b.enquiry,
      listingId: b.listing,
      actorId: b.agent,
      viewingId: id(5000),
      offset: 40000,
    });
    for (let n = 0; n < 26; n++)
      await db.query(
        "INSERT INTO app_private.viewings(tenant_id,id,enquiry_id,listing_id,requested_by_id,status,version,preferred_slots,notes,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'requested',1,'[]'::jsonb,'Fictional unscheduled read fixture',date_trunc('milliseconds',statement_timestamp()),date_trunc('milliseconds',statement_timestamp()))",
        [a.tenant, id(2000 + n), a.enquiry, a.listing, a.agent],
      );
    const before = (await db.query('SELECT count(*)::int count FROM app_private.audit_events'))
      .rows[0].count;
    const read = (company, actor) =>
      as(company, actor, async () =>
        validateStaffViewingCalendar(
          (
            await db.query(
              'SELECT app_api.read_viewing_calendar($1::timestamptz,$2::timestamptz) calendar',
              [window.fromAt, window.untilAt],
            )
          ).rows[0].calendar,
          window,
        ),
      );
    const page = await read(a, a.admin);
    assert.equal(page.scheduled.items.length, 100);
    assert.equal(page.scheduled.hasMore, true);
    assert.equal(page.unscheduled.items.length, 25);
    assert.equal(page.unscheduled.hasMore, true);
    assert.ok(!page.scheduled.items.some((row) => row.viewingId === id(5000)));
    assert.equal((await read(a, a.agent)).scheduled.items.length, 100);
    assert.equal((await read(a, id(12))).scheduled.items.length, 0);
    assert.equal((await read(b, b.admin)).scheduled.items.length, 1);
    for (const actor of [id(13), id(14), b.admin])
      await assert.rejects(
        () => read(a, actor),
        (error) => error.code === '42501',
      );
    await assert.rejects(
      () => as(a, a.admin, () => db.query('SELECT * FROM app_private.viewings')),
      (error) => error.code === '42501',
    );
    await assert.rejects(
      () =>
        as(a, a.admin, () =>
          db.query("SELECT app_api.read_viewing_calendar('2020-01-01Z','2020-03-01Z')"),
        ),
      (error) => error.code === '22023',
    );
    assert.equal(
      (await db.query('SELECT count(*)::int count FROM app_private.audit_events')).rows[0].count,
      before,
    );
    const context = (await db.query("SELECT current_setting('realtor.tenant_id',true) tenant"))
      .rows[0].tenant;
    assert.ok(context === '' || context === null);
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [a.tenant, a.agent],
    );
    await assert.rejects(
      () => read(a, a.agent),
      (error) => error.code === '42501',
    );
  } finally {
    await db.close();
  }
});
