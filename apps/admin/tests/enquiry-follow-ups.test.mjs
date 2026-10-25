import test from 'node:test';
import assert from 'node:assert/strict';
import { enquiryFollowUps } from '../dist/tests/lib/enquiry-model.js';

const row = (id, nextActionAt, status = 'contacted') => Object.freeze({ id, nextActionAt, status });
const now = Date.parse('2026-10-25T20:59:59.000Z'); // 23:59:59 Nairobi

test('loaded follow-ups use inclusive current time and Nairobi midnight, excluding closed historical dates', () => {
  const items = Object.freeze([
    row('later', '2026-10-25T20:59:59.500Z'),
    row('tomorrow', '2026-10-25T21:00:00.000Z'),
    row('exact', '2026-10-25T20:59:59.000Z'),
    row('past', '2026-10-25T20:59:58.999Z'),
    row('won', '2026-10-24T00:00:00.000Z', 'closed_won'),
    row('lost', '2026-10-24T00:00:00.000Z', 'closed_lost'),
    row('spam', '2026-10-24T00:00:00.000Z', 'spam'),
    row('none', null),
  ]);
  const result = enquiryFollowUps(items, now);
  assert.deepEqual(
    result.overdue.map((item) => item.id),
    ['past'],
  );
  assert.deepEqual(
    result.today.map((item) => item.id),
    ['exact', 'later'],
  );
  assert.equal(result.today[0], items[2]);
  assert.ok(
    Object.isFrozen(result) && Object.isFrozen(result.today) && Object.isFrozen(result.overdue),
  );
  assert.equal(items[0].id, 'later');
  assert.deepEqual(
    enquiryFollowUps(items, Date.parse('2026-10-25T21:00:00.000Z')).today.map((item) => item.id),
    ['tomorrow'],
  );
});

test('follow-ups order oldest first with stable ID ties and contain only the supplied visible slice', () => {
  const items = [
    row('b', '2026-10-24T08:00:00.000Z', 'assigned'),
    row('a', '2026-10-24T08:00:00.000Z', 'new'),
    row('c', '2026-10-23T08:00:00.000Z', 'qualified'),
  ];
  assert.deepEqual(
    enquiryFollowUps(items, now).overdue.map((item) => item.id),
    ['c', 'a', 'b'],
  );
  assert.deepEqual(
    items.map((item) => item.id),
    ['b', 'a', 'c'],
  );
  assert.deepEqual(enquiryFollowUps([], now), { overdue: [], today: [] });
  assert.throws(() => enquiryFollowUps(items, NaN), /Current time/);
  assert.throws(() => enquiryFollowUps([row('broken', 'not-a-time')], now));
});
