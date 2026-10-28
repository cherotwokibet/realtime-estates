import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStaffOperationsOverview } from '@realtor/domain';
import { startStaffPreview } from './staff-preview.mjs';
const path = '/v2/staff/operations/overview';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('actual signed HTTP/restricted SQL operations read isolates pending reviews for both companies', async () => {
  for (const [tenantSlug, listing, paused] of [
    ['realtime-estates', 400, 402],
    ['sample-homes', 500, 502],
  ]) {
    const preview = await startStaffPreview({
      port: 0,
      tenantSlug,
      actor: 'admin',
      seedPendingReviews: true,
    });
    try {
      const response = await fetch(preview.origin + path, {
        headers: { authorization: `Bearer ${preview.bearerToken}` },
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control'), /no-store/);
      const data = validateStaffOperationsOverview(await response.json());
      assert.deepEqual(
        data.pendingReviews.items.map((item) => item.listingId).sort(),
        [id(listing), id(paused)].sort(),
      );
      assert.equal(data.overdueEnquiries.items.length, 0);
      assert.equal(data.viewingOutcomes.items.length, 0);
      assert.equal(data.staleStock.items.length, 0);
    } finally {
      await preview.close();
    }
  }
});
test('actual signed admin overview discovers overdue work and ended confirmed viewings while agent reads are denied', async () => {
  for (const [tenantSlug, enquiryBase, viewingBase] of [
    ['realtime-estates', 700, 900],
    ['sample-homes', 800, 910],
  ]) {
    const preview = await startStaffPreview({
      port: 0,
      tenantSlug,
      enquiryPreview: 'synthetic-v1',
      enquiryCatalogue: 'synthetic-v1',
      historicalViewings: 'synthetic-v1',
    });
    try {
      const call = (role) =>
        fetch(preview.origin + path, {
          headers: { authorization: `Bearer ${preview.enquiryStaff[role].bearerToken}` },
        });
      assert.equal((await call('agent')).status, 403);
      const response = await call('admin');
      assert.equal(response.status, 200);
      const data = validateStaffOperationsOverview(await response.json());
      assert.deepEqual(
        data.overdueEnquiries.items.map((item) => item.enquiryId).sort(),
        [id(enquiryBase + 2), id(enquiryBase + 4)].sort(),
      );
      assert.deepEqual(
        data.viewingOutcomes.items.map((item) => item.viewingId).sort(),
        [id(viewingBase), id(viewingBase + 1)].sort(),
      );
      assert.equal(data.staleStock.items.length, 0);
      const raw = JSON.stringify(data);
      assert.ok(!raw.includes('@example.invalid'));
      assert.ok(!raw.includes('PRIVATE'));
      assert.ok(!raw.includes('phoneAgreement'));
      const second = validateStaffOperationsOverview(await (await call('admin')).json());
      assert.deepEqual(second.overdueEnquiries, data.overdueEnquiries);
      assert.deepEqual(second.viewingOutcomes, data.viewingOutcomes);
    } finally {
      await preview.close();
    }
  }
});
