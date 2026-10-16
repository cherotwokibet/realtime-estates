import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEnquiryActivityPage } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const event = (patch = {}) => ({
  eventId: id(1),
  kind: 'received',
  actorId: null,
  occurredAt: '2026-10-13T00:00:00.000Z',
  version: '1',
  status: 'new',
  assignedAgentId: null,
  nextActionAt: null,
  ...patch,
});
const page = (patch = {}) => ({
  items: [event()],
  limit: 50,
  truncated: false,
  coverage: 'capture-and-v2-operations',
  currentVersion: '1',
  ...patch,
});
test('activity validates minimal immutable historical snapshots and explicit incomplete coverage', () => {
  const value = validateEnquiryActivityPage(page({ currentVersion: '7' }), 50);
  assert.equal(value.currentVersion, '7');
  assert.equal(value.items[0].actorId, null);
  assert.ok(
    Object.isFrozen(value) && Object.isFrozen(value.items) && Object.isFrozen(value.items[0]),
  );
});
test('activity rejects hidden contact fields, invalid dates/roles/order and impossible coverage', () => {
  const bad = [
    page({ coverage: 'complete' }),
    page({ secret: 'private' }),
    page({ truncated: true }),
    page({ items: [] }),
    page({ currentVersion: '0' }),
    page({ items: [event({ phone: 'private' })] }),
    page({ items: [event({ occurredAt: '2026-02-30T00:00:00.000Z' })] }),
    page({ items: [event({ kind: 'reschedule' })] }),
    page({ items: [event(), event()] }),
    page({ items: [event({ status: 'contacted' })] }),
    page({ items: [event({ kind: { toString: () => 'received' } })] }),
  ];
  for (const value of bad) assert.throws(() => validateEnquiryActivityPage(value, 50));
});
test('activity preserves historical follow-up values with decreasing versions and bounded truncation', () => {
  const row = event({
    kind: 'transition',
    actorId: id(2),
    version: '3',
    status: 'contacted',
    assignedAgentId: id(2),
    nextActionAt: '2026-10-14T06:00:00.000Z',
  });
  assert.equal(
    validateEnquiryActivityPage(
      page({ items: [row], limit: 1, truncated: true, currentVersion: '4' }),
      1,
    ).items[0].nextActionAt,
    row.nextActionAt,
  );
  assert.throws(() => validateEnquiryActivityPage(page({ items: [row], currentVersion: '2' }), 50));
});
