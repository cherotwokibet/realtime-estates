import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateStaffViewingCalendar } from '@realtor/domain';
import { startStaffPreview } from './staff-preview.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const window = {
  fromAt: '2020-01-01T00:00:00.000Z',
  untilAt: '2020-01-03T00:00:00.000Z',
  timeZone: 'Africa/Nairobi',
};
const path =
  '/v2/staff/viewings/calendar?fromAt=' +
  encodeURIComponent(window.fromAt) +
  '&untilAt=' +
  encodeURIComponent(window.untilAt);
test('actual signed calendar isolates both companies and immediately reflects current enquiry assignment', async () => {
  for (const [tenantSlug, base, viewingBase, peer] of [
    ['realtime-estates', 700, 900, 12],
    ['sample-homes', 800, 910, 22],
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
      for (const role of ['admin', 'agent']) {
        const response = await call(role);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('cache-control'), /no-store/);
        const value = validateStaffViewingCalendar(await response.json(), window);
        assert.deepEqual(
          value.scheduled.items.map((item) => item.viewingId),
          [id(viewingBase), id(viewingBase + 1)],
        );
        assert.equal(value.unscheduled.items.length, 0);
        assert.equal(value.scheduled.items[1].slot.startAt, '2020-01-02T09:00:00.000Z');
        assert.ok(!JSON.stringify(value).includes('@example.invalid'));
        assert.ok(!JSON.stringify(value).includes('agreement'));
      }
      const assigned = await fetch(
        preview.origin + `/v2/staff/enquiries/${id(base + 1)}/operations`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${preview.enquiryStaff.admin.bearerToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            operationId: randomUUID(),
            kind: 'assign',
            expectedVersion: 2,
            assignedAgentId: id(peer),
            status: null,
            nextActionAt: null,
            reason: null,
          }),
        },
      );
      assert.equal(assigned.status, 200);
      assert.equal((await assigned.json()).outcome, 'applied');
      const denied = validateStaffViewingCalendar(await (await call('agent')).json(), window);
      assert.equal(denied.scheduled.items.length, 0);
      const admin = validateStaffViewingCalendar(await (await call('admin')).json(), window);
      assert.equal(admin.scheduled.items.length, 2);
      const edge =
        '/v2/staff/viewings/calendar?fromAt=2020-01-01T10%3A00%3A00.000Z&untilAt=2020-01-02T09%3A00%3A00.000Z';
      const response = await fetch(preview.origin + edge, {
        headers: { authorization: `Bearer ${preview.enquiryStaff.admin.bearerToken}` },
      });
      assert.equal(response.status, 200);
      assert.equal(
        (await response.json()).scheduled.items.length,
        0,
        'slot ending at from or starting at until is excluded',
      );
    } finally {
      await preview.close();
    }
  }
});
