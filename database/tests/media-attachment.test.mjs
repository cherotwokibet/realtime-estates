import assert from 'node:assert/strict';
import test from 'node:test';
import {
  seedGuardedListingDraft,
  seedGuardedListingSuccessor,
} from '../test-helpers/guarded-listing-fixture.mjs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1),
  OTHER = id(2),
  ADMIN = id(10),
  AGENT = id(11),
  PEER = id(12),
  OTHERADMIN = id(20);
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const content = {
  title: 'Synthetic sealed apartment',
  description: 'SQL attestation fixtures; no byte decoding or storage delivery is claimed.',
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
const manifest = (n) => ({
  pipeline: 'synthetic-codec-v1',
  sourceFormat: 'png',
  inputSha256: hash(`input-${n}`),
  inputBytes: 100,
  format: 'webp',
  mimeType: 'image/webp',
  sha256: hash(`output-${n}`),
  width: 640,
  height: 480,
  bytes: 80,
  encoder: { sharp: '0.35.5', vips: '8.18.7' },
  operations: [
    'auto-orient',
    'resize-inside-1920-without-enlargement',
    'strip-metadata',
    'webp-quality-82-effort-4',
  ],
});
async function scalar(db, sql, args = []) {
  return Object.values((await db.query(sql, args)).rows[0])[0];
}
async function transaction(db, role, tenant, actor, callback) {
  await db.exec(`BEGIN;SET LOCAL ROLE ${role};`);
  try {
    await db.query(
      `SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),
      set_config('realtor.correlation_id','FORGED CALLER CORRELATION',true)`,
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
const api = (db, x, callback) =>
  transaction(db, 'api_runtime', x.tenant ?? T, x.actor ?? AGENT, callback);
const coordinator = (db, callback) =>
  transaction(db, 'media_coordinator', OTHER, OTHERADMIN, callback);
const deny = (callback, code) => assert.rejects(callback, (error) => error.code === code);
const intent = (db, x, operation, expected = x.version) =>
  api(db, x, () =>
    scalar(db, 'SELECT app_api.create_media_attach_intent($1,1,$2,$3,$4)', [
      x.listing,
      expected,
      operation,
      x.job,
    ]),
  );
const finalize = (db, operation) =>
  coordinator(db, () => scalar(db, 'SELECT app_media.finalize_media($1)', [operation]));
const readApi = (db, x, operation) =>
  api(db, x, () => scalar(db, 'SELECT app_api.read_media_attach_intent($1)', [operation]));
const readCoordinator = (db, operation) =>
  coordinator(db, () => scalar(db, 'SELECT app_media.read_media_attach_intent($1)', [operation]));
async function fixture() {
  const db = new PGlite();
  await applyTestMigrations(db);
  // Allocation restriction is part of the normal reviewed migration order.
  await db.query(
    `INSERT INTO app_private.tenants(id,slug,display_name) VALUES
    ($1,'attachment-a','Synthetic A'),($2,'attachment-b','Synthetic B')`,
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
async function listing(db, n, { tenant = T, actor = AGENT } = {}) {
  const x = { tenant, actor, listing: id(n), version: 2 };
  await api(db, x, async () => {
    await seedGuardedListingDraft(db, {
      listingId: x.listing,
      slug: `synthetic-attachment-${n}`,
      content: {
        ...content,
        pricing: { declaration: 'not_declared', charges: [] },
        location: { county: null, town: null, area: null },
      },
      actorId: actor,
    });
  });
  return x;
}
async function sealed(db, x, n, { outputHash } = {}) {
  const registration = id(n + 10000),
    facts = manifest(n);
  if (outputHash) facts.sha256 = outputHash;
  const registered = await api(db, x, () =>
    scalar(db, 'SELECT app_api.register_media_upload($1,1,$2,$3,$4)', [
      x.listing,
      x.version,
      registration,
      `Synthetic photo ${n}`,
    ]),
  );
  const job = registered.jobId;
  await coordinator(db, () =>
    scalar(db, 'SELECT app_media.capture_input($1,$2,100,$3)', [
      job,
      id(n + 20000),
      facts.inputSha256,
    ]),
  );
  const lease = await coordinator(db, () =>
    scalar(db, 'SELECT app_media.claim_processing($1,$2)', [job, id(n + 30000)]),
  );
  const verified = await coordinator(db, () =>
    scalar(db, 'SELECT app_media.seal_output($1,$2,$3,$4::jsonb)', [
      job,
      lease.attempt,
      lease.leaseNonce,
      JSON.stringify(facts),
    ]),
  );
  return { ...x, job, registration, facts, lease, verified };
}
async function attach(db, x, n) {
  const photo = await sealed(db, x, n),
    operation = id(n + 40000);
  await intent(db, photo, operation);
  const result = await finalize(db, operation);
  assert.equal(result.status, 'applied');
  x.version = Number(result.receipt.version);
  return { ...photo, operation, result };
}
async function version(db, x) {
  return scalar(
    db,
    'SELECT version::text FROM app_private.listing_revisions WHERE tenant_id=$1 AND listing_id=$2 AND revision_no=1',
    [x.tenant, x.listing],
  );
}
async function snapshot(db) {
  const result = {};
  for (const table of [
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
async function legacy(
  db,
  x,
  n,
  position,
  { sha256 = hash(`legacy-${n}`), key = `legacy/${n}.webp`, accepted = true } = {},
) {
  await db.query(
    `INSERT INTO app_private.revision_media(tenant_id,listing_id,revision_no,id,public_object_key,
    content_type,bytes,width,height,sha256,alt_text,position,accepted) VALUES($1,$2,1,$3,$4,'image/webp',80,640,480,$5,'Legacy unverified metadata',$6,$7)`,
    [x.tenant, x.listing, id(n + 50000), key, sha256, position, accepted],
  );
}
async function expiredReady(db, n) {
  const x = await listing(db, n),
    job = id(n + 60000),
    registration = id(n + 10000),
    operation = id(n + 40000),
    media = id(n + 50000),
    output = id(n + 70000),
    quarantine = id(n + 80000);
  const facts = manifest(n),
    created = '2000-01-01T00:00:00Z';
  // Explicit privileged historical metadata fixture, not simulated wall-clock
  // passage, actual decoder execution, object storage or historical command proof.
  await db.query(
    `WITH request AS (SELECT jsonb_build_object('kind','register_media_upload','tenantId',$1::uuid,
      'actorId',$2::uuid,'listingId',$3::uuid,'revision',1,'expectedVersion','2','jobId',$4::uuid,'altText','Expired synthetic photo') AS payload)
    INSERT INTO app_private.media_operations(tenant_id,operation_id,kind,listing_id,revision_no,requester_id,expected_version,resource_id,
      request_payload,request_sha256,receipt,created_at) SELECT $1,$5,'register_media_upload',$3,1,$2,2,$4,payload,
      encode(sha256(convert_to(payload::text,'UTF8')),'hex'),jsonb_build_object('kind','register_media_upload','operationId',$5::uuid,
      'jobId',$4::uuid,'listingId',$3::uuid,'revision',1,'expectedVersion','2','altText','Expired synthetic photo','outcome','registered',
      'registeredAt',app_private.media_utc($6::timestamptz),'expiresAt',app_private.media_utc($6::timestamptz+interval '24 hours')),$6::timestamptz FROM request`,
    [T, AGENT, x.listing, job, registration, created],
  );
  await db.query(
    `INSERT INTO app_private.media_jobs(tenant_id,id,registration_id,listing_id,revision_no,requester_id,
    registered_assigned_agent_id,expected_version,alt_text,quarantine_id,output_id,created_at,expires_at)
    VALUES($1,$2,$3,$4,1,$5,$5,2,'Expired synthetic photo',$6,$7,$8::timestamptz,$8::timestamptz+interval '24 hours')`,
    [T, job, registration, x.listing, AGENT, quarantine, output, created],
  );
  await db.query(
    `INSERT INTO app_private.media_input_captures VALUES($1,$2,$3,1,$4,$5,100,$6,$7::timestamptz)`,
    [T, job, x.listing, AGENT, id(n + 20000), facts.inputSha256, created],
  );
  await db.query(
    `INSERT INTO app_private.media_processing_leases VALUES($1,$2,1,$3,$4,$5::timestamptz,
    $5::timestamptz+interval '180 seconds',$5::timestamptz+interval '24 hours')`,
    [T, job, id(n + 30000), id(n + 90000), created],
  );
  await db.query(
    `INSERT INTO app_private.media_verified_outputs VALUES($1,$2,1,$3,$4,$5::jsonb,
    encode(sha256(convert_to(($5::jsonb)::text,'UTF8')),'hex'),$6::timestamptz)`,
    [T, job, id(n + 90000), output, JSON.stringify(facts), created],
  );
  await db.query(
    `WITH request AS (SELECT jsonb_build_object('kind','attach_media','tenantId',$1::uuid,'actorId',$2::uuid,
      'listingId',$3::uuid,'revision',1,'expectedVersion','2','jobId',$4::uuid,'altText','Expired synthetic photo',
      'manifestSha256',v.manifest_sha256,'outputId',v.output_id,'mediaId',$6::uuid) AS payload FROM app_private.media_verified_outputs v WHERE job_id=$4)
    INSERT INTO app_private.media_operations(tenant_id,operation_id,kind,listing_id,revision_no,requester_id,expected_version,resource_id,
      request_payload,request_sha256,receipt,created_at) SELECT $1,$5,'attach_media',$3,1,$2,2,$6,payload,
      encode(sha256(convert_to(payload::text,'UTF8')),'hex'),jsonb_build_object('kind','attach_media','operationId',$5::uuid,
      'jobId',$4::uuid,'listingId',$3::uuid,'revision',1,'expectedVersion','2','altText','Expired synthetic photo','status','ready','receipt',NULL),$7::timestamptz FROM request`,
    [T, AGENT, x.listing, job, operation, media, created],
  );
  await db.query(
    `INSERT INTO app_private.media_attach_intents(tenant_id,operation_id,job_id,listing_id,revision_no,requester_id,
    expected_version,alt_text,output_id,manifest_sha256,media_id,created_at,request_payload,request_sha256)
    SELECT tenant_id,operation_id,$2,listing_id,revision_no,requester_id,expected_version,request_payload->>'altText',
      (request_payload->>'outputId')::uuid,request_payload->>'manifestSha256',resource_id,created_at,request_payload,request_sha256
    FROM app_private.media_operations WHERE operation_id=$1`,
    [operation, job],
  );
  return { ...x, job, registration, operation, facts };
}

// One serialized PGlite connection verifies transactional policy and metadata
// provenance. It is not independent-connection concurrency or actual-byte proof.
test('single-photo attachment requires an authenticated exact intent and immutable sealed provenance', async (t) => {
  const db = await fixture();
  try {
    await t.test(
      'intent acknowledgement changes no draft/listing token, media, seal or success audit',
      async () => {
        const x = await sealed(db, await listing(db, 100), 100),
          op = id(40100);
        const before = await snapshot(db);
        const ready = await intent(db, x, op);
        assert.deepEqual(ready, {
          kind: 'attach_media',
          operationId: op,
          jobId: x.job,
          listingId: x.listing,
          revision: 1,
          expectedVersion: '2',
          altText: 'Synthetic photo 100',
          status: 'ready',
          receipt: null,
        });
        assert.deepEqual(await intent(db, x, op), ready);
        assert.deepEqual(await readApi(db, x, op), ready);
        assert.deepEqual(await readCoordinator(db, op), ready);
        const after = await snapshot(db);
        for (const table of Object.keys(before).filter(
          (k) => !['media_operations', 'media_attach_intents'].includes(k),
        ))
          assert.deepEqual(after[table], before[table], table);
        assert.equal(after.media_operations.length, before.media_operations.length + 1);
        assert.equal(after.media_attach_intents.length, before.media_attach_intents.length + 1);
        assert.equal(await version(db, x), '2');
        const privateRow = (
          await db.query('SELECT * FROM app_private.media_attach_intents WHERE operation_id=$1', [
            op,
          ])
        ).rows[0];
        for (const privateField of [
          'outputId',
          'mediaId',
          'manifestSha256',
          'quarantineId',
          'tenantId',
          'actorId',
          'publicObjectKey',
        ])
          assert.equal(Object.hasOwn(ready, privateField), false);
        assert.equal(privateRow.manifest_sha256, x.verified.manifestSha256);
        assert.equal(privateRow.request_payload.expectedVersion, '2');
      },
    );

    await t.test(
      'changed payload/principal/tuple/kind and cross-company operation reuse disclose no original intent',
      async () => {
        const base = await listing(db, 101),
          x = await sealed(db, base, 101),
          other = await sealed(db, base, 102),
          op = id(40101);
        await intent(db, x, op);
        const before = await snapshot(db);
        await deny(() => intent(db, x, op, 3), '40001');
        await deny(() => intent(db, other, op), '40001');
        await deny(() => intent(db, { ...x, actor: ADMIN }, op), 'P0002');
        await deny(
          () =>
            api(db, x, () =>
              scalar(db, 'SELECT app_api.create_media_attach_intent($1,2,2,$2,$3)', [
                x.listing,
                op,
                x.job,
              ]),
            ),
          'P0002',
        );
        await deny(() => intent(db, x, x.registration), '40001');
        await deny(
          () =>
            api(db, x, () =>
              scalar(db, 'SELECT app_api.register_media_upload($1,1,2,$2,$3)', [
                x.listing,
                op,
                'Other photo',
              ]),
            ),
          '40001',
        );
        assert.deepEqual(await snapshot(db), before);
        const foreign = await sealed(
          db,
          await listing(db, 103, { tenant: OTHER, actor: OTHERADMIN }),
          103,
        );
        const foreignBefore = await snapshot(db);
        await deny(() => intent(db, foreign, op), '40001');
        await deny(() => readApi(db, foreign, op), 'P0002');
        assert.deepEqual(await snapshot(db), foreignBefore);
      },
    );

    await t.test(
      'new creation requires a sealed same-requester draft, exact token and bounded version',
      async () => {
        const x = await sealed(db, await listing(db, 104), 104),
          before = await snapshot(db);
        for (const expected of [null, 0, -1, '9007199254740991'])
          await deny(() => intent(db, x, id(40104), expected), '23514');
        await deny(() => intent(db, x, id(40104), 1), '40001');
        await deny(() => intent(db, { ...x, listing: id(999999) }, id(40104)), 'P0002');
        await deny(() => intent(db, x, x.job), '40001');
        assert.deepEqual(await snapshot(db), before);
        // Captured generation, stable worker claim and lease nonce remain distinct
        // identities; none can be relabelled as authenticated attachment consent.
        for (const operation of [
          id(20104),
          x.lease.claimId,
          x.lease.leaseNonce,
          x.lease.quarantineId,
          x.lease.outputId,
        ])
          await deny(() => intent(db, x, operation), '40001');
        assert.deepEqual(await snapshot(db), before);
        const unsealed = await api(db, x, () =>
          scalar(db, 'SELECT app_api.register_media_upload($1,1,2,$2,$3)', [
            x.listing,
            id(17104),
            'Unsealed synthetic',
          ]),
        );
        await deny(() => intent(db, { ...x, job: unsealed.jobId }, id(41104)), '23514');
        await db.query(
          `UPDATE app_private.listing_revisions SET state='pending',submitted_at=now(),submitted_by=$2 WHERE listing_id=$1`,
          [x.listing, AGENT],
        );
        await deny(() => intent(db, x, id(42104)), '23514');
      },
    );

    await t.test(
      'coordinator atomically attaches exact sealed facts, one revision token and one derived audit',
      async () => {
        const x = await sealed(db, await listing(db, 105), 105),
          op = id(40105);
        const ready = await intent(db, x, op);
        const result = await finalize(db, op);
        assert.equal(result.status, 'applied');
        const receipt = result.receipt;
        assert.deepEqual(Object.keys(receipt).sort(), [
          'completedAt',
          'expectedVersion',
          'jobId',
          'kind',
          'listingId',
          'mediaId',
          'operationId',
          'outcome',
          'position',
          'reason',
          'revision',
          'version',
        ]);
        assert.equal(receipt.version, '3');
        assert.equal(receipt.expectedVersion, '2');
        assert.equal(receipt.position, 0);
        assert.equal(receipt.reason, null);
        assert.match(receipt.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
        const media = (
          await db.query('SELECT * FROM app_private.revision_media WHERE tenant_id=$1 AND id=$2', [
            T,
            receipt.mediaId,
          ])
        ).rows[0];
        assert.equal(media.public_object_key, `synthetic/${T}/${x.job}/${x.lease.outputId}.webp`);
        assert.equal(media.sha256, x.facts.sha256);
        assert.equal(media.bytes, x.facts.bytes);
        assert.equal(media.width, 640);
        assert.equal(media.height, 480);
        assert.equal(media.content_type, 'image/webp');
        assert.equal(media.alt_text, ready.altText);
        assert.equal(media.sealed_job_id, x.job);
        assert.equal(media.attach_operation_id, op);
        assert.equal(media.accepted, true);
        const audit = (
          await db.query(
            `SELECT tenant_id,actor_id,object_id,object_version::text,correlation_id,object_type,summary FROM app_private.audit_events WHERE action='media.attached' AND object_id=$1`,
            [x.listing],
          )
        ).rows;
        assert.deepEqual(audit, [
          {
            tenant_id: T,
            actor_id: AGENT,
            object_id: x.listing,
            object_version: '3',
            correlation_id: `media-attach/${op}`,
            object_type: 'listing',
            summary: { revision: 1, operationId: op, mediaId: receipt.mediaId },
          },
        ]);
        assert.equal(
          await scalar(db, 'SELECT version::text FROM app_private.listings WHERE id=$1', [
            x.listing,
          ]),
          '1',
        );
        assert.equal(await version(db, x), '3');
        const before = await snapshot(db);
        assert.deepEqual(await finalize(db, op), result);
        assert.deepEqual(await intent(db, x, op), result);
        assert.deepEqual(await readApi(db, x, op), result);
        assert.deepEqual(await readCoordinator(db, op), result);
        assert.deepEqual(await snapshot(db), before);
        assert.deepEqual(
          await scalar(
            db,
            'SELECT receipt FROM app_private.media_operations WHERE tenant_id=$1 AND operation_id=$2',
            [T, op],
          ),
          ready,
        );
      },
    );

    await t.test(
      'stale terminal conflict is durable and only a fresh authenticated UUID/version reuses verified bytes',
      async () => {
        const x = await sealed(db, await listing(db, 106), 106),
          op = id(40106);
        await intent(db, x, op);
        await api(db, x, () =>
          db.query('SELECT app_api.save_draft($1,1,2,$2::jsonb)', [
            x.listing,
            JSON.stringify({ ...content, title: 'Intervening save' }),
          ]),
        );
        const result = await finalize(db, op);
        assert.equal(result.status, 'conflict');
        assert.equal(result.receipt.reason, 'VERSION_CONFLICT');
        assert.equal(result.receipt.version, '3');
        assert.equal(result.receipt.mediaId, null);
        assert.equal(result.receipt.position, null);
        assert.equal(
          await scalar(
            db,
            'SELECT count(*)::integer FROM app_private.revision_media WHERE listing_id=$1',
            [x.listing],
          ),
          0,
        );
        const failed = await snapshot(db);
        assert.deepEqual(await finalize(db, op), result);
        assert.deepEqual(await intent(db, x, op), result);
        await deny(() => intent(db, x, op, 3), '40001');
        assert.deepEqual(await snapshot(db), failed);
        const fresh = id(41106);
        await intent(db, x, fresh, 3);
        const applied = await finalize(db, fresh);
        assert.equal(applied.status, 'applied');
        assert.equal(applied.receipt.version, '4');
        assert.deepEqual(await readApi(db, x, op), result);
        assert.equal(
          await scalar(
            db,
            'SELECT count(*)::integer FROM app_private.media_verified_outputs WHERE job_id=$1',
            [x.job],
          ),
          1,
        );
        assert.equal(
          await scalar(
            db,
            "SELECT count(*)::integer FROM app_private.audit_events WHERE object_id=$1 AND action='media.attached'",
            [x.listing],
          ),
          1,
        );
      },
    );

    await t.test('two explicit intents at token N cannot both attach or adopt N+1', async () => {
      const base = await listing(db, 107),
        x = await sealed(db, base, 107),
        y = await sealed(db, base, 108),
        op = id(40107),
        other = id(40108);
      await intent(db, x, op);
      await intent(db, y, other);
      const first = await finalize(db, op),
        second = await finalize(db, other);
      assert.equal(first.status, 'applied');
      assert.equal(second.status, 'conflict');
      assert.equal(second.receipt.expectedVersion, '2');
      assert.equal(second.receipt.version, '3');
      assert.equal(await version(db, x), '3');
      assert.equal(
        await scalar(
          db,
          'SELECT count(*)::integer FROM app_private.revision_media WHERE listing_id=$1',
          [x.listing],
        ),
        1,
      );
      await deny(() => intent(db, x, id(41107), 3), '23514');
    });

    await t.test(
      'failed state/expiry/registered assignment outcomes persist without media/version/audit changes',
      async () => {
        const pending = await sealed(db, await listing(db, 109), 109),
          pendingOp = id(40109);
        await intent(db, pending, pendingOp);
        await db.query(
          `UPDATE app_private.listing_revisions SET state='pending',submitted_at=now(),submitted_by=$2 WHERE listing_id=$1`,
          [pending.listing, AGENT],
        );
        const pendingVersion = await version(db, pending),
          result = await finalize(db, pendingOp);
        assert.equal(result.status, 'rejected');
        assert.equal(result.receipt.reason, 'REVISION_NOT_DRAFT');
        assert.equal(await version(db, pending), pendingVersion);
        const expired = await expiredReady(db, 110),
          expiredResult = await finalize(db, expired.operation);
        assert.equal(expiredResult.status, 'expired');
        assert.equal(expiredResult.receipt.reason, 'JOB_EXPIRED');
        assert.equal(await version(db, expired), '2');
        assert.deepEqual(await readApi(db, expired, expired.operation), expiredResult);
        assert.deepEqual(await intent(db, expired, expired.operation), expiredResult);
        await deny(() => intent(db, expired, id(41110)), '23514');
        const admin = await sealed(db, await listing(db, 111, { actor: ADMIN }), 111),
          adminOp = id(40111);
        await intent(db, admin, adminOp);
        await api(db, admin, () =>
          db.query('SELECT app_api.reassign_listing($1,1,$2)', [admin.listing, PEER]),
        );
        const assignment = await finalize(db, adminOp);
        assert.equal(assignment.status, 'conflict');
        assert.equal(assignment.receipt.reason, 'ASSIGNMENT_CHANGED');
        assert.deepEqual(await readApi(db, admin, adminOp), assignment);
        assert.equal(await version(db, admin), '2');
        for (const x of [pending, expired, admin]) {
          assert.equal(
            await scalar(
              db,
              'SELECT count(*)::integer FROM app_private.revision_media WHERE listing_id=$1',
              [x.listing],
            ),
            0,
          );
          assert.equal(
            await scalar(
              db,
              "SELECT count(*)::integer FROM app_private.audit_events WHERE object_id=$1 AND action='media.attached'",
              [x.listing],
            ),
            0,
          );
        }
      },
    );

    await t.test(
      'duplicate checksums/keys, all-row capacity and sparse positions return bounded failures',
      async () => {
        for (const [n, reason, seed] of [
          [112, 'DUPLICATE_OUTPUT', 'hash'],
          [113, 'DUPLICATE_OUTPUT', 'key'],
          [114, 'CAPACITY_REACHED', 'capacity'],
          [115, 'PROVENANCE_CHANGED', 'gap'],
        ]) {
          const x = await sealed(db, await listing(db, n), n),
            op = id(40000 + n);
          await intent(db, x, op);
          if (seed === 'capacity')
            for (let p = 0; p < 12; p++)
              await legacy(db, x, n * 100 + p, p, { accepted: p % 2 === 0 });
          else
            await legacy(db, x, n * 100, seed === 'gap' ? 1 : 0, {
              sha256: seed === 'hash' ? x.facts.sha256 : hash(`legacy-different-${n}`),
              key:
                seed === 'key'
                  ? `synthetic/${T}/${x.job}/${x.lease.outputId}.webp`
                  : `legacy/${n}.webp`,
            });
          const beforeVersion = await version(db, x),
            mediaCount = await scalar(
              db,
              'SELECT count(*)::integer FROM app_private.revision_media WHERE listing_id=$1',
              [x.listing],
            );
          const result = await finalize(db, op);
          assert.equal(result.status, 'rejected');
          assert.equal(result.receipt.reason, reason);
          assert.equal(await version(db, x), beforeVersion);
          assert.equal(
            await scalar(
              db,
              'SELECT count(*)::integer FROM app_private.revision_media WHERE listing_id=$1',
              [x.listing],
            ),
            mediaCount,
          );
          assert.equal(
            await scalar(
              db,
              'SELECT count(*)::integer FROM app_private.media_attachments WHERE job_id=$1',
              [x.job],
            ),
            0,
          );
          assert.deepEqual(await finalize(db, op), result);
        }
      },
    );

    await t.test(
      'current original principal authorization applies before ready and terminal disclosure, independent of coordinator GUC',
      async () => {
        const x = await sealed(db, await listing(db, 116), 116),
          op = id(40116);
        await intent(db, x, op);
        const applied = await finalize(db, op);
        await deny(() => readApi(db, { ...x, actor: ADMIN }, op), 'P0002');
        await deny(() => readApi(db, { ...x, actor: PEER }, op), 'P0002');
        await deny(() => readApi(db, { ...x, tenant: OTHER, actor: OTHERADMIN }, op), 'P0002');
        await api(db, { ...x, actor: ADMIN }, () =>
          db.query('SELECT app_api.reassign_listing($1,1,$2)', [x.listing, PEER]),
        );
        const reassigned = await snapshot(db);
        await deny(() => finalize(db, op), 'P0002');
        await deny(() => readCoordinator(db, op), 'P0002');
        await deny(() => readApi(db, x, op), 'P0002');
        assert.deepEqual(await snapshot(db), reassigned);
        await api(db, { ...x, actor: ADMIN }, () =>
          db.query('SELECT app_api.reassign_listing($1,2,$2)', [x.listing, AGENT]),
        );
        assert.deepEqual(await finalize(db, op), applied);
        await db.query(
          'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
          [T, AGENT],
        );
        const revoked = await snapshot(db);
        await deny(() => readCoordinator(db, op), 'P0002');
        await deny(() => finalize(db, op), 'P0002');
        await deny(() => readApi(db, x, op), '42501');
        assert.deepEqual(await snapshot(db), revoked);
        await db.query(
          'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
          [T, AGENT],
        );
        await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
        await deny(() => finalize(db, op), 'P0002');
        await deny(() => readApi(db, x, op), '42501');
        await db.query('UPDATE app_private.tenants SET enabled=true WHERE id=$1', [T]);
        assert.deepEqual(
          await transaction(db, 'media_coordinator', null, null, () =>
            scalar(db, 'SELECT app_media.read_media_attach_intent($1)', [op]),
          ),
          applied,
        );
        await deny(() => readCoordinator(db, id(999999)), 'P0002');
      },
    );

    await t.test(
      'submission and approval exclude legacy metadata, mixed rows and preexisting pending legacy drafts',
      async () => {
        const x = await listing(db, 117);
        for (let p = 0; p < 4; p++) await legacy(db, x, 11700 + p, p);
        const before = await snapshot(db);
        await deny(
          () => api(db, x, () => scalar(db, 'SELECT app_api.submit_revision($1,1,2)', [x.listing])),
          '23514',
        );
        assert.deepEqual(await snapshot(db), before);
        assert.equal(
          await scalar(
            db,
            'SELECT count(*)::integer FROM app_private.revision_media WHERE listing_id=$1 AND sealed_job_id IS NULL',
            [x.listing],
          ),
          4,
        );
        await db.query(
          `UPDATE app_private.listing_revisions SET state='pending',submitted_at=now(),submitted_by=$2 WHERE listing_id=$1`,
          [x.listing, AGENT],
        );
        await api(db, { ...x, actor: ADMIN }, () =>
          db.query("SELECT app_api.confirm_availability($1,1,'available')", [x.listing]),
        );
        const pending = await snapshot(db);
        await deny(
          () =>
            api(db, { ...x, actor: ADMIN }, () =>
              scalar(db, 'SELECT app_api.decide_revision($1,1,3,true)', [x.listing]),
            ),
          '23514',
        );
        assert.deepEqual(await snapshot(db), pending);
        const mixed = await listing(db, 118);
        await attach(db, mixed, 118);
        for (let p = 1; p < 4; p++) await legacy(db, mixed, 11800 + p, p);
        await deny(
          () =>
            api(db, mixed, () =>
              scalar(db, 'SELECT app_api.submit_revision($1,1,$2)', [mixed.listing, mixed.version]),
            ),
          '23514',
        );
      },
    );

    await t.test(
      'four distinct provenanced outputs submit and approve exact immutable snapshots; historical receipts survive later state and association loss',
      async () => {
        const x = await listing(db, 119),
          photos = [];
        for (let n = 119; n < 123; n++) photos.push(await attach(db, x, n));
        assert.equal(x.version, 6);
        const original = photos[0].result;
        const submitted = await api(db, x, () =>
          scalar(db, 'SELECT app_api.submit_revision($1,1,6)', [x.listing]),
        );
        assert.equal(submitted, 7);
        assert.deepEqual(await finalize(db, photos[0].operation), original);
        assert.deepEqual(await intent(db, photos[0], photos[0].operation), original);
        await api(db, { ...x, actor: ADMIN }, () =>
          db.query("SELECT app_api.confirm_availability($1,1,'available')", [x.listing]),
        );
        await api(db, { ...x, actor: ADMIN }, () =>
          db.query('SELECT app_api.decide_revision($1,1,7,true)', [x.listing]),
        );
        const published = await scalar(
          db,
          'SELECT photo_refs FROM app_private.public_snapshots WHERE listing_id=$1',
          [x.listing],
        );
        assert.equal(published.length, 4);
        assert.deepEqual(
          published.map((p) => p.alt),
          photos.map((p) => p.result.altText),
        );
        assert.deepEqual(await readApi(db, x, photos[0].operation), original);
        assert.deepEqual(await finalize(db, photos[0].operation), original);
        await deny(
          () => db.query('DELETE FROM app_private.revision_media WHERE listing_id=$1', [x.listing]),
          '23514',
        );
        await api(db, x, () =>
          seedGuardedListingSuccessor(db, {
            listingId: x.listing,
            actorId: x.actor,
            expectedListingVersion: '3',
            predecessor: { revision: 1, version: '8', state: 'approved' },
            content: {
              ...{
                ...content,
                pricing: { declaration: 'not_declared', charges: [] },
                location: { county: null, town: null, area: null },
              },
              title: 'New synthetic draft',
            },
          }),
        );
        assert.deepEqual(
          await scalar(
            db,
            'SELECT photo_refs FROM app_private.public_snapshots WHERE listing_id=$1',
            [x.listing],
          ),
          published,
        );
        const removable = await listing(db, 123),
          photo = await attach(db, removable, 123);
        // Owner-only association-removal fixture proves immutable history has no
        // reverse FK to current associations; this is not a removal command test.
        await db.query('DELETE FROM app_private.revision_media WHERE tenant_id=$1 AND id=$2', [
          T,
          photo.result.receipt.mediaId,
        ]);
        assert.deepEqual(await finalize(db, photo.operation), photo.result);
        assert.deepEqual(await readApi(db, removable, photo.operation), photo.result);
        assert.equal(
          await scalar(
            db,
            'SELECT count(*)::integer FROM app_private.media_attachments WHERE job_id=$1',
            [photo.job],
          ),
          1,
        );
      },
    );

    await t.test(
      'exact provenance and immutable receipts reject metadata substitution; full transaction rollback leaves a ready intent',
      async () => {
        const x = await listing(db, 124),
          photo = await attach(db, x, 124),
          media = photo.result.receipt.mediaId;
        await deny(
          () =>
            db.query('UPDATE app_private.revision_media SET width=width+1 WHERE id=$1', [media]),
          '23503',
        );
        await deny(
          () =>
            db.query('UPDATE app_private.revision_media SET accepted=false WHERE id=$1', [media]),
          '23514',
        );
        for (const table of ['media_attach_intents', 'media_attach_results', 'media_attachments']) {
          await deny(
            () =>
              db.query(`DELETE FROM app_private.${table} WHERE operation_id=$1`, [photo.operation]),
            '23514',
          );
          await deny(
            () =>
              db.query(
                `UPDATE app_private.${table} SET operation_id=operation_id WHERE operation_id=$1`,
                [photo.operation],
              ),
            '23514',
          );
        }
        const rollback = await sealed(db, await listing(db, 125), 125),
          op = id(40125);
        await intent(db, rollback, op);
        const before = await snapshot(db);
        await deny(
          () =>
            coordinator(db, async () => {
              await scalar(db, 'SELECT app_media.finalize_media($1)', [op]);
              await db.query('SELECT 1/0');
            }),
          '22012',
        );
        assert.deepEqual(await snapshot(db), before);
        assert.equal((await readCoordinator(db, op)).status, 'ready');
        assert.equal((await finalize(db, op)).status, 'applied');
      },
    );

    await t.test(
      'only exact narrow owner functions are granted; new private tables are forced RLS without runtime DML/read',
      async () => {
        for (const [signature, role] of [
          ['app_api.create_media_attach_intent(uuid,integer,bigint,uuid,uuid)', 'api_runtime'],
          ['app_api.read_media_attach_intent(uuid)', 'api_runtime'],
          ['app_media.finalize_media(uuid)', 'media_coordinator'],
          ['app_media.read_media_attach_intent(uuid)', 'media_coordinator'],
        ]) {
          const row = (
            await db.query(
              `SELECT p.prosecdef,p.proconfig,r.rolname AS owner,
          has_function_privilege($2,p.oid,'EXECUTE') AS allowed,
          EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
          FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=$1::regprocedure`,
              [signature, role],
            )
          ).rows[0];
          assert.deepEqual(row, {
            prosecdef: true,
            proconfig: ['search_path=pg_catalog'],
            owner: 'realtor_owner',
            allowed: true,
            public_execute: false,
          });
        }
        for (const table of ['media_attach_intents', 'media_attach_results', 'media_attachments']) {
          const row = (
            await db.query(
              'SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',
              [`app_private.${table}`],
            )
          ).rows[0];
          assert.deepEqual(row, { relrowsecurity: true, relforcerowsecurity: true });
          for (const role of ['api_runtime', 'media_coordinator'])
            for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
              assert.equal(
                await scalar(db, 'SELECT has_table_privilege($1,$2,$3)', [
                  role,
                  `app_private.${table}`,
                  privilege,
                ]),
                false,
              );
        }
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
          await scalar(
            db,
            "SELECT has_function_privilege('media_coordinator','app_api.create_media_attach_intent(uuid,integer,bigint,uuid,uuid)','EXECUTE')",
          ),
          false,
        );
        assert.equal(
          await scalar(
            db,
            "SELECT has_function_privilege('api_runtime','app_media.finalize_media(uuid)','EXECUTE')",
          ),
          false,
        );
        const privatePublic = await scalar(
          db,
          `SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
        LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE n.nspname='app_private' AND a.grantee=0 AND a.privilege_type='EXECUTE'`,
        );
        assert.equal(privatePublic, 0);
      },
    );
  } finally {
    await db.close();
  }
});
