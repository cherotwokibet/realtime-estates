import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { seedGuardedListingDraft } from '../test-helpers/guarded-listing-fixture.mjs';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1),
  OTHER = id(2),
  ADMIN = id(10),
  AGENT = id(11),
  PEER = id(12),
  VISITOR = id(13),
  OTHERADMIN = id(20);
const content = {
  title: 'Synthetic preflight apartment',
  description: 'SQL authorization fixture only; no body or native processing.',
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
  privateAddress: 'PRIVATE SYNTHETIC ADDRESS',
};
async function scalar(db, sql, args = []) {
  return Object.values((await db.query(sql, args)).rows[0])[0];
}
const denied = (operation, code) => assert.rejects(operation, (error) => error.code === code);
async function fixture() {
  const db = new PGlite();
  await applyTestMigrations(db);
  // Explicit candidate-schema coverage while 0024 is not in default startup.
  await db.exec(
    await readFile(
      new URL('../proposals/0024_guarded_draft_allocation.sql', import.meta.url),
      'utf8',
    ),
  );
  const bootstrap = '"' + (await scalar(db, 'SELECT session_user')).replaceAll('"', '""') + '"';
  await db.query(
    `INSERT INTO app_private.tenants(id,slug,display_name) VALUES
    ($1,'preflight-a','Synthetic A'),($2,'preflight-b','Synthetic B')`,
    [T, OTHER],
  );
  for (const [tenant, user, role] of [
    [T, ADMIN, 'admin'],
    [T, AGENT, 'agent'],
    [T, PEER, 'agent'],
    [T, VISITOR, 'customer'],
    [OTHER, OTHERADMIN, 'admin'],
  ])
    await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
      tenant,
      user,
      role,
    ]);
  await db.exec(
    'CREATE ROLE synthetic_upload_preflight_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;GRANT api_runtime TO synthetic_upload_preflight_login;',
  );
  async function api(actor, operation, tenant = T) {
    await db.exec(
      'SET SESSION AUTHORIZATION synthetic_upload_preflight_login;BEGIN;SET LOCAL ROLE api_runtime;',
    );
    try {
      await db.query(
        `SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),
        set_config('realtor.correlation_id','synthetic-upload-preflight',true)`,
        [tenant ?? '', actor ?? ''],
      );
      const result = await operation();
      await db.exec('COMMIT');
      return result;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    } finally {
      await db.exec(`SET SESSION AUTHORIZATION ${bootstrap};RESET ROLE;`);
    }
  }
  async function job(n, { actor = AGENT, tenant = T } = {}) {
    const listing = id(n),
      registration = id(n + 1000);
    return api(
      actor,
      async () => {
        await seedGuardedListingDraft(db, {
          listingId: listing,
          slug: `synthetic-preflight-${n}`,
          content: {
            ...content,
            pricing: { declaration: 'not_declared', charges: [] },
            location: { county: null, town: null, area: null },
          },
          actorId: actor,
        });
        const receipt = await scalar(db, 'SELECT app_api.register_media_upload($1,1,2,$2,$3)', [
          listing,
          registration,
          'Synthetic preflight photo',
        ]);
        return { listing, registration, job: receipt.jobId, actor, tenant };
      },
      tenant,
    );
  }
  const preflight = (
    x,
    { actor = x.actor, tenant = x.tenant, listing = x.listing, revision = 1, jobId = x.job } = {},
  ) =>
    api(
      actor,
      () =>
        scalar(db, 'SELECT app_api.preflight_media_upload($1,$2,$3)', [listing, revision, jobId]),
      tenant,
    );
  return { db, api, job, preflight };
}
async function snapshot(db) {
  const result = {};
  for (const table of [
    'tenants',
    'memberships',
    'listings',
    'listing_revisions',
    'revision_media',
    'media_operations',
    'media_jobs',
    'media_input_captures',
    'media_processing_leases',
    'media_verified_outputs',
    'media_attach_intents',
    'media_attach_results',
    'media_attachments',
    'audit_events',
    'public_snapshots',
  ])
    result[table] = (
      await db.query(
        `SELECT to_jsonb(x) AS value FROM app_private.${table} x ORDER BY to_jsonb(x)::text`,
      )
    ).rows;
  return result;
}
async function expired(f, n) {
  const { db, api } = f,
    listing = id(n),
    registration = id(n + 1000),
    job = id(n + 2000),
    quarantine = id(n + 3000),
    output = id(n + 4000);
  await api(AGENT, async () => {
    await seedGuardedListingDraft(db, {
      listingId: listing,
      slug: `synthetic-preflight-${n}`,
      content: {
        ...content,
        pricing: { declaration: 'not_declared', charges: [] },
        location: { county: null, town: null, area: null },
      },
      actorId: AGENT,
    });
  });
  // Explicit privileged immutable historical metadata fixture. This is not clock
  // advancement, a successful historical upload, or native/storage evidence.
  await db.query(
    `WITH facts AS (SELECT '2000-01-01T00:00:00Z'::timestamptz AS created), request AS (
    SELECT created,jsonb_build_object('kind','register_media_upload','tenantId',$1::uuid,'actorId',$5::uuid,
      'listingId',$3::uuid,'revision',1,'expectedVersion','2','jobId',$4::uuid,'altText','Expired preflight fixture') AS payload FROM facts)
    INSERT INTO app_private.media_operations(tenant_id,operation_id,kind,listing_id,revision_no,requester_id,
      expected_version,resource_id,request_payload,request_sha256,receipt,created_at)
    SELECT $1,$2,'register_media_upload',$3,1,$5,2,$4,payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'),
      jsonb_build_object('kind','register_media_upload','operationId',$2::uuid,'jobId',$4::uuid,'listingId',$3::uuid,
        'revision',1,'expectedVersion','2','altText','Expired preflight fixture','outcome','registered',
        'registeredAt',app_private.media_utc(created),'expiresAt',app_private.media_utc(created+interval '24 hours')),created FROM request`,
    [T, registration, listing, job, AGENT],
  );
  await db.query(
    `INSERT INTO app_private.media_jobs(tenant_id,id,registration_id,listing_id,revision_no,requester_id,
    registered_assigned_agent_id,expected_version,alt_text,quarantine_id,output_id,created_at,expires_at)
    SELECT tenant_id,resource_id,operation_id,listing_id,revision_no,requester_id,requester_id,expected_version,
      request_payload->>'altText',$2,$3,created_at,created_at+interval '24 hours'
    FROM app_private.media_operations WHERE tenant_id=$4 AND operation_id=$1`,
    [registration, quarantine, output, T],
  );
  return { listing, registration, job, actor: AGENT, tenant: T };
}

// Serialized disposable PGlite policy proof under an isolated API login. The
// migration grants no byte/storage/processing authority; no HTTP/native test runs.
test('fresh upload preflight requires current authenticated exact original-job authorization without mutation', async (t) => {
  const f = await fixture(),
    { db, api, job, preflight } = f;
  try {
    await t.test(
      'exact agent and original admin jobs return only the fixed resource tuple',
      async () => {
        for (const actor of [AGENT, ADMIN]) {
          const x = await job(actor === AGENT ? 100 : 101, { actor }),
            before = await snapshot(db);
          const result = await preflight(x);
          assert.deepEqual(result, { jobId: x.job, listingId: x.listing, revision: 1 });
          assert.deepEqual(await preflight(x), result);
          assert.deepEqual(await snapshot(db), before);
        }
      },
    );
    await t.test(
      'wrong listing, revision and job cannot select another permitted resource',
      async () => {
        const x = await job(102),
          y = await job(103),
          before = await snapshot(db);
        await denied(() => preflight(x, { listing: y.listing }), 'P0002');
        await denied(() => preflight(x, { revision: 2 }), 'P0002');
        await denied(() => preflight(x, { jobId: y.job }), 'P0002');
        await denied(() => preflight(x, { jobId: id(99999) }), 'P0002');
        assert.deepEqual(await snapshot(db), before);
      },
    );
    await t.test(
      'tenant and original actor binding reject peers and another authorized admin',
      async () => {
        const x = await job(104),
          y = await job(105, { actor: OTHERADMIN, tenant: OTHER }),
          before = await snapshot(db);
        await denied(() => preflight(x, { actor: ADMIN }), 'P0002');
        await denied(() => preflight(x, { actor: PEER }), 'P0002');
        await denied(() => preflight(x, { actor: OTHERADMIN, tenant: OTHER }), 'P0002');
        await denied(() => preflight(y, { actor: ADMIN, tenant: T }), 'P0002');
        assert.deepEqual(await snapshot(db), before);
      },
    );
    await t.test(
      'visitors and missing verified identity/context fail before disclosing a tuple',
      async () => {
        const x = await job(106),
          before = await snapshot(db);
        await denied(() => preflight(x, { actor: VISITOR }), '42501');
        await denied(() => preflight(x, { actor: null }), '42501');
        await denied(() => preflight(x, { tenant: null }), '42501');
        assert.deepEqual(await snapshot(db), before);
      },
    );
    await t.test(
      'revocation, role downgrade and disabled company are rechecked on every call',
      async () => {
        const x = await job(107);
        await db.query(
          'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
          [T, AGENT],
        );
        let before = await snapshot(db);
        await denied(() => preflight(x), '42501');
        assert.deepEqual(await snapshot(db), before);
        await db.query(
          "UPDATE app_private.memberships SET active=true,revoked_at=NULL,role='customer' WHERE tenant_id=$1 AND user_id=$2",
          [T, AGENT],
        );
        before = await snapshot(db);
        await denied(() => preflight(x), '42501');
        assert.deepEqual(await snapshot(db), before);
        await db.query(
          "UPDATE app_private.memberships SET role='agent' WHERE tenant_id=$1 AND user_id=$2",
          [T, AGENT],
        );
        await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
        before = await snapshot(db);
        await denied(() => preflight(x), '42501');
        assert.deepEqual(await snapshot(db), before);
        await db.query('UPDATE app_private.tenants SET enabled=true WHERE id=$1', [T]);
        assert.deepEqual(await preflight(x), { jobId: x.job, listingId: x.listing, revision: 1 });
      },
    );
    await t.test(
      'current agent access and original registered assignment apply independently',
      async () => {
        const x = await job(108),
          admin = await job(109, { actor: ADMIN });
        await api(ADMIN, () =>
          db.query('SELECT app_api.reassign_listing($1,1,$2)', [x.listing, PEER]),
        );
        let before = await snapshot(db);
        await denied(() => preflight(x), 'P0002');
        assert.deepEqual(await snapshot(db), before);
        await api(ADMIN, () =>
          db.query('SELECT app_api.reassign_listing($1,1,$2)', [admin.listing, PEER]),
        );
        before = await snapshot(db);
        await denied(() => preflight(admin), '40001');
        assert.deepEqual(await snapshot(db), before);
        await api(ADMIN, () =>
          db.query('SELECT app_api.reassign_listing($1,2,$2)', [x.listing, AGENT]),
        );
        assert.deepEqual(await preflight(x), { jobId: x.job, listingId: x.listing, revision: 1 });
      },
    );
    await t.test(
      'non-draft and expired jobs remain historically readable but cannot admit fresh bytes',
      async () => {
        const pending = await job(110),
          old = await expired(f, 111);
        // State-only privileged fixture isolates the draft guard; no photo gate or
        // genuine successful submission is asserted by this synthetic transition.
        await db.query(
          "UPDATE app_private.listing_revisions SET state='pending',submitted_at=now(),submitted_by=$2 WHERE tenant_id=$3 AND listing_id=$1",
          [pending.listing, AGENT, T],
        );
        const before = await snapshot(db);
        await denied(() => preflight(pending), '23514');
        await denied(() => preflight(old), '23514');
        assert.equal(
          (await api(AGENT, () => scalar(db, 'SELECT app_api.read_media_job($1)', [old.job])))
            .state,
          'expired',
        );
        assert.equal(
          (await api(AGENT, () => scalar(db, 'SELECT app_api.read_media_job($1)', [pending.job])))
            .jobId,
          pending.job,
        );
        assert.deepEqual(await snapshot(db), before);
      },
    );
    await t.test(
      'malformed tuple arguments fail without reserving or changing any facts',
      async () => {
        const x = await job(112),
          before = await snapshot(db);
        for (const change of [
          { listing: null },
          { revision: null },
          { revision: 0 },
          { revision: -1 },
          { jobId: null },
        ])
          await denied(() => preflight(x, change), '23514');
        assert.deepEqual(await snapshot(db), before);
      },
    );
    await t.test(
      'later draft edits are not a refreshed version or new processing authority',
      async () => {
        const x = await job(113),
          original = await preflight(x);
        await api(AGENT, () =>
          db.query('SELECT app_api.save_draft($1,1,2,$2::jsonb)', [
            x.listing,
            JSON.stringify({ ...content, title: 'Later synthetic preflight title' }),
          ]),
        );
        const before = await snapshot(db);
        assert.deepEqual(await preflight(x), original);
        assert.deepEqual(await snapshot(db), before);
        assert.equal(
          await scalar(
            db,
            'SELECT version::text FROM app_private.listing_revisions WHERE tenant_id=$1 AND listing_id=$2',
            [T, x.listing],
          ),
          '3',
        );
        assert.equal(
          await scalar(
            db,
            'SELECT count(*)::integer FROM app_private.media_input_captures WHERE job_id=$1',
            [x.job],
          ),
          0,
        );
        assert.equal(
          await scalar(
            db,
            'SELECT count(*)::integer FROM app_private.media_processing_leases WHERE job_id=$1',
            [x.job],
          ),
          0,
        );
        assert.equal(
          await scalar(
            db,
            'SELECT count(*)::integer FROM app_private.media_verified_outputs WHERE job_id=$1',
            [x.job],
          ),
          0,
        );
      },
    );
    await t.test(
      'one owner function grants only API execution without table or coordinator privileges',
      async () => {
        const flags = (
          await db.query(`SELECT p.prosecdef,p.proconfig,r.rolname AS owner,
        has_function_privilege('api_runtime',p.oid,'EXECUTE') AS api_execute,
        has_function_privilege('media_coordinator',p.oid,'EXECUTE') AS coordinator_execute,
        EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
        FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid='app_api.preflight_media_upload(uuid,integer,uuid)'::regprocedure`)
        ).rows[0];
        assert.deepEqual(flags, {
          prosecdef: true,
          proconfig: ['search_path=pg_catalog'],
          owner: 'realtor_owner',
          api_execute: true,
          coordinator_execute: false,
          public_execute: false,
        });
        assert.equal(
          await scalar(db, "SELECT has_schema_privilege('api_runtime','app_api','CREATE')"),
          false,
        );
        assert.equal(
          await scalar(db, "SELECT has_schema_privilege('api_runtime','app_private','CREATE')"),
          false,
        );
        assert.equal(
          await scalar(db, "SELECT has_schema_privilege('api_runtime','app_media','USAGE')"),
          false,
        );
        for (const table of [
          'media_jobs',
          'media_operations',
          'media_input_captures',
          'media_processing_leases',
          'media_verified_outputs',
        ])
          for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
            assert.equal(
              await scalar(db, "SELECT has_table_privilege('api_runtime',$1,$2)", [
                `app_private.${table}`,
                privilege,
              ]),
              false,
            );
        await denied(
          () => api(ADMIN, () => db.query('SELECT quarantine_id FROM app_private.media_jobs')),
          '42501',
        );
        assert.equal(
          await scalar(
            db,
            "SELECT pg_has_role('synthetic_upload_preflight_login','realtor_owner','MEMBER') OR pg_has_role('synthetic_upload_preflight_login','media_coordinator','MEMBER')",
          ),
          false,
        );
      },
    );
  } finally {
    await db.close();
  }
});
