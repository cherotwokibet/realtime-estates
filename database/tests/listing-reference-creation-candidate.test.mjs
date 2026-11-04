import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import { normalizeStaffDraftContentV2 } from '../../packages/domain/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('isolated reference creation composes allocation and selection without partial stock or synthetic publication', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await applyTestMigrations(db);
  assert.equal(
    (
      await db.query(
        "SELECT to_regprocedure('app_api.create_synthetic_reference_listing(uuid,uuid,text,jsonb,jsonb)') AS f",
      )
    ).rows[0].f,
    null,
  );
  for (const name of [
    'listing-reference-draft.sql',
    'listing-reference-catalogue-install.sql',
    'listing-reference-read.sql',
    'listing-reference-moderation.sql',
    'listing-reference-creation.sql',
  ])
    await db.exec(await readFile(new URL('../proposals/' + name, import.meta.url), 'utf8'));
  for (const tenant of [1, 2]) {
    await db.query('INSERT INTO app_private.tenants(id,slug,display_name)VALUES($1,$2,$2)', [
      id(tenant),
      'synthetic-creation-' + tenant,
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
      { id: id(200), kind: 'county', parentId: null, label: 'Synthetic creation county' },
    ],
    amenities: [
      {
        id: id(210),
        code: 'synthetic-lift',
        label: 'Synthetic creation lift',
        propertyTypes: ['studio'],
      },
      {
        id: id(211),
        code: 'synthetic-land-access',
        label: 'Synthetic land access',
        propertyTypes: ['land'],
      },
    ],
  };
  await db.query('SELECT app_private.install_synthetic_reference_catalogue(0,$1::jsonb)', [
    JSON.stringify(catalogue),
  ]);
  const content = normalizeStaffDraftContentV2({
    title: 'Synthetic reference creation',
    description: 'Independently authored synthetic stock.',
    purpose: 'rent',
    propertyType: 'studio',
    currency: 'KES',
    amountMinor: 2000001,
    rentPeriod: 'month',
    bedrooms: 0,
    privateBathrooms: 1,
    sharedBathrooms: null,
    country: 'KE',
    locality: 'Synthetic creation county',
    location: { county: 'Synthetic creation county', town: null, area: null },
    publicPrecision: 'area',
    latitude: null,
    longitude: null,
    privateAddress: 'PRIVATE SYNTHETIC CREATION',
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
        "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),set_config('realtor.correlation_id','synthetic-reference-allocation',true)",
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
  const create = (
    listing = 100,
    operation = 1000,
    chosen = selection,
    user = 11,
    slug = 'synthetic-reference-' + listing,
  ) =>
    as(
      user,
      async () =>
        (
          await db.query(
            'SELECT app_api.create_synthetic_reference_listing($1,$2,$3,$4::jsonb,$5::jsonb) AS r',
            [id(listing), id(operation), slug, JSON.stringify(content), JSON.stringify(chosen)],
          )
        ).rows[0].r,
    );
  const read = (user = 11, tenant = 1) =>
    as(
      user,
      async () =>
        (
          await db.query('SELECT app_api.read_synthetic_reference_creation($1,$2) AS r', [
            id(100),
            id(1000),
          ])
        ).rows[0].r,
      tenant,
    );
  const counts = async () =>
    (
      await db.query(
        'SELECT (SELECT count(*) FROM app_private.listings)::integer AS listings,(SELECT count(*) FROM app_private.listing_revisions)::integer AS revisions,(SELECT count(*) FROM app_private.listing_creation_requests)::integer AS requests,(SELECT count(*) FROM app_private.synthetic_reference_draft_receipts)::integer AS drafts,(SELECT count(*) FROM app_private.synthetic_reference_creation_receipts)::integer AS receipts',
      )
    ).rows[0];
  const fail = (work, code) => assert.rejects(work, (e) => e.code === code);
  let original;
  await t.test(
    'new stock starts as one assigned draft with an immutable composed receipt and exact saved references',
    async () => {
      original = await create();
      assert.equal(original.policy, 'synthetic-reference-creation-v1');
      assert.equal(original.creation.outcome, 'created');
      assert.equal(original.creation.actorId, id(11));
      assert.deepEqual(original.creation.result, {
        listingVersion: '1',
        revision: 1,
        revisionVersion: '2',
      });
      assert.equal(original.referenceDraft.revisionVersion, '3');
      assert.equal(original.referenceDraft.expectedVersion, '2');
      assert.equal(
        original.referenceDraft.attributes.amenities[0].label,
        'Synthetic creation lift',
      );
      assert.deepEqual(original.referenceDraft.content, content);
      const auditRows = async () =>
        (
          await db.query(
            'SELECT action,tenant_id,actor_id,object_type,object_id,object_version::text,correlation_id,summary FROM app_private.audit_events WHERE object_id=$1 AND action IN ($2,$3) ORDER BY id',
            [id(100), 'listing.created', 'revision.synthetic_references_saved'],
          )
        ).rows;
      const facts = {
        tenant_id: id(1),
        actor_id: id(11),
        object_type: 'listing',
        object_id: id(100),
        correlation_id: 'synthetic-reference-allocation',
      };
      const expectedAudit = [
        { ...facts, action: 'listing.created', object_version: '1', summary: {} },
        {
          ...facts,
          action: 'revision.synthetic_references_saved',
          object_version: '3',
          summary: { revision: 1 },
        },
      ];
      assert.deepEqual(await auditRows(), expectedAudit);
      assert.deepEqual(await read(), original);
      assert.deepEqual(await create(), original);
      assert.deepEqual(await auditRows(), expectedAudit);
      assert.deepEqual(await counts(), {
        listings: 1,
        revisions: 1,
        requests: 1,
        drafts: 1,
        receipts: 1,
      });
      const row = (
        await db.query(
          'SELECT state,version FROM app_private.listing_revisions WHERE listing_id=$1',
          [id(100)],
        )
      ).rows[0];
      assert.deepEqual(row, { state: 'draft', version: 3 });
    },
  );
  await t.test(
    'unknown references, mismatched disclosure and incompatible amenities roll back allocation and every receipt',
    async () => {
      for (const patch of [
        { ...selection, location: { ...selection.location, countyId: id(999) } },
        { ...selection, catalogueVersion: '2' },
        { ...selection, amenityIds: [id(999)] },
        { ...selection, amenityIds: [id(211)] },
        { ...selection, location: { countyId: null, localityId: null, neighbourhoodId: null } },
      ]) {
        const before = await counts();
        await assert.rejects(() => create(101, 1001, patch));
        assert.deepEqual(await counts(), before);
      }
    },
  );
  await t.test(
    'duplicate target ID or slug cannot leave a v2-only refusal or alter existing stock',
    async () => {
      const before = await counts();
      await fail(() => create(100, 1002), '40001');
      await fail(() => create(102, 1003, selection, 11, 'synthetic-reference-100'), '40001');
      assert.deepEqual(await counts(), before);
      assert.deepEqual(await read(), original);
    },
  );
  await t.test('runtime cannot forge, rewrite or delete private composed receipts', async () => {
    await fail(
      () =>
        as(11, () => db.query('SELECT * FROM app_private.synthetic_reference_creation_receipts')),
      '42501',
    );
    await fail(
      () => as(11, () => db.query('DELETE FROM app_private.synthetic_reference_creation_receipts')),
      '42501',
    );
    await fail(
      () =>
        db.query('UPDATE app_private.synthetic_reference_creation_receipts SET slug=$1', [
          'forged',
        ]),
      '23514',
    );
  });
  await t.test(
    'current requester role, assignment and company gate original reads and matching replay',
    async () => {
      const before = await counts();
      await fail(() => create(104, 1005, selection, 13), '42501');
      assert.deepEqual(await counts(), before);
      await fail(() => read(12), 'P0002');
      await fail(() => read(13), '42501');
      await fail(() => read(11, 2), 'P0002');
      await fail(() => create(100, 1000, selection, 12), 'P0002');
      await db.query(
        'UPDATE app_private.memberships SET active=false,revoked_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(11)],
      );
      await fail(() => read(), '42501');
      await fail(() => create(), '42501');
      await db.query(
        'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(11)],
      );
      await db.query(
        'UPDATE app_private.listings SET assigned_agent_id=$1 WHERE tenant_id=$2 AND id=$3',
        [id(12), id(1), id(100)],
      );
      await fail(() => read(), 'P0002');
      await fail(() => create(), 'P0002');
      await db.query(
        'UPDATE app_private.listings SET assigned_agent_id=$1 WHERE tenant_id=$2 AND id=$3',
        [id(11), id(1), id(100)],
      );
      assert.deepEqual(await read(), original);
    },
  );
  await t.test(
    'legacy two-step originals cannot fabricate a composed recovery receipt',
    async () => {
      await as(11, () =>
        db.query('SELECT app_api.create_listing_draft_v2($1,$2,$3,$4::jsonb)', [
          id(103),
          id(1004),
          'synthetic-legacy-103',
          JSON.stringify(content),
        ]),
      );
      await as(11, () =>
        db.query('SELECT app_api.save_synthetic_reference_draft($1,1,2,$2,$3::jsonb,$4::jsonb)', [
          id(103),
          id(1004),
          JSON.stringify(content),
          JSON.stringify(selection),
        ]),
      );
      await fail(
        () =>
          as(11, () =>
            db.query('SELECT app_api.read_synthetic_reference_creation($1,$2)', [
              id(103),
              id(1004),
            ]),
          ),
        'P0002',
      );
    },
  );
  await t.test(
    'historical replay survives catalogue activation and later draft edits without re-saving or replacing the original',
    async () => {
      await db.query('SELECT app_private.install_synthetic_reference_catalogue(1,$1::jsonb)', [
        JSON.stringify({
          ...catalogue,
          version: '2',
          locations: [{ ...catalogue.locations[0], label: 'Synthetic newer county' }],
          amenities: [{ ...catalogue.amenities[0], label: 'Synthetic newer lift' }],
        }),
      ]);
      assert.deepEqual(await create(), original);
      assert.deepEqual(await read(), original);
      await fail(() => create(100, 1000, { ...selection, amenityIds: [] }), '40001');
      const nextContent = {
        ...content,
        title: 'Synthetic later edit',
        locality: 'Synthetic newer county',
        location: { county: 'Synthetic newer county', town: null, area: null },
      };
      await as(11, () =>
        db.query('SELECT app_api.save_synthetic_reference_draft($1,1,3,$2,$3::jsonb,$4::jsonb)', [
          id(100),
          id(1010),
          JSON.stringify(nextContent),
          JSON.stringify({ ...selection, catalogueVersion: '2' }),
        ]),
      );
      assert.deepEqual(await read(), original);
      assert.deepEqual(await create(), original);
      assert.equal(
        (
          await db.query('SELECT version FROM app_private.listing_revisions WHERE listing_id=$1', [
            id(100),
          ])
        ).rows[0].version,
        4,
      );
    },
  );
  await t.test(
    'creation alone supplies no photos, availability confirmation or publication',
    async () => {
      assert.equal(
        (await db.query('SELECT count(*)::integer AS n FROM app_api.public_listings_reference_v3'))
          .rows[0].n,
        0,
      );
      assert.equal(
        (await db.query('SELECT count(*)::integer AS n FROM app_private.revision_media')).rows[0].n,
        0,
      );
    },
  );
});
