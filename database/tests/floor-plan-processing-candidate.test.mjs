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
const request = id(700),
  claimId = id(800);
async function setup(t, actor = AGENT) {
  const db = await fixture();
  t.after(() => db.close());
  assert.equal(
    await scalar(db, "SELECT to_regclass('app_private.synthetic_floor_plan_leases')"),
    null,
  );
  for (const name of ['registration', 'processing'])
    await db.exec(
      await readFile(new URL('../proposals/floor-plan-' + name + '.sql', import.meta.url), 'utf8'),
    );
  await createDraft(db);
  const register = (operation = request) =>
    asActor(db, T, actor, () =>
      scalar(db, 'SELECT app_api.register_synthetic_floor_plan($1,1,2,$2,$3,100,$4)', [
        LISTING,
        operation,
        'a'.repeat(64),
        'png',
      ]),
    );
  const registered = await register();
  return { db, registered, register };
}
async function media(db, actor, work, tenant = T) {
  await db.exec('BEGIN; SET LOCAL ROLE media_coordinator');
  try {
    await db.query(
      "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),set_config('realtor.correlation_id','synthetic-floor-plan-lease',true)",
      [tenant, actor ?? ''],
    );
    const result = await work();
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
const claim = (db, actor = AGENT, value = claimId, operation = request, tenant = T) =>
  media(
    db,
    actor,
    () =>
      scalar(db, 'SELECT app_media.claim_synthetic_floor_plan($1,1,$2,$3)', [
        LISTING,
        operation,
        value,
      ]),
    tenant,
  );
const read = (db, actor = AGENT) =>
  media(db, actor, () =>
    scalar(db, 'SELECT app_media.read_synthetic_floor_plan_lease($1,1,$2)', [LISTING, request]),
  );
const preflight = (db, lease, actor = AGENT, nonce = lease.leaseNonce) =>
  media(db, actor, () =>
    scalar(db, 'SELECT app_media.preflight_synthetic_floor_plan_worker($1,1,$2,$3,$4)', [
      LISTING,
      request,
      claimId,
      nonce,
    ]),
  );
const denied = (work, code) => assert.rejects(work, (error) => error.code === code);
const counts = async (db) =>
  (
    await db.query(
      `SELECT
 (SELECT count(*)::int FROM app_private.synthetic_floor_plan_leases) AS leases,
 (SELECT count(*)::int FROM app_private.audit_events WHERE action='floor_plan.processing_claimed') AS audits,
 (SELECT count(*)::int FROM app_private.media_processing_leases) AS photo_leases,
 (SELECT count(*)::int FROM app_private.revision_media) AS photos,
 (SELECT version::text FROM app_private.listing_revisions WHERE listing_id=$1 AND revision_no=1) AS version`,
      [LISTING],
    )
  ).rows[0];

test('floor-plan processing has one immutable bounded lease with exact original facts and one audit', async (t) => {
  const { db, registered } = await setup(t);
  const lease = await claim(db);
  assert.equal(lease.policy, 'synthetic-floor-plan-lease-v1');
  assert.deepEqual(lease.registration, registered);
  assert.equal(lease.claimId, claimId);
  assert.match(lease.leaseNonce, /^[0-9a-f-]{36}$/);
  assert.match(lease.outputObjectId, /^[0-9a-f-]{36}$/);
  assert.notEqual(lease.outputObjectId, registered.binding.inputObjectId);
  assert.equal(Date.parse(lease.expiresAt) - Date.parse(lease.claimedAt), 300000);
  assert.deepEqual(await claim(db), lease);
  assert.deepEqual(await read(db), lease);
  assert.deepEqual(await preflight(db, lease), lease);
  assert.deepEqual(await counts(db), {
    leases: 1,
    audits: 1,
    photo_leases: 0,
    photos: 0,
    version: '2',
  });
  assert.deepEqual(
    (
      await db.query(
        "SELECT tenant_id,actor_id,object_id,object_version::text,correlation_id,summary FROM app_private.audit_events WHERE action='floor_plan.processing_claimed'",
      )
    ).rows,
    [
      {
        tenant_id: T,
        actor_id: AGENT,
        object_id: LISTING,
        object_version: '2',
        correlation_id: 'synthetic-floor-plan-lease',
        summary: { revision: 1, requestId: request, claimId, jobId: registered.binding.jobId },
      },
    ],
  );
});

test('floor-plan claims and launch checks deny foreign scope, changed assignment, role loss and wrong nonces', async (t) => {
  const { db } = await setup(t, ADMIN);
  const lease = await claim(db, ADMIN);
  const before = await counts(db);
  for (const actor of [AGENT, id(12), id(13), id(20), null]) {
    await assert.rejects(() => claim(db, actor));
    await assert.rejects(() => read(db, actor));
    await assert.rejects(() => preflight(db, lease, actor));
  }
  await assert.rejects(() => claim(db, id(20), claimId, request, OTHER));
  await denied(() => preflight(db, lease, ADMIN, id(999)), 'P0002');
  await db.query('UPDATE app_private.listings SET assigned_agent_id=$1 WHERE id=$2', [
    id(12),
    LISTING,
  ]);
  await denied(() => preflight(db, lease, ADMIN), '40001');
  assert.deepEqual(await read(db, ADMIN), lease);
  await db.query('UPDATE app_private.listings SET assigned_agent_id=$1 WHERE id=$2', [
    AGENT,
    LISTING,
  ]);
  await db.query(
    "UPDATE app_private.memberships SET role='customer' WHERE tenant_id=$1 AND user_id=$2",
    [T, ADMIN],
  );
  await denied(() => preflight(db, lease, ADMIN), '42501');
  await db.query(
    "UPDATE app_private.memberships SET role='admin' WHERE tenant_id=$1 AND user_id=$2",
    [T, ADMIN],
  );
  await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
  await denied(() => read(db, ADMIN), '42501');
  await denied(() => preflight(db, lease, ADMIN), '42501');
  await db.query('UPDATE app_private.tenants SET enabled=true WHERE id=$1', [T]);
  assert.deepEqual(await counts(db), before);
});

test('expired leases cannot admit work or be replaced, and historical recovery preserves their deadline', async (t) => {
  const { db } = await setup(t);
  await claim(db);
  // Privileged disposable clock fixture, unavailable through the runtime API.
  await db.exec(
    'ALTER TABLE app_private.synthetic_floor_plan_leases DISABLE TRIGGER immutable_floor_plan_lease',
  );
  try {
    await db.exec(
      "UPDATE app_private.synthetic_floor_plan_leases SET claimed_at=clock_timestamp()-interval '10 minutes',expires_at=clock_timestamp()-interval '5 minutes 1 second'",
    );
  } finally {
    await db.exec(
      'ALTER TABLE app_private.synthetic_floor_plan_leases ENABLE TRIGGER immutable_floor_plan_lease',
    );
  }
  const expired = await read(db);
  const before = await counts(db);
  await denied(() => preflight(db, expired), '23514');
  await denied(() => claim(db, AGENT, id(801)), '40001');
  assert.deepEqual(await claim(db), expired);
  await db.query(
    "UPDATE app_private.listing_revisions SET title='Synthetic later version' WHERE listing_id=$1 AND revision_no=1",
    [LISTING],
  );
  await denied(() => preflight(db, expired), '40001');
  assert.deepEqual(await read(db), expired);
  assert.deepEqual(await counts(db), { ...before, version: '3' });
});

test('claim collisions and audit failures leave no partial floor-plan lease', async (t) => {
  const { db, register } = await setup(t);
  await db.exec(
    "CREATE FUNCTION app_private.fail_floor_lease_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='floor_plan.processing_claimed' THEN RAISE EXCEPTION 'Synthetic failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_floor_lease_audit BEFORE INSERT ON app_private.audit_events FOR EACH ROW EXECUTE FUNCTION app_private.fail_floor_lease_audit()",
  );
  await denied(() => claim(db), '23514');
  assert.equal((await counts(db)).leases, 0);
  await db.exec('DROP TRIGGER fail_floor_lease_audit ON app_private.audit_events');
  const lease = await claim(db);
  await register(id(701));
  await denied(() => claim(db, AGENT, claimId, id(701)), '23505');
  await denied(() => claim(db, AGENT, null), '23514');
  assert.deepEqual(await read(db), lease);
  assert.equal((await counts(db)).leases, 1);
  assert.equal((await counts(db)).audits, 1);
});

test('runtime roles cannot edit floor-plan leases and only the coordinator can execute processing functions', async (t) => {
  const { db } = await setup(t);
  await denied(
    () =>
      asActor(db, T, AGENT, () =>
        scalar(db, 'SELECT app_media.claim_synthetic_floor_plan($1,1,$2,$3)', [
          LISTING,
          request,
          claimId,
        ]),
      ),
    '42501',
  );
  await claim(db);
  await denied(
    () => media(db, AGENT, () => db.exec('SELECT * FROM app_private.synthetic_floor_plan_leases')),
    '42501',
  );
  await denied(() => db.exec('DELETE FROM app_private.synthetic_floor_plan_leases'), '23514');
  await denied(
    () =>
      db.exec('UPDATE app_private.synthetic_floor_plan_leases SET lease_nonce=gen_random_uuid()'),
    '23514',
  );
  assert.deepEqual(
    (
      await db.query(
        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='app_private.synthetic_floor_plan_leases'::regclass",
      )
    ).rows,
    [{ relrowsecurity: true, relforcerowsecurity: true }],
  );
});
