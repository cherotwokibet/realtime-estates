import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { publicSearchQuery } from '../dist/public-search.js';
const build = (text) => publicSearchQuery(new URLSearchParams(text));
test('public search refuses ambiguous, unknown, costly and incompatible query shapes', () => {
  for (const query of [
    'tenantId=x',
    'countyId=00000000-0000-4000-8000-000000000001',
    'limit=0',
    'limit=101',
    'limit=01',
    'limit=1&limit=2',
    'offset=-1',
    'offset=10001',
    'offset=1e2',
    'beds=101',
    'beds=00',
    'privateBaths=1.1',
    'sort=title%3BDELETE',
    'type=castle',
    'purpose=other',
    'period=hour',
    'sort=price_low',
    'purpose=rent&max=100',
    'purpose=rent&period=month&max=1.001',
    'purpose=sale&max=0',
    'purpose=rent&min=100',
    'purpose=sale&min=0',
    'purpose=sale&min=-1',
    'purpose=sale&min=1e2',
    'purpose=sale&min=1.001',
    'purpose=sale&min=100000000000000000000',
    'purpose=sale&min=1&min=2',
    'purpose=sale&min=20000.02&max=20000.01',
    'location=%00',
    'location=' + 'a'.repeat(161),
    'location=' + 'a'.repeat(8200),
    'area=%7B%22type%22%3A%22LineString%22%2C%22coordinates%22%3A%5B%5D%7D',
    'area=%7Bnot-json',
    'area=%7B%22type%22%3A%22Polygon%22%2C%22coordinates%22%3A%5B%5D%7D&area=%7B%7D',
  ])
    assert.throws(() => build(query), /supported public search/);
});

test('public search bounds draw-area results using the approved public coordinates', async () => {
  const polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [36.8, -1.3],
        [36.9, -1.3],
        [36.9, -1.2],
        [36.8, -1.2],
        [36.8, -1.3],
      ],
    ],
  };
  const query = build(`area=${encodeURIComponent(JSON.stringify(polygon))}&limit=10`);
  assert.match(query.sql, /longitude BETWEEN \$\d+::numeric AND \$\d+::numeric/);
  assert.match(query.sql, /latitude IS NOT NULL AND longitude IS NOT NULL/);
  assert.equal(query.values.length, 22);

  const db = new PGlite();
  try {
    await db.exec(`
      CREATE SCHEMA app_api;
      CREATE TABLE app_api.public_listings_v2 (
        listing_id uuid, slug text, revision_no integer, title text, description text,
        purpose text, property_type text, currency text, amount_minor bigint,
        rent_period text, bedrooms integer, private_bathrooms integer, shared_bathrooms integer,
        country text, locality text, public_precision text, latitude numeric, longitude numeric,
        photo_refs jsonb, pricing jsonb, location jsonb, approved_at timestamptz
      );
      INSERT INTO app_api.public_listings_v2 (
        listing_id, slug, revision_no, title, description, purpose, property_type,
        currency, amount_minor, country, locality, public_precision, latitude, longitude,
        photo_refs, pricing, location, approved_at
      ) VALUES
        ('00000000-0000-4000-8000-000000000001','inside',1,'Inside','', 'rent','apartment','KES',100000,'Kenya','Nairobi','area',-1.25,36.85,'[]','{}','{}','2026-01-01T00:00:00Z'),
        ('00000000-0000-4000-8000-000000000002','outside',1,'Outside','', 'rent','apartment','KES',100000,'Kenya','Nairobi','area',-1.25,36.95,'[]','{}','{}','2026-01-01T00:00:00Z'),
        ('00000000-0000-4000-8000-000000000003','boundary',1,'Boundary','', 'rent','apartment','KES',100000,'Kenya','Nairobi','area',-1.25,36.8,'[]','{}','{}','2026-01-01T00:00:00Z'),
      ('00000000-0000-4000-8000-000000000004','unknown',1,'Unknown','', 'rent','apartment','KES',100000,'Kenya','Nairobi','area',NULL,NULL,'[]','{}','{}','2026-01-01T00:00:00Z');
      CREATE VIEW app_api.public_listings_reference_v3 AS
        SELECT p.*, '{}'::jsonb AS reference_attributes, '1'::text AS reference_revision_version,
          '{}'::jsonb AS reference_catalogue FROM app_api.public_listings_v2 p;
    `);
    for (const reference of [false, true]) {
      const search = publicSearchQuery(
        new URLSearchParams(`area=${encodeURIComponent(JSON.stringify(polygon))}&limit=10`),
        reference,
      );
      const result = await db.query(search.sql, search.values);
      assert.deepEqual(result.rows[0].items.map((item) => item.slug).sort(), [
        'boundary',
        'inside',
      ]);
      assert.equal(result.rows[0].total, '2');
    }
  } finally {
    await db.close();
  }
});
test('all caller text is bound and SQL ordering remains a fixed whitelist', () => {
  const attack = "%' OR true --_!";
  const q = publicSearchQuery(
    new URLSearchParams({
      location: attack,
      purpose: 'rent',
      period: 'month',
      min: '20000.00',
      max: '20000.01',
      beds: '0',
      privateBaths: '0',
      sharedBaths: '0',
      limit: '40',
      offset: '100',
      sort: 'price_high',
    }),
  );
  assert.ok(!q.sql.includes(attack));
  assert.ok(q.values.includes("%!%' OR true --!_!!%"));
  assert.ok(q.values.includes('2000001'));
  assert.ok(q.values.includes('2000000'));
  assert.ok(q.sql.includes('amount_minor >= '));
  assert.ok(q.sql.includes('amount_minor <= '));
  assert.ok(q.sql.includes('AS MATERIALIZED'));
  assert.ok(q.sql.includes('count(*)::text'));
  assert.ok(q.sql.includes('"amountMinor"::bigint DESC,id ASC'));
  assert.ok(Object.isFrozen(q));
  assert.ok(Object.isFrozen(q.values));
  assert.equal(q.limit, 40);
  assert.equal(q.offset, 100);
});

test('both public search versions retain inclusive exact minimum and equality ranges', () => {
  for (const reference of [false, true])
    for (const mode of [{}, { minMode: '' }]) {
      const query = publicSearchQuery(
        new URLSearchParams({ purpose: 'sale', min: '20000.01', max: '20000.01', ...mode }),
        reference,
      );
      assert.equal(query.values.filter((value) => value === '2000001').length, 2);
      assert.match(query.sql, /amount_minor >= \$\d+::bigint/);
      assert.match(query.sql, /amount_minor <= \$\d+::bigint/);
      assert.ok(
        query.sql.includes(reference ? 'public_listings_reference_v3' : 'public_listings_v2'),
      );
    }
});

test('both search versions bind strict Over without changing exact cents or upper-bound semantics', () => {
  for (const reference of [false, true])
    for (const basis of [{ purpose: 'sale' }, { purpose: 'rent', period: 'month' }]) {
      const query = publicSearchQuery(
        new URLSearchParams({ ...basis, min: '20000.01', minMode: 'over', max: '20000.01' }),
        reference,
      );
      assert.equal(query.values.filter((value) => value === '2000001').length, 2);
      assert.match(query.sql, /amount_minor > \$\d+::bigint/);
      assert.doesNotMatch(query.sql, /amount_minor >=/);
      assert.match(query.sql, /amount_minor <= \$\d+::bigint/);
      assert.ok(!query.values.includes('over'));
      const largest = publicSearchQuery(
        new URLSearchParams({ ...basis, min: '90071992547409.91', minMode: 'over' }),
        reference,
      );
      assert.ok(largest.values.includes('9007199254740991'));
      assert.match(largest.sql, /amount_minor > \$\d+::bigint/);
    }
});

test('both search versions keep exact bedroom counts and bind an explicit inclusive group', () => {
  for (const reference of [false, true])
    for (const beds of ['0', '6', '7', '8', '9', '10', '100'])
      for (const mode of [{}, { bedsMode: '' }, { bedsMode: 'at_least' }]) {
        const query = publicSearchQuery(new URLSearchParams({ beds, ...mode }), reference);
        assert.match(query.sql, mode.bedsMode ? /bedrooms >= \$\d+/ : /bedrooms = \$\d+/);
        assert.ok(query.values.includes(Number(beds)));
        assert.ok(!query.values.includes('at_least'));
        assert.doesNotMatch(query.sql, /COALESCE\(bedrooms/);
      }
});

test('both search versions reject malformed grouped bedroom modes and missing counts', () => {
  for (const reference of [false, true])
    for (const query of [
      'bedsMode=at_least',
      'beds=&bedsMode=at_least',
      'beds=7&bedsMode=over',
      'beds=7&bedsMode=exact',
      'beds=7&bedsMode=At_least',
      'beds=7&bedsMode=%20at_least',
      'beds=7&bedsMode=at_least%20',
      'beds=7&bedsMode=%20',
      'beds=7&bedsMode=at_least&bedsMode=at_least',
      'beds=7&bedsMode=&bedsMode=',
      'beds=7&beds=8&bedsMode=at_least',
      'beds=7%2B&bedsMode=at_least',
      'beds=07&bedsMode=at_least',
      'beds=-1&bedsMode=at_least',
      'beds=1.1&bedsMode=at_least',
      'beds=1e1&bedsMode=at_least',
      'beds=101&bedsMode=at_least',
    ])
      assert.throws(
        () => publicSearchQuery(new URLSearchParams(query), reference),
        /supported public search/,
        query,
      );
});

test('both search versions refuse malformed, repeated and unbounded Over modes', () => {
  for (const reference of [false, true])
    for (const query of [
      'minMode=over',
      'purpose=sale&minMode=over',
      'purpose=sale&min=&minMode=over',
      'purpose=sale&max=100&minMode=over',
      'purpose=sale&min=0&minMode=over',
      'purpose=sale&min=1.001&minMode=over',
      'purpose=sale&min=90071992547409.92&minMode=over',
      'purpose=sale&min=1&minMode=Over',
      'purpose=sale&min=1&minMode=inclusive',
      'purpose=sale&min=1&minMode=%20',
      'purpose=sale&min=1&minMode=over&minMode=over',
      'purpose=sale&min=1&minMode=&minMode=over',
      'purpose=sale&min=1&minMode=&minMode=',
      'purpose=rent&min=1&minMode=over',
      'period=month&min=1&minMode=over',
      'purpose=sale&min=2&max=1&minMode=over',
    ])
      assert.throws(
        () => publicSearchQuery(new URLSearchParams(query), reference),
        /supported public search/,
        query,
      );
});
