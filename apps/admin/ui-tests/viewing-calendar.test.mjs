import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { validateStaffViewingCalendar } from '@realtor/domain';
import ViewingCalendar from '../dist/tests/components/ViewingCalendar.js';
import {
  viewingCalendarSelection,
  calendarDay,
  calendarTime,
} from '../dist/tests/lib/viewing-calendar-model.js';
import { enquiryEntryTarget } from '../dist/tests/lib/operations-navigation.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('calendar date selection retains exact Nairobi boundaries across month/year and refuses posted scope', () => {
  const current = viewingCalendarSelection({}, Date.parse('2026-10-27T22:00:00.000Z'));
  assert.equal(current.date, '2026-10-28');
  assert.equal(current.window.fromAt, '2026-10-27T21:00:00.000Z');
  assert.equal(current.window.untilAt, '2026-11-03T21:00:00.000Z');
  const year = viewingCalendarSelection({ date: '2026-12-31', days: '7' });
  assert.equal(year.window.untilAt, '2027-01-06T21:00:00.000Z');
  assert.equal(calendarDay('2026-10-27T21:00:00.000Z'), '2026-10-28');
  assert.ok(calendarTime('2026-10-28T09:00:00.000Z').includes('12:00:00'));
  assert.ok(calendarTime('2026-10-28T09:00:00.000Z').includes('+03:00'));
  for (const query of [
    { date: '2026-02-30' },
    { date: '0000-01-01' },
    { date: ['2026-10-28'] },
    { days: '2' },
    { days: ['7', '7'] },
    { date: '2026-10-28', companyId: id(9) },
    { date: '2026-10-28', role: 'admin' },
  ])
    assert.throws(() => viewingCalendarSelection(query));
});
test('calendar separates proposals from confirmations/outcomes and escapes labels in fresh record links', () => {
  const window = viewingCalendarSelection({ date: '2026-10-28', days: '7' }).window;
  const base = {
    enquiryId: id(7),
    listingId: id(8),
    version: '3',
    slot: {
      startAt: '2026-10-28T09:00:00.000Z',
      endAt: '2026-10-28T10:00:00.000Z',
      timeZone: 'Africa/Nairobi',
    },
    enquiryClosed: false,
  };
  const data = validateStaffViewingCalendar({
    policy: 'staff-viewing-calendar-v1',
    asOf: '2026-10-28T08:00:00.000Z',
    window,
    scheduled: {
      limit: 100,
      hasMore: false,
      items: [
        { ...base, viewingId: id(1), title: '<script>synthetic</script>', status: 'proposed' },
        {
          ...base,
          viewingId: id(2),
          title: 'Fictional completed slot',
          status: 'completed',
          enquiryClosed: true,
        },
      ],
    },
    unscheduled: {
      limit: 25,
      hasMore: false,
      items: [
        {
          viewingId: id(3),
          enquiryId: id(7),
          listingId: id(8),
          title: 'Unscheduled synthetic request',
          version: '1',
          status: 'requested',
          createdAt: '2026-10-28T07:00:00.000Z',
          enquiryClosed: false,
        },
      ],
    },
  });
  const html = renderToStaticMarkup(React.createElement(ViewingCalendar, { data, actor: 'agent' }));
  assert.ok(html.includes('Proposed · awaiting agreement'));
  assert.ok(html.includes('Completed · staff-reported'));
  assert.ok(html.includes('The enquiry is closed'));
  assert.ok(html.includes('Assigned enquiries only'));
  assert.ok(html.includes('not company totals'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(
    html.includes(
      '/enquiries/agent?enquiryId=' +
        id(7) +
        '&amp;viewingId=' +
        id(1) +
        '&amp;viewingMode=inspect',
    ),
  );
  assert.ok(html.includes('Preferred times are not confirmed appointments'));
});
test('linked inspection is a strict read-navigation mode requiring the original enquiry/viewing tuple', () => {
  assert.deepEqual(
    enquiryEntryTarget({ enquiryId: id(1), viewingId: id(2), viewingMode: 'inspect' }),
    { enquiryId: id(1), viewingId: id(2), viewingMode: 'inspect' },
  );
  for (const query of [
    { enquiryId: id(1), viewingMode: 'inspect' },
    { enquiryId: id(1), viewingId: id(2), viewingMode: 'complete' },
    { enquiryId: id(1), viewingId: id(2), viewingMode: ['inspect', 'inspect'] },
    { enquiryId: id(1), viewingId: id(2), viewingMode: 'inspect', actor: 'admin' },
  ])
    assert.throws(() => enquiryEntryTarget(query));
});
