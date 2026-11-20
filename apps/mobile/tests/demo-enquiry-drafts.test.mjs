import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoEnquiryDrafts, DemoDraftError } from '../dist/tests/src/demo-enquiry-drafts.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const body = { kind: 'availability', message: '  Is this available?  ', preferredDay: '' };
const listing = 'demo-langata-1';
const make = () => {
  let sequence = 0,
    time = Date.parse('2026-11-20T20:59:00.000Z');
  return {
    store: createDemoEnquiryDrafts(
      'realtime-estates',
      () => id(++sequence),
      () => time,
    ),
    time: (value) => {
      time = value;
    },
  };
};
test('local draft owns its property, trims and freezes text, and repeated taps return one original', () => {
  const { store, time } = make(),
    input = { ...body },
    handle = store.begin(listing);
  const saved = handle.save(input);
  input.message = 'Mutated caller text';
  time(Date.parse('2027-01-01T00:00:00.000Z'));
  assert.equal(handle.save({ ...body }), saved);
  assert.equal(store.snapshot().length, 1);
  assert.equal(saved.message, 'Is this available?');
  assert.equal(saved.listingId, listing);
  assert.equal(saved.preferredDay, null);
  assert.ok(Object.isFrozen(saved));
  assert.ok(Object.isFrozen(store.snapshot()));
  assert.equal('receipt' in saved, false);
  assert.equal('status' in saved, false);
  assert.throws(() => handle.save({ ...body, message: 'Changed intent' }), DemoDraftError);
  assert.equal(store.snapshot()[0], saved);
});
test('demo-company boundaries reject foreign, hosted or unknown listing identities before allocating a draft', () => {
  let allocated = 0;
  const a = createDemoEnquiryDrafts('realtime-estates', () => {
    allocated++;
    return id(1);
  });
  for (const wrong of ['sample-property-1', id(10), 'missing'])
    assert.throws(() => a.begin(wrong), DemoDraftError);
  assert.equal(allocated, 0);
  assert.throws(() => createDemoEnquiryDrafts('foreign-company', () => id(1)), DemoDraftError);
  const b = createDemoEnquiryDrafts('sample-homes', () => id(1));
  assert.throws(() => b.begin(listing), DemoDraftError);
  assert.equal(b.begin('sample-property-1').save(body).listingId, 'sample-property-1');
  assert.equal(a.snapshot().length, 0);
});
test('viewing preferences validate real calendar days and Nairobi midnight without claiming an appointment', () => {
  const { store, time } = make();
  const handle = store.begin(listing);
  for (const day of ['', '2026-02-30', '2026-11-19', '2026-1-01', '2026-11-20T00:00:00Z'])
    assert.throws(
      () => handle.save({ ...body, kind: 'viewing', preferredDay: day }),
      DemoDraftError,
    );
  time(Date.parse('2026-11-20T21:01:00.000Z'));
  assert.throws(
    () => handle.save({ ...body, kind: 'viewing', preferredDay: '2026-11-20' }),
    DemoDraftError,
  );
  const row = handle.save({ ...body, kind: 'viewing', preferredDay: '2026-11-21' });
  assert.equal(row.kind, 'viewing');
  assert.equal(row.preferredDay, '2026-11-21');
  assert.equal('bookingId' in row, false);
  time(Date.parse('2026-11-22T00:00:00.000Z'));
  assert.equal(handle.save({ ...body, kind: 'viewing', preferredDay: '2026-11-21' }), row);
});
test('input failures and authority/accessor extras never mutate the local list', () => {
  const { store } = make(),
    handle = store.begin(listing);
  let getter = 0;
  const accessor = { kind: 'availability', preferredDay: '' };
  Object.defineProperty(accessor, 'message', {
    enumerable: true,
    get() {
      getter++;
      return 'secret';
    },
  });
  for (const input of [
    null,
    [],
    { ...body, actorId: id(2) },
    { ...body, kind: 'booked' },
    { ...body, message: '' },
    { ...body, message: 'a'.repeat(1001) },
    { ...body, message: 'bad\u0000text' },
    { ...body, message: '\ud800' },
    { ...body, preferredDay: '2026-11-21' },
    accessor,
  ])
    assert.throws(() => handle.save(input), DemoDraftError);
  assert.equal(getter, 0);
  assert.deepEqual(store.snapshot(), []);
  assert.equal(handle.save(body).message, 'Is this available?');
});
test('bounded drafts reject a late extra save, then removal permits a fresh draft and invalidates old handles', () => {
  const { store } = make(),
    handles = Array.from({ length: 11 }, () => store.begin(listing));
  for (let i = 0; i < 10; i++) handles[i].save({ ...body, message: 'Draft ' + i });
  assert.equal(store.snapshot().length, 10);
  assert.throws(() => handles[10].save(body), DemoDraftError);
  assert.throws(() => store.begin(listing), DemoDraftError);
  store.remove(store.snapshot()[0].id);
  assert.equal(store.snapshot().length, 9);
  assert.throws(() => handles[10].save(body), DemoDraftError);
  store.begin(listing).save(body);
  assert.equal(store.snapshot().length, 10);
});
test('background/reset invalidates both saved and unsaved handles and permits only newly opened drafts', () => {
  const { store } = make(),
    saved = store.begin(listing),
    pending = store.begin(listing);
  saved.save(body);
  store.clear();
  assert.deepEqual(store.snapshot(), []);
  assert.throws(() => saved.save(body), DemoDraftError);
  assert.throws(() => pending.save(body), DemoDraftError);
  const next = store.begin(listing).save(body);
  assert.equal(store.snapshot()[0], next);
});
test('duplicate or invalid generated references cannot replace another property draft', () => {
  assert.throws(
    () => createDemoEnquiryDrafts('realtime-estates', () => 'invalid').begin(listing),
    DemoDraftError,
  );
  const store = createDemoEnquiryDrafts('realtime-estates', () => id(1)),
    a = store.begin(listing),
    b = store.begin('demo-ruaka-1');
  a.save(body);
  assert.throws(() => b.save(body), DemoDraftError);
  assert.throws(() => store.begin(listing), DemoDraftError);
  assert.equal(store.snapshot().length, 1);
});
test('an unavailable clock refuses a new draft without changing state', () => {
  const store = createDemoEnquiryDrafts(
    'realtime-estates',
    () => id(1),
    () => NaN,
  );
  assert.throws(() => store.begin(listing).save(body), DemoDraftError);
  assert.equal(store.snapshot().length, 0);
});
