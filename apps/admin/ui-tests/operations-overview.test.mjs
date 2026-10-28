import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { validateStaffOperationsOverview } from '@realtor/domain';
import OperationsOverview from '../dist/tests/components/OperationsOverview.js';
import { enquiryEntryTarget, reviewEntryTarget } from '../dist/tests/lib/operations-navigation.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('overview renders bounded labelled work and safe links to fresh authorized actions', () => {
  const q = (items) => ({ items, hasMore: false });
  const data = validateStaffOperationsOverview({
    policy: 'staff-operations-overview-v1',
    asOf: '2026-10-28T08:00:00.000Z',
    freshnessDays: 30,
    limit: 10,
    staleStock: q([{ listingId: id(1), title: '<script>synthetic</script>', lastCheckedAt: null }]),
    pendingReviews: q([
      {
        listingId: id(2),
        revision: 4,
        title: 'Synthetic review',
        submittedAt: '2026-10-28T07:00:00.000Z',
      },
    ]),
    overdueEnquiries: q([
      { enquiryId: id(3), name: 'Synthetic prospect', nextActionAt: '2026-10-28T07:00:00.000Z' },
    ]),
    viewingOutcomes: q([
      {
        enquiryId: id(3),
        viewingId: id(4),
        listingId: id(1),
        title: 'Synthetic viewing',
        endedAt: '2026-10-28T07:00:00.000Z',
      },
    ]),
  });
  const html = renderToStaticMarkup(React.createElement(OperationsOverview, { data }));
  assert.ok(html.includes('/listings/' + id(1) + '/controls'));
  assert.ok(html.includes('/reviews?listingId=' + id(2) + '&amp;revision=4'));
  assert.ok(html.includes('/enquiries/admin?enquiryId=' + id(3) + '&amp;viewingId=' + id(4)));
  assert.ok(html.includes('not company totals'));
  assert.ok(html.includes('720 hours'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Attendance has not been established'));
});
test('entry targets reject authority fields, repeated or malformed IDs, orphan viewing targets and invalid revision numbers', () => {
  assert.equal(enquiryEntryTarget({}), null);
  assert.equal(reviewEntryTarget({}), null);
  assert.deepEqual(enquiryEntryTarget({ enquiryId: id(3), viewingId: id(4) }), {
    enquiryId: id(3),
    viewingId: id(4),
  });
  assert.deepEqual(reviewEntryTarget({ listingId: id(2), revision: '4' }), {
    listingId: id(2),
    revision: 4,
  });
  for (const query of [
    { viewingId: id(4) },
    { enquiryId: [id(3), id(3)] },
    { enquiryId: id(3), tenantId: id(9) },
    { enquiryId: 'bad' },
  ])
    assert.throws(() => enquiryEntryTarget(query));
  for (const query of [
    { listingId: id(2) },
    { listingId: id(2), revision: '0' },
    { listingId: id(2), revision: '2147483648' },
    { listingId: id(2), revision: ['4', '4'] },
    { listingId: id(2), revision: '4', role: 'admin' },
  ])
    assert.throws(() => reviewEntryTarget(query));
});
