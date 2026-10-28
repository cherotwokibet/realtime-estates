import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStaffViewingCalendar, validateViewingCalendarWindow } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const window = {
  fromAt: '2026-10-27T21:00:00.000Z',
  untilAt: '2026-11-03T21:00:00.000Z',
  timeZone: 'Africa/Nairobi',
};
const entry = (n = 1) => ({
  viewingId: id(n),
  enquiryId: id(5),
  listingId: id(6),
  title: 'Synthetic calendar studio',
  version: '9007199254740991',
  status: 'confirmed',
  slot: {
    startAt: '2026-10-28T07:00:00.000Z',
    endAt: '2026-10-28T08:00:00.000Z',
    timeZone: 'Africa/Nairobi',
  },
  enquiryClosed: false,
});
const page = () => ({
  policy: 'staff-viewing-calendar-v1',
  asOf: '2026-10-28T09:00:00.000Z',
  window: { ...window },
  scheduled: { items: [entry()], limit: 100, hasMore: false },
  unscheduled: {
    items: [
      {
        viewingId: id(2),
        enquiryId: id(5),
        listingId: id(6),
        title: 'Synthetic unscheduled request',
        version: '1',
        status: 'requested',
        createdAt: '2026-10-28T06:00:00.000Z',
        enquiryClosed: false,
      },
    ],
    limit: 25,
    hasMore: false,
  },
});
test('calendar retains canonical half-open window and frozen minimal current rows without adopting write authority', () => {
  const input = page(),
    read = validateStaffViewingCalendar(input, window);
  input.scheduled.items[0].title = 'Changed';
  assert.equal(read.scheduled.items[0].title, 'Synthetic calendar studio');
  assert.ok(Object.isFrozen(read));
  assert.ok(Object.isFrozen(read.scheduled.items[0].slot));
  assert.equal(read.scheduled.items[0].version, '9007199254740991');
  assert.throws(() =>
    validateStaffViewingCalendar(page(), { ...window, untilAt: '2026-11-04T21:00:00.000Z' }),
  );
});
test('calendar rejects private extras, getters, sparse/oversize/duplicate records and fabricated pagination', () => {
  let getterCalls = 0;
  for (const mutate of [
    (p) => (p.scheduled.items[0].email = 'private@example.invalid'),
    (p) => p.scheduled.items.push({ ...entry() }),
    (p) => (p.unscheduled.items[0].viewingId = id(1)),
    (p) => (p.scheduled.hasMore = true),
    (p) => (p.scheduled.items = new Array(1)),
    (p) => (p.scheduled.items = Array.from({ length: 101 }, (_, n) => entry(n + 10))),
    (p) =>
      Object.defineProperty(p, 'asOf', {
        enumerable: true,
        get() {
          getterCalls++;
          return '2026-10-28T09:00:00.000Z';
        },
      }),
    (p) =>
      Object.defineProperty(p.scheduled.items, '0', {
        enumerable: true,
        get() {
          getterCalls++;
          return entry();
        },
      }),
    (p) => (p.scheduled.items[0].version = '9223372036854775808'),
  ]) {
    const value = page();
    mutate(value);
    assert.throws(() => validateStaffViewingCalendar(value));
  }
  assert.equal(getterCalls, 0);
  const statusObject = page();
  statusObject.scheduled.items[0].status = {
    toString() {
      getterCalls++;
      return 'confirmed';
    },
  };
  assert.throws(() => validateStaffViewingCalendar(statusObject));
  assert.equal(getterCalls, 0);
});
test('calendar rejects impossible windows, non-overlapping slots, unknown status and future-created requests', () => {
  for (const w of [
    { ...window, timeZone: 'UTC' },
    { ...window, untilAt: window.fromAt },
    { ...window, untilAt: '2026-12-01T21:00:00.000Z' },
    { ...window, fromAt: '2026-02-30T21:00:00.000Z' },
    { ...window, fromAt: '2026-10-27T21:00:00Z' },
  ])
    assert.throws(() => validateViewingCalendarWindow(w));
  for (const mutate of [
    (p) =>
      (p.scheduled.items[0].slot = {
        ...entry().slot,
        startAt: '2026-10-27T20:00:00.000Z',
        endAt: window.fromAt,
      }),
    (p) =>
      (p.scheduled.items[0].slot = {
        ...entry().slot,
        startAt: window.untilAt,
        endAt: '2026-11-03T22:00:00.000Z',
      }),
    (p) => (p.scheduled.items[0].status = 'requested'),
    (p) => (p.unscheduled.items[0].createdAt = '2026-10-28T09:00:00.001Z'),
  ]) {
    const value = page();
    mutate(value);
    assert.throws(() => validateStaffViewingCalendar(value));
  }
  const boundary = page();
  boundary.scheduled.items[0].slot.startAt = window.fromAt;
  boundary.scheduled.items[0].slot.endAt = '2026-10-27T22:00:00.000Z';
  assert.equal(validateStaffViewingCalendar(boundary).scheduled.items.length, 1);
});
