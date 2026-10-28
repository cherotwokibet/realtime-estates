import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDurableSyntheticStore, retireExpiredDurableJob } from '../dist/durable-store.js';
import { expiredMediaCleanupAuthorization } from '../dist/expired-cleanup.js';
import { MediaMaintenanceDatabase } from '../dist/expired-cleanup-database.js';
import {
  T,
  OTHER,
  A,
  B,
  LB,
  scalar,
  as,
  fixture,
  historicalJob,
  authorize,
} from '../../../database/test-helpers/expired-media-fixture.mjs';
test('restricted SQL expiry admission enforces exact company, grace, immutable original operation and denies API/coordinator/raw access', async (t) => {
  const db = await fixture(t),
    expired = await historicalJob(db),
    recent = await historicalJob(db, { age: 24.5 }),
    live = await historicalJob(db, { age: 0 }),
    foreign = await historicalJob(db, { tenant: OTHER, actor: B, listing: LB });
  const before = await scalar(db, 'SELECT count(*) FROM app_private.audit_events');
  for (const role of ['api_runtime', 'media_coordinator'])
    await assert.rejects(
      as(db, role, () =>
        scalar(db, 'SELECT app_media.authorize_expired_cleanup($1,$2,$3)', [
          T,
          expired.job,
          randomUUID(),
        ]),
      ),
      { code: '42501' },
    );
  await assert.rejects(
    as(db, 'media_maintenance', () => db.query('SELECT * FROM app_private.media_jobs')),
    { code: '42501' },
  );
  for (const j of [recent, live]) await assert.rejects(authorize(db, j), { code: '23514' });
  await assert.rejects(authorize(db, foreign, randomUUID(), T), { code: 'P0002' });
  const operation = randomUUID(),
    first = expiredMediaCleanupAuthorization(await authorize(db, expired, operation));
  assert.equal(first.jobId, expired.job);
  assert.equal(first.tenantId, T);
  assert.equal(first.quarantineId, expired.quarantineId);
  assert.equal(first.outputId, expired.outputId);
  assert.deepEqual(await authorize(db, expired, operation), first);
  await assert.rejects(authorize(db, expired), { code: '40001' });
  await assert.rejects(authorize(db, foreign, operation), { code: '40001' });
  assert.equal(await scalar(db, 'SELECT count(*) FROM app_private.expired_media_cleanup'), 1);
  await assert.rejects(
    db.query('UPDATE app_private.expired_media_cleanup SET authorized_at=clock_timestamp()'),
    { code: '23514' },
  );
  assert.equal(await scalar(db, 'SELECT count(*) FROM app_private.audit_events'), before);
  assert.equal(await scalar(db, 'SELECT count(*) FROM app_private.media_jobs'), 4);
  await assert.rejects(
    as(db, 'media_coordinator', () =>
      scalar(db, 'SELECT app_media.claim_processing($1,$2)', [expired.job, randomUUID()]),
    ),
    { code: '23514' },
  );
  const state = await as(db, 'media_coordinator', () =>
    scalar(db, 'SELECT app_media.read_processing($1)', [expired.job]),
  );
  assert.equal(state.state, 'expired');
  const proc = (
    await db.query(
      "SELECT p.prosecdef,pg_get_userbyid(p.proowner) AS owner,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app_media' AND p.proname='authorize_expired_cleanup'",
    )
  ).rows[0];
  assert.equal(proc.owner, 'realtor_owner');
  assert.equal(proc.prosecdef, true);
  assert.ok(proc.proconfig.includes('search_path=pg_catalog'));
});
test('expired verified output remains protected even without an attachment or current gallery entry', async (t) => {
  const db = await fixture(t),
    j = await historicalJob(db),
    generation = randomUUID(),
    claim = randomUUID(),
    nonce = randomUUID();
  const input = 'a'.repeat(64),
    output = 'b'.repeat(64);
  await db.query(
    `INSERT INTO app_private.media_input_captures(tenant_id,job_id,listing_id,revision_no,requester_id,generation_id,input_bytes,input_sha256,captured_at)
 SELECT tenant_id,id,listing_id,revision_no,requester_id,$2,100,$3,created_at FROM app_private.media_jobs WHERE id=$1`,
    [j.job, generation, input],
  );
  await db.query(
    `INSERT INTO app_private.media_processing_leases(tenant_id,job_id,attempt,claim_id,lease_nonce,claimed_at,lease_expires_at,job_expires_at)
 SELECT tenant_id,id,1,$2,$3,created_at,created_at+interval '180 seconds',expires_at FROM app_private.media_jobs WHERE id=$1`,
    [j.job, claim, nonce],
  );
  const manifest = {
    pipeline: 'synthetic-codec-v1',
    sourceFormat: 'png',
    inputSha256: input,
    inputBytes: 100,
    format: 'webp',
    mimeType: 'image/webp',
    sha256: output,
    width: 100,
    height: 100,
    bytes: 100,
    encoder: { sharp: '0.35.5', vips: '8.18.7' },
    operations: [
      'auto-orient',
      'resize-inside-1920-without-enlargement',
      'strip-metadata',
      'webp-quality-82-effort-4',
    ],
  };
  await db.query(
    `INSERT INTO app_private.media_verified_outputs(tenant_id,job_id,attempt,lease_nonce,output_id,manifest,manifest_sha256,verified_at)
 SELECT tenant_id,id,1,$2,output_id,$3::jsonb,encode(sha256(convert_to(($3::jsonb)::text,'UTF8')),'hex'),created_at FROM app_private.media_jobs WHERE id=$1`,
    [j.job, nonce, JSON.stringify(manifest)],
  );
  await assert.rejects(authorize(db, j), { code: '23514' });
  assert.equal(await scalar(db, 'SELECT count(*) FROM app_private.expired_media_cleanup'), 0);
  assert.equal(await scalar(db, 'SELECT count(*) FROM app_private.media_verified_outputs'), 1);
});
test('actual restricted SQL authorization drives owned-store byte cleanup while registration and receipt history survive', async (t) => {
  const db = await fixture(t),
    j = await historicalJob(db),
    operation = randomUUID();
  const bootstrap = '"' + (await scalar(db, 'SELECT session_user')).replaceAll('"', '""') + '"';
  const parent = await mkdtemp(path.join(tmpdir(), 'realtor SQL expiry ')),
    store = await createDurableSyntheticStore(parent);
  const ref = {
    jobId: j.job,
    objectId: j.quarantineId,
    generationId: randomUUID(),
    kind: 'quarantine',
  };
  t.after(async () => {
    await store.close();
    const job = path.join(store.rootDirectory, 'objects', j.job),
      q = path.join(job, 'quarantine');
    assert.deepEqual(await readdir(q), ['receipt.json']);
    await unlink(path.join(q, 'receipt.json'));
    await rmdir(q);
    await unlink(path.join(job, 'expiry.json'));
    await rmdir(job);
    await rmdir(path.join(store.rootDirectory, 'objects'));
    await unlink(path.join(store.rootDirectory, 'store.json'));
    await rmdir(store.rootDirectory);
    await rmdir(parent);
  });
  await store.install(ref, Buffer.from('expired synthetic bytes'));
  await db.exec(
    'CREATE ROLE synthetic_expiry_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;GRANT media_maintenance TO synthetic_expiry_login;SET SESSION AUTHORIZATION synthetic_expiry_login;',
  );
  let loseNextCommit = false,
    physicalCleanupStarted = false;
  const releases = [];
  const pool = {
    async connect() {
      return {
        async query(sql, values) {
          const response = await db.query(sql, values ? [...values] : []);
          if (sql === 'COMMIT' && loseNextCommit) {
            loseNextCommit = false;
            throw new Error('Synthetic lost maintenance COMMIT acknowledgement');
          }
          return response;
        },
        release(destroy) {
          releases.push(destroy);
        },
      };
    },
  };
  const maintenance = new MediaMaintenanceDatabase(pool, T);
  const page = await maintenance.candidates();
  assert.deepEqual(page.jobs, [{ jobId: j.job, operationId: null }]);
  loseNextCommit = true;
  await assert.rejects(
    async () => {
      const uncertain = await maintenance.authorize(j.job, operation);
      physicalCleanupStarted = true;
      await retireExpiredDurableJob(store, uncertain, async () => true);
    },
    (error) => error.commitUncertain === true,
  );
  assert.equal(physicalCleanupStarted, false);
  assert.equal(releases.at(-1), true);
  assert.equal((await store.read(ref)).data.toString(), 'expired synthetic bytes');
  assert.deepEqual((await maintenance.candidates()).jobs, [
    { jobId: j.job, operationId: operation },
  ]);
  const sql = await maintenance.authorize(j.job, operation),
    plan = expiredMediaCleanupAuthorization(sql);
  assert.deepEqual(await retireExpiredDurableJob(store, plan, async () => true), {
    removedFiles: 1,
    removedBytes: 23,
  });
  await assert.rejects(store.read(ref), { code: 'RETIRED' });
  assert.deepEqual(await maintenance.authorize(j.job, operation), sql);
  assert.deepEqual((await maintenance.candidates()).jobs, [
    { jobId: j.job, operationId: operation },
  ]);
  assert.equal(await scalar(db, 'SELECT current_user'), 'synthetic_expiry_login');
  await db.exec(`SET SESSION AUTHORIZATION ${bootstrap};RESET ROLE;`);
  assert.equal(await scalar(db, 'SELECT count(*) FROM app_private.media_operations'), 1);
  assert.equal(await scalar(db, 'SELECT count(*) FROM app_private.media_jobs'), 1);
});
test('candidate pages are bounded, company-specific, sorted and resume original admissions without editing business audit', async (t) => {
  const db = await fixture(t),
    jobs = [];
  for (let i = 0; i < 101; i++) jobs.push(await historicalJob(db));
  await historicalJob(db, { tenant: OTHER, actor: B, listing: LB });
  await historicalJob(db, { age: 24.5 });
  const list = (after = null, limit = 100, tenant = T) =>
    as(db, 'media_maintenance', () =>
      scalar(db, 'SELECT app_media.expired_cleanup_candidates($1,$2,$3)', [tenant, after, limit]),
    );
  const before = await scalar(db, 'SELECT count(*) FROM app_private.audit_events');
  const first = await list();
  assert.equal(first.jobs.length, 100);
  assert.equal(first.hasMore, true);
  assert.equal(first.tenantId, T);
  assert.deepEqual(
    first.jobs.map((j) => j.jobId),
    jobs
      .map((j) => j.job)
      .sort()
      .slice(0, 100),
  );
  const second = await list(first.jobs.at(-1).jobId);
  assert.equal(second.jobs.length, 1);
  assert.equal(second.hasMore, false);
  const operation = randomUUID();
  await authorize(
    db,
    jobs.find((j) => j.job === first.jobs[0].jobId),
    operation,
  );
  assert.equal((await list()).jobs[0].operationId, operation);
  assert.equal((await list(null, 25, OTHER)).jobs.length, 1);
  for (const limit of [0, 101, null]) await assert.rejects(list(null, limit), { code: '23514' });
  await assert.rejects(list(null, 25, null), { code: '23514' });
  assert.equal(await scalar(db, 'SELECT count(*) FROM app_private.audit_events'), before);
});
test('maintenance adapter rechecks actual isolated role and refuses privilege widening before business SQL', async (t) => {
  const db = await fixture(t);
  await historicalJob(db);
  const bootstrap = '"' + (await scalar(db, 'SELECT session_user')).replaceAll('"', '""') + '"';
  await db.exec(
    'CREATE ROLE expiry_guard_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;GRANT media_maintenance TO expiry_guard_login;SET SESSION AUTHORIZATION expiry_guard_login;',
  );
  const calls = [],
    releases = [];
  const pool = {
    async connect() {
      return {
        async query(sql, values) {
          calls.push(sql);
          return db.query(sql, values ? [...values] : []);
        },
        release(destroy) {
          releases.push(destroy);
        },
      };
    },
  };
  const maintenance = new MediaMaintenanceDatabase(pool, T);
  assert.equal((await maintenance.candidates()).jobs.length, 1);
  await db.exec(`SET SESSION AUTHORIZATION ${bootstrap};RESET ROLE;`);
  await db.exec(
    'GRANT EXECUTE ON FUNCTION app_media.read_processing(uuid) TO media_maintenance;SET SESSION AUTHORIZATION expiry_guard_login;',
  );
  const before = calls.length;
  await assert.rejects(maintenance.candidates(), { code: 'UNSAFE_MEDIA_MAINTENANCE_ROLE' });
  assert.equal(calls.length, before + 1);
  assert.equal(releases.at(-1), true);
  await db.exec(`SET SESSION AUTHORIZATION ${bootstrap};RESET ROLE;`);
  await db.exec(
    'REVOKE EXECUTE ON FUNCTION app_media.read_processing(uuid) FROM media_maintenance;GRANT api_runtime TO expiry_guard_login;SET SESSION AUTHORIZATION expiry_guard_login;',
  );
  await assert.rejects(maintenance.candidates(), { code: 'UNSAFE_MEDIA_MAINTENANCE_ROLE' });
  await db.exec(`SET SESSION AUTHORIZATION ${bootstrap};RESET ROLE;`);
});
