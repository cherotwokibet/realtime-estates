import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setup, id } from './floor-plan-attachment-fixture.mjs';
import {
  asActor,
  scalar,
  seedMedia,
  fixture,
  publish,
  T,
  OTHER,
  ADMIN,
  AGENT,
  LISTING,
} from './public-media-fixtures.mjs';
const install = async (db) =>
  db.exec(
    await readFile(new URL('../proposals/floor-plan-publication.sql', import.meta.url), 'utf8'),
  );
const read = (db, tenant = T) =>
  asActor(db, tenant, null, () =>
    scalar(db, 'SELECT app_api.read_synthetic_published_floor_plan($1,1)', [LISTING]),
  );
const review = (db, version, actor = ADMIN) =>
  asActor(db, T, actor, () =>
    scalar(db, 'SELECT app_api.read_synthetic_review_floor_plan($1,1,$2)', [LISTING, version]),
  );
async function pending(f, version) {
  await seedMedia(f.db);
  return asActor(f.db, T, AGENT, async () => {
    await scalar(f.db, "SELECT app_api.confirm_availability($1,1,'available')", [LISTING]);
    return scalar(f.db, 'SELECT app_api.submit_revision($1,1,$2)', [LISTING, version]);
  });
}
const approve = (db, version) =>
  asActor(db, T, ADMIN, () =>
    scalar(db, 'SELECT app_api.decide_revision($1,1,$2,true)', [LISTING, version]),
  );
const snapshotCount = (db) =>
  scalar(db, 'SELECT count(*)::integer FROM app_private.synthetic_approved_floor_plans');

test('floor approval captures sealed attachment atomically; public projection excludes private provenance', async (t) => {
  const f = await setup(t);
  await install(f.db);
  const saved = await f.save(),
    version = await pending(f, saved.resultVersion);
  await assert.rejects(() => read(f.db));
  assert.deepEqual((await review(f.db, version)).floorPlan, saved);
  await assert.rejects(
    () => review(f.db, version, AGENT),
    (e) => e.code === '42501',
  );
  await assert.rejects(
    () => review(f.db, '1'),
    (e) => e.code === '40001',
  );
  await assert.rejects(() =>
    asActor(f.db, T, ADMIN, async () => {
      await scalar(f.db, 'SELECT app_api.decide_revision($1,1,$2,true)', [LISTING, version]);
      throw Error('Synthetic transaction rollback after capture');
    }),
  );
  assert.equal(await snapshotCount(f.db), 0);
  assert.deepEqual((await review(f.db, version)).floorPlan, saved);
  await assert.rejects(() => read(f.db));
  await approve(f.db, version);
  assert.equal(await snapshotCount(f.db), 1);
  const result = await read(f.db);
  assert.deepEqual(
    result.floorPlan,
    Object.fromEntries(['width', 'height', 'bytes', 'sha256'].map((k) => [k, f.manifest[k]])),
  );
  assert.deepEqual(
    Object.keys(result).sort(),
    ['policy', 'listingId', 'revision', 'approvedVersion', 'floorPlan'].sort(),
  );
  assert.deepEqual((await review(f.db, result.approvedVersion)).floorPlan, saved);
  const json = JSON.stringify(result);
  for (const field of [
    'actorId',
    'companyId',
    'operationId',
    'requestId',
    'lease',
    'inputObjectId',
    'privateAddress',
    'source',
  ])
    assert.ok(!json.includes(field));
  await assert.rejects(
    () => read(f.db, OTHER),
    (e) => e.code === 'P0002',
  );
  await assert.rejects(
    () =>
      asActor(f.db, T, ADMIN, () =>
        f.db.query('SELECT * FROM app_private.synthetic_approved_floor_plans'),
      ),
    (e) => e.code === '42501',
  );
  await assert.rejects(() =>
    f.db.query('UPDATE app_private.synthetic_approved_floor_plans SET operation_id=NULL'),
  );
  await assert.rejects(() => f.db.query('DELETE FROM app_private.synthetic_approved_floor_plans'));
  assert.deepEqual(await f.original(), saved);
});

test('explicit removal before submission is captured as null and never resurrects a historical attachment', async (t) => {
  const f = await setup(t);
  await install(f.db);
  const original = await f.save();
  const removed = await f.save(
    f.command({ operationId: id(1301), expectedVersion: original.resultVersion, requestId: null }),
  );
  const version = await pending(f, removed.resultVersion);
  assert.equal((await review(f.db, version)).floorPlan, null);
  await approve(f.db, version);
  assert.equal((await read(f.db)).floorPlan, null);
  assert.equal(await snapshotCount(f.db), 1);
  assert.deepEqual(await f.save(), original, 'Exact old replay does not change approved snapshot');
  assert.equal((await read(f.db)).floorPlan, null);
});

test('current company and publication controls deny fresh delivery while retaining immutable approval', async (t) => {
  const f = await setup(t);
  await install(f.db);
  const saved = await f.save();
  await approve(f.db, await pending(f, saved.resultVersion));
  const expected = await read(f.db);
  await f.db.query("UPDATE app_private.listings SET publication_status='paused' WHERE id=$1", [
    LISTING,
  ]);
  await assert.rejects(
    () => read(f.db),
    (e) => e.code === 'P0002',
  );
  await f.db.query("UPDATE app_private.listings SET publication_status='published' WHERE id=$1", [
    LISTING,
  ]);
  assert.deepEqual(await read(f.db), expected);
  await f.db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
  await assert.rejects(() => read(f.db));
  await assert.rejects(() => review(f.db, expected.approvedVersion));
  assert.equal(await snapshotCount(f.db), 1);
});

test('installing extension after approval never infers a floor plan or exposes private identifiers', async (t) => {
  const db = await fixture();
  t.after(() => db.close());
  await publish(db);
  for (const n of ['registration', 'processing', 'output', 'attachment'])
    await db.exec(
      await readFile(new URL('../proposals/floor-plan-' + n + '.sql', import.meta.url), 'utf8'),
    );
  await install(db);
  const result = await read(db);
  assert.equal(result.floorPlan, null);
  assert.equal(await snapshotCount(db), 0);
  assert.equal((await review(db, result.approvedVersion)).floorPlan, null);
});

test('floor plan is optional at approval and cannot substitute for the required property photos', async (t) => {
  const f = await setup(t);
  await install(f.db);
  const saved = await f.save();
  await assert.rejects(() =>
    asActor(f.db, T, AGENT, () =>
      scalar(f.db, 'SELECT app_api.submit_revision($1,1,$2)', [LISTING, saved.resultVersion]),
    ),
  );
  assert.equal(await snapshotCount(f.db), 0);
  const removed = await f.save(
    f.command({ operationId: id(1301), expectedVersion: saved.resultVersion, requestId: null }),
  );
  await approve(f.db, await pending(f, removed.resultVersion));
  assert.equal((await read(f.db)).floorPlan, null);
});

test('rejected moderation cannot capture a public floor plan', async (t) => {
  const f = await setup(t);
  await install(f.db);
  const saved = await f.save(),
    v = await pending(f, saved.resultVersion);
  await asActor(f.db, T, ADMIN, () =>
    scalar(f.db, "SELECT app_api.decide_revision($1,1,$2,false,'Synthetic floor plan rejected')", [
      LISTING,
      v,
    ]),
  );
  assert.equal(await snapshotCount(f.db), 0);
  await assert.rejects(() => read(f.db));
  await assert.rejects(() => review(f.db, String(Number(v) + 1)));
  assert.deepEqual(await f.original(), saved);
});
