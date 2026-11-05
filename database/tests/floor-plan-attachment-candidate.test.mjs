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
import { syntheticPng } from '../../packages/media/tests/fixtures.mjs';
import { convertSyntheticFloorPlan } from '../../packages/media/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SECOND = id(101);
async function media(db, work) {
  await db.exec('BEGIN; SET LOCAL ROLE media_coordinator');
  try {
    await db.query(
      "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
      [T, AGENT],
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
    await scalar(db, "SELECT to_regclass('app_private.synthetic_floor_plan_attachments')"),
    null,
  );
  for (const n of ['registration', 'processing', 'output', 'attachment'])
    await db.exec(
      await readFile(new URL('../proposals/floor-plan-' + n + '.sql', import.meta.url), 'utf8'),
    );
  await createDraft(db);
  const source = syntheticPng(),
    manifest = (await convertSyntheticFloorPlan(source)).manifest;
  const prepare = async (request = id(1100), version = 2, sealed = true) => {
    await asActor(db, T, AGENT, () =>
      scalar(db, 'SELECT app_api.register_synthetic_floor_plan($1,1,$2,$3,$4,$5,$6)', [
        LISTING,
        version,
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
        id(Number(request.slice(-4)) + 100),
      ]),
    );
    if (sealed)
      await media(db, () =>
        scalar(db, 'SELECT app_media.seal_synthetic_floor_plan($1,1,$2,$3,$4,$5,$6)', [
          LISTING,
          request,
          lease.claimId,
          lease.leaseNonce,
          lease.outputObjectId,
          manifest,
        ]),
      );
    return request;
  };
  const request = await prepare();
  const command = (changes = {}) => ({
    policy: 'synthetic-floor-plan-attachment-command-v1',
    operationId: id(1300),
    listingId: LISTING,
    revision: 1,
    expectedVersion: '2',
    requestId: request,
    ...changes,
  });
  const save = (cmd = command(), actor = AGENT, tenant = T) =>
    asActor(db, tenant, actor, () =>
      scalar(db, 'SELECT app_api.save_synthetic_floor_plan_attachment($1)', [cmd]),
    );
  const gallery = (actor = AGENT, tenant = T, listing = LISTING) =>
    asActor(db, tenant, actor, () =>
      scalar(db, 'SELECT app_api.read_synthetic_floor_plan_gallery($1,1)', [listing]),
    );
  const original = (operation = id(1300), actor = AGENT) =>
    asActor(db, T, actor, () =>
      scalar(db, 'SELECT app_api.read_synthetic_floor_plan_attachment_original($1,$2)', [
        LISTING,
        operation,
      ]),
    );
  return { db, source, manifest, request, prepare, command, save, gallery, original };
}
const denied = (work, c) => assert.rejects(work, (e) => !c || e.code === c);
const counts = async (db) =>
  (
    await db.query(
      "SELECT (SELECT count(*)::int FROM app_private.synthetic_floor_plan_attachments) AS operations,(SELECT count(*)::int FROM app_private.revision_media) AS photos,(SELECT count(*)::int FROM app_private.audit_events WHERE action IN ('listing.floor_plan_attached','listing.floor_plan_removed')) AS audits,(SELECT version::text FROM app_private.listing_revisions WHERE listing_id=$1 AND revision_no=1) AS version",
      [LISTING],
    )
  ).rows[0];
test('sealed floor-plan attachment advances a draft once, retains original output and has no photo-count effect', async (t) => {
  const f = await setup(t);
  assert.equal((await f.gallery()).floorPlan, null);
  const r = await f.save();
  assert.equal(r.policy, 'synthetic-floor-plan-attachment-record-v1');
  assert.equal(r.resultVersion, '3');
  assert.equal(r.actorId, AGENT);
  assert.equal(r.output.policy, 'synthetic-floor-plan-output-v1');
  assert.equal(r.output.manifest.countsAsPhoto, false);
  assert.deepEqual(await f.save(), r);
  assert.deepEqual(await f.original(), r);
  const gallery = await f.gallery();
  assert.equal(gallery.policy, 'synthetic-floor-plan-gallery-v1');
  assert.equal(gallery.version, '3');
  assert.equal(gallery.actorId, AGENT);
  assert.deepEqual(gallery.floorPlan, r);
  assert.deepEqual(await counts(f.db), { operations: 1, photos: 0, audits: 1, version: '3' });
  const audit = (
    await f.db.query(
      "SELECT actor_id,object_version,summary FROM app_private.audit_events WHERE action='listing.floor_plan_attached'",
    )
  ).rows[0];
  assert.equal(audit.actor_id, AGENT);
  assert.equal(audit.object_version, 3);
  assert.equal(audit.summary.requestId, f.request);
});
test('replacement and removal preserve prior history and exact replay never restores removed content', async (t) => {
  const f = await setup(t),
    first = await f.save(),
    request = await f.prepare(id(1101), 3);
  const secondCmd = f.command({ operationId: id(1301), expectedVersion: '3', requestId: request }),
    second = await f.save(secondCmd);
  assert.equal(second.resultVersion, '4');
  assert.notEqual(second.output.lease.outputObjectId, first.output.lease.outputObjectId);
  const remove = f.command({ operationId: id(1302), expectedVersion: '4', requestId: null }),
    removed = await f.save(remove);
  assert.equal(removed.resultVersion, '5');
  assert.equal(removed.output, null);
  assert.equal((await f.gallery()).floorPlan, null);
  assert.deepEqual(await f.save(), first);
  assert.deepEqual(await f.original(), first);
  assert.deepEqual(await f.original(id(1301)), second);
  assert.deepEqual(await f.save(remove), removed);
  assert.equal((await f.gallery()).floorPlan, null);
  assert.deepEqual(await counts(f.db), { operations: 3, photos: 0, audits: 3, version: '5' });
});
test('fresh attachment requires exact current version and a sealed output for the same company/listing/revision', async (t) => {
  const f = await setup(t),
    unsealed = await f.prepare(id(1102), 2, false);
  await denied(() => f.save(f.command({ requestId: unsealed })), '23514');
  await denied(() => f.save(f.command({ requestId: id(1999) })), 'P0002');
  await denied(() => f.save(f.command({ revision: 2 })), 'P0002');
  await denied(() => f.save(f.command({ expectedVersion: '1' })), '40001');
  await createDraft(f.db, SECOND);
  await denied(() => f.save(f.command({ listingId: SECOND })), 'P0002');
  assert.deepEqual(await counts(f.db), { operations: 0, photos: 0, audits: 0, version: '2' });
});
test('current company, membership and assignment govern writes, gallery reads and original recovery', async (t) => {
  const f = await setup(t);
  for (const actor of [id(12), id(13)]) {
    await denied(() => f.save(undefined, actor));
    await denied(() => f.gallery(actor));
  }
  await denied(() => f.save(undefined, AGENT, OTHER));
  await denied(() => f.save(undefined, id(20), OTHER), 'P0002');
  await denied(() => f.gallery(id(20), OTHER), 'P0002');
  const saved = await f.save(undefined, ADMIN);
  assert.equal(saved.actorId, ADMIN);
  const adminGallery = await f.gallery(ADMIN);
  assert.equal(adminGallery.actorId, ADMIN);
  assert.equal(adminGallery.floorPlan.output.lease.registration.binding.actorId, AGENT);
  await denied(() => f.original(id(1300), AGENT), 'P0002');
  await denied(() => f.save(undefined, AGENT), '40001');
  await f.db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
  await denied(() => f.gallery(ADMIN));
  await denied(() => f.save(undefined, ADMIN));
  await f.db.query('UPDATE app_private.tenants SET enabled=true WHERE id=$1', [T]);
  await f.db.query('UPDATE app_private.listings SET assigned_agent_id=$1 WHERE id=$2', [
    id(12),
    LISTING,
  ]);
  await denied(() => f.gallery(AGENT));
  assert.equal((await f.gallery(id(12))).floorPlan.actorId, ADMIN);
  await denied(
    () => f.save(f.command({ operationId: id(1301), expectedVersion: '3' }), ADMIN),
    '40001',
  );
  assert.deepEqual(await counts(f.db), { operations: 1, photos: 0, audits: 1, version: '3' });
});
test('malformed commands and changed operation originals cannot change a draft or existing gallery', async (t) => {
  const f = await setup(t);
  for (const change of [
    { expectedVersion: 2 },
    { expectedVersion: '02' },
    { expectedVersion: '9007199254740991' },
    { revision: 0 },
    { requestId: 'photo' },
    { policy: 'synthetic-listing-video-command-v1' },
    { unexpected: true },
  ])
    await denied(() => f.save(f.command(change)), '23514');
  const saved = await f.save();
  await denied(() => f.save(f.command({ requestId: null })), '40001');
  await f.db.query(
    "UPDATE app_private.listing_revisions SET title='later ordinary edit' WHERE listing_id=$1",
    [LISTING],
  );
  assert.deepEqual(await f.save(), saved);
  assert.equal((await f.gallery()).version, '4');
  assert.deepEqual((await f.gallery()).floorPlan, saved);
});
test('audit failure rolls back attachment and version, while original rows remain immutable and inaccessible to raw runtime reads', async (t) => {
  const f = await setup(t);
  await f.db.exec(
    "CREATE FUNCTION app_private.fail_floor_attachment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='listing.floor_plan_attached' THEN RAISE EXCEPTION 'Synthetic failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_floor_attachment_audit BEFORE INSERT ON app_private.audit_events FOR EACH ROW EXECUTE FUNCTION app_private.fail_floor_attachment_audit()",
  );
  await denied(() => f.save(), '23514');
  assert.deepEqual(await counts(f.db), { operations: 0, photos: 0, audits: 0, version: '2' });
  await f.db.exec('DROP TRIGGER fail_floor_attachment_audit ON app_private.audit_events');
  const saved = await f.save();
  assert.equal(saved.resultVersion, '3');
  await denied(
    () =>
      asActor(f.db, T, AGENT, () =>
        scalar(f.db, 'SELECT count(*) FROM app_private.synthetic_floor_plan_attachments'),
      ),
    '42501',
  );
  await denied(
    () => f.db.exec('DELETE FROM app_private.synthetic_floor_plan_attachments'),
    '23514',
  );
  await denied(
    () => f.db.exec('UPDATE app_private.synthetic_floor_plan_attachments SET result_version=4'),
    '23514',
  );
  assert.equal(
    await scalar(
      f.db,
      "SELECT relforcerowsecurity FROM pg_class WHERE oid='app_private.synthetic_floor_plan_attachments'::regclass",
    ),
    true,
  );
  assert.deepEqual(await counts(f.db), { operations: 1, photos: 0, audits: 1, version: '3' });
});

test('pending and archived revisions refuse new attachment changes while retaining authorized historical reads', async (t) => {
  const f = await setup(t),
    saved = await f.save();
  await f.db.query(
    "UPDATE app_private.listing_revisions SET state='pending' WHERE listing_id=$1 AND revision_no=1",
    [LISTING],
  );
  const change = f.command({ operationId: id(1303), expectedVersion: '4', requestId: null });
  await denied(() => f.save(change), '23514');
  assert.equal((await f.gallery()).state, 'pending');
  assert.deepEqual((await f.gallery()).floorPlan, saved);
  await f.db.query(
    "UPDATE app_private.listings SET publication_status='archived',archived_at=now() WHERE id=$1",
    [LISTING],
  );
  await denied(() => f.save(change), '23514');
  assert.deepEqual(await f.save(), saved);
  assert.deepEqual(await f.original(), saved);
  assert.deepEqual(await counts(f.db), { operations: 1, photos: 0, audits: 1, version: '4' });
});
