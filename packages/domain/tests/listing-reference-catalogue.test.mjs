import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateListingReferenceCatalogue,
  selectListingReferenceAttributes,
  snapshotListingReferenceAttributes,
} from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const catalogue = () => ({
  policy: 'synthetic-reference-catalogue-v1',
  version: '1',
  country: 'KE',
  locations: [
    { id: id(1), kind: 'county', parentId: null, label: 'Synthetic county A' },
    { id: id(2), kind: 'locality', parentId: id(1), label: 'Synthetic locality A' },
    { id: id(3), kind: 'neighbourhood', parentId: id(2), label: 'Synthetic neighbourhood A' },
    { id: id(4), kind: 'county', parentId: null, label: 'Synthetic county B' },
    { id: id(5), kind: 'locality', parentId: id(4), label: 'Synthetic locality B' },
  ],
  amenities: [
    {
      id: id(10),
      code: 'synthetic-parking',
      label: 'Synthetic parking',
      propertyTypes: ['apartment', 'studio'],
    },
    { id: id(11), code: 'synthetic-lift', label: 'Synthetic lift', propertyTypes: ['apartment'] },
  ],
});
const selection = () => ({
  catalogueVersion: '1',
  location: { countyId: id(1), localityId: id(2), neighbourhoodId: id(3) },
  amenityIds: [id(11), id(10)],
});
const rejects = (work, code) => assert.throws(work, (error) => error.code === code);
test('normalized reference selections bind exact hierarchy and deterministic applicable amenity sets', () => {
  const value = validateListingReferenceCatalogue(catalogue());
  assert.equal(value.policy, 'synthetic-reference-catalogue-v1');
  assert.deepEqual(value.amenities[0].propertyTypes, ['studio', 'apartment']);
  const selected = selectListingReferenceAttributes(selection(), value, 'apartment');
  assert.deepEqual(selected.amenityIds, [id(10), id(11)]);
  assert.deepEqual(selected.location, selection().location);
  assert.ok(Object.isFrozen(selected.amenityIds));
});
test('reference currency and every hierarchy edge refuse stale, foreign or wrong-level facts', () => {
  rejects(
    () =>
      selectListingReferenceAttributes(
        { ...selection(), catalogueVersion: '2' },
        catalogue(),
        'apartment',
      ),
    'STALE_REFERENCE_CATALOGUE',
  );
  for (const location of [
    { countyId: id(4), localityId: id(2), neighbourhoodId: id(3) },
    { countyId: id(1), localityId: id(5), neighbourhoodId: null },
    { countyId: id(1), localityId: id(2), neighbourhoodId: id(5) },
    { countyId: null, localityId: id(2), neighbourhoodId: null },
    { countyId: id(1), localityId: null, neighbourhoodId: id(3) },
    { countyId: id(2), localityId: null, neighbourhoodId: null },
    { countyId: id(99), localityId: null, neighbourhoodId: null },
  ])
    rejects(
      () =>
        selectListingReferenceAttributes({ ...selection(), location }, catalogue(), 'apartment'),
      'INVALID_REFERENCE_SELECTION',
    );
});
test('reference catalogue rejects orphan, cyclic, duplicate-id and wrong-level parent graphs', () => {
  for (const change of [
    (c) => c.locations.push({ ...c.locations[0] }),
    (c) => (c.locations[0].parentId = id(2)),
    (c) => (c.locations[1].parentId = id(3)),
    (c) => (c.locations[2].parentId = id(1)),
    (c) => (c.locations[1].parentId = id(99)),
    (c) => (c.locations[1].kind = 'village'),
    (c) => (c.amenities[0].id = id(1)),
  ]) {
    const c = catalogue();
    change(c);
    rejects(() => validateListingReferenceCatalogue(c), 'INVALID_REFERENCE_CATALOGUE');
  }
});
test('amenities refuse unknown, repeated and inapplicable choices without silently dropping them', () => {
  for (const [ids, type] of [
    [[id(10), id(10)], 'apartment'],
    [[id(99)], 'apartment'],
    [[id(11)], 'studio'],
    [[id(10)], 'land'],
    [[id(10)], null],
  ])
    rejects(
      () =>
        selectListingReferenceAttributes({ ...selection(), amenityIds: ids }, catalogue(), type),
      'INVALID_REFERENCE_SELECTION',
    );
  for (const change of [
    (c) => (c.amenities[1].code = c.amenities[0].code),
    (c) => (c.amenities[0].propertyTypes = []),
    (c) => (c.amenities[0].propertyTypes = ['studio', 'studio']),
    (c) => (c.amenities[0].propertyTypes = ['unrecognized']),
    (c) => (c.amenities[0].code = 'Unsafe Code'),
  ]) {
    const c = catalogue();
    change(c);
    rejects(() => validateListingReferenceCatalogue(c), 'INVALID_REFERENCE_CATALOGUE');
  }
});
test('reference objects and arrays refuse unsafe facts without invoking data getters', () => {
  let reads = 0;
  const accessor = catalogue();
  Object.defineProperty(accessor, 'version', {
    enumerable: true,
    get() {
      reads++;
      return '1';
    },
  });
  const nested = catalogue();
  Object.defineProperty(nested.locations[0], 'label', {
    enumerable: true,
    get() {
      reads++;
      return 'Changed';
    },
  });
  const arrayGetter = catalogue();
  Object.defineProperty(arrayGetter.locations, '0', {
    enumerable: true,
    get() {
      reads++;
      return catalogue().locations[0];
    },
  });
  const hidden = catalogue();
  Object.defineProperty(hidden, 'secret', { value: 'synthetic', enumerable: false });
  const symbolic = catalogue();
  symbolic.locations[Symbol('hidden')] = true;
  for (const c of [accessor, nested, arrayGetter, hidden, symbolic, Object.create(catalogue())])
    rejects(() => validateListingReferenceCatalogue(c), 'INVALID_REFERENCE_CATALOGUE');
  const sparse = catalogue();
  delete sparse.locations[1];
  rejects(() => validateListingReferenceCatalogue(sparse), 'INVALID_REFERENCE_CATALOGUE');
  assert.equal(reads, 0);
});
test('saved reference snapshots detach labels and preserve explicit unknowns across later catalogue changes', () => {
  const c = catalogue(),
    input = selection(),
    snapshot = snapshotListingReferenceAttributes(input, c, 'apartment');
  c.locations[0].label = 'Changed county';
  c.amenities[0].label = 'Changed amenity';
  input.amenityIds.length = 0;
  assert.equal(snapshot.location.county.label, 'Synthetic county A');
  assert.equal(snapshot.amenities[0].label, 'Synthetic parking');
  for (const value of [
    snapshot,
    snapshot.location,
    snapshot.location.county,
    snapshot.amenities,
    snapshot.amenities[0],
  ])
    assert.ok(Object.isFrozen(value));
  const empty = {
    catalogueVersion: '1',
    location: { countyId: null, localityId: null, neighbourhoodId: null },
    amenityIds: [],
  };
  const unknown = snapshotListingReferenceAttributes(empty, catalogue(), null);
  assert.deepEqual(unknown.location, { county: null, locality: null, neighbourhood: null });
  assert.deepEqual(unknown.amenities, []);
  assert.equal(Object.hasOwn(unknown, 'latitude'), false);
  assert.equal(Object.hasOwn(unknown, 'privateAddress'), false);
});
test('reference bounds, version spelling, Unicode labels and canonical IDs cannot round or alias', () => {
  for (const version of ['0', '01', '1.0', '1e0', '9007199254740992', 1])
    rejects(
      () => validateListingReferenceCatalogue({ ...catalogue(), version }),
      'INVALID_REFERENCE_CATALOGUE',
    );
  for (const text of [
    ' padded',
    'padded ',
    'line\nfeed',
    'c1\u0085',
    'e\u0301',
    '\ud800',
    'x'.repeat(161),
  ]) {
    const c = catalogue();
    c.locations[0].label = text;
    rejects(() => validateListingReferenceCatalogue(c), 'INVALID_REFERENCE_CATALOGUE');
  }
  const long = catalogue();
  long.locations[0].label = '😀'.repeat(160);
  assert.equal(validateListingReferenceCatalogue(long).locations[0].label, long.locations[0].label);
  for (const [key, value] of [
    ['locations', new Array(5001)],
    ['amenities', new Array(101)],
  ])
    rejects(
      () => validateListingReferenceCatalogue({ ...catalogue(), [key]: value }),
      'INVALID_REFERENCE_CATALOGUE',
    );
  rejects(
    () =>
      selectListingReferenceAttributes(
        { ...selection(), amenityIds: new Array(51) },
        catalogue(),
        'apartment',
      ),
    'INVALID_REFERENCE_SELECTION',
  );
  const bad = catalogue();
  bad.locations[0].id = id(1).toUpperCase().replace('000000000001', 'ABCDEFABCDEF');
  rejects(() => validateListingReferenceCatalogue(bad), 'INVALID_REFERENCE_CATALOGUE');
});
test('labels alone cannot select or deduplicate places and no legacy free-text location is auto-mapped', () => {
  const c = catalogue();
  c.locations[4].label = c.locations[1].label;
  assert.equal(validateListingReferenceCatalogue(c).locations.length, 5);
  rejects(
    () =>
      selectListingReferenceAttributes(
        {
          ...selection(),
          location: { county: 'Synthetic county A', town: 'Synthetic locality A', area: null },
        },
        c,
        'apartment',
      ),
    'INVALID_REFERENCE_SELECTION',
  );
  rejects(
    () =>
      selectListingReferenceAttributes(
        {
          ...selection(),
          location: { countyId: 'Synthetic county A', localityId: null, neighbourhoodId: null },
        },
        c,
        'apartment',
      ),
    'INVALID_REFERENCE_SELECTION',
  );
  rejects(
    () => selectListingReferenceAttributes({ ...selection(), actorId: id(9) }, c, 'apartment'),
    'INVALID_REFERENCE_SELECTION',
  );
});
