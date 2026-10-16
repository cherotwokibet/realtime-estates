import assert from 'node:assert/strict';
import test from 'node:test';
import { seedGuardedListingDraft } from '../test-helpers/guarded-listing-fixture.mjs';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import { seedSyntheticSealedMedia } from '../test-helpers/synthetic-sealed-media.mjs';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1),
  OTHER = id(2),
  ADMIN = id(10),
  AGENT = id(11),
  PEER = id(12),
  OTHERADMIN = id(20);
const INPUT = 'a'.repeat(64),
  OUTPUT = 'b'.repeat(64);
const content = {
  title: 'Synthetic processing apartment',
  description: 'SQL policy fixtures; not actual decoder evidence.',
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
const manifest = (overrides = {}) => ({
  pipeline: 'synthetic-codec-v1',
  sourceFormat: 'png',
  inputSha256: INPUT,
  inputBytes: 100,
  format: 'webp',
  mimeType: 'image/webp',
  sha256: OUTPUT,
  width: 800,
  height: 600,
  bytes: 1000,
  encoder: { sharp: '0.35.5', vips: '8.18.7' },
  operations: [
    'auto-orient',
    'resize-inside-1920-without-enlargement',
    'strip-metadata',
    'webp-quality-82-effort-4',
  ],
  ...overrides,
});
async function scalar(db, sql, args = []) {
  const result = await db.query(sql, args);
  return Object.values(result.rows[0])[0];
}
async function transaction(db, role, tenant, actor, callback) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${role};`);
  try {
    await db.query(
      `SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),
      set_config('realtor.correlation_id','FORGED-CONTEXT-MUST-NOT-CHOOSE-ACTOR',true)`,
      [tenant ?? '', actor ?? ''],
    );
    const result = await callback();
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
const actor = (db, user, callback) => transaction(db, 'api_runtime', T, user, callback);
// Coordinator commands deliberately receive a wrong company's GUC context. They
// must derive company/requester from the immutable registered job instead.
const coordinator = (db, callback) =>
  transaction(db, 'media_coordinator', OTHER, OTHERADMIN, callback);
const denied = (callback, code = '42501') =>
  assert.rejects(callback, (error) => error.code === code);
const capture = (db, job, generation = id(5000), bytes = 100, sha = INPUT) =>
  coordinator(db, () =>
    scalar(db, 'SELECT app_media.capture_input($1,$2,$3,$4)', [job, generation, bytes, sha]),
  );
const claim = (db, job, claimId) =>
  coordinator(db, () => scalar(db, 'SELECT app_media.claim_processing($1,$2)', [job, claimId]));
const seal = (db, job, lease, value = manifest()) =>
  coordinator(db, () =>
    scalar(db, 'SELECT app_media.seal_output($1,$2,$3,$4::jsonb)', [
      job,
      lease.attempt,
      lease.leaseNonce,
      JSON.stringify(value),
    ]),
  );
const read = (db, job) =>
  coordinator(db, () => scalar(db, 'SELECT app_media.read_processing($1)', [job]));
async function fixture() {
  const db = new PGlite();
  await applyTestMigrations(db);
  // Allocation restriction is part of the normal reviewed migration order.
  await db.query(
    `INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'processing-a','Synthetic A'),($2,'processing-b','Synthetic B')`,
    [T, OTHER],
  );
  for (const [tenant, user, role] of [
    [T, ADMIN, 'admin'],
    [T, AGENT, 'agent'],
    [T, PEER, 'agent'],
    [OTHER, OTHERADMIN, 'admin'],
  ])
    await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
      tenant,
      user,
      role,
    ]);
  return db;
}
async function newJob(db, n, { requester = AGENT } = {}) {
  const listing = id(n),
    operation = id(n + 1000);
  return actor(db, requester, async () => {
    await seedGuardedListingDraft(db, {
      listingId: listing,
      slug: `synthetic-${n}`,
      content: {
        ...content,
        pricing: { declaration: 'not_declared', charges: [] },
        location: { county: null, town: null, area: null },
      },
      actorId: requester,
    });
    const receipt = await scalar(db, 'SELECT app_api.register_media_upload($1,1,2,$2,$3)', [
      listing,
      operation,
      'Synthetic processing photo',
    ]);
    return { listing, operation, job: receipt.jobId, receipt };
  });
}
async function versions(db, listing) {
  return (
    await db.query(
      `SELECT l.version::text AS listing,r.version::text AS revision,
    (SELECT count(*)::integer FROM app_private.revision_media m WHERE m.tenant_id=l.tenant_id AND m.listing_id=l.id) AS photos
    FROM app_private.listings l JOIN app_private.listing_revisions r ON r.tenant_id=l.tenant_id AND r.listing_id=l.id
    WHERE l.id=$1`,
      [listing],
    )
  ).rows;
}
async function seedExpiredLease(db, job, attempt, claimId) {
  const nonce = id(20000 + Number(claimId.slice(-4)));
  await db.query(
    `WITH facts AS (SELECT clock_timestamp() AS current_time)
    INSERT INTO app_private.media_processing_leases(tenant_id,job_id,attempt,claim_id,lease_nonce,claimed_at,lease_expires_at,job_expires_at)
    SELECT tenant_id,id,$2,$3,$4,facts.current_time-interval '200 seconds',least(facts.current_time-interval '20 seconds',expires_at),expires_at
    FROM app_private.media_jobs CROSS JOIN facts WHERE id=$1`,
    [job, attempt, claimId, nonce],
  );
  return { attempt, leaseNonce: nonce };
}
async function historicalJob(db, n, expiresOffsetSeconds) {
  const listing = id(n),
    operation = id(n + 1000),
    job = id(n + 2000);
  await actor(db, AGENT, async () => {
    await seedGuardedListingDraft(db, {
      listingId: listing,
      slug: `synthetic-${n}`,
      content: {
        ...content,
        pricing: { declaration: 'not_declared', charges: [] },
        location: { county: null, town: null, area: null },
      },
      actorId: AGENT,
    });
  });
  await db.query(
    `WITH facts AS (SELECT clock_timestamp()-interval '24 hours'+($6::integer*interval '1 second') AS created),
    request AS (SELECT created,jsonb_build_object('kind','register_media_upload','tenantId',$1::uuid,'actorId',$5::uuid,
      'listingId',$3::uuid,'revision',1,'expectedVersion','2','jobId',$4::uuid,'altText','Historical synthetic processing') AS payload FROM facts)
    INSERT INTO app_private.media_operations(tenant_id,operation_id,kind,listing_id,revision_no,requester_id,
      expected_version,resource_id,request_payload,request_sha256,receipt,created_at)
    SELECT $1,$2,'register_media_upload',$3,1,$5,2,$4,payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'),
      jsonb_build_object('kind','register_media_upload','operationId',$2::uuid,'jobId',$4::uuid,'listingId',$3::uuid,
        'revision',1,'expectedVersion','2','altText','Historical synthetic processing','outcome','registered',
        'registeredAt',app_private.media_utc(created),'expiresAt',app_private.media_utc(created+interval '24 hours')),created FROM request`,
    [T, operation, listing, job, AGENT, expiresOffsetSeconds],
  );
  await db.query(
    `INSERT INTO app_private.media_jobs(tenant_id,id,registration_id,listing_id,revision_no,requester_id,
    registered_assigned_agent_id,expected_version,alt_text,quarantine_id,output_id,created_at,expires_at)
    SELECT tenant_id,resource_id,operation_id,listing_id,revision_no,requester_id,requester_id,expected_version,
      request_payload->>'altText',$2,$3,created_at,created_at+interval '24 hours'
    FROM app_private.media_operations WHERE operation_id=$1`,
    [operation, id(n + 3000), id(n + 4000)],
  );
  return { listing, operation, job };
}
async function seedCaptured(db, job) {
  await db.query(
    `INSERT INTO app_private.media_input_captures(tenant_id,job_id,listing_id,revision_no,requester_id,generation_id,input_bytes,input_sha256,captured_at)
    SELECT tenant_id,id,listing_id,revision_no,requester_id,$2,100,$3,created_at+interval '1 second' FROM app_private.media_jobs WHERE id=$1`,
    [job, id(5999), INPUT],
  );
}

// Serialized local policy/transaction evidence. Privileged seeded timestamps and
// manifests do not claim real elapsed expiry, concurrent PG sessions or decoding.
test('synthetic coordinator processing preserves captured input and fenced immutable attestations', async (t) => {
  const db = await fixture();
  try {
    await t.test(
      'capture, stable claim and seal derive the stored company, requester and generated output',
      async () => {
        const x = await newJob(db, 100);
        const before = await versions(db, x.listing);
        assert.deepEqual(await read(db, x.job), {
          jobId: x.job,
          state: 'registered',
          capture: null,
          lease: null,
          verified: null,
        });
        const captured = await capture(db, x.job);
        assert.equal(captured.inputBytes, 100);
        assert.equal(captured.inputSha256, INPUT);
        assert.deepEqual(await capture(db, x.job), captured);
        assert.equal((await read(db, x.job)).state, 'captured');
        const lease = await claim(db, x.job, id(6000));
        assert.equal(lease.attempt, 1);
        assert.equal(lease.claimId, id(6000));
        assert.equal(lease.pipeline, 'synthetic-codec-v1');
        assert.deepEqual(lease.input, { generationId: id(5000), bytes: 100, sha256: INPUT });
        const row = (
          await db.query('SELECT * FROM app_private.media_processing_leases WHERE job_id=$1', [
            x.job,
          ])
        ).rows[0];
        assert.equal(Date.parse(row.lease_expires_at) - Date.parse(row.claimed_at), 180000);
        assert.deepEqual(await claim(db, x.job, id(6000)), lease);
        await denied(() => claim(db, x.job, id(6001)), '40001');
        assert.equal((await read(db, x.job)).state, 'processing');
        const verified = await seal(db, x.job, lease);
        assert.equal(verified.outputId, lease.outputId);
        assert.equal(verified.outcome, 'verified');
        assert.deepEqual(verified.manifest, manifest());
        assert.match(verified.manifestSha256, /^[a-f0-9]{64}$/);
        assert.deepEqual(await seal(db, x.job, lease), verified);
        assert.deepEqual((await read(db, x.job)).verified, verified);
        assert.equal((await read(db, x.job)).state, 'verified');
        assert.deepEqual(await claim(db, x.job, id(6000)), lease);
        await denied(() => claim(db, x.job, id(6002)), '23514');
        assert.deepEqual(await versions(db, x.listing), before);
        assert.deepEqual(
          await actor(db, AGENT, () =>
            scalar(db, 'SELECT app_api.read_media_registration($1)', [x.operation]),
          ),
          x.receipt,
        );
        assert.equal(
          (await actor(db, AGENT, () => scalar(db, 'SELECT app_api.read_media_job($1)', [x.job])))
            .state,
          'registered',
        );
        const audit = await db.query(
          "SELECT * FROM app_private.audit_events WHERE action LIKE 'media.%' AND object_id=$1",
          [x.listing],
        );
        assert.equal(audit.rows.length, 1);
        assert.equal(audit.rows[0].tenant_id, T);
        assert.equal(audit.rows[0].actor_id, AGENT);
      },
    );

    await t.test(
      'changed capture facts, malformed bounds and a claim reused for another job conflict',
      async () => {
        const x = await newJob(db, 101),
          y = await newJob(db, 102);
        await capture(db, x.job);
        await capture(db, y.job);
        for (const [generation, bytes, sha] of [
          [id(5001), 100, INPUT],
          [id(5000), 101, INPUT],
          [id(5000), 100, OUTPUT],
        ])
          await denied(() => capture(db, x.job, generation, bytes, sha), '40001');
        for (const [generation, bytes, sha] of [
          [null, 100, INPUT],
          [id(5000), 0, INPUT],
          [id(5000), 10485761, INPUT],
          [id(5000), 100, 'A'.repeat(64)],
          [id(5000), 100, null],
        ])
          await denied(() => capture(db, x.job, generation, bytes, sha), '23514');
        const lease = await claim(db, x.job, id(6010));
        await denied(() => claim(db, y.job, id(6010)), '40001');
        assert.deepEqual(await claim(db, x.job, id(6010)), lease);
        await denied(() => claim(db, x.job, null), '23514');
        assert.equal(
          await scalar(
            db,
            'SELECT count(*)::integer FROM app_private.media_processing_leases WHERE job_id=$1',
            [y.job],
          ),
          0,
        );
      },
    );

    await t.test(
      'full fixed manifest validation rejects extra fields, altered encoder/policy and input mismatch',
      async () => {
        const x = await newJob(db, 103);
        await capture(db, x.job);
        const lease = await claim(db, x.job, id(6020));
        const invalid = [
          manifest({ pipeline: 'production' }),
          manifest({ sourceFormat: 'gif' }),
          manifest({ format: 'png' }),
          manifest({ mimeType: 'image/png' }),
          manifest({ width: 0 }),
          manifest({ height: 1921 }),
          manifest({ width: 1.5 }),
          manifest({ bytes: 10485761 }),
          manifest({ bytes: 0 }),
          manifest({ sha256: 'B'.repeat(64) }),
          manifest({ encoder: { sharp: '0.35.5', vips: 'OTHER' } }),
          manifest({ operations: ['strip-metadata'] }),
          manifest({ accepted: true }),
          manifest({ outputId: id(999) }),
          manifest({ actorId: ADMIN }),
          manifest({ tenantId: OTHER }),
          manifest({ inputBytes: null }),
        ];
        const missing = manifest();
        delete missing.operations;
        invalid.push(missing);
        for (const value of invalid) await denied(() => seal(db, x.job, lease, value), '23514');
        await denied(() => seal(db, x.job, lease, manifest({ inputBytes: 101 })), '40001');
        await denied(() => seal(db, x.job, lease, manifest({ inputSha256: OUTPUT })), '40001');
        assert.equal(
          await scalar(
            db,
            'SELECT count(*)::integer FROM app_private.media_verified_outputs WHERE job_id=$1',
            [x.job],
          ),
          0,
        );
        const verified = await seal(db, x.job, lease);
        await denied(() => seal(db, x.job, lease, manifest({ sha256: 'c'.repeat(64) })), '40001');
        await denied(() => seal(db, x.job, { ...lease, leaseNonce: id(9999) }), '40001');
        assert.deepEqual((await read(db, x.job)).verified, verified);
      },
    );

    await t.test(
      'expired lease acknowledgement never renews and a replaced lease fences late output',
      async () => {
        const x = await newJob(db, 104);
        await capture(db, x.job);
        const old = await seedExpiredLease(db, x.job, 1, id(6030));
        const recovered = await claim(db, x.job, id(6030));
        assert.equal(recovered.attempt, 1);
        assert.ok(Date.parse(recovered.leaseExpiresAt) < Date.now());
        assert.deepEqual(await claim(db, x.job, id(6030)), recovered);
        assert.equal((await read(db, x.job)).state, 'captured');
        await denied(() => seal(db, x.job, old), '40001');
        const next = await claim(db, x.job, id(6031));
        assert.equal(next.attempt, 2);
        await denied(() => seal(db, x.job, old), '40001');
        assert.deepEqual(await claim(db, x.job, id(6030)), recovered);
        const verified = await seal(db, x.job, next);
        assert.equal(verified.attempt, 2);
        const limited = await newJob(db, 105);
        await capture(db, limited.job);
        for (let attempt = 1; attempt <= 3; attempt++)
          await seedExpiredLease(db, limited.job, attempt, id(6040 + attempt));
        await denied(() => claim(db, limited.job, id(6049)), '23514');
        assert.equal(
          await scalar(
            db,
            'SELECT count(*)::integer FROM app_private.media_processing_leases WHERE job_id=$1',
            [limited.job],
          ),
          3,
        );
      },
    );

    await t.test(
      'current stored authorization ignores forged GUCs but denies revocation, disabled tenant and reassigned agent',
      async () => {
        const x = await newJob(db, 106);
        await capture(db, x.job);
        const lease = await claim(db, x.job, id(6050));
        await actor(db, ADMIN, () =>
          db.query('SELECT app_api.reassign_listing($1,1,$2)', [x.listing, PEER]),
        );
        await denied(() => read(db, x.job), 'P0002');
        await denied(() => claim(db, x.job, id(6050)), 'P0002');
        await denied(() => seal(db, x.job, lease), 'P0002');
        await actor(db, ADMIN, () =>
          db.query('SELECT app_api.reassign_listing($1,2,$2)', [x.listing, AGENT]),
        );
        await db.query(
          'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
          [T, AGENT],
        );
        await denied(() => read(db, x.job), 'P0002');
        await denied(() => capture(db, x.job), 'P0002');
        await db.query(
          'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
          [T, AGENT],
        );
        await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
        await denied(() => seal(db, x.job, lease), 'P0002');
        await db.query('UPDATE app_private.tenants SET enabled=true WHERE id=$1', [T]);
        assert.equal((await read(db, x.job)).state, 'processing');
        await denied(() => read(db, id(99999)), 'P0002');
      },
    );

    await t.test(
      'processing does not adopt an edited draft token and exact committed seal replays after submit',
      async () => {
        const x = await newJob(db, 107);
        await capture(db, x.job);
        await actor(db, AGENT, () =>
          db.query('SELECT app_api.save_draft($1,1,2,$2::jsonb)', [
            x.listing,
            JSON.stringify({ ...content, title: 'Later synthetic title' }),
          ]),
        );
        const lease = await claim(db, x.job, id(6060));
        const verified = await seal(db, x.job, lease);
        assert.equal((await versions(db, x.listing))[0].revision, '3');
        // Separate privileged SQL-only provenance fixtures satisfy submission.
        // This job itself remains unattached; no image bytes/native proof is supplied here.
        for (let position = 0; position < 4; position++)
          await seedSyntheticSealedMedia(db, {
            tenantId: T,
            listingId: x.listing,
            mediaId: id(30000 + position),
            position,
          });
        await actor(db, AGENT, () =>
          db.query('SELECT app_api.submit_revision($1,1,3)', [x.listing]),
        );
        assert.deepEqual(await seal(db, x.job, lease), verified);
        assert.deepEqual(await capture(db, x.job), (await read(db, x.job)).capture);
        assert.deepEqual(await claim(db, x.job, id(6060)), lease);
        assert.equal((await read(db, x.job)).state, 'verified');
        const y = await newJob(db, 108);
        await capture(db, y.job);
        const yLease = await claim(db, y.job, id(6061));
        // Privileged pending-state fixture isolates new-seal state rejection without
        // presenting four metadata rows as trusted processed media.
        await db.query(
          `UPDATE app_private.listing_revisions SET state='pending',submitted_at=now(),submitted_by=$2 WHERE listing_id=$1`,
          [y.listing, AGENT],
        );
        await denied(() => seal(db, y.job, yLease), '23514');
        await denied(() => claim(db, y.job, id(6062)), '23514');
      },
    );

    await t.test(
      'fixed lease is bounded by job expiry and historical verified output remains recoverable after expiry',
      async () => {
        const near = await historicalJob(db, 109, 120);
        await capture(db, near.job);
        const lease = await claim(db, near.job, id(6070));
        const jobExpiry = await scalar(
          db,
          'SELECT expires_at FROM app_private.media_jobs WHERE id=$1',
          [near.job],
        );
        assert.equal(Date.parse(lease.leaseExpiresAt), new Date(jobExpiry).getTime());
        const expired = await historicalJob(db, 110, -60);
        await seedCaptured(db, expired.job);
        const old = await seedExpiredLease(db, expired.job, 1, id(6071));
        await db.query(
          `INSERT INTO app_private.media_verified_outputs(tenant_id,job_id,attempt,lease_nonce,output_id,manifest,manifest_sha256,verified_at)
        SELECT tenant_id,id,1,$2,output_id,$3::jsonb,encode(sha256(convert_to(($3::jsonb)::text,'UTF8')),'hex'),expires_at-interval '1 second'
        FROM app_private.media_jobs WHERE id=$1`,
          [expired.job, old.leaseNonce, JSON.stringify(manifest())],
        );
        const before = await read(db, expired.job);
        assert.equal(before.state, 'verified');
        assert.deepEqual(await seal(db, expired.job, old), before.verified);
        await denied(() => claim(db, expired.job, id(6072)), '23514');
        const unprocessed = await historicalJob(db, 111, -60);
        assert.equal((await read(db, unprocessed.job)).state, 'expired');
        await denied(() => capture(db, unprocessed.job), '23514');
        assert.equal(
          await scalar(
            db,
            'SELECT count(*)::integer FROM app_private.media_input_captures WHERE job_id=$1',
            [unprocessed.job],
          ),
          0,
        );
      },
    );

    await t.test(
      'original admin historical recovery survives reassignment, while new work requires original assignment snapshot',
      async () => {
        const x = await newJob(db, 112, { requester: ADMIN });
        await capture(db, x.job);
        const lease = await claim(db, x.job, id(6080));
        const verified = await seal(db, x.job, lease);
        await actor(db, ADMIN, () =>
          db.query('SELECT app_api.reassign_listing($1,1,$2)', [x.listing, PEER]),
        );
        assert.deepEqual(await seal(db, x.job, lease), verified);
        assert.deepEqual(await claim(db, x.job, id(6080)), lease);
        const y = await newJob(db, 113, { requester: ADMIN });
        await actor(db, ADMIN, () =>
          db.query('SELECT app_api.reassign_listing($1,1,$2)', [y.listing, PEER]),
        );
        assert.equal((await read(db, y.job)).state, 'registered');
        await denied(() => capture(db, y.job), '40001');
      },
    );

    await t.test(
      'append-only records, composite context and global resource IDs fail closed',
      async () => {
        const x = await newJob(db, 114);
        await capture(db, x.job);
        const lease = await claim(db, x.job, id(6090));
        await seal(db, x.job, lease);
        for (const table of [
          'media_input_captures',
          'media_processing_leases',
          'media_verified_outputs',
        ]) {
          await denied(
            () => db.query(`DELETE FROM app_private.${table} WHERE job_id=$1`, [x.job]),
            '23514',
          );
          await denied(
            () =>
              db.query(`UPDATE app_private.${table} SET job_id=job_id WHERE job_id=$1`, [x.job]),
            '23514',
          );
        }
        await denied(
          () =>
            db.query(
              `INSERT INTO app_private.media_input_captures(tenant_id,job_id,listing_id,revision_no,requester_id,generation_id,input_bytes,input_sha256,captured_at)
        VALUES($1,$2,$3,1,$4,$5,100,$6,now())`,
              [OTHER, x.job, x.listing, OTHERADMIN, id(999), INPUT],
            ),
          '23503',
        );
        await denied(
          () =>
            db.query(
              `INSERT INTO app_private.media_verified_outputs(tenant_id,job_id,attempt,lease_nonce,output_id,manifest,manifest_sha256,verified_at)
        VALUES($1,$2,1,$3,$4,$5::jsonb,encode(sha256(convert_to(($5::jsonb)::text,'UTF8')),'hex'),now())`,
              [T, id(999), lease.leaseNonce, lease.outputId, JSON.stringify(manifest())],
            ),
          '23503',
        );
        const constraints = await db.query(
          `SELECT conname FROM pg_constraint WHERE conrelid='app_private.media_jobs'::regclass AND conname='media_job_global_identity'`,
        );
        assert.equal(constraints.rows.length, 1);
      },
    );

    await t.test(
      'coordinator grants are separate from API and expose exactly four fixed security-definer commands',
      async () => {
        assert.deepEqual(
          (
            await db.query(
              "SELECT rolsuper,rolbypassrls,rolinherit,rolcanlogin FROM pg_roles WHERE rolname='media_coordinator'",
            )
          ).rows[0],
          { rolsuper: false, rolbypassrls: false, rolinherit: false, rolcanlogin: false },
        );
        for (const role of ['api_runtime', 'realtor_owner'])
          assert.equal(
            await scalar(db, "SELECT pg_has_role('media_coordinator',$1,'MEMBER')", [role]),
            false,
          );
        assert.equal(
          await scalar(db, "SELECT pg_has_role('api_runtime','media_coordinator','MEMBER')"),
          false,
        );
        assert.equal(
          await scalar(db, "SELECT has_schema_privilege('api_runtime','app_media','USAGE')"),
          false,
        );
        assert.equal(
          await scalar(
            db,
            "SELECT has_schema_privilege('media_coordinator','app_private','USAGE')",
          ),
          false,
        );
        assert.equal(
          await scalar(db, "SELECT has_schema_privilege('media_coordinator','app_media','CREATE')"),
          false,
        );
        const functions =
          await db.query(`SELECT p.proname,p.prosecdef,p.proconfig,r.rolname AS owner,
        has_function_privilege('media_coordinator',p.oid,'EXECUTE') AS coordinator_execute,
        has_function_privilege('api_runtime',p.oid,'EXECUTE') AS api_execute,
        EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='app_media'`);
        assert.deepEqual(functions.rows.map((row) => row.proname).sort(), [
          'capture_input',
          'claim_processing',
          'finalize_media',
          'read_media_attach_intent',
          'read_processing',
          'read_upload_context',
          'seal_output',
        ]);
        for (const row of functions.rows)
          assert.deepEqual(
            {
              owner: row.owner,
              security: row.prosecdef,
              config: row.proconfig,
              coordinator: row.coordinator_execute,
              api: row.api_execute,
              public: row.public_execute,
            },
            {
              owner: 'realtor_owner',
              security: true,
              config: ['search_path=pg_catalog'],
              coordinator: true,
              api: false,
              public: false,
            },
          );
        for (const table of [
          'media_input_captures',
          'media_processing_leases',
          'media_verified_outputs',
          'media_jobs',
          'memberships',
        ]) {
          for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])
            assert.equal(
              await scalar(db, "SELECT has_table_privilege('media_coordinator',$1,$2)", [
                `app_private.${table}`,
                privilege,
              ]),
              false,
            );
          await denied(() => coordinator(db, () => db.query(`SELECT * FROM app_private.${table}`)));
        }
        await denied(() =>
          actor(db, ADMIN, () => db.query('SELECT app_media.read_processing($1)', [id(999)])),
        );
        const tables =
          await db.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='app_private' AND relname IN ('media_input_captures','media_processing_leases','media_verified_outputs')`);
        assert.equal(tables.rows.length, 3);
        assert.ok(tables.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity));
      },
    );
  } finally {
    await db.close();
  }
});
