import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setup, id } from './floor-plan-attachment-fixture.mjs';
import {
  asActor,
  scalar,
  seedMedia,
  T,
  OTHER,
  ADMIN,
  AGENT,
  LISTING,
} from './public-media-fixtures.mjs';
import { normalizeStaffDraftContentV2 } from '../../packages/domain/dist/index.js';
const content = normalizeStaffDraftContentV2({
  title: 'Synthetic successor studio',
  description: 'Synthetic inheritance only.',
  purpose: 'rent',
  propertyType: 'studio',
  currency: 'KES',
  amountMinor: 2000000,
  rentPeriod: 'month',
  bedrooms: 0,
  privateBathrooms: 1,
  country: 'KE',
  locality: 'Synthetic county',
  location: { county: 'Synthetic county', town: null, area: null },
  publicPrecision: 'area',
  privateAddress: 'PRIVATE SYNTHETIC',
  pricing: { declaration: 'complete', charges: [] },
});
async function install(db) {
  await db.exec(
    await readFile(new URL('../proposals/floor-plan-publication.sql', import.meta.url), 'utf8'),
  );
  assert.equal(
    await scalar(db, "SELECT to_regclass('app_private.synthetic_floor_plan_inheritance')"),
    null,
  );
  await db.exec(
    await readFile(new URL('../proposals/floor-plan-successor.sql', import.meta.url), 'utf8'),
  );
}
const counts = (db) =>
  scalar(
    db,
    `SELECT jsonb_build_object('inheritance',(SELECT count(*) FROM app_private.synthetic_floor_plan_inheritance),'attachments',(SELECT count(*) FROM app_private.synthetic_floor_plan_attachments),'registrations',(SELECT count(*) FROM app_private.synthetic_floor_plan_registrations),'leases',(SELECT count(*) FROM app_private.synthetic_floor_plan_leases))`,
  );
const selected = (db, revision, version, actor = AGENT, tenant = T) =>
  asActor(db, tenant, actor, () =>
    scalar(db, 'SELECT app_api.read_synthetic_floor_plan_selection($1,$2,$3)', [
      LISTING,
      revision,
      version,
    ]),
  );
async function terminal(db, revision, version, approve = true) {
  await seedMedia(db, LISTING, revision);
  const pending = await asActor(db, T, AGENT, () =>
    scalar(db, 'SELECT app_api.submit_revision($1,$2,$3)', [LISTING, revision, version]),
  );
  return asActor(db, T, ADMIN, () =>
    scalar(db, "SELECT app_api.decide_revision($1,$2,$3,$4,'Synthetic test decision')", [
      LISTING,
      revision,
      pending,
      approve,
    ]),
  );
}
async function command(db, predecessor, operation = id(6000)) {
  const l = (
    await db.query('SELECT version::text FROM app_private.listings WHERE id=$1', [LISTING])
  ).rows[0];
  const r = (
    await db.query(
      'SELECT version::text,state FROM app_private.listing_revisions WHERE listing_id=$1 AND revision_no=$2',
      [LISTING, predecessor],
    )
  ).rows[0];
  return [LISTING, operation, l.version, predecessor, r.version, r.state, content];
}
const start = (db, args) =>
  asActor(db, T, AGENT, () =>
    scalar(db, 'SELECT app_api.start_listing_revision_v2($1,$2,$3,$4,$5,$6,$7)', args),
  );

test('successor freezes original source without copying upload, and exact replay/conflict cannot add mappings', async (t) => {
  const f = await setup(t);
  await install(f.db);
  const original = await f.save();
  await terminal(f.db, 1, original.resultVersion, false);
  const args = await command(f.db, 1),
    receipt = await start(f.db, args);
  assert.equal(receipt.decision.outcome, 'applied');
  const result = await selected(f.db, 2, '2');
  assert.deepEqual(result.source, original);
  assert.equal(result.source.command.revision, 1);
  assert.equal(result.source.actorId, AGENT);
  assert.equal(result.revision, 2);
  assert.deepEqual(await counts(f.db), {
    inheritance: 1,
    attachments: 1,
    registrations: 1,
    leases: 1,
  });
  assert.deepEqual(await start(f.db, args), receipt);
  await assert.rejects(
    () => start(f.db, [...args.slice(0, 6), { ...content, title: 'Changed replay' }]),
    (e) => e.code === '40001',
  );
  const stale = [...args];
  stale[1] = id(6001);
  assert.equal((await start(f.db, stale)).decision.outcome, 'conflict');
  assert.equal((await counts(f.db)).inheritance, 1);
  await assert.rejects(
    () => selected(f.db, 2, '1'),
    (e) => e.code === '40001',
  );
  for (const [actor, tenant] of [
    [id(12), T],
    [id(13), T],
    [ADMIN, OTHER],
  ])
    await assert.rejects(() => selected(f.db, 2, '2', actor, tenant));
  await assert.rejects(
    () =>
      asActor(f.db, T, AGENT, () =>
        f.db.query('SELECT * FROM app_private.synthetic_floor_plan_inheritance'),
      ),
    (e) => e.code === '42501',
  );
  await assert.rejects(() =>
    f.db.query('UPDATE app_private.synthetic_floor_plan_inheritance SET source_operation_id=NULL'),
  );
  await assert.rejects(() =>
    f.db.query('DELETE FROM app_private.synthetic_floor_plan_inheritance'),
  );
  assert.deepEqual(await f.original(), original);
});

test('explicit null overrides inherited plan and remains null in the next successor without historical resurrection', async (t) => {
  const f = await setup(t);
  await install(f.db);
  const original = await f.save();
  await terminal(f.db, 1, original.resultVersion, false);
  await start(f.db, await command(f.db, 1));
  const removed = await f.save(
    f.command({ operationId: id(6100), revision: 2, expectedVersion: '2', requestId: null }),
  );
  assert.equal((await selected(f.db, 2, removed.resultVersion)).source, null);
  assert.deepEqual((await selected(f.db, 1, '5')).source, original);
  await terminal(f.db, 2, removed.resultVersion, false);
  await start(f.db, await command(f.db, 2, id(6101)));
  assert.equal((await selected(f.db, 3, '2')).source, null);
  assert.deepEqual(await counts(f.db), {
    inheritance: 2,
    attachments: 2,
    registrations: 1,
    leases: 1,
  });
  const mappings = (
    await f.db.query(
      'SELECT source_operation_id FROM app_private.synthetic_floor_plan_inheritance ORDER BY revision_no',
    )
  ).rows;
  assert.equal(mappings[0].source_operation_id, original.command.operationId);
  assert.equal(mappings[1].source_operation_id, null);
});

test('failed inheritance capture rolls back successor allocation and identical retry captures exactly once', async (t) => {
  const f = await setup(t);
  await install(f.db);
  const original = await f.save();
  await terminal(f.db, 1, original.resultVersion, false);
  const args = await command(f.db, 1);
  await f.db.exec(
    "CREATE FUNCTION app_private.fail_inheritance_test() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Synthetic capture failure' USING ERRCODE='23514';END $$; CREATE TRIGGER fail_inheritance_test BEFORE INSERT ON app_private.synthetic_floor_plan_inheritance FOR EACH ROW EXECUTE FUNCTION app_private.fail_inheritance_test()",
  );
  await assert.rejects(
    () => start(f.db, args),
    (e) => e.code === '23514',
  );
  assert.equal(
    await scalar(
      f.db,
      'SELECT count(*)::integer FROM app_private.listing_revisions WHERE listing_id=$1',
      [LISTING],
    ),
    1,
  );
  assert.equal((await counts(f.db)).inheritance, 0);
  await f.db.exec(
    'DROP TRIGGER fail_inheritance_test ON app_private.synthetic_floor_plan_inheritance',
  );
  await start(f.db, args);
  assert.equal((await counts(f.db)).inheritance, 1);
  assert.deepEqual((await selected(f.db, 2, '2')).source, original);
});

test('adopted reference successor commits inheritance and explicit reference selection in the same transaction', async (t) => {
  const f = await setup(t);
  await install(f.db);
  const original = await f.save();
  await terminal(f.db, 1, original.resultVersion, false);
  for (const name of ['draft', 'catalogue-install', 'read', 'moderation', 'successor'])
    await f.db.exec(
      await readFile(
        new URL('../proposals/listing-reference-' + name + '.sql', import.meta.url),
        'utf8',
      ),
    );
  const catalogue = {
    policy: 'synthetic-reference-catalogue-v1',
    version: '1',
    country: 'KE',
    locations: [{ id: id(6200), kind: 'county', parentId: null, label: 'Synthetic county' }],
    amenities: [],
  };
  await f.db.query('SELECT app_private.install_synthetic_reference_catalogue(0,$1::jsonb)', [
    JSON.stringify(catalogue),
  ]);
  const args = await command(f.db, 1, id(6201)),
    selection = {
      catalogueVersion: '1',
      location: { countyId: id(6200), localityId: null, neighbourhoodId: null },
      amenityIds: [],
    };
  const run = (extra = selection) =>
    asActor(f.db, T, AGENT, () =>
      scalar(f.db, 'SELECT app_api.start_synthetic_reference_successor($1,$2,$3,$4,$5,$6,$7,$8)', [
        ...args,
        extra,
      ]),
    );
  await assert.rejects(() =>
    run({ ...selection, location: { ...selection.location, countyId: id(6999) } }),
  );
  assert.equal((await counts(f.db)).inheritance, 0);
  const receipt = await run();
  assert.equal(receipt.referenceDraft.revisionVersion, '3');
  assert.deepEqual((await selected(f.db, 2, '3')).source, original);
  assert.deepEqual(await run(), receipt);
  assert.equal((await counts(f.db)).inheritance, 1);
});

test('approved inherited source is frozen across another successor and removal approval captures null', async (t) => {
  const f = await setup(t);
  await install(f.db);
  const original = await f.save();
  await asActor(f.db, T, AGENT, () =>
    scalar(f.db, "SELECT app_api.confirm_availability($1,1,'available')", [LISTING]),
  );
  await terminal(f.db, 1, original.resultVersion, true);
  await start(f.db, await command(f.db, 1, id(6300)));
  await terminal(f.db, 2, '2', true);
  const publicRead = (rev) =>
    asActor(f.db, T, null, () =>
      scalar(f.db, 'SELECT app_api.read_synthetic_published_floor_plan($1,$2)', [LISTING, rev]),
    );
  const approved = await publicRead(2);
  assert.equal(approved.floorPlan.sha256, f.manifest.sha256);
  assert.equal(JSON.stringify(approved).includes(original.command.operationId), false);
  await assert.rejects(() => publicRead(1));
  await start(f.db, await command(f.db, 2, id(6301)));
  assert.deepEqual((await selected(f.db, 3, '2')).source, original);
  const removed = await f.save(
    f.command({ operationId: id(6302), revision: 3, expectedVersion: '2', requestId: null }),
  );
  assert.deepEqual(
    await publicRead(2),
    approved,
    'unapproved removal preserves prior public snapshot',
  );
  await terminal(f.db, 3, removed.resultVersion, true);
  assert.equal((await publicRead(3)).floorPlan, null);
  await start(f.db, await command(f.db, 3, id(6303)));
  assert.equal((await selected(f.db, 4, '2')).source, null);
  assert.deepEqual(await counts(f.db), {
    inheritance: 3,
    attachments: 2,
    registrations: 1,
    leases: 1,
  });
  const snapshots = (
    await f.db.query(
      'SELECT revision_no,operation_id FROM app_private.synthetic_approved_floor_plans ORDER BY revision_no',
    )
  ).rows;
  assert.deepEqual(
    snapshots.map((r) => r.operation_id),
    [original.command.operationId, original.command.operationId, null],
  );
});

test('selection rechecks current assignment and company without impersonating the original source creator', async (t) => {
  const f = await setup(t);
  await install(f.db);
  const original = await f.save();
  await terminal(f.db, 1, original.resultVersion, false);
  await start(f.db, await command(f.db, 1, id(6400)));
  await f.db.query('UPDATE app_private.listings SET assigned_agent_id=$1 WHERE id=$2', [
    id(12),
    LISTING,
  ]);
  await assert.rejects(() => selected(f.db, 2, '2', AGENT));
  assert.equal((await selected(f.db, 2, '2', id(12))).source.actorId, AGENT);
  await assert.rejects(
    () =>
      asActor(f.db, T, id(12), () =>
        scalar(f.db, 'SELECT app_private.selected_synthetic_floor_plan($1,$2,2)', [T, LISTING]),
      ),
    (e) => e.code === '42501',
  );
  await f.db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
  await assert.rejects(() => selected(f.db, 2, '2', id(12)));
  assert.deepEqual(await counts(f.db), {
    inheritance: 1,
    attachments: 1,
    registrations: 1,
    leases: 1,
  });
});
