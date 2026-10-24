import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import { seedGuardedListingDraft } from '../test-helpers/guarded-listing-fixture.mjs';
import { seedSyntheticSealedMedia } from '../test-helpers/synthetic-sealed-media.mjs';
import { normalizeStaffDraftContentV2 } from '../../packages/domain/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('isolated reference successor atomically adopts explicit references and preserves originals', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const fail = (work, code) => assert.rejects(work, (e) => e.code === code);
  await applyTestMigrations(db);
  assert.equal(
    await scalar(
      "SELECT to_regprocedure('app_api.start_synthetic_reference_successor(uuid,uuid,bigint,integer,bigint,text,jsonb,jsonb)')",
    ),
    null,
  );
  assert.equal(
    await scalar("SELECT to_regclass('app_private.synthetic_reference_successor_receipts')"),
    null,
  );
  for (const name of ['draft', 'catalogue-install', 'read', 'moderation', 'creation', 'successor'])
    await db.exec(
      await readFile(
        new URL(`../proposals/listing-reference-${name}.sql`, import.meta.url),
        'utf8',
      ),
    );
  for (const tenant of [1, 2]) {
    await db.query('INSERT INTO app_private.tenants(id,slug,display_name)VALUES($1,$2,$2)', [
      id(tenant),
      'synthetic-successor-' + tenant,
    ]);
    for (const [user, role] of [
      [10, 'admin'],
      [11, 'agent'],
      [12, 'agent'],
      [13, 'customer'],
    ])
      await db.query(
        'INSERT INTO app_private.memberships(tenant_id,user_id,role)VALUES($1,$2,$3)',
        [id(tenant), id(user), role],
      );
  }
  const catalogue = {
    policy: 'synthetic-reference-catalogue-v1',
    version: '1',
    country: 'KE',
    locations: [
      { id: id(200), kind: 'county', parentId: null, label: 'Synthetic successor county' },
    ],
    amenities: [
      { id: id(210), code: 'synthetic-lift', label: 'Synthetic lift', propertyTypes: ['studio'] },
      { id: id(211), code: 'synthetic-land', label: 'Synthetic land', propertyTypes: ['land'] },
    ],
  };
  await db.query('SELECT app_private.install_synthetic_reference_catalogue(0,$1::jsonb)', [
    JSON.stringify(catalogue),
  ]);
  const content = normalizeStaffDraftContentV2({
    title: 'Synthetic successor studio',
    description: 'Independent synthetic successor.',
    purpose: 'rent',
    propertyType: 'studio',
    currency: 'KES',
    amountMinor: 2000001,
    rentPeriod: 'month',
    bedrooms: 0,
    privateBathrooms: 1,
    sharedBathrooms: null,
    country: 'KE',
    locality: 'Synthetic successor county',
    location: { county: 'Synthetic successor county', town: null, area: null },
    publicPrecision: 'area',
    latitude: null,
    longitude: null,
    privateAddress: 'PRIVATE SYNTHETIC SUCCESSOR',
    pricing: { declaration: 'complete', charges: [] },
  });
  const selection = {
    catalogueVersion: '1',
    location: { countyId: id(200), localityId: null, neighbourhoodId: null },
    amenityIds: [id(210)],
  };
  async function as(user, work, tenant = 1) {
    await db.exec('BEGIN; SET LOCAL ROLE api_runtime');
    try {
      await db.query(
        "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
        [id(tenant), id(user)],
      );
      const out = await work();
      await db.exec('COMMIT');
      return out;
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }
  }
  // Real guarded creation/submit/decision; only sealed media history is a privileged
  // disposable SQL fixture. No image bytes/decoder/attachment or device claim.
  async function terminal(listing, approved = false) {
    await as(11, () =>
      seedGuardedListingDraft(db, {
        listingId: id(listing),
        slug: 'synthetic-successor-' + listing,
        actorId: id(11),
        content,
      }),
    );
    for (let position = 0; position < 4; position++)
      await seedSyntheticSealedMedia(db, {
        tenantId: id(1),
        listingId: id(listing),
        revision: 1,
        position,
        mediaId: id(listing * 10 + position),
      });
    if (approved)
      await as(11, () =>
        db.query("SELECT app_api.confirm_availability($1,1,'available')", [id(listing)]),
      );
    await as(11, () => db.query('SELECT app_api.submit_revision($1,1,2)', [id(listing)]));
    await as(10, () =>
      db.query("SELECT app_api.decide_revision($1,1,3,$2,'Synthetic decision')", [
        id(listing),
        approved,
      ]),
    );
    const row = (
      await db.query('SELECT version::text AS version FROM app_private.listings WHERE id=$1', [
        id(listing),
      ])
    ).rows[0];
    return {
      listing,
      operation: listing + 10000,
      listingVersion: row.version,
      predecessor: 1,
      version: '4',
      state: approved ? 'approved' : 'rejected',
      content,
      selection,
    };
  }
  const args = (q) => [
    id(q.listing),
    id(q.operation),
    q.listingVersion,
    q.predecessor,
    q.version,
    q.state,
    JSON.stringify(q.content),
    JSON.stringify(q.selection),
  ];
  const start = (q, user = 11, tenant = 1) =>
    as(
      user,
      () =>
        scalar(
          'SELECT app_api.start_synthetic_reference_successor($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)',
          args(q),
        ),
      tenant,
    );
  const read = (q, user = 11, tenant = 1) =>
    as(
      user,
      () =>
        scalar('SELECT app_api.read_synthetic_reference_successor($1,$2)', [
          id(q.listing),
          id(q.operation),
        ]),
      tenant,
    );
  const snapshot = async () =>
    (
      await db.query(`SELECT
    (SELECT count(*) FROM app_private.listing_revisions)::int AS revisions,
    (SELECT count(*) FROM app_private.listing_successor_requests)::int AS requests,
    (SELECT count(*) FROM app_private.listing_successor_results)::int AS results,
    (SELECT count(*) FROM app_private.synthetic_reference_draft_receipts)::int AS drafts,
    (SELECT count(*) FROM app_private.synthetic_reference_successor_receipts)::int AS receipts,
    (SELECT count(*) FROM app_private.audit_events)::int AS audits,
    (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM app_private.listings l) AS listings`)
    ).rows[0];
  const q = await terminal(100),
    approved = await terminal(101, true),
    legacy = await terminal(102);
  let original;
  await t.test(
    'version-limit refusal and a failure after reference adoption leave no partial completion',
    async () => {
      const boundary = await terminal(103);
      // Disposable privileged boundary fixture only: reaching this counter through
      // quadrillions of edits is impractical. Re-enable the normal trigger immediately.
      await db.exec('ALTER TABLE app_private.listings DISABLE TRIGGER touch_listing');
      try {
        await db.query('UPDATE app_private.listings SET version=9007199254740991 WHERE id=$1', [
          id(boundary.listing),
        ]);
      } finally {
        await db.exec('ALTER TABLE app_private.listings ENABLE TRIGGER touch_listing');
      }
      const before = await snapshot();
      await fail(() => start({ ...boundary, listingVersion: '9007199254740991' }), '40001');
      assert.deepEqual(await snapshot(), before);
      await db.exec(
        "CREATE FUNCTION app_private.synthetic_fail_reference_successor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic completion failure' USING ERRCODE='23514'; END $$; CREATE TRIGGER synthetic_fail_reference_successor BEFORE INSERT ON app_private.synthetic_reference_successor_receipts FOR EACH ROW EXECUTE FUNCTION app_private.synthetic_fail_reference_successor()",
      );
      try {
        await fail(() => start(q), '23514');
        assert.deepEqual(await snapshot(), before);
      } finally {
        await db.exec(
          'DROP TRIGGER synthetic_fail_reference_successor ON app_private.synthetic_reference_successor_receipts; DROP FUNCTION app_private.synthetic_fail_reference_successor()',
        );
      }
    },
  );
  await t.test(
    'invalid references, disclosure and stale predecessor roll back revision, listing version, audits and all originals',
    async () => {
      for (const patch of [
        { selection: { ...selection, catalogueVersion: '2' } },
        { selection: { ...selection, amenityIds: [id(999)] } },
        { selection: { ...selection, amenityIds: [id(211)] } },
        { selection: { ...selection, location: { ...selection.location, countyId: id(999) } } },
        { content: { ...content, locality: 'Wrong disclosure' } },
        { listingVersion: '99' },
        { version: '3' },
        { state: 'approved' },
      ]) {
        const before = await snapshot();
        await assert.rejects(() => start({ ...q, ...patch }));
        assert.deepEqual(await snapshot(), before);
      }
      await fail(() => read(q), 'P0002');
    },
  );
  await t.test(
    'rejected predecessor allocates exactly one reference-aware revision with an empty gallery',
    async () => {
      const before = await scalar(
        'SELECT to_jsonb(r) FROM app_private.listing_revisions r WHERE listing_id=$1 AND revision_no=1',
        [id(q.listing)],
      );
      original = await start(q);
      assert.equal(original.policy, 'synthetic-reference-successor-v1');
      assert.deepEqual(original.successor.decision, {
        outcome: 'applied',
        reason: null,
        result: { listingVersion: '2', revision: 2, revisionVersion: '2' },
      });
      assert.equal(original.referenceDraft.expectedVersion, '2');
      assert.equal(original.referenceDraft.revisionVersion, '3');
      assert.equal(original.referenceDraft.revision, 2);
      assert.equal(original.referenceDraft.actorId, id(11));
      assert.deepEqual(original.referenceDraft.content, content);
      assert.deepEqual(original.referenceDraft.selection, selection);
      assert.deepEqual(await read(q), original);
      assert.equal(
        await scalar(
          'SELECT count(*)::int FROM app_private.revision_media WHERE listing_id=$1 AND revision_no=2',
          [id(q.listing)],
        ),
        0,
      );
      assert.deepEqual(
        await scalar(
          'SELECT to_jsonb(r) FROM app_private.listing_revisions r WHERE listing_id=$1 AND revision_no=1',
          [id(q.listing)],
        ),
        before,
      );
      const beforeReplay = await snapshot();
      assert.deepEqual(await start(q), original);
      assert.deepEqual(await snapshot(), beforeReplay);
      for (const patch of [
        { content: { ...content, title: 'Changed' } },
        { selection: { ...selection, amenityIds: [] } },
        { predecessor: 2 },
        { listingVersion: '2' },
        { version: '5' },
        { state: 'approved' },
      ])
        await fail(() => start({ ...q, ...patch }), '40001');
      const beforeConflict = await snapshot();
      await fail(() => start({ ...q, operation: 9999 }), '40001');
      assert.deepEqual(await snapshot(), beforeConflict);
    },
  );
  await t.test(
    'approved public pointer and predecessor remain unchanged by successor allocation',
    async () => {
      const before = await scalar('SELECT to_jsonb(l) FROM app_private.listings l WHERE id=$1', [
        id(approved.listing),
      ]);
      assert.equal(before.published_revision_no, 1);
      await start(approved);
      const after = await scalar('SELECT to_jsonb(l) FROM app_private.listings l WHERE id=$1', [
        id(approved.listing),
      ]);
      assert.equal(after.published_revision_no, 1);
      assert.equal(after.publication_status, before.publication_status);
      assert.equal(
        await scalar(
          'SELECT count(*)::int FROM app_private.revision_media WHERE listing_id=$1 AND revision_no=2',
          [id(approved.listing)],
        ),
        0,
      );
    },
  );
  await t.test(
    'current role, original actor, tenant and assignment gate reads and exact replay',
    async () => {
      for (const [user, tenant, code] of [
        [12, 1, 'P0002'],
        [10, 1, 'P0002'],
        [13, 1, '42501'],
        [11, 2, 'P0002'],
      ]) {
        await fail(() => read(q, user, tenant), code);
        await fail(() => start(q, user, tenant), code);
      }
      await db.query(
        'UPDATE app_private.memberships SET active=false,revoked_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(11)],
      );
      await fail(() => read(q), '42501');
      await fail(() => start(q), '42501');
      await db.query(
        'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(11)],
      );
      await db.query('UPDATE app_private.listings SET assigned_agent_id=$1 WHERE id=$2', [
        id(12),
        id(q.listing),
      ]);
      await fail(() => read(q), 'P0002');
      await fail(() => start(q), 'P0002');
      await db.query('UPDATE app_private.listings SET assigned_agent_id=$1 WHERE id=$2', [
        id(11),
        id(q.listing),
      ]);
      assert.deepEqual(await read(q), original);
    },
  );
  await t.test(
    'independent two-step originals cannot fabricate recovery; explicit matching composition may mark completion',
    async () => {
      await as(11, () =>
        scalar(
          'SELECT app_api.start_listing_revision_v2($1,$2,$3,$4,$5,$6,$7::jsonb)',
          args(legacy).slice(0, 7),
        ),
      );
      await as(11, () =>
        scalar('SELECT app_api.save_synthetic_reference_draft($1,2,2,$2,$3::jsonb,$4::jsonb)', [
          id(legacy.listing),
          id(legacy.operation),
          JSON.stringify(content),
          JSON.stringify(selection),
        ]),
      );
      await fail(() => read(legacy), 'P0002');
      const marked = await start(legacy);
      assert.equal(marked.referenceDraft.revisionVersion, '3');
      assert.deepEqual(await read(legacy), marked);
    },
  );
  await t.test(
    'private marker is FORCE RLS, immutable and inaccessible for runtime DML',
    async () => {
      assert.deepEqual(
        (
          await db.query(
            "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='app_private.synthetic_reference_successor_receipts'::regclass",
          )
        ).rows[0],
        { relrowsecurity: true, relforcerowsecurity: true },
      );
      for (const sql of ['SELECT * FROM', 'DELETE FROM', 'UPDATE']) {
        const statement =
          sql === 'UPDATE'
            ? "UPDATE app_private.synthetic_reference_successor_receipts SET predecessor_state='rejected'"
            : sql + ' app_private.synthetic_reference_successor_receipts';
        await fail(() => as(11, () => db.query(statement)), '42501');
      }
      await fail(
        () =>
          db.query(
            "UPDATE app_private.synthetic_reference_successor_receipts SET predecessor_state='rejected'",
          ),
        '23514',
      );
      await fail(
        () => db.query('DELETE FROM app_private.synthetic_reference_successor_receipts'),
        '23514',
      );
    },
  );
  await t.test(
    'historical original survives activation and later edits without saving or copying current state',
    async () => {
      await db.query('SELECT app_private.install_synthetic_reference_catalogue(1,$1::jsonb)', [
        JSON.stringify({ ...catalogue, version: '2' }),
      ]);
      await as(11, () =>
        scalar('SELECT app_api.save_synthetic_reference_draft($1,2,3,$2,$3::jsonb,$4::jsonb)', [
          id(q.listing),
          id(20000),
          JSON.stringify({ ...content, title: 'Later intentional edit' }),
          JSON.stringify({ ...selection, catalogueVersion: '2' }),
        ]),
      );
      const before = await snapshot();
      assert.deepEqual(await read(q), original);
      assert.deepEqual(await start(q), original);
      assert.deepEqual(await snapshot(), before);
      assert.equal(
        await scalar(
          'SELECT version::text FROM app_private.listing_revisions WHERE listing_id=$1 AND revision_no=2',
          [id(q.listing)],
        ),
        '4',
      );
    },
  );
});
