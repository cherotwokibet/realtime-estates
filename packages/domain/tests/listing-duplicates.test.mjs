import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateListingDuplicateRequest,
  validateListingDuplicateCandidates,
} from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const request = () => ({
  listingId: id(1),
  listingVersion: '2',
  revision: 3,
  revisionVersion: '4',
  limit: 2,
});
const candidate = (n) => ({
  listingId: id(n),
  listingVersion: '9',
  revision: 2,
  revisionVersion: '3',
  slug: `synthetic-${n}`,
  revisionState: 'draft',
  availability: 'available',
  publicationStatus: 'unpublished',
});
const response = () => {
  const { limit, ...target } = request();
  return {
    kind: 'listing_duplicate_candidates',
    policy: 'exact-current-work-v1',
    target,
    comparison: 'compared',
    matches: [candidate(2), candidate(3)],
    hasMore: true,
  };
};
const validate = (value) => validateListingDuplicateCandidates(value, request());
test('duplicate candidates return a detached deeply frozen exact target and minimal snapshot', () => {
  const input = response(),
    result = validate(input);
  input.matches[0].slug = 'changed';
  input.target.revision = 5;
  assert.equal(result.matches[0].slug, 'synthetic-2');
  assert.equal(result.target.revision, 3);
  for (const value of [result, result.target, result.matches, ...result.matches])
    assert.ok(Object.isFrozen(value));
  assert.deepEqual(validateListingDuplicateRequest(request()), request());
  const empty = { ...response(), comparison: 'insufficient_facts', matches: [], hasMore: false };
  assert.equal(validate(empty).comparison, 'insufficient_facts');
  assert.equal(validate({ ...response(), matches: [], hasMore: false }).matches.length, 0);
});
test('duplicate requests reject unsafe versions, revisions, limits and noncanonical authority', () => {
  for (const [key, values] of Object.entries({
    listingVersion: ['0', '01', '9007199254740992', 2, '2e1'],
    revisionVersion: ['-1', '', '9007199254740992'],
    revision: [0, 1.5, 2147483648, '3'],
    limit: [0, 26, 1.2, '2'],
    listingId: ['unknown', id(1).toUpperCase().replace('00000000', 'ABCDEF00')],
  })) {
    for (const value of values)
      assert.throws(() => validateListingDuplicateRequest({ ...request(), [key]: value }), {
        code: 'INVALID_LISTING_DUPLICATES',
      });
  }
  assert.throws(() => validateListingDuplicateRequest({ ...request(), actorId: id(8) }));
});
test('duplicate result binds all target currency and refuses extra private or unknown fields', () => {
  for (const [key, value] of Object.entries({
    listingId: id(9),
    listingVersion: '3',
    revision: 4,
    revisionVersion: '5',
  }))
    assert.throws(() =>
      validate({ ...response(), target: { ...response().target, [key]: value } }),
    );
  for (const value of [
    { ...response(), address: 'private' },
    { ...response(), policy: 'semantic-v2' },
    { ...response(), comparison: 'certain' },
    { ...response(), matches: [{ ...candidate(2), price: 1 }] },
    { ...response(), target: { ...response().target, limit: 2 } },
  ])
    assert.throws(() => validate(value));
});
test('duplicate result enforces ordered unique nonself IDs and bounded lookahead semantics', () => {
  for (const value of [
    { ...response(), matches: [candidate(3), candidate(2)] },
    { ...response(), matches: [candidate(2), candidate(2)] },
    { ...response(), matches: [candidate(1), candidate(2)] },
    { ...response(), matches: [candidate(2)] },
    { ...response(), matches: [candidate(2), candidate(3), candidate(4)] },
    { ...response(), hasMore: 1 },
    { ...response(), comparison: 'insufficient_facts' },
    { ...response(), comparison: 'insufficient_facts', matches: [] },
  ])
    assert.throws(() => validate(value));
  assert.equal(validate({ ...response(), hasMore: false }).matches.length, 2);
});
test('duplicate candidate fields reject invalid slugs, versions and enum values', () => {
  for (const [key, value] of Object.entries({
    slug: 'private/path',
    listingVersion: '01',
    revision: 0,
    revisionVersion: '9007199254740992',
    revisionState: 'deleted',
    availability: 'unknown',
    publicationStatus: 'live',
  }))
    assert.throws(() =>
      validate({ ...response(), matches: [{ ...candidate(2), [key]: value }], hasMore: false }),
    );
  for (const slug of ['', 'a'.repeat(161), 'two--hyphens', 'Upper', '-prefix'])
    assert.throws(() =>
      validate({ ...response(), matches: [{ ...candidate(2), slug }], hasMore: false }),
    );
});
test('duplicate validators refuse accessors, custom iterators and sparse arrays without invoking them', () => {
  let invoked = 0;
  const getter = {
    enumerable: true,
    get() {
      invoked++;
      throw new Error('must not run');
    },
  };
  const req = request();
  Object.defineProperty(req, 'limit', getter);
  assert.throws(() => validateListingDuplicateRequest(req));
  for (const alter of [
    (r) => Object.defineProperty(r, 'kind', getter),
    (r) => Object.defineProperty(r.target, 'listingId', getter),
    (r) => Object.defineProperty(r.matches, '0', getter),
    (r) => Object.defineProperty(r.matches[0], 'slug', getter),
    (r) => {
      r.matches[Symbol.iterator] = () => {
        invoked++;
        throw new Error('iterator');
      };
    },
    (r) => {
      delete r.matches[0];
    },
    (r) => {
      Object.setPrototypeOf(r.matches[0], { private: true });
    },
  ]) {
    const r = response();
    alter(r);
    assert.throws(() => validate(r));
  }
  assert.equal(invoked, 0);
});
