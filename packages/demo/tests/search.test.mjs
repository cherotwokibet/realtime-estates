import test from 'node:test';
import assert from 'node:assert/strict';
import { searchCatalogue } from '../dist/search.js';
import { propertiesForCompany, getDemoBrand, resolveDemoTenantSlug } from '../dist/index.js';
test('search applies all URL filters together and inclusive exact maximum', () => {
  assert.deepEqual(
    searchCatalogue('realtime-estates', {
      location: 'ruaka',
      purpose: 'rent',
      type: 'studio',
      max: '18000',
    }).items.map((p) => p.id),
    ['demo-ruaka-1'],
  );
  assert.equal(
    searchCatalogue('realtime-estates', { location: 'Ruaka', max: '17999.99' }).items.length,
    0,
  );
});
test('duplicate known URL filters fail closed instead of silently dropping constraints', () => {
  for (const key of ['location', 'purpose', 'type', 'min', 'minMode', 'max', 'beds', 'bedsMode']) {
    const result = searchCatalogue('realtime-estates', {
      [key]: key === 'max' ? ['18000', '1e4'] : ['first', 'second'],
    });
    assert.ok(result.error, key);
    assert.equal(result.items.length, 0, key);
  }
  const oneArray = searchCatalogue('realtime-estates', { max: ['18000'] });
  assert.ok(oneArray.error);
  assert.equal(oneArray.items.length, 0);
});

test('inclusive minimum and maximum compose and invalid ranges never broaden demo results', () => {
  const exact = searchCatalogue('realtime-estates', { min: '18000.00', max: '18000.00' });
  assert.deepEqual(
    exact.items.map((item) => item.id),
    ['demo-ruaka-1'],
  );
  assert.equal(exact.minText, '18000.00');
  assert.equal(
    searchCatalogue('realtime-estates', { min: '18000.01', max: '18000.01' }).items.length,
    0,
  );
  for (const min of ['0', '-1', '18.001', '1e4', 'NaN', '100000000000000000000']) {
    const result = searchCatalogue('realtime-estates', { min });
    assert.ok(result.error, min);
    assert.equal(result.items.length, 0);
  }
  const reversed = searchCatalogue('realtime-estates', { min: '18000.01', max: '18000' });
  assert.match(reversed.error, /Minimum price/);
  assert.equal(reversed.items.length, 0);
  assert.equal(searchCatalogue('realtime-estates', {}).minText, '');
});
test('Over excludes the exact lower price, includes the next cent and keeps the maximum inclusive', () => {
  const exact = { location: 'Ruaka', purpose: 'rent', min: '18000', max: '18000.00' };
  assert.deepEqual(
    searchCatalogue('realtime-estates', exact).items.map((item) => item.id),
    ['demo-ruaka-1'],
  );
  const strict = searchCatalogue('realtime-estates', { ...exact, minMode: 'over' });
  assert.equal(strict.error, null);
  assert.equal(strict.minMode, 'over');
  assert.deepEqual(strict.items, []);
  assert.deepEqual(
    searchCatalogue('realtime-estates', { ...exact, min: '17999.99', minMode: 'over' }).items.map(
      (item) => item.id,
    ),
    ['demo-ruaka-1'],
  );
  assert.equal(
    searchCatalogue('realtime-estates', { ...exact, min: '18000.01', minMode: 'over' }).items
      .length,
    0,
  );
});
test('minimum comparison rejects unsupported or repeated values and Over without a positive minimum', () => {
  for (const minMode of [
    'inclusive',
    'OVER',
    ' ',
    ' over ',
    ['over'],
    ['over', ''],
    ['over', 'over'],
  ]) {
    const result = searchCatalogue('realtime-estates', { min: '18000', minMode });
    assert.ok(result.error, String(minMode));
    assert.deepEqual(result.items, []);
  }
  const unsupported = searchCatalogue('realtime-estates', { min: '18000', minMode: ' unknown ' });
  assert.equal(unsupported.minMode, ' unknown ');
  for (const min of [undefined, '', ' ', '0', '-1']) {
    const result = searchCatalogue('realtime-estates', { min, minMode: 'over' });
    assert.ok(result.error, String(min));
    assert.deepEqual(result.items, []);
  }
  for (const minMode of [undefined, '']) {
    const result = searchCatalogue('realtime-estates', { min: '', minMode });
    assert.equal(result.error, null);
    assert.equal(result.items.length, 4);
    assert.equal(result.minMode, '');
  }
});
test('configured tenants reject inherited object keys and unknown names', () => {
  for (const slug of ['constructor', 'toString', '__proto__', 'unknown', '', null, 12]) {
    assert.throws(() => resolveDemoTenantSlug(slug), String(slug));
    assert.throws(() => getDemoBrand(slug), String(slug));
  }
  assert.equal(resolveDemoTenantSlug(undefined), 'realtime-estates');
  assert.equal(getDemoBrand('sample-homes').primary, '#10465b');
  assert.equal(getDemoBrand('sample-homes').initials, 'SH');
  assert.throws(() => searchCatalogue('constructor', {}));
});
test('explicit At least bedroom groups compose with exact filters while the default remains exact', () => {
  assert.deepEqual(
    searchCatalogue('realtime-estates', { beds: '2' }).items.map((item) => item.id),
    ['demo-kilimani-1'],
  );
  assert.deepEqual(
    searchCatalogue('realtime-estates', { beds: '2', bedsMode: 'at_least' }).items.map(
      (item) => item.id,
    ),
    ['demo-kilimani-1', 'demo-kitengela-1'],
  );
  assert.deepEqual(
    searchCatalogue('realtime-estates', {
      beds: '2',
      bedsMode: 'at_least',
      purpose: 'rent',
    }).items.map((item) => item.id),
    ['demo-kilimani-1'],
  );
  assert.deepEqual(
    searchCatalogue('realtime-estates', { beds: '0', type: 'studio' }).items.map((item) => item.id),
    ['demo-ruaka-1'],
  );
  assert.equal(
    searchCatalogue('realtime-estates', { beds: '0', bedsMode: 'at_least' }).items.length,
    4,
  );
  for (const beds of ['7', '8', '9', '10']) {
    const result = searchCatalogue('realtime-estates', { beds });
    assert.equal(result.error, null);
    assert.equal(result.bedsText, beds);
    assert.equal(result.bedsMode, '');
  }
  const reset = searchCatalogue('realtime-estates', { beds: '', bedsMode: '' });
  assert.equal(reset.error, null);
  assert.equal(reset.bedsText, '');
  assert.equal(reset.bedsMode, '');
  assert.equal(reset.items.length, 4);
});
test('bedroom group modes reject malformed requests without broadening demo results', () => {
  for (const bedsMode of [
    'unknown',
    'AT_LEAST',
    ' ',
    ' at_least ',
    ['at_least'],
    ['at_least', ''],
    ['at_least', 'at_least'],
  ]) {
    const result = searchCatalogue('realtime-estates', { beds: '7', bedsMode });
    assert.ok(result.error, String(bedsMode));
    assert.deepEqual(result.items, []);
    if (typeof bedsMode === 'string') assert.equal(result.bedsMode, bedsMode);
  }
  for (const beds of [undefined, '', ' ', '7+', '-1', '01', '1.5', '1e1', '101', ['7']]) {
    const result = searchCatalogue('realtime-estates', { beds, bedsMode: 'at_least' });
    assert.ok(result.error, String(beds));
    assert.equal(result.bedsMode, 'at_least');
    assert.deepEqual(result.items, []);
  }
});
test('malformed, overprecise and zero prices produce errors, never an unfiltered result set', () => {
  for (const max of ['0', '-1', '18.001', '1e4', 'NaN', '100000000000000000000']) {
    const r = searchCatalogue('realtime-estates', { max });
    assert.ok(r.error, max);
    assert.equal(r.items.length, 0);
  }
});
test('reset has no stale filter state; foreign tenant data is excluded', () => {
  const filtered = searchCatalogue('realtime-estates', { purpose: 'sale' });
  assert.equal(filtered.items.length, 1);
  const reset = searchCatalogue('realtime-estates', {});
  assert.equal(reset.items.length, 4);
  assert.equal(reset.purpose, '');
  assert.equal(
    reset.items.some((p) => p.id === 'sample-property-1'),
    false,
  );
  assert.equal(propertiesForCompany('unknown').length, 0);
  assert.equal(searchCatalogue('sample-homes', {}).items[0].id, 'sample-property-1');
});
