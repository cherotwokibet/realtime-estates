import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const operation = id(700);
const hash = 'a'.repeat(64);
async function setup(t) {
  const db = await fixture();
  t.after(() => db.close());
  assert.equal(
    await scalar(db, "SELECT to_regclass('app_private.synthetic_floor_plan_registrations')"),
    null,
  );
  await db.exec(
    await readFile(new URL('../proposals/floor-plan-registration.sql', import.meta.url), 'utf8'),
  );
  await createDraft(db);
  return db;
}
const register = (db, patch = {}, user = AGENT, tenant = T) => {
  const input = {
    listing: LISTING,
    revision: 1,
    version: '2',
    operation,
    hash,
    bytes: 100,
    format: 'png',
    ...patch,
  };
  return asActor(db, tenant, user, () =>
    scalar(db, 'SELECT app_api.register_synthetic_floor_plan($1,$2,$3,$4,$5,$6,$7)', [
      input.listing,
      input.revision,
      input.version,
      input.operation,
      input.hash,
      input.bytes,
      input.format,
    ]),
  );
};
const original = (db, user = AGENT, tenant = T) =>
  asActor(db, tenant, user, () =>
    scalar(db, 'SELECT app_api.read_synthetic_floor_plan_registration($1,$2)', [
      LISTING,
      operation,
    ]),
  );
const preflight = (
  db,
  user = AGENT,
  tenant = T,
  listing = LISTING,
  revision = 1,
  request = operation,
) =>
  asActor(db, tenant, user, () =>
    scalar(db, 'SELECT app_api.preflight_synthetic_floor_plan($1,$2,$3)', [
      listing,
      revision,
      request,
    ]),
  );
const denied = (work, code) => assert.rejects(work, (error) => error.code === code);
const state = async (db) =>
  (
    await db.query(
      `SELECT
 (SELECT count(*)::int FROM app_private.synthetic_floor_plan_registrations) AS registrations,
 (SELECT count(*)::int FROM app_private.audit_events WHERE action='floor_plan.registered') AS audits,
 (SELECT count(*)::int FROM app_private.media_jobs) AS photo_jobs,
 (SELECT count(*)::int FROM app_private.revision_media) AS photos,
 (SELECT version::text FROM app_private.listing_revisions WHERE listing_id=$1 AND revision_no=1) AS version`,
      [LISTING],
    )
  ).rows[0];

test('floor-plan registration binds current staff and source facts once without changing photo or draft state', async (t) => {
  const db = await setup(t);
  const before = await state(db);
  const saved = await register(db);
  assert.equal(saved.policy, 'synthetic-floor-plan-registration-v1');
  assert.equal(saved.pipeline, 'synthetic-floor-plan-codec-v1');
  assert.equal(saved.role, 'floor_plan');
  assert.equal(saved.countsAsPhoto, false);
  const binding = saved.binding;
  assert.deepEqual(binding, {
    companyId: T,
    actorId: AGENT,
    listingId: LISTING,
    revision: 1,
    expectedVersion: 2,
    requestId: operation,
    jobId: binding.jobId,
    generationId: binding.generationId,
    inputObjectId: binding.inputObjectId,
  });
  for (const key of ['jobId', 'generationId', 'inputObjectId'])
    assert.match(binding[key], /^[0-9a-f-]{36}$/);
  assert.equal(
    new Set([operation, binding.jobId, binding.generationId, binding.inputObjectId]).size,
    4,
  );
  assert.deepEqual(saved.source, { sha256: hash, bytes: 100, format: 'png' });
  assert.equal(Date.parse(saved.expiresAt) - Date.parse(saved.registeredAt), 86400000);
  assert.deepEqual(await original(db), saved);
  assert.deepEqual(await preflight(db), saved);
  assert.deepEqual(await register(db), saved);
  assert.deepEqual(await state(db), { ...before, registrations: 1, audits: 1 });
  assert.deepEqual(
    (
      await db.query(
        "SELECT tenant_id,actor_id,object_id,object_version::text,correlation_id,summary FROM app_private.audit_events WHERE action='floor_plan.registered'",
      )
    ).rows,
    [
      {
        tenant_id: T,
        actor_id: AGENT,
        object_id: LISTING,
        object_version: '2',
        correlation_id: 'synthetic-db-test',
        summary: { revision: 1, operationId: operation, jobId: binding.jobId },
      },
    ],
  );
});

test('malformed floor-plan declarations and stale versions reserve no registration or audit', async (t) => {
  const db = await setup(t);
  const before = await state(db);
  for (const patch of [
    { listing: null },
    { revision: null },
    { revision: 0 },
    { operation: null },
    { operation: '00000000-0000-0000-0000-000000000000' },
    { version: null },
    { version: '0' },
    { version: '9007199254740992' },
    { hash: null },
    { hash: 'A'.repeat(64) },
    { hash: 'a'.repeat(63) },
    { bytes: null },
    { bytes: 0 },
    { bytes: 10485761 },
    { format: null },
    { format: 'pdf' },
    { format: 'PNG' },
  ])
    await denied(() => register(db, patch), '23514');
  await denied(() => register(db, { version: '1' }), '40001');
  assert.deepEqual(await state(db), before);
});

test('current company, assignment and original actor fence registration and recovery', async (t) => {
  const db = await setup(t);
  const saved = await register(db);
  const before = await state(db);
  for (const user of [id(12), id(13), id(20)]) {
    await assert.rejects(() => register(db, {}, user));
    await assert.rejects(() => original(db, user));
  }
  await denied(() => register(db, {}, ADMIN), '40001');
  await denied(() => original(db, ADMIN), 'P0002');
  await assert.rejects(() => register(db, {}, id(20), OTHER));
  for (const patch of [
    { hash: 'b'.repeat(64) },
    { bytes: 101 },
    { format: 'jpeg' },
    { version: '3' },
  ])
    await denied(() => register(db, patch), '40001');
  await db.query(
    'UPDATE app_private.listings SET assigned_agent_id=$1 WHERE tenant_id=$2 AND id=$3',
    [id(12), T, LISTING],
  );
  await denied(() => original(db), 'P0002');
  await denied(() => register(db), 'P0002');
  await db.query(
    'UPDATE app_private.listings SET assigned_agent_id=$1 WHERE tenant_id=$2 AND id=$3',
    [AGENT, T, LISTING],
  );
  await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
  await denied(() => original(db), '42501');
  await denied(() => register(db), '42501');
  await db.query('UPDATE app_private.tenants SET enabled=true WHERE id=$1', [T]);
  assert.deepEqual(await original(db), saved);
  assert.deepEqual(await state(db), before);
});

test('historical originals survive draft edits and archive while fresh registration requires a current draft', async (t) => {
  const db = await setup(t);
  const saved = await register(db);
  await db.query(
    "UPDATE app_private.listing_revisions SET title='Synthetic later edit' WHERE tenant_id=$1 AND listing_id=$2 AND revision_no=1",
    [T, LISTING],
  );
  await denied(() => register(db, { operation: id(701) }), '40001');
  assert.deepEqual(await register(db), saved);
  await db.query(
    "UPDATE app_private.listing_revisions SET state='pending' WHERE tenant_id=$1 AND listing_id=$2 AND revision_no=1",
    [T, LISTING],
  );
  await denied(() => register(db, { operation: id(701), version: '4' }), '23514');
  assert.deepEqual(await register(db), saved);
  await db.query(
    "UPDATE app_private.listings SET publication_status='archived',archived_at=now() WHERE tenant_id=$1 AND id=$2",
    [T, LISTING],
  );
  await denied(() => register(db, { operation: id(701), version: '3' }), '23514');
  assert.deepEqual(await original(db), saved);
  assert.deepEqual(await register(db), saved);
  assert.equal((await state(db)).registrations, 1);
});

test('floor-plan originals are immutable and audit failure rolls back registration without leaking runtime table access', async (t) => {
  const db = await setup(t);
  await db.exec(
    "CREATE FUNCTION app_private.fail_floor_plan_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='floor_plan.registered' THEN RAISE EXCEPTION 'Synthetic failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_floor_plan_audit BEFORE INSERT ON app_private.audit_events FOR EACH ROW EXECUTE FUNCTION app_private.fail_floor_plan_audit()",
  );
  await denied(() => register(db), '23514');
  assert.equal((await state(db)).registrations, 0);
  await db.exec('DROP TRIGGER fail_floor_plan_audit ON app_private.audit_events');
  await register(db);
  await denied(
    () => db.exec('UPDATE app_private.synthetic_floor_plan_registrations SET source_bytes=101'),
    '23514',
  );
  await denied(
    () => db.exec('DELETE FROM app_private.synthetic_floor_plan_registrations'),
    '23514',
  );
  await denied(
    () =>
      asActor(db, T, ADMIN, () =>
        db.exec('SELECT * FROM app_private.synthetic_floor_plan_registrations'),
      ),
    '42501',
  );
  await denied(
    () =>
      asActor(db, T, ADMIN, () =>
        db.exec('DELETE FROM app_private.synthetic_floor_plan_registrations'),
      ),
    '42501',
  );
  assert.deepEqual(
    (
      await db.query(
        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='app_private.synthetic_floor_plan_registrations'::regclass",
      )
    ).rows,
    [{ relrowsecurity: true, relforcerowsecurity: true }],
  );
});

test('floor-plan fresh-work preflight fences current scope, registered assignment and draft version without refreshing an original', async (t) => {
  const db = await setup(t);
  const saved = await register(db, {}, ADMIN);
  const before = await state(db);
  assert.deepEqual(await preflight(db, ADMIN), saved);
  for (const work of [
    () => preflight(db),
    () => preflight(db, ADMIN, OTHER),
    () => preflight(db, ADMIN, T, LISTING, 2),
    () => preflight(db, ADMIN, T, LISTING, 1, id(799)),
  ])
    await assert.rejects(work);
  await db.query('UPDATE app_private.listings SET assigned_agent_id=$1 WHERE id=$2', [
    id(12),
    LISTING,
  ]);
  await denied(() => preflight(db, ADMIN), '40001');
  assert.deepEqual(await original(db, ADMIN), saved);
  await db.query('UPDATE app_private.listings SET assigned_agent_id=$1 WHERE id=$2', [
    AGENT,
    LISTING,
  ]);
  await db.query(
    "UPDATE app_private.memberships SET role='customer' WHERE tenant_id=$1 AND user_id=$2",
    [T, ADMIN],
  );
  await denied(() => preflight(db, ADMIN), '42501');
  await db.query(
    "UPDATE app_private.memberships SET role='admin' WHERE tenant_id=$1 AND user_id=$2",
    [T, ADMIN],
  );
  assert.deepEqual(await state(db), before);
  await db.query(
    "UPDATE app_private.listing_revisions SET title='Synthetic later draft' WHERE listing_id=$1 AND revision_no=1",
    [LISTING],
  );
  await denied(() => preflight(db, ADMIN), '40001');
  assert.deepEqual(await original(db, ADMIN), saved);
  await db.query(
    "UPDATE app_private.listing_revisions SET state='pending' WHERE listing_id=$1 AND revision_no=1",
    [LISTING],
  );
  await denied(() => preflight(db, ADMIN), '23514');
});

test('expired and future-dated floor-plan registrations remain historical and cannot admit fresh bytes', async (t) => {
  const db = await setup(t);
  await register(db);
  for (const interval of ['-25 hours', '1 hour']) {
    // Privileged disposable clock-boundary fixture. Application roles cannot edit the original.
    await db.exec(
      'ALTER TABLE app_private.synthetic_floor_plan_registrations DISABLE TRIGGER immutable_floor_plan_registration',
    );
    try {
      await db.query(
        'UPDATE app_private.synthetic_floor_plan_registrations SET registered_at=clock_timestamp()+$1::interval',
        [interval],
      );
    } finally {
      await db.exec(
        'ALTER TABLE app_private.synthetic_floor_plan_registrations ENABLE TRIGGER immutable_floor_plan_registration',
      );
    }
    const before = await state(db);
    await denied(() => preflight(db), '23514');
    assert.equal((await original(db)).binding.requestId, operation);
    assert.deepEqual(await state(db), before);
  }
});
