import test from 'node:test';
import assert from 'node:assert/strict';
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
  ])
    assert.throws(() => build(query), /supported public search/);
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
  for (const reference of [false, true]) {
    const query = publicSearchQuery(
      new URLSearchParams({ purpose: 'sale', min: '20000.01', max: '20000.01' }),
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
