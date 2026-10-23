import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import { seedGuardedListingDraft } from '../test-helpers/guarded-listing-fixture.mjs';
import { seedSyntheticSealedMedia } from '../test-helpers/synthetic-sealed-media.mjs';
import {
  normalizeStaffDraftContentV2,
  validateSyntheticReferenceDraftReceipt,
} from '../../packages/domain/dist/index.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('isolated reference candidate binds content, labels and receipt to one editorial version', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await applyTestMigrations(db);
  assert.equal(
    (
      await db.query(
        "SELECT to_regprocedure('app_api.save_synthetic_reference_draft(uuid,integer,bigint,uuid,jsonb,jsonb)') AS f",
      )
    ).rows[0].f,
    null,
  );
  await db.exec(
    await readFile(new URL('../proposals/listing-reference-draft.sql', import.meta.url), 'utf8'),
  );
  await db.exec(
    await readFile(
      new URL('../proposals/listing-reference-catalogue-install.sql', import.meta.url),
      'utf8',
    ),
  );
  for (const tenant of [1, 2]) {
    await db.query('INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,$2,$2)', [
      id(tenant),
      `synthetic-reference-${tenant}`,
    ]);
    for (const [user, role] of [
      [10, 'admin'],
      [11, 'agent'],
      [12, 'agent'],
      [13, 'customer'],
    ])
      await db.query(
        'INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',
        [id(tenant), id(user), role],
      );
  }
  await db.query('SELECT app_private.install_synthetic_reference_catalogue(0,$1::jsonb)', [
    JSON.stringify({
      policy: 'synthetic-reference-catalogue-v1',
      version: '1',
      country: 'KE',
      locations: [
        { id: id(200), kind: 'county', parentId: null, label: 'Synthetic county' },
        { id: id(201), kind: 'locality', parentId: id(200), label: 'Synthetic locality' },
        { id: id(202), kind: 'neighbourhood', parentId: id(201), label: 'Synthetic neighbourhood' },
        { id: id(203), kind: 'county', parentId: null, label: 'Other synthetic county' },
      ],
      amenities: [
        {
          id: id(210),
          code: 'synthetic-lift',
          label: 'Synthetic lift',
          propertyTypes: ['apartment'],
        },
        {
          id: id(211),
          code: 'synthetic-parking',
          label: 'Synthetic parking',
          propertyTypes: ['apartment'],
        },
      ],
    }),
  ]);
  async function as(tenant, user, work, rollback = false) {
    await db.exec('BEGIN; SET LOCAL ROLE api_runtime');
    try {
      await db.query(
        "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
        [id(tenant), id(user)],
      );
      const result = await work();
      await db.exec(rollback ? 'ROLLBACK' : 'COMMIT');
      return result;
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }
  }
  const originalCatalogue = (
    await db.query('SELECT payload FROM app_private.synthetic_reference_catalogues WHERE version=1')
  ).rows[0].payload;
  const content = normalizeStaffDraftContentV2({
    title: 'Synthetic combined draft',
    description: 'Synthetic candidate only.',
    purpose: 'rent',
    propertyType: 'apartment',
    amountMinor: 2000000,
    rentPeriod: 'month',
    bedrooms: 2,
    locality: 'Synthetic neighbourhood',
    pricing: { declaration: 'complete', charges: [] },
    location: {
      county: 'Synthetic county',
      town: 'Synthetic locality',
      area: 'Synthetic neighbourhood',
    },
  });
  const selection = {
    catalogueVersion: '1',
    location: { countyId: id(200), localityId: id(201), neighbourhoodId: id(202) },
    amenityIds: [id(211), id(210)],
  };
  for (const tenant of [1, 2])
    await as(tenant, 11, () =>
      seedGuardedListingDraft(db, {
        listingId: id(100),
        slug: 'synthetic-reference-draft',
        actorId: id(11),
        content,
      }),
    );
  for (let position = 0; position < 4; position++)
    await seedSyntheticSealedMedia(db, { tenantId: id(1), listingId: id(100), position });
  const save = async (operation = 300, version = '2', c = content, s = selection) =>
    (
      await db.query(
        'SELECT app_api.save_synthetic_reference_draft($1,1,$2,$3,$4::jsonb,$5::jsonb) AS r',
        [id(100), version, id(operation), JSON.stringify(c), JSON.stringify(s)],
      )
    ).rows[0].r;
  const read = async (operation = 300) =>
    (
      await db.query('SELECT app_api.read_synthetic_reference_draft($1,$2) AS r', [
        id(100),
        id(operation),
      ])
    ).rows[0].r;
  const state = async () =>
    (
      await db.query(
        'SELECT version,synthetic_reference_attributes AS attributes FROM app_private.listing_revisions WHERE tenant_id=$1 AND listing_id=$2',
        [id(1), id(100)],
      )
    ).rows[0];
  const denied = (work, code) => assert.rejects(work, (e) => e.code === code);

  await t.test('owner catalogue rejects wrong-level and incomplete parent edges', async () => {
    await denied(
      () =>
        db.query(
          "INSERT INTO app_private.synthetic_reference_locations VALUES(1,$1,'locality',$2,NULL,'Synthetic invalid')",
          [id(220), id(200)],
        ),
      '23514',
    );
    await denied(
      () =>
        db.query(
          "INSERT INTO app_private.synthetic_reference_locations VALUES(1,$1,'neighbourhood',$2,'locality','Synthetic wrong parent')",
          [id(220), id(200)],
        ),
      '23503',
    );
  });
  await t.test(
    'unadopted v2 lifecycle remains available; pending drafts cannot adopt or bypass stale review',
    async () => {
      for (let position = 0; position < 4; position++)
        await seedSyntheticSealedMedia(db, { tenantId: id(2), listingId: id(100), position });
      const saved = await as(2, 11, () =>
        db.query('SELECT app_api.save_draft_v2($1,1,2,$2::jsonb) AS version', [
          id(100),
          JSON.stringify(content),
        ]),
      );
      assert.equal(saved.rows[0].version, 3);
      const submitted = await as(2, 11, () =>
        db.query('SELECT app_api.submit_revision($1,1,3) AS version', [id(100)]),
      );
      assert.equal(submitted.rows[0].version, 4);
      await denied(() => as(2, 11, () => save(310, '4')), '23514');
      await denied(
        () =>
          as(2, 10, () =>
            db.query('SELECT app_api.decide_revision($1,1,3,false,$2)', [
              id(100),
              'Synthetic rejection',
            ]),
          ),
        '40001',
      );
    },
  );

  await t.test('one update, exact original replay and authorized GET recovery', async () => {
    const receipt = await as(1, 11, () => save());
    assert.deepEqual(
      validateSyntheticReferenceDraftReceipt(
        receipt,
        {
          policy: 'synthetic-reference-draft-v1',
          operationId: id(300),
          listingId: id(100),
          revision: 1,
          expectedVersion: '2',
          content,
          selection,
        },
        originalCatalogue,
        id(11),
      ),
      receipt,
    );
    assert.equal(receipt.revisionVersion, '3');
    assert.equal(receipt.attributes.location.locality.label, 'Synthetic locality');
    assert.equal(receipt.attributes.amenities[0].code, 'synthetic-lift');
    assert.deepEqual(await as(1, 11, () => save()), receipt);
    assert.deepEqual(await as(1, 11, () => read()), receipt);
    assert.equal((await state()).version, 3);
    await denied(
      () => as(1, 11, () => save(300, '2', { ...content, title: 'Changed replay' })),
      '40001',
    );
  });
  await t.test(
    'legacy edit and invisible submission fail closed after explicit adoption',
    async () => {
      await denied(
        () =>
          as(1, 11, () =>
            db.query('SELECT app_api.save_draft_v2($1,1,3,$2::jsonb)', [
              id(100),
              JSON.stringify({ ...content, propertyType: 'land', bedrooms: null }),
            ]),
          ),
        '23514',
      );
      await assert.rejects(
        () => as(1, 11, () => db.query('SELECT app_api.submit_revision($1,1,3)', [id(100)])),
        (e) => e.code === '23514' && e.message === 'Reference-aware review not enabled',
      );
      assert.equal((await state()).version, 3);
    },
  );
  await t.test(
    'stale core version, cross-parent selection, stale catalogue and incompatible amenities reject atomically',
    async () => {
      await denied(() => as(1, 11, () => save(301, '2')), '40001');
      await denied(
        () =>
          as(1, 11, () =>
            save(311, '3', { ...content, locality: 'Contradictory legacy locality' }),
          ),
        '23514',
      );
      await denied(() => as(1, 11, () => save(312, '9007199254740991')), '23514');
      await denied(
        () =>
          as(1, 11, () =>
            save(302, '3', content, {
              ...selection,
              location: { ...selection.location, countyId: id(203) },
            }),
          ),
        '23514',
      );
      await denied(
        () => as(1, 11, () => save(303, '3', content, { ...selection, catalogueVersion: '2' })),
        '40001',
      );
      await denied(
        () => as(1, 11, () => save(304, '3', { ...content, propertyType: 'land', bedrooms: null })),
        '23514',
      );
      await denied(
        () =>
          as(1, 11, () =>
            save(305, '3', content, { ...selection, amenityIds: [id(210), id(210)] }),
          ),
        '23514',
      );
      await denied(
        () =>
          as(1, 11, () =>
            save(306, '3', {
              ...content,
              location: { county: 'Guessed name', town: null, area: null },
            }),
          ),
        '23514',
      );
      assert.equal((await state()).version, 3);
    },
  );
  await t.test(
    'assignment, current role and tenant bind both write and receipt reads',
    async () => {
      await denied(() => as(1, 12, () => save(307, '3')), 'P0002');
      await denied(() => as(1, 13, () => save(307, '3')), '42501');
      await denied(() => as(1, 10, () => read()), 'P0002');
      await denied(() => as(2, 11, () => read()), 'P0002');
      await db.query(
        'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(11)],
      );
      await denied(() => as(1, 11, () => save()), '42501');
      await denied(() => as(1, 11, () => read()), '42501');
      await db.query(
        'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(11)],
      );
    },
  );
  await t.test(
    'runtime cannot edit catalogue, attributes or receipts directly; rollback retains no write',
    async () => {
      await denied(
        () =>
          as(1, 11, () =>
            db.query("UPDATE app_private.synthetic_reference_locations SET label='Forged'"),
          ),
        '42501',
      );
      await denied(
        () =>
          as(1, 11, () =>
            db.query(
              "UPDATE app_private.listing_revisions SET synthetic_reference_attributes='{}'",
            ),
          ),
        '42501',
      );
      await denied(
        () =>
          as(1, 11, () => db.query('DELETE FROM app_private.synthetic_reference_draft_receipts')),
        '42501',
      );
      await as(1, 11, () => save(308, '3'), true);
      assert.equal((await state()).version, 3);
      await denied(() => as(1, 11, () => read(308)), 'P0002');
      const receipt = await as(1, 11, () => save(308, '3'));
      assert.equal(receipt.revisionVersion, '4');
      await denied(
        () => db.query('DELETE FROM app_private.synthetic_reference_draft_receipts'),
        '23514',
      );
    },
  );
  await t.test(
    'historical receipts retain labels after future owner catalogue installation',
    async () => {
      await db.query('SELECT app_private.install_synthetic_reference_catalogue(1,$1::jsonb)', [
        JSON.stringify({
          policy: 'synthetic-reference-catalogue-v1',
          version: '2',
          country: 'KE',
          locations: [],
          amenities: [],
        }),
      ]);
      const receipt = await as(1, 11, () => read());
      assert.deepEqual(
        validateSyntheticReferenceDraftReceipt(
          receipt,
          {
            policy: 'synthetic-reference-draft-v1',
            operationId: id(300),
            listingId: id(100),
            revision: 1,
            expectedVersion: '2',
            content,
            selection,
          },
          originalCatalogue,
          id(11),
        ),
        receipt,
      );
      assert.equal(receipt.attributes.location.county.label, 'Synthetic county');
      assert.equal((await as(1, 11, () => save())).revisionVersion, '3');
      await denied(() => as(1, 11, () => save(309, '4')), '40001');
      const next = {
        catalogueVersion: '2',
        location: { countyId: null, localityId: null, neighbourhoodId: null },
        amenityIds: [],
      };
      const unknown = await as(1, 11, () =>
        save(
          309,
          '4',
          {
            ...content,
            propertyType: null,
            locality: null,
            location: { county: null, town: null, area: null },
          },
          next,
        ),
      );
      assert.equal(unknown.revisionVersion, '5');
      assert.deepEqual(unknown.attributes.location, {
        county: null,
        locality: null,
        neighbourhood: null,
      });
      assert.deepEqual(unknown.attributes.amenities, []);
    },
  );
});
