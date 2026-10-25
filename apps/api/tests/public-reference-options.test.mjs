import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLIC_REFERENCE_OPTIONS_SQL,
  publicReferenceOptions,
} from '../dist/public-reference-options.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('public options project only validated bounded saved identities and empty categories', () => {
  const p = publicReferenceOptions([
    { kind: 'countyId', id: id(1), label: 'Synthetic County' },
    { kind: 'countyId', id: id(2), label: 'Synthetic County' },
    { kind: 'amenityId', id: id(3), label: 'Synthetic lift' },
  ]);
  assert.equal(p.options.countyId.length, 2);
  assert.deepEqual(p.options.localityId, []);
  assert.equal(p.maximumPerCategory, 5000);
  assert.ok(PUBLIC_REFERENCE_OPTIONS_SQL.includes('app_api.public_listings_reference_v3'));
  assert.ok(!PUBLIC_REFERENCE_OPTIONS_SQL.includes('app_private.'));
  assert.ok(!PUBLIC_REFERENCE_OPTIONS_SQL.includes('LIMIT 100 '));
  assert.ok(PUBLIC_REFERENCE_OPTIONS_SQL.includes('LIMIT 20001'));
});
test('public options never silently truncate overflows, duplicate identities, private fields or invalid labels', () => {
  let reads = 0;
  const getter = { kind: 'countyId', id: id(1) };
  Object.defineProperty(getter, 'label', {
    enumerable: true,
    get() {
      reads++;
      return 'secret';
    },
  });
  assert.throws(() => publicReferenceOptions([getter]));
  assert.equal(reads, 0);
  for (const rows of [
    [{ kind: 'tenantId', id: id(1), label: 'bad' }],
    [{ kind: 'countyId', id: 'bad', label: 'bad' }],
    [{ kind: 'countyId', id: id(1), label: ' x' }],
    [{ kind: 'countyId', id: id(1), label: 'x', privateAddress: 'secret' }],
    [
      { kind: 'countyId', id: id(1), label: 'County' },
      { kind: 'amenityId', id: id(1), label: 'Reused' },
    ],
    Array.from({ length: 5001 }, (_, i) => ({ kind: 'countyId', id: id(i), label: 'Large' })),
    Array(20001).fill({}),
  ])
    assert.throws(() => publicReferenceOptions(rows));
});
