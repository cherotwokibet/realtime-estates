import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStaffOperationsOverview } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sample = () => ({
  policy: 'staff-operations-overview-v1',
  asOf: '2026-10-28T08:00:00.000Z',
  freshnessDays: 30,
  limit: 10,
  staleStock: {
    items: [{ listingId: id(1), title: 'Synthetic stale stock', lastCheckedAt: null }],
    hasMore: false,
  },
  pendingReviews: {
    items: [
      {
        listingId: id(2),
        revision: 1,
        title: 'Synthetic review',
        submittedAt: '2026-10-28T07:00:00.000Z',
      },
    ],
    hasMore: false,
  },
  overdueEnquiries: {
    items: [
      { enquiryId: id(3), name: 'Synthetic prospect', nextActionAt: '2026-10-28T07:00:00.000Z' },
    ],
    hasMore: false,
  },
  viewingOutcomes: {
    items: [
      {
        enquiryId: id(3),
        viewingId: id(4),
        listingId: id(1),
        title: 'Synthetic viewing',
        endedAt: '2026-10-28T07:30:00.000Z',
      },
    ],
    hasMore: false,
  },
});
test('operations overview snapshots only the fixed bounded summary without private details', () => {
  const input = sample(),
    result = validateStaffOperationsOverview(input);
  input.staleStock.items[0].title = 'changed';
  assert.equal(result.staleStock.items[0].title, 'Synthetic stale stock');
  for (const value of [
    result,
    result.staleStock,
    result.staleStock.items,
    result.staleStock.items[0],
  ])
    assert.ok(Object.isFrozen(value));
});
test('operations overview rejects private additions, invalid clocks and inconsistent queue states', () => {
  const cases = [
    (x) => (x.email = 'private@example.invalid'),
    (x) => (x.overdueEnquiries.items[0].message = 'private'),
    (x) => (x.asOf = '2026-02-30T08:00:00.000Z'),
    (x) => (x.freshnessDays = 7),
    (x) => (x.staleStock.items[0].lastCheckedAt = '2026-09-28T08:00:00.000Z'),
    (x) => (x.pendingReviews.items[0].submittedAt = '2026-10-29T00:00:00.000Z'),
    (x) => (x.overdueEnquiries.items[0].nextActionAt = x.asOf),
    (x) => (x.viewingOutcomes.items[0].endedAt = '2026-10-29T00:00:00.000Z'),
    (x) => (x.pendingReviews.items[0].revision = 0),
    (x) => (x.staleStock.hasMore = true),
    (x) => x.staleStock.items.push(x.staleStock.items[0]),
    (x) => (x.staleStock.items[0].listingId = 'invalid'),
  ];
  for (const change of cases) {
    const input = sample();
    change(input);
    assert.throws(() => validateStaffOperationsOverview(input));
  }
});
test('ten-item continuation and empty queues are explicit; sparse/accessor arrays are rejected without invoking them', () => {
  const input = sample();
  input.staleStock = {
    items: Array.from({ length: 10 }, (_, n) => ({
      listingId: id(n + 10),
      title: 'Synthetic stock',
      lastCheckedAt: '2026-09-01T00:00:00.000Z',
    })),
    hasMore: true,
  };
  assert.equal(validateStaffOperationsOverview(input).staleStock.items.length, 10);
  input.staleStock.items.push({ listingId: id(30), title: 'Too many', lastCheckedAt: null });
  assert.throws(() => validateStaffOperationsOverview(input));
  input.staleStock = { items: [], hasMore: false };
  assert.equal(validateStaffOperationsOverview(input).staleStock.items.length, 0);
  input.staleStock.items.length = 1;
  assert.throws(() => validateStaffOperationsOverview(input));
  let invoked = false;
  Object.defineProperty(input.staleStock.items, '0', {
    enumerable: true,
    get() {
      invoked = true;
      return {};
    },
  });
  assert.throws(() => validateStaffOperationsOverview(input));
  assert.equal(invoked, false);
});
