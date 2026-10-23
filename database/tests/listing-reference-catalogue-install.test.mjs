import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import { validateListingReferenceCatalogue } from '../../packages/domain/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fixture = (version = '2') => ({
  policy: 'synthetic-reference-catalogue-v1',
  version,
  country: 'KE',
  locations: [
    { id: id(3), kind: 'neighbourhood', parentId: id(2), label: 'Synthetic area' },
    { id: id(2), kind: 'locality', parentId: id(1), label: 'Synthetic town' },
    { id: id(1), kind: 'county', parentId: null, label: 'Synthetic county' },
  ],
  amenities: [
    {
      id: id(4),
      code: 'synthetic-lift',
      label: 'Synthetic lift',
      propertyTypes: ['apartment', 'commercial'],
    },
  ],
});
test('isolated catalogue installation validates facts and atomically activates explicit versions', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await applyTestMigrations(db);
  for (const file of ['listing-reference-draft.sql', 'listing-reference-catalogue-install.sql'])
    await db.exec(await readFile(new URL('../proposals/' + file, import.meta.url), 'utf8'));
  const install = async (expected, input) =>
    (
      await db.query(
        'SELECT app_private.install_synthetic_reference_catalogue($1,$2::jsonb) AS version',
        [expected, JSON.stringify(input)],
      )
    ).rows[0].version;
  const current = async () =>
    (await db.query('SELECT version FROM app_private.synthetic_reference_catalogue_current'))
      .rows[0].version;
  const denied = (work, code) => assert.rejects(work, (e) => e.code === code);
  await t.test(
    'empty catalogue can activate; unordered valid hierarchy is accepted by both domain and SQL',
    async () => {
      const empty = { ...fixture('1'), locations: [], amenities: [] };
      validateListingReferenceCatalogue(empty);
      assert.equal(await install(0, empty), 1);
      assert.equal(await current(), 1);
      validateListingReferenceCatalogue(fixture());
      assert.equal(await install(1, fixture()), 2);
      assert.equal(await current(), 2);
      assert.equal(
        (await db.query('SELECT count(*) AS n FROM app_private.synthetic_reference_locations'))
          .rows[0].n,
        3,
      );
    },
  );
  await t.test(
    'same payload replay never reactivates an older installation; conflicts and stale CAS do not write',
    async () => {
      const original = { ...fixture('1'), locations: [], amenities: [] };
      assert.equal(await install(0, original), 1);
      assert.equal(await current(), 2);
      await denied(() => install(2, { ...fixture(), amenities: [] }), '40001');
      await denied(() => install(0, fixture('3')), '40001');
      assert.equal(
        (await db.query('SELECT count(*) AS n FROM app_private.synthetic_reference_catalogues'))
          .rows[0].n,
        2,
      );
    },
  );
  await t.test(
    'domain and SQL reject malformed labels, IDs, sets, edges and metadata before activation',
    async () => {
      const cases = [];
      const edit = (mutate) => {
        const c = fixture('3');
        mutate(c);
        cases.push(c);
      };
      edit((c) => (c.locations[0].label = 'e\u0301'));
      edit((c) => (c.amenities[0].label = 'e\u0301'));
      edit((c) => (c.locations[0].label = ' Synthetic area'));
      edit((c) => (c.locations[0].id = c.locations[1].id));
      edit((c) => (c.amenities[0].id = c.locations[0].id));
      edit((c) => (c.amenities[0].propertyTypes = ['apartment', 'apartment']));
      edit((c) => (c.amenities[0].propertyTypes = [null]));
      edit((c) => (c.amenities[0].propertyTypes = []));
      edit((c) => (c.locations[1].parentId = id(3)));
      edit((c) => (c.locations[1].parentId = null));
      edit((c) => (c.locations[2].parentId = id(3)));
      edit((c) => (c.locations[0].parentId = id(99)));
      edit((c) => c.amenities.push({ ...c.amenities[0], id: id(5) }));
      edit((c) => (c.locations[0].extra = true));
      edit((c) => (c.policy = 'official'));
      edit((c) => (c.version = '03'));
      edit((c) => (c.country = 'UG'));
      edit((c) => (c.locations[0].id += '\n'));
      edit((c) => (c.amenities[0].code += '\n'));
      edit((c) => (c.version += '\n'));
      edit((c) => (c.locations[0].label = 'Synthetic\u0085area'));
      for (const c of cases) {
        assert.throws(() => validateListingReferenceCatalogue(c));
        await assert.rejects(() => install(2, c));
        assert.equal(await current(), 2);
      }
      assert.equal(
        (await db.query('SELECT count(*) AS n FROM app_private.synthetic_reference_catalogues'))
          .rows[0].n,
        2,
      );
    },
  );
  await t.test(
    'catalogue and amenity cardinality bounds reject without retaining partial rows',
    async () => {
      const locations = fixture('3');
      locations.locations = Array.from({ length: 5001 }, (_, n) => ({
        id: id(100 + n),
        kind: 'county',
        parentId: null,
        label: 'Synthetic county',
      }));
      const amenities = fixture('3');
      amenities.amenities = Array.from({ length: 101 }, (_, n) => ({
        id: id(100 + n),
        code: 'synthetic-' + n,
        label: 'Synthetic amenity',
        propertyTypes: ['land'],
      }));
      for (const c of [locations, amenities]) {
        assert.throws(() => validateListingReferenceCatalogue(c));
        await denied(() => install(2, c), '23514');
      }
      assert.equal(await current(), 2);
    },
  );
  await t.test(
    'runtime cannot ingest or change activation; owner transaction rollback restores old version',
    async () => {
      await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
      await denied(() => install(2, fixture('3')), '42501');
      await db.exec('ROLLBACK');
      await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
      await denied(
        () => db.query('UPDATE app_private.synthetic_reference_catalogue_current SET version=1'),
        '42501',
      );
      await db.exec('ROLLBACK');
      await db.exec('BEGIN;SET LOCAL ROLE realtor_owner');
      assert.equal(await install(2, fixture('3')), 3);
      await db.exec('ROLLBACK');
      assert.equal(await current(), 2);
      assert.equal(
        (
          await db.query(
            'SELECT count(*) AS n FROM app_private.synthetic_reference_catalogues WHERE version=3',
          )
        ).rows[0].n,
        0,
      );
      await denied(
        () => db.query('DELETE FROM app_private.synthetic_reference_catalogues'),
        '23514',
      );
      await denied(
        () => db.query("UPDATE app_private.synthetic_reference_locations SET label='Rewritten'"),
        '23514',
      );
      await denied(
        () => db.query('DELETE FROM app_private.synthetic_reference_amenities'),
        '23514',
      );
    },
  );
});
