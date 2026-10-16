/** Disposable synthetic SQL fixture; normal protected workflows, no test-module import or real delivery. */
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from './migrations.mjs';
import { seedSyntheticSealedMedia } from './synthetic-sealed-media.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  T = id(1),
  A = id(10),
  U = id(11),
  P = id(12),
  L = id(100),
  E = id(200);
const slot = {
    startAt: '2090-01-01T09:00:00.000Z',
    endAt: '2090-01-01T10:00:00.000Z',
    timeZone: 'Africa/Nairobi',
  },
  due = '2090-01-01T08:00:00.000Z',
  expires = slot.startAt;
const scalar = async (db, sql, args = []) => (await db.query(sql, args)).rows[0].value;
async function actor(db, user, work, tenant = T) {
  await db.exec('BEGIN;SET LOCAL ROLE api_runtime;');
  try {
    await db.query(
      "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
      [tenant, user],
    );
    const value = await work();
    await db.exec('COMMIT');
    return value;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
async function fixture() {
  const db = new PGlite();
  try {
    await applyTestMigrations(db);
    await db.query(
      "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'reminder-admission','Synthetic reminder admission')",
      [T],
    );
    for (const [user, role] of [
      [A, 'admin'],
      [U, 'agent'],
      [P, 'agent'],
    ])
      await db.query(
        'INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',
        [T, user, role],
      );
    const content = {
      title: 'Synthetic reminder studio',
      description: 'Fictional reminder admission fixture.',
      purpose: 'rent',
      propertyType: 'studio',
      currency: 'KES',
      amountMinor: 2000000,
      rentPeriod: 'month',
      bedrooms: 0,
      privateBathrooms: 1,
      sharedBathrooms: null,
      country: 'KE',
      locality: 'Synthetic Nairobi',
      publicPrecision: 'area',
      latitude: null,
      longitude: null,
      privateAddress: null,
    };
    const version = await actor(db, U, async () => {
      await db.query('SELECT app_api.create_listing($1,$2)', [L, 'synthetic-reminder-admission']);
      return scalar(db, 'SELECT app_api.save_draft($1,1,0,$2::jsonb) value', [
        L,
        JSON.stringify(content),
      ]);
    });
    for (let position = 0; position < 4; position++)
      await seedSyntheticSealedMedia(db, {
        tenantId: T,
        listingId: L,
        mediaId: id(600 + position),
        position,
      });
    const pending = await actor(db, U, async () => {
      await db.query("SELECT app_api.confirm_availability($1,1,'available')", [L]);
      return scalar(db, 'SELECT app_api.submit_revision($1,1,$2) value', [L, version]);
    });
    await actor(db, A, () =>
      db.query('SELECT app_api.decide_revision($1,1,$2,true)', [L, pending]),
    );
    await db.query(
      "INSERT INTO app_private.enquiries(tenant_id,id,idempotency_key,assigned_agent_id,contact_name,email,message,origin,notice_version,status) VALUES($1,$2,$2,$3,'Synthetic reminder','synthetic@example.invalid','Fictional reminder interest','staff','synthetic-v1','assigned')",
      [T, E, U],
    );
    const requested = await actor(db, U, () =>
        scalar(
          db,
          "SELECT app_api.execute_viewing_operation($1,NULL,$2,1,'request',$3,'[]'::jsonb,$4,NULL) value",
          [E, id(700), L, 'Synthetic reminder request.'],
        ),
      ),
      viewing = requested.viewingId;
    const proposed = await actor(db, U, () =>
      scalar(
        db,
        "SELECT app_api.execute_viewing_operation($1,$2,$3,1,'propose',NULL,NULL,NULL,$4::jsonb) value",
        [E, viewing, id(701), JSON.stringify(slot)],
      ),
    );
    await actor(db, U, () =>
      scalar(db, "SELECT app_api.confirm_viewing_phone($1,$2,$3,2,$4::jsonb,'phone',$5,$6) value", [
        E,
        viewing,
        id(702),
        JSON.stringify(slot),
        proposed.completedAt,
        'Synthetic explicit agreement.',
      ]),
    );
    return { db, viewing };
  } catch (error) {
    await db.close();
    throw error;
  }
}

export {
  fixture as createReminderAdmissionFixture,
  actor as reminderFixtureActor,
  scalar as reminderFixtureScalar,
};
