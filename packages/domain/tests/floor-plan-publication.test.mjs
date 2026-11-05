import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePublishedFloorPlan,
  validateReviewFloorPlan,
  parseFloorPlanJson,
} from '../dist/index.js';
const listing = '00000000-0000-4000-8000-000000000100';
const image = { width: 512, height: 384, bytes: 93652, sha256: 'a'.repeat(64) };
const published = {
  policy: 'synthetic-published-floor-plan-v1',
  listingId: listing,
  revision: 1,
  approvedVersion: '5',
  floorPlan: image,
};
test('published floor-plan facts are strict frozen metadata without private provenance', () => {
  const r = validatePublishedFloorPlan(published, listing, 1);
  assert.deepEqual(r, published);
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.floorPlan));
  assert.equal(
    validatePublishedFloorPlan({ ...published, floorPlan: null }, listing, 1).floorPlan,
    null,
  );
  for (const v of [
    { ...published, actorId: listing },
    { ...published, revision: 2 },
    { ...published, approvedVersion: '05' },
    { ...published, approvedVersion: '9007199254740992' },
    ...['requestId', 'operationId', 'url', 'lease'].map((k) => ({
      ...published,
      floorPlan: { ...image, [k]: listing },
    })),
    ...['width', 'height', 'bytes'].flatMap((k) =>
      [0, NaN, Infinity, 1921.5].map((n) => ({ ...published, floorPlan: { ...image, [k]: n } })),
    ),
  ])
    assert.throws(() => validatePublishedFloorPlan(v, listing, 1));
  const accessor = { ...published };
  Object.defineProperty(accessor, 'floorPlan', {
    enumerable: true,
    get() {
      throw Error('Must not invoke getter');
    },
  });
  assert.throws(() => validatePublishedFloorPlan(accessor, listing, 1), /Invalid floor-plan facts/);
  assert.throws(() => parseFloorPlanJson('{"floorPlan":null,"floorPlan":{}}'));
});
test('review floor-plan metadata binds exact approved or pending revision version', () => {
  const state = {
    policy: 'synthetic-floor-plan-state-v1',
    listingId: listing,
    revision: 1,
    version: '5',
    state: 'pending',
    floorPlan: null,
  };
  assert.deepEqual(validateReviewFloorPlan(state, listing, 1, '5'), state);
  assert.equal(
    validateReviewFloorPlan({ ...state, state: 'approved' }, listing, 1, '5').state,
    'approved',
  );
  for (const v of [
    { ...state, state: 'draft' },
    { ...state, state: 'rejected' },
    { ...state, version: '6' },
    { ...state, revision: 2 },
  ])
    assert.throws(() => validateReviewFloorPlan(v, listing, 1, '5'));
});
