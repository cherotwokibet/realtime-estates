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
  for (const key of ['location', 'purpose', 'type', 'max']) {
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
