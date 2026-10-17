import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import { seedGuardedListingDraft } from '../test-helpers/guarded-listing-fixture.mjs';
import { normalizeStaffDraftContentV2 } from '../../packages/domain/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('import stock intersection is bounded, current-admin, company-isolated and read-only', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await applyTestMigrations(db);
  for (const tenant of [1, 2]) {
    await db.query('INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,$2,$2)', [
      id(tenant),
      `synthetic-import-${tenant}`,
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
  for (const [tenant, n, slug] of [
    [1, 100, 'shared-stock'],
    [1, 101, 'z-stock'],
    [1, 102, 'unrequested-stock'],
    [2, 103, 'other-only'],
    [2, 104, 'shared-stock'],
  ])
    await actor(tenant, 10, () =>
      seedGuardedListingDraft(db, {
        listingId: id(n),
        slug,
        actorId: id(10),
        content: normalizeStaffDraftContentV2({
          title: 'Synthetic import stock',
          pricing: { declaration: 'not_declared', charges: [] },
          location: { county: null, town: null, area: null },
        }),
      }),
    );
  const read = (slugs, tenant = 1, user = 10) =>
    actor(
      tenant,
      user,
      async () =>
        (await db.query('SELECT app_api.read_listing_import_stock($1::text[]) AS value', [slugs]))
          .rows[0].value,
    );
  const denied = (fn, code) => assert.rejects(fn, (error) => error.code === code);
  const snapshot = async () =>
    (
      await db.query(
        'SELECT (SELECT jsonb_agg(to_jsonb(l) ORDER BY tenant_id,id) FROM app_private.listings l) AS listings,(SELECT count(*)::text FROM app_private.audit_events) AS audits',
      )
    ).rows;
  await t.test(
    'returns only requested current-company matches in deterministic order with no writes',
    async () => {
      const before = await snapshot();
      assert.deepEqual(await read(['z-stock', 'other-only', 'shared-stock', 'new-stock']), [
        'shared-stock',
        'z-stock',
      ]);
      assert.deepEqual(await read(['new-stock']), []);
      assert.deepEqual(await read(['other-only', 'z-stock'], 2), ['other-only']);
      assert.deepEqual(await snapshot(), before);
    },
  );
  await t.test(
    'agent/customer/missing member cannot compare even malformed candidates',
    async () => {
      for (const user of [11, 12, 13]) await denied(() => read(null, 1, user), 'P0002');
    },
  );
  await t.test('revocation, disabled company and demotion apply to each new read', async () => {
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [id(1), id(10)],
    );
    await denied(() => read(['shared-stock']), 'P0002');
    await db.query(
      "UPDATE app_private.memberships SET active=true,revoked_at=null,role='agent' WHERE tenant_id=$1 AND user_id=$2",
      [id(1), id(10)],
    );
    await denied(() => read(['shared-stock']), 'P0002');
    await db.query(
      "UPDATE app_private.memberships SET role='admin' WHERE tenant_id=$1 AND user_id=$2",
      [id(1), id(10)],
    );
    await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [id(1)]);
    await denied(() => read(['shared-stock']), 'P0002');
    await db.query('UPDATE app_private.tenants SET enabled=true WHERE id=$1', [id(1)]);
    assert.deepEqual(await read(['shared-stock']), ['shared-stock']);
  });
  await t.test(
    'rejects empty, duplicate, malformed, multidimensional and oversized candidate arrays',
    async () => {
      for (const value of [
        null,
        [],
        ['same', 'same'],
        ['UPPER'],
        [''],
        [null],
        ['a'.repeat(161)],
        Array.from({ length: 101 }, (_, i) => `slug-${i}`),
        [['a', 'b']],
      ])
        await denied(() => read(value), '23514');
      await denied(
        () =>
          actor(1, 10, () =>
            db.query("SELECT app_api.read_listing_import_stock('[0:0]={a}'::text[])"),
          ),
        '23514',
      );
      assert.deepEqual(await read(Array.from({ length: 100 }, (_, i) => `slug-${i}`)), []);
    },
  );
  await t.test('PUBLIC and media coordinator have no execute grant; api runtime does', async () => {
    const rows = (
      await db.query(
        "SELECT has_function_privilege('api_runtime','app_api.read_listing_import_stock(text[])','EXECUTE') AS api,has_function_privilege('media_coordinator','app_api.read_listing_import_stock(text[])','EXECUTE') AS worker",
      )
    ).rows;
    assert.equal(rows[0].api, true);
    assert.equal(rows[0].worker, false);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM pg_proc p,aclexplode(p.proacl) a WHERE p.oid='app_api.read_listing_import_stock(text[])'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'",
        )
      ).rows[0].n,
      0,
    );
  });
});
