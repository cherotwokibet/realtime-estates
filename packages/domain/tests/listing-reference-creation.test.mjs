import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStaffDraftContentV2,
  validateSyntheticReferenceCreationCommand,
  validateSyntheticReferenceCreationReceipt,
  syntheticReferenceCreationDraftCommand,
  snapshotListingReferenceAttributes,
  SYNTHETIC_REFERENCE_CREATION_MAX_BYTES,
} from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const catalogue = () => ({
  policy: 'synthetic-reference-catalogue-v1',
  version: '1',
  country: 'KE',
  locations: [{ id: id(1), kind: 'county', parentId: null, label: 'Synthetic county' }],
  amenities: [
    { id: id(3), code: 'synthetic-lift', label: 'Synthetic lift', propertyTypes: ['apartment'] },
  ],
});
const command = () => ({
  policy: 'synthetic-reference-creation-v1',
  operationId: id(10),
  listingId: id(20),
  slug: 'synthetic-created-listing',
  content: normalizeStaffDraftContentV2({
    propertyType: 'apartment',
    locality: 'Synthetic county',
    location: { county: 'Synthetic county', town: null, area: null },
    pricing: { declaration: 'not_declared', charges: [] },
  }),
  selection: {
    catalogueVersion: '1',
    location: { countyId: id(1), localityId: null, neighbourhoodId: null },
    amenityIds: [id(3)],
  },
});
const receipt = (c = command(), cat = catalogue()) => ({
  policy: c.policy,
  creation: {
    operationId: c.operationId,
    listingId: c.listingId,
    actorId: id(30),
    kind: 'create_listing',
    request: { slug: c.slug, content: c.content },
    outcome: 'created',
    reason: null,
    result: { listingVersion: '1', revision: 1, revisionVersion: '2' },
    completedAt: '2026-10-24T01:00:00.000000Z',
  },
  referenceDraft: {
    ...syntheticReferenceCreationDraftCommand(c),
    actorId: id(30),
    revisionVersion: '3',
    attributes: snapshotListingReferenceAttributes(c.selection, cat, c.content.propertyType),
  },
});
test('reference creation captures a detached exact command and binds both immutable initial versions to one actor', () => {
  const input = structuredClone(command()),
    cat = catalogue(),
    out = validateSyntheticReferenceCreationCommand(input, cat),
    r = receipt(out, cat),
    result = validateSyntheticReferenceCreationReceipt(r, out, cat, id(30));
  assert.deepEqual(out, input);
  assert.deepEqual(result, r);
  assert.equal(result.creation.result.revisionVersion, '2');
  assert.equal(result.referenceDraft.revisionVersion, '3');
  input.content.locality = 'Changed';
  input.selection.amenityIds = [];
  cat.locations[0].label = 'Changed';
  assert.equal(out.content.locality, 'Synthetic county');
  assert.deepEqual(out.selection.amenityIds, [id(3)]);
  assert.ok(Object.isFrozen(result.referenceDraft.attributes.amenities[0]));
});
test('reference creation rejects authority/private additions, missing canonical facts, wrong labels and incompatible selection', () => {
  for (const mutate of [
    (c) => (c.actorId = id(30)),
    (c) => (c.assignedAgentId = id(30)),
    (c) => (c.revision = 1),
    (c) => (c.expectedVersion = '2'),
    (c) => (c.policy = 'live'),
    (c) => delete c.content.currency,
    (c) => (c.content.title = ' Not canonical '),
    (c) => (c.content.locality = 'Unbound location'),
    (c) => (c.selection.amenityIds = [id(999)]),
    (c) => (c.slug = 'Not canonical'),
  ]) {
    const c = structuredClone(command());
    mutate(c);
    assert.throws(() => validateSyntheticReferenceCreationCommand(c, catalogue()));
  }
});
test('composite original rejects changed actor, identity, slug, content, selection, versions, outcome and snapshot', () => {
  const c = command(),
    cat = catalogue();
  for (const mutate of [
    (r) => (r.privateAddress = 'PRIVATE'),
    (r) => (r.creation.actorId = id(31)),
    (r) => (r.referenceDraft.actorId = id(31)),
    (r) => (r.creation.listingId = id(21)),
    (r) => (r.creation.request.slug = 'changed'),
    (r) => (r.creation.request.content.privateAddress = 'Changed'),
    (r) => (r.creation.result.revisionVersion = '3'),
    (r) => (r.referenceDraft.revisionVersion = '4'),
    (r) => (r.referenceDraft.selection.amenityIds = []),
    (r) => (r.referenceDraft.attributes.amenities[0].label = 'Changed'),
    (r) => {
      r.creation.outcome = 'refused';
      r.creation.reason = 'TARGET_UNAVAILABLE';
      r.creation.result = null;
    },
  ]) {
    const r = structuredClone(receipt(c, cat));
    mutate(r);
    assert.throws(() => validateSyntheticReferenceCreationReceipt(r, c, cat, id(30)));
  }
});
test('creation recovery uses the retained catalogue and rejects latest-pointer substitution', () => {
  const c = command(),
    cat = catalogue(),
    r = receipt(c, cat),
    latest = { ...catalogue(), version: '2' };
  assert.deepEqual(validateSyntheticReferenceCreationReceipt(r, c, cat, id(30)), r);
  assert.throws(() => validateSyntheticReferenceCreationReceipt(r, c, latest, id(30)));
});
test('command and receipt capture reject accessors without executing untrusted getters', () => {
  let reads = 0;
  const c = structuredClone(command());
  Object.defineProperty(c, 'selection', {
    enumerable: true,
    get() {
      reads++;
      return command().selection;
    },
  });
  assert.throws(() => validateSyntheticReferenceCreationCommand(c, catalogue()));
  const r = receipt();
  Object.defineProperty(r, 'creation', {
    enumerable: true,
    get() {
      reads++;
      return receipt().creation;
    },
  });
  assert.throws(() => validateSyntheticReferenceCreationReceipt(r, command(), catalogue(), id(30)));
  assert.equal(reads, 0);
});
test('creation preflight reserves response capacity for the duplicated full original instead of widening ordinary limits', () => {
  const c = structuredClone(command());
  c.content.description = '界'.repeat(10000);
  const out = validateSyntheticReferenceCreationCommand(c, catalogue()),
    r = receipt(out);
  assert.ok(new TextEncoder().encode(JSON.stringify(r)).byteLength > 60000);
  assert.ok(
    new TextEncoder().encode(JSON.stringify(r)).byteLength < SYNTHETIC_REFERENCE_CREATION_MAX_BYTES,
  );
  assert.deepEqual(validateSyntheticReferenceCreationReceipt(r, out, catalogue(), id(30)), r);
  const huge = structuredClone(command());
  huge.content.pricing = {
    declaration: 'complete',
    charges: Array.from({ length: 32 }, (_, i) => ({
      id: 'fee-' + i,
      name: '界'.repeat(160),
      amountStatus: 'known',
      amountMinor: 1,
      timing: 'one_off',
      classification: 'fee',
      mandatory: true,
    })),
  };
  huge.content.description = '界'.repeat(10000);
  assert.throws(() =>
    validateSyntheticReferenceCreationCommand(
      { ...huge, content: { ...huge.content, description: '界'.repeat(10001) } },
      catalogue(),
    ),
  );
});
