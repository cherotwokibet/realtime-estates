import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStaffDraftContentV2,
  validateSyntheticReferenceDraftCommand,
  validateSyntheticReferenceDraftReceipt,
  snapshotListingReferenceAttributes,
} from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const catalogue = () => ({
  policy: 'synthetic-reference-catalogue-v1',
  version: '1',
  country: 'KE',
  locations: [
    { id: id(1), kind: 'county', parentId: null, label: 'Synthetic county' },
    { id: id(2), kind: 'locality', parentId: id(1), label: 'Synthetic town' },
  ],
  amenities: [
    { id: id(3), code: 'synthetic-lift', label: 'Synthetic lift', propertyTypes: ['apartment'] },
  ],
});
const command = () => ({
  policy: 'synthetic-reference-draft-v1',
  operationId: id(10),
  listingId: id(20),
  revision: 1,
  expectedVersion: '2',
  content: normalizeStaffDraftContentV2({
    propertyType: 'apartment',
    locality: 'Synthetic town',
    location: { county: 'Synthetic county', town: 'Synthetic town', area: null },
    pricing: { declaration: 'not_declared', charges: [] },
  }),
  selection: {
    catalogueVersion: '1',
    location: { countyId: id(1), localityId: id(2), neighbourhoodId: null },
    amenityIds: [id(3)],
  },
});
const receipt = (c = command(), cat = catalogue()) => ({
  ...c,
  actorId: id(30),
  revisionVersion: (BigInt(c.expectedVersion) + 1n).toString(),
  attributes: snapshotListingReferenceAttributes(c.selection, cat, c.content.propertyType),
});
const rejects = (work) => assert.throws(work);
test('synthetic combined draft command is exact canonical full replacement and deeply detached', () => {
  const input = structuredClone(command()),
    cat = catalogue(),
    result = validateSyntheticReferenceDraftCommand(input, cat);
  assert.deepEqual(result, input);
  input.content.locality = 'Changed';
  input.selection.amenityIds.length = 0;
  cat.locations[0].label = 'Changed';
  assert.equal(result.content.locality, 'Synthetic town');
  assert.deepEqual(result.selection.amenityIds, [id(3)]);
  assert.ok(Object.isFrozen(result.content.location));
  assert.ok(Object.isFrozen(result.selection));
});
test('explicit adoption requires every disclosure and legacy locality to match deepest selected label', () => {
  for (const mutate of [
    (c) => (c.content.locality = 'Unrelated legacy town'),
    (c) => (c.content.location.town = 'Other town'),
    (c) => delete c.content.currency,
    (c) => (c.content.title = '  Not canonical  '),
    (c) => (c.content.actorId = id(30)),
  ]) {
    const c = structuredClone(command());
    mutate(c);
    rejects(() => validateSyntheticReferenceDraftCommand(c, catalogue()));
  }
  const c = structuredClone(command());
  c.selection.location.localityId = null;
  c.content.location.town = null;
  c.content.locality = 'Synthetic county';
  assert.equal(
    validateSyntheticReferenceDraftCommand(c, catalogue()).content.locality,
    'Synthetic county',
  );
});
test('unknown location is explicitly null and never inherits independent legacy locality text', () => {
  const c = structuredClone(command());
  c.selection.location = { countyId: null, localityId: null, neighbourhoodId: null };
  c.selection.amenityIds = [];
  c.content.propertyType = null;
  c.content.location = { county: null, town: null, area: null };
  rejects(() => validateSyntheticReferenceDraftCommand(c, catalogue()));
  c.content.locality = null;
  assert.equal(validateSyntheticReferenceDraftCommand(c, catalogue()).content.locality, null);
});
test('saved original receipt binds actor, request identity, exact content, version and every catalogue snapshot fact', () => {
  const c = command(),
    r = receipt(c);
  assert.deepEqual(validateSyntheticReferenceDraftReceipt(r, c, catalogue(), id(30)), r);
  for (const mutate of [
    (r) => (r.actorId = id(31)),
    (r) => (r.operationId = id(11)),
    (r) => (r.listingId = id(21)),
    (r) => (r.revision = 2),
    (r) => (r.expectedVersion = '3'),
    (r) => (r.revisionVersion = '4'),
    (r) => (r.content.privateAddress = 'Unbound private text'),
    (r) => (r.attributes.location.county.label = 'Rewritten'),
    (r) => (r.attributes.amenities[0].code = 'other-code'),
    (r) => (r.selection.amenityIds = []),
    (r) => (r.extra = true),
  ]) {
    const altered = structuredClone(r);
    mutate(altered);
    rejects(() => validateSyntheticReferenceDraftReceipt(altered, c, catalogue(), id(30)));
  }
});
test('recovery validates against retained original catalogue, never remaps historical labels through latest version', () => {
  const original = catalogue(),
    c = command(),
    r = receipt(c, original),
    latest = catalogue();
  latest.version = '2';
  latest.locations[0].label = 'Renamed later county';
  rejects(() => validateSyntheticReferenceDraftReceipt(r, c, latest, id(30)));
  const recovered = validateSyntheticReferenceDraftReceipt(r, c, original, id(30));
  assert.equal(recovered.attributes.location.county.label, 'Synthetic county');
  assert.ok(Object.isFrozen(recovered.attributes.amenities[0]));
});
test('own-data boundaries reject command and nested receipt getters without executing them', () => {
  let reads = 0;
  const c = structuredClone(command());
  Object.defineProperty(c, 'content', {
    enumerable: true,
    get() {
      reads++;
      return command().content;
    },
  });
  rejects(() => validateSyntheticReferenceDraftCommand(c, catalogue()));
  const r = structuredClone(receipt());
  Object.defineProperty(r.attributes.amenities, '0', {
    enumerable: true,
    get() {
      reads++;
      return {};
    },
  });
  rejects(() => validateSyntheticReferenceDraftReceipt(r, command(), catalogue(), id(30)));
  const hidden = structuredClone(receipt());
  Object.defineProperty(hidden.attributes.location, 'secret', { value: true });
  rejects(() => validateSyntheticReferenceDraftReceipt(hidden, command(), catalogue(), id(30)));
  assert.equal(reads, 0);
  const sparse = structuredClone(receipt());
  delete sparse.attributes.amenities[0];
  rejects(() => validateSyntheticReferenceDraftReceipt(sparse, command(), catalogue(), id(30)));
});
test('revision and version bounds preserve exact single-step currency and canonical UUID identity', () => {
  for (const patch of [
    { revision: 0 },
    { revision: 2147483648 },
    { revision: 1.5 },
    { expectedVersion: '0' },
    { expectedVersion: '02' },
    { expectedVersion: '2\n' },
    { expectedVersion: '9007199254740991' },
    { operationId: id(10) + '\n' },
    { policy: 'v2' },
  ])
    rejects(() => validateSyntheticReferenceDraftCommand({ ...command(), ...patch }, catalogue()));
  const c = { ...command(), revision: 2147483647, expectedVersion: '9007199254740990' };
  assert.equal(
    validateSyntheticReferenceDraftReceipt(receipt(c), c, catalogue(), id(30)).revisionVersion,
    '9007199254740991',
  );
});
