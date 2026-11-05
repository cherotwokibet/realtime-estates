import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  fixture,
  createDraft,
  asActor,
  scalar,
  T,
  OTHER,
  ADMIN,
  AGENT,
  LISTING,
} from './public-media-fixtures.mjs';
import {
  convertSyntheticFloorPlan,
  convertSyntheticImage,
} from '../../packages/media/dist/index.js';
import { syntheticPng } from '../../packages/media/tests/fixtures.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function media(db, work, actor = AGENT, tenant = T) {
  await db.exec('BEGIN; SET LOCAL ROLE media_coordinator');
  try {
    await db.query(
      "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
      [tenant, actor],
    );
    const v = await work();
    await db.exec('COMMIT');
    return v;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}
async function setup(t) {
  const db = await fixture();
  t.after(() => db.close());
  assert.equal(
    await scalar(db, "SELECT to_regclass('app_private.synthetic_floor_plan_outputs')"),
    null,
    true,
    [],
  );
  for (const n of ['registration', 'processing', 'output'])
    await db.exec(
      await readFile(new URL('../proposals/floor-plan-' + n + '.sql', import.meta.url), 'utf8'),
    );
  await createDraft(db);
  const source = syntheticPng(),
    result = await convertSyntheticFloorPlan(source),
    request = id(1000),
    claim = id(1001);
  const registration = await asActor(db, T, AGENT, () =>
    scalar(db, 'SELECT app_api.register_synthetic_floor_plan($1,1,2,$2,$3,$4,$5)', [
      LISTING,
      request,
      createHash('sha256').update(source).digest('hex'),
      source.length,
      'png',
    ]),
  );
  const lease = await media(db, () =>
    scalar(db, 'SELECT app_media.claim_synthetic_floor_plan($1,1,$2,$3)', [
      LISTING,
      request,
      claim,
    ]),
  );
  const seal = (manifest = result.manifest, changes = {}, actor = AGENT, tenant = T) =>
    media(
      db,
      () =>
        scalar(db, 'SELECT app_media.seal_synthetic_floor_plan($1,1,$2,$3,$4,$5,$6)', [
          LISTING,
          request,
          changes.claim ?? claim,
          changes.nonce ?? lease.leaseNonce,
          changes.output ?? lease.outputObjectId,
          manifest,
        ]),
      actor,
      tenant,
    );
  const read = (actor = AGENT, tenant = T) =>
    media(
      db,
      () =>
        scalar(db, 'SELECT app_media.read_synthetic_floor_plan_output($1,1,$2)', [
          LISTING,
          request,
        ]),
      actor,
      tenant,
    );
  return { db, source, result, registration, lease, request, claim, seal, read };
}
const count = async (db) =>
  (
    await db.query(
      "SELECT (SELECT count(*)::int FROM app_private.synthetic_floor_plan_outputs) AS outputs,(SELECT count(*)::int FROM app_private.audit_events WHERE action='floor_plan.output_sealed') AS audits,(SELECT count(*)::int FROM app_private.media_verified_outputs) AS photo_outputs,(SELECT count(*)::int FROM app_private.revision_media) AS photos,(SELECT version::text FROM app_private.listing_revisions WHERE listing_id=$1 AND revision_no=1) AS version",
      [LISTING],
    )
  ).rows[0];
const denied = (f, c) => assert.rejects(f, (e) => !c || e.code === c);
test('floor-plan seal binds actual lossless manifest and original output lease with one audit and exact historical read', async (t) => {
  const f = await setup(t);
  await denied(() => f.read(), 'P0002');
  const sealed = await f.seal();
  assert.equal(sealed.policy, 'synthetic-floor-plan-output-v1');
  assert.deepEqual(sealed.lease, f.lease);
  assert.deepEqual(sealed.manifest, f.result.manifest);
  assert.match(sealed.manifestSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(await f.seal(), sealed);
  assert.deepEqual(await f.read(), sealed);
  await denied(
    () =>
      media(f.db, () =>
        scalar(f.db, 'SELECT app_media.preflight_synthetic_floor_plan_worker($1,1,$2,$3,$4)', [
          LISTING,
          f.request,
          f.claim,
          f.lease.leaseNonce,
        ]),
      ),
    '23514',
  );
  assert.deepEqual(await count(f.db), {
    outputs: 1,
    audits: 1,
    photo_outputs: 0,
    photos: 0,
    version: '2',
  });
  const audit = (
    await f.db.query(
      "SELECT actor_id,object_id,summary FROM app_private.audit_events WHERE action='floor_plan.output_sealed'",
    )
  ).rows[0];
  assert.equal(audit.actor_id, AGENT);
  assert.equal(audit.object_id, LISTING);
  assert.equal(audit.summary.outputObjectId, f.lease.outputObjectId);
});
test('floor-plan seal rejects photo, lossy, malformed and wrong-source declarations without a partial output', async (t) => {
  const f = await setup(t),
    m = f.result.manifest;
  const photo = (await convertSyntheticImage(f.source)).manifest;
  for (const bad of [
    photo,
    { ...m, role: 'photo' },
    { ...m, countsAsPhoto: true },
    { ...m, inputSha256: 'a'.repeat(64) },
    { ...m, inputBytes: m.inputBytes + 1 },
    { ...m, sourceFormat: 'jpeg' },
    { ...m, width: 1921 },
    { ...m, height: 0 },
    { ...m, bytes: 1.5 },
    { ...m, encoder: { sharp: 'unknown', vips: '8.18.7' } },
    { ...m, unexpected: true },
    { ...m, operations: photo.operations },
    null,
  ])
    await denied(() => f.seal(bad), '23514');
  assert.equal((await count(f.db)).outputs, 0);
  assert.equal((await count(f.db)).audits, 0);
});
test('current actor, company, assignment, draft and exact claim/output remain required for a fresh seal', async (t) => {
  const f = await setup(t);
  await denied(() => f.seal(undefined, {}, ADMIN));
  await denied(() => f.seal(undefined, {}, AGENT, OTHER));
  for (const change of [{ claim: id(1990) }, { nonce: id(1991) }, { output: id(1992) }])
    await denied(() => f.seal(undefined, change), '40001');
  await f.db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
  await denied(() => f.seal());
  await f.db.query('UPDATE app_private.tenants SET enabled=true WHERE id=$1', [T]);
  await f.db.query(
    "UPDATE app_private.memberships SET role='customer' WHERE tenant_id=$1 AND user_id=$2",
    [T, AGENT],
  );
  await denied(() => f.seal());
  await f.db.query(
    "UPDATE app_private.memberships SET role='agent' WHERE tenant_id=$1 AND user_id=$2",
    [T, AGENT],
  );
  await f.db.query('UPDATE app_private.listings SET assigned_agent_id=$1 WHERE id=$2', [
    id(12),
    LISTING,
  ]);
  await denied(() => f.seal());
  await f.db.query('UPDATE app_private.listings SET assigned_agent_id=$1 WHERE id=$2', [
    AGENT,
    LISTING,
  ]);
  await f.db.query(
    "UPDATE app_private.listing_revisions SET title='later version' WHERE listing_id=$1",
    [LISTING],
  );
  await denied(() => f.seal(), '40001');
  assert.equal((await count(f.db)).outputs, 0);
});
test('a committed floor-plan output remains exact history after a later edit and refuses a changed replay', async (t) => {
  const f = await setup(t),
    saved = await f.seal();
  await f.db.query(
    "UPDATE app_private.listing_revisions SET title='later draft edit' WHERE listing_id=$1",
    [LISTING],
  );
  assert.deepEqual(await f.read(), saved);
  assert.deepEqual(await f.seal(), saved);
  await denied(() => f.seal({ ...f.result.manifest, sha256: 'b'.repeat(64) }), '40001');
  assert.deepEqual(await f.read(), saved);
  assert.equal((await count(f.db)).audits, 1);
});
test('expired processing lease and audit failure cannot leave an accepted partial output', async (t) => {
  const f = await setup(t);
  await f.db.exec(
    "CREATE FUNCTION app_private.fail_floor_output_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='floor_plan.output_sealed' THEN RAISE EXCEPTION 'Synthetic failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_floor_output_audit BEFORE INSERT ON app_private.audit_events FOR EACH ROW EXECUTE FUNCTION app_private.fail_floor_output_audit()",
  );
  await denied(() => f.seal(), '23514');
  assert.equal((await count(f.db)).outputs, 0);
  await f.db.exec('DROP TRIGGER fail_floor_output_audit ON app_private.audit_events');
  await f.db.exec(
    'ALTER TABLE app_private.synthetic_floor_plan_leases DISABLE TRIGGER immutable_floor_plan_lease',
  );
  await f.db.query(
    "UPDATE app_private.synthetic_floor_plan_leases SET claimed_at=clock_timestamp()-interval '6 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE request_id=$1",
    [f.request],
  );
  await f.db.exec(
    'ALTER TABLE app_private.synthetic_floor_plan_leases ENABLE TRIGGER immutable_floor_plan_lease',
  );
  await denied(() => f.seal(), '23514');
  assert.equal((await count(f.db)).outputs, 0);
  assert.equal((await count(f.db)).audits, 0);
});
test('floor-plan output rows are immutable and forced-RLS, with coordinator-only commands and no raw runtime reads', async (t) => {
  const f = await setup(t);
  await f.seal();
  await denied(
    () =>
      asActor(f.db, T, AGENT, () =>
        scalar(f.db, 'SELECT app_media.read_synthetic_floor_plan_output($1,1,$2)', [
          LISTING,
          f.request,
        ]),
      ),
    '42501',
  );
  await denied(
    () =>
      media(f.db, () =>
        scalar(f.db, 'SELECT count(*) FROM app_private.synthetic_floor_plan_outputs'),
      ),
    '42501',
  );
  await denied(
    () =>
      f.db.query(
        'UPDATE app_private.synthetic_floor_plan_outputs SET verified_at=clock_timestamp()',
      ),
    '23514',
  );
  await denied(() => f.db.exec('DELETE FROM app_private.synthetic_floor_plan_outputs'), '23514');
  assert.equal(
    await scalar(
      f.db,
      "SELECT relforcerowsecurity FROM pg_class WHERE oid='app_private.synthetic_floor_plan_outputs'::regclass",
    ),
    true,
  );
  assert.equal((await count(f.db)).outputs, 1);
});

test('a failed seal audit rolls back completely and an explicit exact retry commits only once', async (t) => {
  const f = await setup(t);
  await f.db.exec(
    "CREATE FUNCTION app_private.fail_floor_retry_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='floor_plan.output_sealed' THEN RAISE EXCEPTION 'Synthetic failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_floor_retry_audit BEFORE INSERT ON app_private.audit_events FOR EACH ROW EXECUTE FUNCTION app_private.fail_floor_retry_audit()",
  );
  await denied(() => f.seal(), '23514');
  await denied(() => f.read(), 'P0002');
  assert.equal((await count(f.db)).outputs, 0);
  await f.db.exec('DROP TRIGGER fail_floor_retry_audit ON app_private.audit_events');
  const receipt = await f.seal();
  assert.deepEqual(await f.seal(), receipt);
  assert.equal((await count(f.db)).outputs, 1);
  assert.equal((await count(f.db)).audits, 1);
});
test(
  'actual Windows floor-plan readback binds directly to the isolated SQL output seal',
  { skip: process.platform !== 'win32', timeout: 90000 },
  async (t) => {
    const { setup: setupNative } =
      await import('../../packages/media/tests/floor-plan-fixture.mjs');
    const { createFloorPlanProcessor } =
      await import('../../packages/media/dist/floor-plan-processing.js');
    const { createWindowsSyntheticSupervisor, retireWindowsSyntheticSupervisor } =
      await import('../../packages/media/dist/windows-supervisor.js');
    const path = (await import('node:path')).default,
      os = (await import('node:os')).default;
    let supervisor;
    const f = await setupNative(t, {
      allowCleanup: async () =>
        !supervisor || Boolean(await retireWindowsSyntheticSupervisor(supervisor)),
    });
    await f.db.exec(
      await readFile(new URL('../proposals/floor-plan-output.sql', import.meta.url), 'utf8'),
    );
    supervisor = await createWindowsSyntheticSupervisor({
      powerShellPath:
        process.env.REALTOR_TEST_POWERSHELL ??
        path.join(
          os.homedir(),
          '.cache',
          'codex-runtimes',
          'codex-primary-runtime',
          'dependencies',
          'native',
          'powershell',
          'pwsh.exe',
        ),
      attemptParent: f.journal.attemptParent,
    });
    const processor = await createFloorPlanProcessor({ ...f.config, supervisor });
    try {
      const r = await processor.run(f.target);
      assert.equal(r.state, 'readback_verified');
      const receipt = await media(f.db, () =>
        scalar(f.db, 'SELECT app_media.seal_synthetic_floor_plan($1,1,$2,$3,$4,$5,$6)', [
          LISTING,
          f.target.requestId,
          f.target.claimId,
          f.target.leaseNonce,
          r.lease.outputObjectId,
          r.result.manifest,
        ]),
      );
      assert.deepEqual(receipt.manifest, r.result.manifest);
      assert.deepEqual(receipt.lease, r.lease ? f.lease : null);
      assert.equal((await count(f.db)).outputs, 1);
      assert.equal(r.outcome.termination, 'job_empty');
    } finally {
      await processor.close();
    }
  },
);
