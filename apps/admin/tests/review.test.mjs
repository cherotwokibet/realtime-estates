import test from 'node:test';
import assert from 'node:assert/strict';
import {
  knownPublication,
  reviewReadback,
  reviewRejectionReason,
} from '../dist/tests/lib/review-model.js';
const before = {
  listingId: 'synthetic-listing',
  revision: 1,
  version: '9007199254740990',
  state: 'pending',
};
test('rejection notes accept bounded Unicode and explain invalid paragraph input before dispatch', () => {
  assert.equal(reviewRejectionReason('  Replace the image  '), 'Replace the image');
  assert.equal(reviewRejectionReason('🏠'.repeat(1000)), '🏠'.repeat(1000));
  for (const value of [
    ' ',
    'First paragraph\nSecond paragraph',
    'Bad\u0085reason',
    '\ud800',
    '🏠'.repeat(1001),
  ])
    assert.throws(() => reviewRejectionReason(value), /without line breaks/);
});
test('decision readback requires same resource, later revision version and exact saved reason', () => {
  const rejected = {
    ...before,
    state: 'rejected',
    version: '9007199254740991',
    decisionReason: 'Replace photo',
  };
  assert.equal(
    reviewReadback(before, { decision: 'reject', reason: 'Replace photo' }, rejected),
    'matching',
  );
  assert.equal(
    reviewReadback(before, { decision: 'reject', reason: 'Different reason' }, rejected),
    'different',
  );
  assert.equal(
    reviewReadback(
      before,
      { decision: 'reject', reason: 'Replace photo' },
      { ...rejected, version: before.version },
    ),
    'different',
  );
  assert.equal(
    reviewReadback(
      before,
      { decision: 'approve', reason: null },
      { ...before, version: '9007199254740992' },
    ),
    'pending',
  );
  assert.throws(
    () =>
      reviewReadback(before, { decision: 'approve', reason: null }, { ...rejected, revision: 2 }),
    /Unexpected review/,
  );
});
test('approval wording preserves pause/archive, selected revision and availability boundaries', () => {
  const approved = {
    state: 'approved',
    revision: 2,
    publishedRevision: 2,
    publicationStatus: 'published',
    availability: 'available',
    lastAvailabilityConfirmedAt: '2026-10-10T00:00:00Z',
  };
  assert.match(knownPublication(approved), /also requires current availability/);
  for (const publicationStatus of ['paused', 'archived'])
    assert.match(
      knownPublication({ ...approved, publicationStatus }),
      new RegExp(`Publication is ${publicationStatus}`),
    );
  assert.match(knownPublication({ ...approved, availability: 'rented' }), /Availability is rented/);
  assert.match(
    knownPublication({ ...approved, publishedRevision: 3 }),
    /different approved revision/,
  );
  assert.match(knownPublication({ ...approved, state: 'rejected' }), /has not approved/);
});
