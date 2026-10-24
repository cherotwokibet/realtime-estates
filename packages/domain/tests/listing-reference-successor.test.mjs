import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStaffDraftContentV2,
  snapshotListingReferenceAttributes,
  validateSyntheticReferenceSuccessorCommand,
  validateSyntheticReferenceSuccessorReceipt,
  syntheticReferenceSuccessorDraftCommand,
  SYNTHETIC_REFERENCE_SUCCESSOR_REQUEST_MAX_BYTES,
  SYNTHETIC_REFERENCE_SUCCESSOR_MAX_BYTES,
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
  policy: 'synthetic-reference-successor-v1',
  operationId: id(10),
  listingId: id(20),
  expectedListingVersion: '9',
  predecessor: { revision: 3, version: '8', state: 'approved' },
  content: structuredClone(
    normalizeStaffDraftContentV2({
      propertyType: 'apartment',
      amountMinor: 2000001,
      privateAddress: 'PRIVATE SYNTHETIC FACT',
      locality: 'Synthetic county',
      location: { county: 'Synthetic county', town: null, area: null },
      pricing: { declaration: 'not_declared', charges: [] },
    }),
  ),
  selection: {
    catalogueVersion: '1',
    location: { countyId: id(1), localityId: null, neighbourhoodId: null },
    amenityIds: [id(3)],
  },
});
const receipt = (c = command(), cat = catalogue()) => ({
  policy: c.policy,
  successor: {
    operationId: c.operationId,
    listingId: c.listingId,
    actorId: id(30),
    kind: 'start_revision',
    request: {
      expectedListingVersion: c.expectedListingVersion,
      predecessor: c.predecessor,
      content: c.content,
    },
    decision: {
      outcome: 'applied',
      reason: null,
      result: {
        listingVersion: String(BigInt(c.expectedListingVersion) + 1n),
        revision: c.predecessor.revision + 1,
        revisionVersion: '2',
      },
    },
    completedAt: '2026-10-24T07:45:00.000000Z',
  },
  referenceDraft: {
    ...syntheticReferenceSuccessorDraftCommand(c),
    actorId: id(30),
    revisionVersion: '3',
    attributes: snapshotListingReferenceAttributes(c.selection, cat, c.content.propertyType),
  },
});

test('reference successor detaches full canonical facts and binds allocated revision and both initial versions', () => {
  const input = command(),
    cat = catalogue(),
    out = validateSyntheticReferenceSuccessorCommand(input, cat);
  const r = receipt(out, cat),
    saved = validateSyntheticReferenceSuccessorReceipt(r, out, cat, id(30));
  assert.deepEqual(out, input);
  assert.deepEqual(saved, r);
  assert.equal(saved.successor.decision.result.revision, 4);
  assert.equal(saved.referenceDraft.revision, 4);
  assert.equal(saved.referenceDraft.expectedVersion, '2');
  assert.equal(saved.referenceDraft.revisionVersion, '3');
  input.predecessor.revision = 9;
  input.content.privateAddress = 'Changed';
  input.selection.amenityIds = [];
  cat.amenities[0].label = 'Changed';
  assert.equal(out.predecessor.revision, 3);
  assert.equal(out.content.privateAddress, 'PRIVATE SYNTHETIC FACT');
  assert.ok(Object.isFrozen(saved.successor.request.predecessor));
  assert.ok(Object.isFrozen(saved.referenceDraft.attributes.amenities[0]));
});
test('reference successor rejects authority additions, noncanonical facts, wrong disclosure and incompatible references', () => {
  for (const mutate of [
    (c) => (c.actorId = id(30)),
    (c) => (c.revision = 4),
    (c) => (c.expectedVersion = '2'),
    (c) => (c.policy = 'live'),
    (c) => (c.predecessor.state = 'draft'),
    (c) => (c.predecessor.version = '08'),
    (c) => (c.predecessor.extra = true),
    (c) => delete c.content.currency,
    (c) => (c.content.title = ' Not canonical '),
    (c) => (c.content.locality = 'Wrong county'),
    (c) => (c.selection.amenityIds = [id(999)]),
    (c) => (c.selection.catalogueVersion = '2'),
    (c) => (c.operationId = c.operationId.toUpperCase().replace('00000000', 'ABCDEFAB')),
  ]) {
    const c = command();
    mutate(c);
    assert.throws(
      () => validateSyntheticReferenceSuccessorCommand(c, catalogue()),
      undefined,
      String(mutate),
    );
  }
  const cat = catalogue();
  cat.amenities[0].propertyTypes = ['land'];
  assert.throws(() => validateSyntheticReferenceSuccessorCommand(command(), cat));
});
test('allocation boundaries are checked before deriving a successor, with exact safe maximum result versions', () => {
  for (const patch of [
    { expectedListingVersion: '9007199254740991' },
    { predecessor: { revision: 2147483647, version: '8', state: 'rejected' } },
  ])
    assert.throws(() =>
      validateSyntheticReferenceSuccessorCommand({ ...command(), ...patch }, catalogue()),
    );
  const c = {
    ...command(),
    expectedListingVersion: '9007199254740990',
    predecessor: { revision: 2147483646, version: '9007199254740991', state: 'rejected' },
  };
  const out = validateSyntheticReferenceSuccessorCommand(c, catalogue());
  const r = validateSyntheticReferenceSuccessorReceipt(receipt(out), out, catalogue(), id(30));
  assert.equal(r.successor.decision.result.listingVersion, '9007199254740991');
  assert.equal(r.referenceDraft.revision, 2147483647);
});
test('composed original rejects either actor, identity, predecessor, private text, selection, result or version substitutions', () => {
  for (const mutate of [
    (r) => (r.extra = true),
    (r) => (r.successor.actorId = id(31)),
    (r) => (r.referenceDraft.actorId = id(31)),
    (r) => (r.successor.operationId = id(11)),
    (r) => (r.referenceDraft.listingId = id(21)),
    (r) => (r.successor.request.predecessor.version = '9'),
    (r) => (r.successor.request.predecessor.state = 'rejected'),
    (r) => (r.successor.request.expectedListingVersion = '10'),
    (r) => (r.successor.request.content.privateAddress = 'Changed'),
    (r) => (r.successor.request.content.privateAddress = ' PRIVATE SYNTHETIC FACT '),
    (r) => (r.successor.decision.result.listingVersion = '11'),
    (r) => (r.successor.decision.result.revision = 5),
    (r) => (r.successor.decision.result.revisionVersion = '3'),
    (r) => (r.referenceDraft.revision = 5),
    (r) => (r.referenceDraft.expectedVersion = '3'),
    (r) => (r.referenceDraft.revisionVersion = '4'),
    (r) => (r.referenceDraft.selection.amenityIds = []),
    (r) => (r.referenceDraft.attributes.amenities[0].label = 'Changed'),
    (r) => (r.successor.completedAt = '2026-02-30T07:45:00.000000Z'),
    (r) =>
      (r.successor.decision = { outcome: 'conflict', reason: 'PREDECESSOR_CHANGED', result: null }),
  ]) {
    const c = command(),
      r = structuredClone(receipt(c));
    mutate(r);
    assert.throws(() => validateSyntheticReferenceSuccessorReceipt(r, c, catalogue(), id(30)));
  }
});
test('recovery validates historical catalogue rather than the current pointer or later draft versions', () => {
  const c = command(),
    r = receipt(c),
    cat = catalogue();
  assert.deepEqual(validateSyntheticReferenceSuccessorReceipt(r, c, cat, id(30)), r);
  assert.throws(() =>
    validateSyntheticReferenceSuccessorReceipt(r, c, { ...cat, version: '2' }, id(30)),
  );
  const changed = structuredClone(cat);
  changed.locations[0].label = 'New label';
  assert.throws(() => validateSyntheticReferenceSuccessorReceipt(r, c, changed, id(30)));
  assert.throws(() =>
    validateSyntheticReferenceSuccessorReceipt(
      r,
      { ...c, expectedListingVersion: '10' },
      cat,
      id(30),
    ),
  );
});
test('private whitespace is retained exactly while public title normalization cannot alter a recovered original', () => {
  const c = command();
  c.content.privateAddress = '  PRIVATE\nSYNTHETIC  ';
  const out = validateSyntheticReferenceSuccessorCommand(c, catalogue());
  assert.equal(out.content.privateAddress, c.content.privateAddress);
  const r = receipt(out);
  assert.deepEqual(validateSyntheticReferenceSuccessorReceipt(r, out, catalogue(), id(30)), r);
  const changed = structuredClone(r);
  changed.successor.request.content.title = '   ';
  assert.throws(() =>
    validateSyntheticReferenceSuccessorReceipt(changed, out, catalogue(), id(30)),
  );
});
test('untrusted getters, symbols, sparse arrays and custom prototypes are rejected without executing accessors', () => {
  let reads = 0;
  for (const path of [['selection'], ['predecessor', 'version'], ['content', 'privateAddress']]) {
    const c = command();
    let target = c;
    for (const key of path.slice(0, -1)) target = target[key];
    Object.defineProperty(target, path.at(-1), {
      enumerable: true,
      get() {
        reads++;
        return '8';
      },
    });
    assert.throws(() => validateSyntheticReferenceSuccessorCommand(c, catalogue()));
  }
  for (const mutate of [
    (r) =>
      Object.defineProperty(r, 'successor', {
        enumerable: true,
        get() {
          reads++;
          return {};
        },
      }),
    (r) =>
      Object.defineProperty(r.successor.request.predecessor, 'version', {
        enumerable: true,
        get() {
          reads++;
          return '8';
        },
      }),
    (r) => (r.referenceDraft.attributes.amenities[Symbol('hidden')] = true),
    (r) => delete r.referenceDraft.attributes.amenities[0],
    (r) => Object.setPrototypeOf(r, { forged: true }),
  ]) {
    const r = structuredClone(receipt());
    mutate(r);
    assert.throws(() =>
      validateSyntheticReferenceSuccessorReceipt(r, command(), catalogue(), id(30)),
    );
  }
  assert.equal(reads, 0);
});
test('UTF-8 preflight reserves each response component and the measured composed envelope before mutation', (t) => {
  const c = command();
  c.content.description = '界'.repeat(10000);
  const out = validateSyntheticReferenceSuccessorCommand(c, catalogue()),
    r = receipt(out);
  const bytes = (x) => new TextEncoder().encode(JSON.stringify(x)).byteLength;
  assert.ok(bytes(out) < SYNTHETIC_REFERENCE_SUCCESSOR_REQUEST_MAX_BYTES);
  assert.ok(bytes(r) > 60000);
  assert.ok(bytes(r) < SYNTHETIC_REFERENCE_SUCCESSOR_MAX_BYTES);
  assert.ok(bytes({ policy: c.policy, successor: null, referenceDraft: null }) - 8 <= 128);
  assert.deepEqual(validateSyntheticReferenceSuccessorReceipt(r, out, catalogue(), id(30)), r);
  // Stress the maximum selected references, charges and Unicode description.
  // Existing per-field limits may be tighter than the defensive byte ceiling.
  const cat = catalogue();
  cat.amenities = Array.from({ length: 50 }, (_, i) => ({
    id: id(100 + i),
    code: 'synthetic-' + i,
    label: '🏠'.repeat(160),
    propertyTypes: ['apartment'],
  }));
  c.selection.amenityIds = cat.amenities.map((a) => a.id);
  c.content.purpose = 'rent';
  c.content.rentPeriod = 'month';
  c.content.description = '🏠'.repeat(10000);
  c.content.privateAddress = '🏠'.repeat(1000);
  c.content.pricing = {
    declaration: 'complete',
    charges: Array.from({ length: 32 }, (_, i) => ({
      id: 'fee-' + i,
      name: '🏠'.repeat(160),
      amountStatus: 'known',
      amountMinor: 1,
      timing: 'one_off',
      classification: 'fee',
      mandatory: true,
    })),
  };
  const accepted = validateSyntheticReferenceSuccessorCommand(c, cat),
    original = receipt(accepted, cat);
  assert.deepEqual(
    validateSyntheticReferenceSuccessorReceipt(original, accepted, cat, id(30)),
    original,
  );
  assert.ok(
    bytes(original) > 131072,
    'duplicated content and snapshots exceed an ordinary envelope',
  );
  assert.ok(bytes(original.successor) <= 131072);
  assert.ok(bytes(original.referenceDraft) <= 131072);
  assert.ok(bytes(original) <= SYNTHETIC_REFERENCE_SUCCESSOR_MAX_BYTES);
  t.diagnostic(
    JSON.stringify({
      requestBytes: bytes(accepted),
      successorBytes: bytes(original.successor),
      referenceDraftBytes: bytes(original.referenceDraft),
      totalBytes: bytes(original),
      envelopeOverheadBytes: bytes({ policy: c.policy, successor: null, referenceDraft: null }) - 8,
    }),
  );
  const denied = { ...c, content: { ...c.content, description: '🏠'.repeat(10001) } };
  assert.throws(() => validateSyntheticReferenceSuccessorCommand(denied, cat));
});
