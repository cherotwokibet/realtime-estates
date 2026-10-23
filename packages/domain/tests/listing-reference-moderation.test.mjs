import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStaffDraftContentV2,
  snapshotListingReferenceAttributes,
  validateSyntheticReferenceRevision as read,
  validateSyntheticReferenceTransitionCommand as command,
  validateSyntheticReferenceTransitionReceipt as receipt,
  SYNTHETIC_REFERENCE_MODERATION_MAX_BYTES,
  validateSyntheticReferencePublicAttributes as publicAttributes,
  validateSyntheticReferenceContext as context,
} from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cat = () => ({
  policy: 'synthetic-reference-catalogue-v1',
  version: '1',
  country: 'KE',
  locations: [{ id: id(1), kind: 'county', parentId: null, label: 'Synthetic county' }],
  amenities: [
    { id: id(2), code: 'synthetic-lift', label: 'Synthetic lift', propertyTypes: ['apartment'] },
  ],
});
const selection = {
  catalogueVersion: '1',
  location: { countyId: id(1), localityId: null, neighbourhoodId: null },
  amenityIds: [id(2)],
};
const review = () => ({
  policy: 'synthetic-reference-revision-v1',
  listingId: id(20),
  revision: 1,
  listingVersion: '2',
  revisionVersion: '3',
  state: 'pending',
  availability: 'available',
  availabilityConfirmedAt: '2026-10-23T12:00:00.123Z',
  publicationStatus: 'paused',
  publishedRevision: null,
  content: normalizeStaffDraftContentV2({
    propertyType: 'apartment',
    locality: 'Synthetic county',
    location: { county: 'Synthetic county', town: null, area: null },
    pricing: { declaration: 'not_declared', charges: [] },
    privateAddress: 'PRIVATE SENTINEL',
  }),
  attributes: snapshotListingReferenceAttributes(selection, cat(), 'apartment'),
  photos: [
    {
      id: id(30),
      position: 0,
      altText: 'Synthetic photo',
      accepted: true,
      sha256: 'a'.repeat(64),
      sealed: true,
    },
  ],
});
const original = (action) => ({
  policy: 'synthetic-reference-transition-v1',
  operationId: id(40),
  listingId: id(20),
  revision: 1,
  action,
  review: { ...review(), state: action === 'submit' ? 'draft' : 'pending' },
  reason: action === 'reject' ? 'Synthetic reason' : null,
});
const result = (c) => ({
  ...c,
  actorId: id(50),
  revisionVersion: '4',
  state: { submit: 'pending', withdraw: 'draft', approve: 'approved', reject: 'rejected' }[
    c.action
  ],
});
const readReview = (r) => read(r, cat(), id(20), 1, '3');
test('initial reference context binds the saved catalogue, target, version and pending state', () => {
  const input = {
    policy: 'synthetic-reference-context-v1',
    review: structuredClone(review()),
    catalogue: cat(),
  };
  const out = context(input, id(20), 1, '3', 'review');
  assert.deepEqual(out, input);
  input.catalogue.locations[0].label = 'Changed';
  input.review.content.privateAddress = 'Changed';
  assert.equal(out.catalogue.locations[0].label, 'Synthetic county');
  assert.equal(out.review.content.privateAddress, 'PRIVATE SENTINEL');
  assert.ok(Object.isFrozen(out) && Object.isFrozen(out.catalogue.locations[0]));
  for (const mutate of [
    (v) => (v.catalogue.version = '2'),
    (v) => (v.catalogue.locations[0].label = 'Latest label'),
    (v) => (v.review.revisionVersion = '4'),
    (v) => (v.review.listingId = id(21)),
    (v) => (v.review.revision = 2),
    (v) => (v.extra = true),
    (v) => (v.policy = 'synthetic-reference-revision-v1'),
    (v) => (v.review.state = 'draft'),
  ]) {
    const changed = structuredClone(out);
    mutate(changed);
    assert.throws(() => context(changed, id(20), 1, '3', 'review'));
  }
  const draft = structuredClone(out);
  draft.review.state = 'draft';
  assert.equal(context(draft, id(20), 1, '3', 'revision').review.state, 'draft');
});
test('initial context rejects executable and hidden envelope properties without invoking getters', () => {
  let calls = 0;
  for (const key of ['policy', 'review', 'catalogue']) {
    const input = { policy: 'synthetic-reference-context-v1', review: review(), catalogue: cat() };
    Object.defineProperty(input, key, {
      enumerable: true,
      get() {
        calls++;
        throw Error();
      },
    });
    assert.throws(() => context(input, id(20), 1, '3', 'review'));
  }
  const input = { policy: 'synthetic-reference-context-v1', review: review(), catalogue: cat() };
  Object.defineProperty(input, 'hidden', { value: true });
  assert.throws(() => context(input, id(20), 1, '3', 'review'));
  assert.equal(calls, 0);
});
test('private reference projection is exact, detached and preserves historical labels and operational context', () => {
  const input = structuredClone(review()),
    output = readReview(input);
  assert.deepEqual(output, input);
  input.content.privateAddress = 'Changed';
  input.photos[0].altText = 'Changed';
  input.attributes.location.county.label = 'Changed';
  assert.equal(output.content.privateAddress, 'PRIVATE SENTINEL');
  assert.equal(output.photos[0].altText, 'Synthetic photo');
  assert.ok(
    Object.isFrozen(output.photos[0]) && Object.isFrozen(output.attributes.location.county),
  );
  const latest = cat();
  latest.version = '2';
  latest.locations[0].label = 'Renamed';
  assert.throws(() => read(review(), latest, id(20), 1, '3'));
});
test('reference projection rejects path, editorial version and private/public field substitution', () => {
  for (const mutate of [
    (r) => (r.listingId = id(21)),
    (r) => (r.revision = 2),
    (r) => (r.revisionVersion = '4'),
    (r) => (r.listingVersion = '02'),
    (r) => (r.state = 'published'),
    (r) => (r.publicationStatus = 'draft'),
    (r) => (r.availability = 'unknown'),
    (r) => (r.publicationStatus = 'published'),
    (r) => (r.content.privateAddress = undefined),
    (r) => (r.content.extra = true),
    (r) => (r.content.locality = 'Unrelated'),
    (r) => (r.content.location.county = 'Other'),
    (r) => (r.attributes.location.county.label = 'Renamed'),
    (r) => (r.attributes.amenities[0].code = 'other'),
    (r) => (r.attributes.country = 'UG'),
    (r) => (r.extra = true),
  ]) {
    const r = structuredClone(review());
    mutate(r);
    assert.throws(() => readReview(r));
  }
});
test('canonical UTC timestamps reject normalization, impossible dates and non-string values', () => {
  for (const v of [
    '2026-02-30T12:00:00.123Z',
    '2026-10-23T12:00:00Z',
    '2026-10-23T12:00:00.123+00:00',
    42,
    undefined,
  ]) {
    const r = structuredClone(review());
    r.availabilityConfirmedAt = v;
    assert.throws(() => readReview(r));
  }
  const r = structuredClone(review());
  r.availabilityConfirmedAt = null;
  assert.equal(readReview(r).availabilityConfirmedAt, null);
});
test('ordered photo fingerprints reject duplicate IDs, unordered positions, extras and malformed hashes', () => {
  for (const mutate of [
    (r) => r.photos.push({ ...r.photos[0], position: 1 }),
    (r) => r.photos.push({ ...r.photos[0], id: id(31) }),
    (r) => (r.photos[0].position = 12),
    (r) => (r.photos[0].sha256 = 'A'.repeat(64)),
    (r) => (r.photos[0].accepted = 1),
    (r) => (r.photos[0].sealed = 'true'),
    (r) => (r.photos[0].altText = ' x '),
    (r) => (r.photos[0].url = 'private-key'),
    (r) => (r.photos = Array(13).fill(r.photos[0])),
    (r) => (r.photos = new Array(1)),
  ]) {
    const r = structuredClone(review());
    mutate(r);
    assert.throws(() => readReview(r));
  }
  const r = structuredClone(review());
  r.photos = [];
  r.state = 'draft';
  assert.deepEqual(readReview(r).photos, []);
  r.photos = [{ ...review().photos[0], accepted: false, sealed: false }];
  assert.equal(readReview(r).photos[0].sealed, false);
});
test('all four transitions bind original facts and receipt actor, outcome and exactly one version', () => {
  for (const action of ['submit', 'withdraw', 'approve', 'reject']) {
    const c = original(action),
      r = result(c);
    assert.deepEqual(command(c, cat()), c);
    assert.deepEqual(receipt(r, c, cat(), id(50)), r);
    for (const mutate of [
      (r) => (r.actorId = id(51)),
      (r) => (r.operationId = id(41)),
      (r) => (r.action = 'other'),
      (r) => (r.listingId = id(21)),
      (r) => (r.revision = 2),
      (r) => (r.revisionVersion = '5'),
      (r) => (r.state = 'draft' === r.state ? 'approved' : 'draft'),
      (r) => (r.reason = 'Changed'),
      (r) => (r.review.listingVersion = '3'),
      (r) => (r.review.photos[0].sha256 = 'b'.repeat(64)),
      (r) => (r.review.content.privateAddress = 'Changed'),
      (r) => (r.extra = true),
    ]) {
      const changed = structuredClone(r);
      mutate(changed);
      assert.throws(() => receipt(changed, c, cat(), id(50)));
    }
  }
});
test('command forbids invalid state/action/reason and cannot increment either exhausted version', () => {
  for (const mutate of [
    (c) => (c.action = 'publish'),
    (c) => (c.review.state = 'approved'),
    (c) => (c.reason = 'Unrequested'),
    (c) => (c.operationId = c.operationId.toUpperCase().replace('00000000', 'AAAAAAAA')),
    (c) => (c.review.revisionVersion = '9007199254740991'),
    (c) => (c.review.listingVersion = '9007199254740991'),
    (c) => (c.actorId = id(50)),
  ]) {
    const c = structuredClone(original('approve'));
    mutate(c);
    assert.throws(() => command(c, cat()));
  }
  for (const reason of [null, '', '  ', ' x ', 'x'.repeat(2001), 'bad\u0080', 'bad\ud800']) {
    const c = original('reject');
    c.reason = reason;
    assert.throws(() => command(c, cat()));
  }
  const c = original('reject');
  c.reason = '😀'.repeat(2000);
  assert.equal(command(c, cat()).reason, c.reason);
  const r = structuredClone(review());
  r.revisionVersion = '9007199254740991';
  assert.equal(read(r, cat(), id(20), 1, r.revisionVersion).revisionVersion, r.revisionVersion);
});
test('records, nested arrays, symbols and accessors fail without executing ordinary getters', () => {
  let calls = 0;
  for (const mutate of [
    (r) =>
      Object.defineProperty(r, 'state', {
        enumerable: true,
        get() {
          calls++;
          return 'pending';
        },
      }),
    (r) =>
      Object.defineProperty(r.photos, '0', {
        enumerable: true,
        get() {
          calls++;
          return review().photos[0];
        },
      }),
    (r) =>
      Object.defineProperty(r.attributes.location.county, 'label', {
        enumerable: true,
        get() {
          calls++;
          return 'Synthetic county';
        },
      }),
    (r) => (r.photos[Symbol('extra')] = true),
    (r) => Object.defineProperty(r, 'hidden', { value: true }),
    (r) => Object.setPrototypeOf(r, {}),
  ]) {
    const r = structuredClone(review());
    mutate(r);
    assert.throws(() => readReview(r));
  }
  assert.equal(calls, 0);
  const c = original('approve'),
    r = structuredClone(result(c));
  Object.defineProperty(r.review.content, 'privateAddress', {
    enumerable: true,
    get() {
      calls++;
      return 'PRIVATE SENTINEL';
    },
  });
  assert.throws(() => receipt(r, c, cat(), id(50)));
  assert.equal(calls, 0);
});
test('explicit Unknown adoption and complete 12-photo reviewed payload fit a declared bounded wire contract', () => {
  const r = structuredClone(review());
  r.content.location = { county: null, town: null, area: null };
  r.content.locality = null;
  r.content.propertyType = null;
  r.attributes = snapshotListingReferenceAttributes(
    {
      catalogueVersion: '1',
      location: { countyId: null, localityId: null, neighbourhoodId: null },
      amenityIds: [],
    },
    cat(),
    null,
  );
  r.photos = Array.from({ length: 12 }, (_, i) => ({
    ...review().photos[0],
    id: id(100 + i),
    position: i,
    altText: '😀'.repeat(300),
  }));
  const c = { ...original('approve'), review: r },
    canonical = command(c, cat());
  assert.equal(canonical.review.attributes.location.county, null);
  assert.ok(
    Buffer.byteLength(JSON.stringify(canonical)) < SYNTHETIC_REFERENCE_MODERATION_MAX_BYTES,
  );
  const out = receipt(result(c), c, cat(), id(50));
  assert.ok(Object.isFrozen(out.review.photos));
});

test('public extension accepts explicit legacy absence and historical approved attributes, excluding every private review field', () => {
  const p = { attributes: review().attributes, revisionVersion: '4' };
  assert.deepEqual(publicAttributes(p, cat(), 'apartment'), p);
  assert.deepEqual(publicAttributes({ attributes: null, revisionVersion: null }, undefined, null), {
    attributes: null,
    revisionVersion: null,
  });
  for (const mutate of [
    (p) => (p.attributes = null),
    (p) => (p.revisionVersion = null),
    (p) => (p.revisionVersion = '1'),
    (p) => (p.content = review().content),
    (p) => (p.actorId = id(50)),
    (p) => (p.attributes.location.county.label = 'Renamed'),
  ]) {
    const changed = structuredClone(p);
    mutate(changed);
    assert.throws(() => publicAttributes(changed, cat(), 'apartment'));
  }
  assert.throws(() => publicAttributes(p, cat(), 'land'));
  assert.throws(() => publicAttributes(review(), cat(), 'apartment'));
  const latest = cat();
  latest.version = '2';
  assert.throws(() => publicAttributes(p, latest, 'apartment'));
  let calls = 0;
  const changed = structuredClone(p);
  Object.defineProperty(changed.attributes.amenities[0], 'label', {
    enumerable: true,
    get() {
      calls++;
      return 'Synthetic lift';
    },
  });
  assert.throws(() => publicAttributes(changed, cat(), 'apartment'));
  assert.equal(calls, 0);
});
