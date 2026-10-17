import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import {
  seedGuardedListingDraft,
  seedGuardedListingSuccessor,
} from '../test-helpers/guarded-listing-fixture.mjs';
import { seedSyntheticSealedMedia } from '../test-helpers/synthetic-sealed-media.mjs';
import { normalizeStaffDraftContentV2 } from '../../packages/domain/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const content = (patch) =>
  normalizeStaffDraftContentV2({
    title: 'Synthetic monthly apartment',
    description: 'A fictional apartment for duplicate checks.',
    purpose: 'rent',
    propertyType: 'apartment',
    amountMinor: 2000000,
    rentPeriod: 'month',
    bedrooms: 1,
    privateBathrooms: 1,
    sharedBathrooms: null,
    country: 'KE',
    locality: 'Synthetic Nairobi',
    publicPrecision: 'area',
    latitude: null,
    longitude: null,
    privateAddress: 'PRIVATE FICTIONAL ADDRESS',
    pricing: { declaration: 'not_declared', charges: [] },
    location: { county: null, town: null, area: null },
    ...patch,
  });
test('duplicate hints bind current admin, company and latest versions without mutation', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await applyTestMigrations(db);
  for (const tenant of [1, 2]) {
    await db.query('INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,$2,$2)', [
      id(tenant),
      `synthetic-duplicate-${tenant}`,
    ]);
    for (const [user, role] of [
      [10, 'admin'],
      [11, 'agent'],
      [12, 'customer'],
    ])
      await db.query(
        'INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',
        [id(tenant), id(user), role],
      );
  }
  async function actor(tenant, user, work) {
    await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
    try {
      await db.query(
        "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
        [id(tenant), id(user)],
      );
      const result = await work();
      await db.exec('COMMIT');
      return result;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  }
  for (const [tenant, n, patch] of [
    [1, 100, {}],
    [
      1,
      101,
      {
        title: 'SYNTHETIC   MONTHLY apartment',
        locality: 'synthetic\tNairobi',
        amountMinor: 3000000,
      },
    ],
    [1, 102, { bedrooms: 2 }],
    [1, 103, {}],
    [1, 104, { locality: 'Different locality' }],
    [1, 105, { purpose: 'sale', rentPeriod: null }],
    [1, 106, { propertyType: 'studio', bedrooms: 0 }],
    [1, 107, { title: 'Synthetic monthly apartment!' }],
    [1, 108, { title: null }],
    [1, 109, { locality: null }],
    [2, 200, {}],
  ])
    await actor(tenant, 10, () =>
      seedGuardedListingDraft(db, {
        listingId: id(n),
        slug: `synthetic-dupe-${n}`,
        actorId: id(10),
        content: content(patch),
      }),
    );
  const read = ({
    listing = 100,
    lv = '1',
    rev = 1,
    rv = '2',
    limit = 20,
    tenant = 1,
    user = 10,
  } = {}) =>
    actor(
      tenant,
      user,
      async () =>
        (
          await db.query(
            'SELECT app_api.read_listing_duplicate_candidates($1,$2,$3,$4,$5) AS value',
            [id(listing), lv, rev, rv, limit],
          )
        ).rows[0].value,
    );
  const denied = (fn, code) => assert.rejects(fn, (e) => e.code === code);
  const snapshot = async () =>
    (
      await db.query(
        'SELECT (SELECT jsonb_agg(to_jsonb(l) ORDER BY tenant_id,id) FROM app_private.listings l) AS listings,(SELECT count(*)::text FROM app_private.audit_events) AS audits',
      )
    ).rows;
  await t.test(
    'returns only conservative same-company current-work hints with bounded lookahead and no private facts',
    async () => {
      const before = await snapshot(),
        p = await read({ limit: 2 });
      assert.equal(p.policy, 'exact-current-work-v1');
      assert.equal(p.comparison, 'compared');
      assert.equal(p.hasMore, true);
      assert.deepEqual(
        p.matches.map((x) => x.listingId),
        [id(101), id(102)],
      );
      assert.equal(p.matches[0].revisionVersion, '2');
      assert.equal(p.matches[0].listingVersion, '1');
      assert.doesNotMatch(
        JSON.stringify(p),
        /PRIVATE|privateAddress|latitude|amountMinor|2000000|3000000/,
      );
      assert.equal(
        p.matches.every((x) => Object.keys(x).length === 8),
        true,
      );
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(
        (await read()).matches.map((x) => x.listingId),
        [id(101), id(102), id(103)],
      );
    },
  );
  await t.test(
    'missing comparison facts are explicit, not a claim that no duplicate exists',
    async () => {
      for (const listing of [108, 109]) {
        const p = await read({ listing });
        assert.equal(p.comparison, 'insufficient_facts');
        assert.deepEqual(p.matches, []);
        assert.equal(p.hasMore, false);
      }
    },
  );
  await t.test(
    'nonadmins/foreign target/revoked membership/disabled company denied before stale currency',
    async () => {
      for (const user of [11, 12, 13]) await denied(() => read({ user, lv: '99' }), 'P0002');
      await denied(() => read({ tenant: 2, lv: '99' }), 'P0002');
      await db.query(
        'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(10)],
      );
      await denied(() => read({ lv: '99' }), 'P0002');
      await db.query(
        'UPDATE app_private.memberships SET active=true,revoked_at=null WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(10)],
      );
      await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [id(1)]);
      await denied(() => read(), 'P0002');
      await db.query('UPDATE app_private.tenants SET enabled=true WHERE id=$1', [id(1)]);
      await db.query(
        "UPDATE app_private.memberships SET role='agent' WHERE tenant_id=$1 AND user_id=$2",
        [id(1), id(10)],
      );
      await denied(() => read(), 'P0002');
      await db.query(
        "UPDATE app_private.memberships SET role='admin' WHERE tenant_id=$1 AND user_id=$2",
        [id(1), id(10)],
      );
      assert.equal((await read()).matches.length, 3);
    },
  );
  await t.test('exact target currency and input bounds are required', async () => {
    for (const patch of [{ lv: '2' }, { rv: '3' }, { rev: 2 }])
      await denied(() => read(patch), '40001');
    for (const patch of [
      { lv: '0' },
      { rv: '0' },
      { rv: '9007199254740992' },
      { rev: 0 },
      { limit: 0 },
      { limit: 26 },
      { limit: null },
    ])
      await denied(() => read(patch), '23514');
    await denied(() => read({ listing: 999 }), 'P0002');
  });
  await t.test(
    'latest guarded successor supersedes old matching content without erasing history',
    async () => {
      for (let position = 0; position < 4; position++)
        await seedSyntheticSealedMedia(db, {
          tenantId: id(1),
          listingId: id(103),
          revision: 1,
          position,
          mediaId: id(500 + position),
        });
      await actor(1, 10, () => db.query('SELECT app_api.submit_revision($1,1,2)', [id(103)]));
      await actor(1, 10, () =>
        db.query("SELECT app_api.decide_revision($1,1,3,false,'Synthetic distinct replacement')", [
          id(103),
        ]),
      );
      await actor(1, 10, () =>
        seedGuardedListingSuccessor(db, {
          actorId: id(10),
          listingId: id(103),
          expectedListingVersion: '1',
          predecessor: { revision: 1, version: '4', state: 'rejected' },
          content: content({ title: 'A different current apartment' }),
        }),
      );
      const p = await read({ limit: 2 });
      assert.equal(p.hasMore, false);
      assert.deepEqual(
        p.matches.map((x) => x.listingId),
        [id(101), id(102)],
      );
      assert.equal(
        (
          await db.query(
            'SELECT title FROM app_private.listing_revisions WHERE listing_id=$1 AND revision_no=1',
            [id(103)],
          )
        ).rows[0].title,
        'Synthetic monthly apartment',
      );
    },
  );
  await t.test(
    'PUBLIC/media coordinator/runtime private helper privileges remain isolated',
    async () => {
      const row = (
        await db.query(
          "SELECT has_function_privilege('api_runtime','app_api.read_listing_duplicate_candidates(uuid,bigint,integer,bigint,integer)','EXECUTE') AS api,has_function_privilege('media_coordinator','app_api.read_listing_duplicate_candidates(uuid,bigint,integer,bigint,integer)','EXECUTE') AS worker,has_function_privilege('api_runtime','app_private.listing_duplicate_key(text)','EXECUTE') AS helper",
        )
      ).rows[0];
      assert.deepEqual(row, { api: true, worker: false, helper: false });
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM pg_proc p,aclexplode(p.proacl) a WHERE p.oid='app_api.read_listing_duplicate_candidates(uuid,bigint,integer,bigint,integer)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'",
          )
        ).rows[0].n,
        0,
      );
    },
  );
});
