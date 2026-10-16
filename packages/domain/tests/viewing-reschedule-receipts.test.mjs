import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateViewingSchedule,
  validateViewingDetail,
  validateViewingRescheduleReceipt,
  validateViewingConfirmationReceipt,
  validateViewingTerminationReceipt,
  validateViewingHistoryPage,
} from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (hour) => `2026-10-14T${hour}:00:00.000Z`,
  end = '2026-10-15T00:00:00.000Z';
const slot = (day) => ({
  startAt: `2090-01-0${day}T09:00:00.000Z`,
  endAt: `2090-01-0${day}T10:00:00.000Z`,
  timeZone: 'Africa/Nairobi',
});
const requested = {
  viewingId: id(2),
  enquiryId: id(3),
  listingId: id(4),
  version: '1',
  status: 'requested',
  preferredSlots: [],
  proposedSlot: null,
};
const proposed = { ...requested, version: '2', status: 'proposed', proposedSlot: slot(1) },
  first = {
    ...proposed,
    version: '3',
    status: 'confirmed',
    agreement: {
      channel: 'phone',
      agreedAt: '2026-10-14T18:30:00.000Z',
      notes: 'Original phone facts.',
    },
  };
const reason = '  Synthetic reschedule.\nKeep exact reason.  ',
  cycle = {
    number: '2',
    proposalVersion: '4',
    proposedAt: at('20'),
    reason,
    previousStatus: 'confirmed',
    previousUpdatedAt: at('19'),
  };
const second = { ...proposed, version: '4', proposedSlot: slot(2), cycle },
  secondAgreed = {
    ...second,
    version: '5',
    status: 'confirmed',
    agreement: {
      channel: 'phone',
      agreedAt: '2026-10-14T20:30:00.000Z',
      notes: 'New exact agreement.',
    },
  };
const third = {
    ...second,
    version: '6',
    proposedSlot: slot(3),
    cycle: {
      ...cycle,
      number: '3',
      proposalVersion: '6',
      proposedAt: at('22'),
      previousUpdatedAt: at('21'),
    },
  },
  thirdAgreed = {
    ...third,
    version: '7',
    status: 'confirmed',
    agreement: {
      channel: 'phone',
      agreedAt: '2026-10-14T22:30:00.000Z',
      notes: 'Third exact agreement.',
    },
  };
const ended = {
  ...thirdAgreed,
  status: 'cancelled',
  version: '8',
  termination: {
    kind: 'cancel',
    fromStatus: 'confirmed',
    reason: 'Synthetic ending.',
    endedAt: end,
    previousUpdatedAt: at('23'),
  },
};
const command = { operationId: id(1), expectedVersion: '3', slot: slot(2), reason },
  receipt = {
    operationId: id(1),
    enquiryId: id(3),
    viewingId: id(2),
    actorId: id(5),
    kind: 'reschedule',
    expectedVersion: '3',
    observedVersion: '3',
    request: { slot: slot(2), reason },
    outcome: 'applied',
    reason: null,
    result: second,
    completedAt: at('20'),
  };
const validate = (value) => validateViewingRescheduleReceipt(value, id(3), id(2), command);
test('current cycle projections carry no active old agreement and derive exact proposed or confirmed versions', () => {
  assert.deepEqual(validateViewingSchedule(second), second);
  assert.deepEqual(validateViewingSchedule(secondAgreed), secondAgreed);
  assert.ok(Object.isFrozen(validateViewingSchedule(second).cycle));
  assert.equal(Object.hasOwn(validateViewingSchedule(second), 'agreement'), false);
  for (const patch of [
    { agreement: first.agreement },
    { version: '3' },
    { cycle: { ...cycle, number: '1' } },
    { cycle: { ...cycle, previousStatus: 'requested' } },
    { cycle: { ...cycle, previousStatus: 'proposed' } },
    { cycle: { ...cycle, previousUpdatedAt: at('21') } },
    { cycle: { ...cycle, proposalVersion: '5' } },
  ])
    assert.throws(() => validateViewingSchedule({ ...second, ...patch }));
});
test('current detail binds confirming metadata to its new proposal while retaining original interest', () => {
  const detail = {
    schedule: secondAgreed,
    notes: 'Original interest.',
    requestedById: id(5),
    assignedAgentId: id(6),
    createdAt: at('17'),
    updatedAt: at('21'),
    confirmation: { proposedAt: at('20'), recordedAt: at('21'), recordedById: id(6) },
  };
  assert.deepEqual(validateViewingDetail(detail, id(3)), detail);
  for (const patch of [
    { confirmation: { ...detail.confirmation, proposedAt: at('18') } },
    { schedule: { ...secondAgreed, agreement: first.agreement } },
    { updatedAt: at('19') },
  ])
    assert.throws(() => validateViewingDetail({ ...detail, ...patch }, id(3)));
});
test('reschedule original receipt binds exact new slot,reason,target,cycle chronology and version', () => {
  assert.deepEqual(validate(receipt), receipt);
  for (const patch of [
    { kind: 'propose' },
    { viewingId: id(9) },
    { request: { slot: slot(3), reason } },
    { request: { slot: slot(2), reason: 'changed' } },
    { completedAt: at('21') },
    { result: { ...second, cycle: { ...cycle, reason: 'changed' } } },
    { result: { ...second, cycle: { ...cycle, number: '3' } } },
  ])
    assert.throws(() => validate({ ...receipt, ...patch }));
  assert.equal(
    validate({
      ...receipt,
      outcome: 'conflict',
      reason: 'VERSION_CONFLICT',
      observedVersion: '4',
      result: null,
    }).outcome,
    'conflict',
  );
  for (const reason of [
    'ENQUIRY_CLOSED',
    'LISTING_UNAVAILABLE',
    'INVALID_STATE',
    'RECORD_TIME_IN_FUTURE',
    'SLOT_UNCHANGED',
  ])
    assert.equal(
      validate({ ...receipt, outcome: 'refused', reason, result: null }).outcome,
      'refused',
    );
});
test('confirmation and ending original validators support later cycle versions without agreement transfer', () => {
  const phone = {
    operationId: id(1),
    expectedVersion: '4',
    slot: slot(2),
    channel: 'phone',
    agreedAt: secondAgreed.agreement.agreedAt,
    notes: secondAgreed.agreement.notes,
  };
  const confirmed = {
    ...receipt,
    kind: 'confirm',
    expectedVersion: '4',
    observedVersion: '4',
    request: { slot: slot(2), ...secondAgreed.agreement },
    result: secondAgreed,
    completedAt: at('21'),
  };
  assert.deepEqual(validateViewingConfirmationReceipt(confirmed, id(3), id(2), phone), confirmed);
  const endingCommand = {
      operationId: id(1),
      expectedVersion: '7',
      reason: ended.termination.reason,
    },
    ending = {
      ...receipt,
      kind: 'cancel',
      expectedVersion: '7',
      observedVersion: '7',
      request: { reason: endingCommand.reason },
      result: ended,
      completedAt: end,
    };
  assert.deepEqual(
    validateViewingTerminationReceipt(ending, id(3), id(2), 'cancel', endingCommand),
    ending,
  );
});
test('history verifies all repeated cycles with contiguous versions and unchanged old evidence', () => {
  const event = (kind, recordedAt, schedule) => ({ kind, recordedAt, actorId: id(5), schedule }),
    page = {
      items: [
        event('cancel', end, ended),
        event('confirm', at('23'), thirdAgreed),
        event('reschedule', at('22'), third),
        event('confirm', at('21'), secondAgreed),
        event('reschedule', at('20'), second),
        event('confirm', at('19'), first),
        event('propose', at('18'), proposed),
        event('request', at('17'), requested),
      ],
      limit: 25,
      truncated: false,
      currentVersion: '8',
    };
  assert.deepEqual(validateViewingHistoryPage(page, id(3), id(2), 25), page);
  const changed = structuredClone(page);
  changed.items[2].schedule.cycle.previousUpdatedAt = at('20');
  assert.throws(() => validateViewingHistoryPage(changed, id(3), id(2), 25));
  const sameSlot = structuredClone(page);
  sameSlot.items[4].schedule.proposedSlot = slot(1);
  assert.throws(() => validateViewingHistoryPage(sameSlot, id(3), id(2), 25));
  assert.equal(
    validateViewingHistoryPage(
      { ...page, items: page.items.slice(0, 3), limit: 3, truncated: true },
      id(3),
      id(2),
      3,
    ).items.length,
    3,
  );
});
test('cycle metadata rejects hidden fields and accessors without executing caller code', () => {
  let touched = false;
  const raw = { ...second };
  Object.defineProperty(raw, 'cycle', {
    enumerable: true,
    get() {
      touched = true;
      return cycle;
    },
  });
  assert.throws(() => validateViewingSchedule(raw));
  assert.equal(touched, false);
  const hidden = { ...cycle };
  Object.defineProperty(hidden, 'actorId', { value: id(9) });
  assert.throws(() => validateViewingSchedule({ ...second, cycle: hidden }));
});
