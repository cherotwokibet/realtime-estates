import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import { seedSyntheticSealedMedia } from '../test-helpers/synthetic-sealed-media.mjs';
import {
  normalizeStaffDraftContentV2,
  validateListingSuccessorReceipt,
} from '../../packages/domain/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1),
  A = id(10),
  U = id(11),
  C = id(13),
  L = id(100);
const full = normalizeStaffDraftContentV2({
  title: 'Synthetic candidate predecessor',
  description: 'Independently written candidate fixture.',
  purpose: 'rent',
  propertyType: 'studio',
  currency: 'KES',
  amountMinor: 2000000,
  rentPeriod: 'month',
  bedrooms: 0,
  privateBathrooms: 1,
  sharedBathrooms: null,
  country: 'KE',
  locality: 'Synthetic Nairobi area',
  publicPrecision: 'area',
  latitude: null,
  longitude: null,
  privateAddress: null,
  pricing: { declaration: 'complete', charges: [] },
  location: { county: 'Nairobi', town: null, area: 'Synthetic area' },
});
const partial = normalizeStaffDraftContentV2({
  title: 'Explicit candidate successor',
  pricing: { declaration: 'not_declared', charges: [] },
  location: { county: null, town: null, area: null },
});
async function actor(db, user, run) {
  await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');
  try {
    await db.query(
      "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
      [T, user],
    );
    const result = await run();
    await db.exec('COMMIT');
    return result;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}
const scalar = async (db, sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const create = (db, listing, operation, content = partial) =>
  actor(db, U, () =>
    scalar(db, 'SELECT app_api.create_listing_draft_v2($1,$2,$3,$4::jsonb)', [
      listing,
      operation,
      'synthetic-candidate-' + listing.slice(-3),
      JSON.stringify(content),
    ]),
  );
const command = (operationId) => ({
  listingId: L,
  operationId,
  expectedListingVersion: '1',
  predecessor: { revision: 1, version: '4', state: 'rejected' },
  content: partial,
});
const start = (db, c) =>
  actor(db, U, () =>
    scalar(db, 'SELECT app_api.start_listing_revision_v2($1,$2,$3,$4,$5,$6,$7::jsonb)', [
      c.listingId,
      c.operationId,
      c.expectedListingVersion,
      c.predecessor.revision,
      c.predecessor.version,
      c.predecessor.state,
      JSON.stringify(c.content),
    ]),
  );
async function fixture() {
  const db = new PGlite();
  await applyTestMigrations(db, { through: '0023_listing_successor.sql' });
  await db.query(
    "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'synthetic-boundary-candidate','Synthetic boundary candidate')",
    [T],
  );
  for (const [user, role] of [
    [A, 'admin'],
    [U, 'agent'],
    [C, 'customer'],
  ])
    await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
      T,
      user,
      role,
    ]);
  await create(db, L, id(900), full);
  for (let position = 0; position < 4; position++)
    await seedSyntheticSealedMedia(db, {
      tenantId: T,
      listingId: L,
      revision: 1,
      position,
      mediaId: id(500 + position),
    });
  await actor(db, U, () => db.query('SELECT app_api.submit_revision($1,1,2)', [L]));
  await actor(db, A, () =>
    db.query("SELECT app_api.decide_revision($1,1,3,false,'Synthetic changes required')", [L]),
  );
  await db.exec(
    await readFile(
      new URL('../migrations/0024_guarded_draft_allocation.sql', import.meta.url),
      'utf8',
    ),
  );
  return db;
}
test('candidate SQL denies direct zero allocation and private helpers without weakening positive edits', async () => {
  const db = await fixture();
  try {
    const count = await scalar(db, 'SELECT count(*)::integer FROM app_private.listing_revisions');
    await actor(db, U, () =>
      db.query("SELECT app_api.create_listing($1,'synthetic-bare-legacy')", [id(102)]),
    );
    for (const fn of ['save_draft', 'save_draft_v2']) {
      await assert.rejects(
        () =>
          actor(db, U, () =>
            db.query(`SELECT app_api.${fn}($1,1,0,$2::jsonb)`, [
              id(102),
              JSON.stringify(fn === 'save_draft_v2' ? partial : {}),
            ]),
          ),
        (e) => e.code === '40001',
      );
      await assert.rejects(
        () =>
          actor(db, U, () =>
            db.query(`SELECT app_api.${fn}($1,2,0,$2::jsonb)`, [
              L,
              JSON.stringify(fn === 'save_draft_v2' ? partial : {}),
            ]),
          ),
        (e) => e.code === '40001',
      );
    }
    for (const fn of ['save_draft_internal_v1', 'save_draft_internal_v2']) {
      assert.equal(
        await scalar(db, "SELECT has_function_privilege('api_runtime',$1,'EXECUTE')", [
          `app_private.${fn}(uuid,integer,bigint,jsonb)`,
        ]),
        false,
      );
      await assert.rejects(
        () =>
          actor(db, U, () =>
            db.query(`SELECT app_private.${fn}($1,2,0,$2::jsonb)`, [L, JSON.stringify(partial)]),
          ),
        (e) => e.code === '42501',
      );
    }
    const helpers = (
      await db.query(
        "SELECT p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app_private' AND p.proname IN ('save_draft_internal_v1','save_draft_internal_v2')",
      )
    ).rows;
    assert.equal(helpers.length, 2);
    assert.ok(
      helpers.every(
        (row) =>
          row.prosecdef &&
          row.owner === 'realtor_owner' &&
          row.proconfig.includes('search_path=pg_catalog'),
      ),
    );
    assert.equal(
      await scalar(db, 'SELECT count(*)::integer FROM app_private.listing_revisions'),
      count,
    );
    const created = await create(db, id(101), id(901));
    assert.equal(created.outcome, 'created');
    const { pricing, location, ...v1 } = partial;
    assert.equal(
      await actor(db, U, () =>
        scalar(db, 'SELECT app_api.save_draft($1,1,2,$2::jsonb)', [id(101), JSON.stringify(v1)]),
      ),
      3,
    );
    assert.equal(
      await actor(db, U, () =>
        scalar(db, 'SELECT app_api.save_draft_v2($1,1,3,$2::jsonb)', [
          id(101),
          JSON.stringify(partial),
        ]),
      ),
      4,
    );
    await assert.rejects(
      () =>
        actor(db, C, () =>
          db.query('SELECT app_api.save_draft_v2($1,1,4,$2::jsonb)', [
            id(101),
            JSON.stringify(partial),
          ]),
        ),
      (e) => e.code === '42501',
    );
  } finally {
    await db.close();
  }
});
test('candidate guarded successor still allocates once, preserves predecessor and returns original after later edits', async () => {
  const db = await fixture();
  try {
    const before = (
      await db.query(
        'SELECT * FROM app_private.listing_revisions WHERE listing_id=$1 AND revision_no=1',
        [L],
      )
    ).rows[0];
    const c = command(id(902));
    const receipt = await start(db, c);
    assert.equal(validateListingSuccessorReceipt(receipt, c, U).decision.outcome, 'applied');
    assert.equal(receipt.decision.result.revision, 2);
    assert.equal(
      await scalar(
        db,
        'SELECT count(*)::integer FROM app_private.revision_media WHERE listing_id=$1 AND revision_no=2',
        [L],
      ),
      0,
    );
    const audit = await scalar(db, 'SELECT count(*)::integer FROM app_private.audit_events');
    assert.deepEqual(await start(db, c), receipt);
    assert.equal(await scalar(db, 'SELECT count(*)::integer FROM app_private.audit_events'), audit);
    await actor(db, U, () =>
      db.query('SELECT app_api.save_draft_v2($1,2,2,$2::jsonb)', [
        L,
        JSON.stringify({ ...partial, title: 'Explicit later edit' }),
      ]),
    );
    assert.deepEqual(await start(db, c), receipt);
    assert.deepEqual(
      (
        await db.query(
          'SELECT * FROM app_private.listing_revisions WHERE listing_id=$1 AND revision_no=1',
          [L],
        )
      ).rows[0],
      before,
    );
    assert.equal(
      await scalar(
        db,
        'SELECT count(*)::integer FROM app_private.listing_revisions WHERE listing_id=$1',
        [L],
      ),
      2,
    );
  } finally {
    await db.close();
  }
});
test('candidate unknown allocation failure rolls back request,result,revision and audit together', async () => {
  const db = await fixture();
  try {
    const audit = await scalar(db, 'SELECT count(*)::integer FROM app_private.audit_events');
    await db.exec(
      "CREATE FUNCTION app_private.fail_candidate_allocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.revision_no=2 THEN RAISE EXCEPTION 'Synthetic candidate rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_candidate BEFORE INSERT ON app_private.listing_revisions FOR EACH ROW EXECUTE FUNCTION app_private.fail_candidate_allocation();",
    );
    await assert.rejects(() => start(db, command(id(903))));
    for (const table of ['listing_successor_requests', 'listing_successor_results'])
      assert.equal(await scalar(db, `SELECT count(*)::integer FROM app_private.${table}`), 0);
    assert.equal(
      await scalar(
        db,
        'SELECT count(*)::integer FROM app_private.listing_revisions WHERE listing_id=$1',
        [L],
      ),
      1,
    );
    assert.equal(await scalar(db, 'SELECT count(*)::integer FROM app_private.audit_events'), audit);
  } finally {
    await db.close();
  }
});
