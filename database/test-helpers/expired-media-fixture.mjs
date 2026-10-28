/** Privileged disposable historical fixtures only. Never production commands or actual past executions. */
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from './migrations.mjs';
import { seedGuardedListingDraft } from './guarded-listing-fixture.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1),
  OTHER = id(2),
  A = id(10),
  B = id(20),
  L = id(100),
  LB = id(200);
const scalar = async (db, sql, params = []) =>
  Object.values((await db.query(sql, params)).rows[0])[0];
async function as(db, role, fn) {
  await db.exec(`BEGIN;SET LOCAL ROLE ${role};`);
  try {
    const result = await fn();
    await db.exec('COMMIT');
    return result;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}
async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await applyTestMigrations(db, { through: '0033_staff_viewing_calendar.sql' });
  await db.exec(
    await readFile(
      new URL('../migrations/0034_expired_media_cleanup.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.query(
    "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'expiry-a','Synthetic A'),($2,'expiry-b','Synthetic B')",
    [T, OTHER],
  );
  await db.query(
    "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin'),($3,$4,'admin')",
    [T, A, OTHER, B],
  );
  for (const [tenant, actor, listing] of [
    [T, A, L],
    [OTHER, B, LB],
  ])
    await as(db, 'api_runtime', async () => {
      await db.query(
        "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
        [tenant, actor],
      );
      await seedGuardedListingDraft(db, {
        listingId: listing,
        slug: 'synthetic-' + listing,
        actorId: actor,
        content: {
          title: 'Synthetic expiry fixture',
          description: 'No vendor data; no accepted decoder claim.',
          purpose: 'rent',
          propertyType: 'apartment',
          currency: 'KES',
          amountMinor: 2000000,
          rentPeriod: 'month',
          bedrooms: 2,
          privateBathrooms: 1,
          sharedBathrooms: null,
          country: 'KE',
          locality: 'Synthetic Nairobi',
          publicPrecision: 'area',
          latitude: null,
          longitude: null,
          privateAddress: null,
          pricing: { declaration: 'not_declared', charges: [] },
          location: { county: null, town: null, area: null },
        },
      });
    });
  return db;
}
/** Owner-only historical SQL facts, not execution of backdated live commands. */
async function historicalJob(db, { tenant = T, actor = A, listing = L, age = 26 } = {}) {
  const job = randomUUID(),
    operation = randomUUID(),
    q = randomUUID(),
    o = randomUUID();
  await db.query(
    `WITH facts AS(SELECT clock_timestamp()-$6::double precision*interval '1 hour' AS created),payload AS(
 SELECT created,jsonb_build_object('kind','register_media_upload','tenantId',$1::uuid,'actorId',$2::uuid,'listingId',$3::uuid,
 'revision',1,'expectedVersion','2','jobId',$5::uuid,'altText','Synthetic expiry bytes') AS body FROM facts)
 INSERT INTO app_private.media_operations(tenant_id,operation_id,kind,listing_id,revision_no,requester_id,expected_version,resource_id,request_payload,request_sha256,receipt,created_at)
 SELECT $1,$4,'register_media_upload',$3,1,$2,2,$5,body,encode(sha256(convert_to(body::text,'UTF8')),'hex'),
 jsonb_build_object('kind','register_media_upload','operationId',$4::uuid,'jobId',$5::uuid,'listingId',$3::uuid,'revision',1,'expectedVersion','2',
 'altText','Synthetic expiry bytes','outcome','registered','registeredAt',app_private.media_utc(created),'expiresAt',app_private.media_utc(created+interval '24 hours')),created FROM payload`,
    [tenant, actor, listing, operation, job, age],
  );
  await db.query(
    `INSERT INTO app_private.media_jobs(tenant_id,id,registration_id,listing_id,revision_no,requester_id,registered_assigned_agent_id,expected_version,alt_text,quarantine_id,output_id,created_at,expires_at)
 SELECT tenant_id,$2,operation_id,listing_id,revision_no,requester_id,requester_id,expected_version,'Synthetic expiry bytes',$3,$4,created_at,created_at+interval '24 hours'
 FROM app_private.media_operations WHERE tenant_id=$1 AND operation_id=$5`,
    [tenant, job, q, o, operation],
  );
  return { tenant, job, quarantineId: q, outputId: o };
}
const authorize = (db, j, operation = randomUUID(), tenant = j.tenant) =>
  as(db, 'media_maintenance', () =>
    scalar(db, 'SELECT app_media.authorize_expired_cleanup($1,$2,$3)', [tenant, j.job, operation]),
  );

export { id, T, OTHER, A, B, L, LB, scalar, as, fixture, historicalJob, authorize };
