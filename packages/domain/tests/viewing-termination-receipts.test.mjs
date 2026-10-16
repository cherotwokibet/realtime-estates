import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateViewingSchedule,
  validateViewingDetail,
  validateViewingPage,
  validateViewingTerminationReceipt,
  planViewingTermination,
} from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const slot = {
    startAt: '2026-10-15T09:00:00.000Z',
    endAt: '2026-10-15T10:00:00.000Z',
    timeZone: 'Africa/Nairobi',
  },
  reason = '  Fictional ending reason.  ',
  endedAt = '2026-10-16T00:00:00.000Z',
  previousUpdatedAt = '2026-10-14T08:00:00.000Z';
const command = { operationId: id(1), expectedVersion: '3', reason },
  agreement = {
    channel: 'phone',
    agreedAt: '2026-10-14T07:00:00.000Z',
    notes: 'Original phone agreement.',
  };
const schedule = {
  viewingId: id(2),
  enquiryId: id(3),
  listingId: id(4),
  version: '4',
  status: 'cancelled',
  preferredSlots: [],
  proposedSlot: slot,
  agreement,
  termination: { kind: 'cancel', fromStatus: 'confirmed', reason, endedAt, previousUpdatedAt },
};
const detail = {
  schedule,
  notes: 'Original interest.',
  requestedById: id(5),
  assignedAgentId: id(6),
  createdAt: '2026-10-13T00:00:00.000Z',
  updatedAt: endedAt,
  confirmation: {
    proposedAt: '2026-10-14T06:00:00.000Z',
    recordedAt: previousUpdatedAt,
    recordedById: id(6),
  },
  terminationRecord: { recordedById: id(7) },
};
const receipt = {
  operationId: id(1),
  enquiryId: id(3),
  viewingId: id(2),
  actorId: id(7),
  kind: 'cancel',
  expectedVersion: '3',
  observedVersion: '3',
  request: { reason },
  outcome: 'applied',
  reason: null,
  result: schedule,
  completedAt: endedAt,
};
const validate = (value) =>
  validateViewingTerminationReceipt(value, id(3), id(2), 'cancel', command);
test('terminal detail preserves previous confirmed metadata after slot passes and has a separate immutable ending actor', () => {
  const saved = validateViewingDetail(detail, id(3));
  assert.deepEqual(saved, detail);
  assert.ok(
    Object.isFrozen(saved.schedule.termination) && Object.isFrozen(saved.terminationRecord),
  );
  assert.deepEqual(
    validateViewingPage({ items: [detail], limit: 25, truncated: false }, id(3), 25).items[0],
    detail,
  );
  assert.equal(
    planViewingTermination(detail, 'cancel', { ...command, expectedVersion: '4' }, endedAt).reason,
    'INVALID_STATE',
  );
});
test('terminal snapshot requires correct state,prior stage,version,reason and unchanged valid phone chronology', () => {
  for (const patch of [
    { version: '3' },
    { status: 'declined' },
    { agreement: undefined },
    { termination: { ...schedule.termination, kind: 'decline' } },
    { termination: { ...schedule.termination, fromStatus: 'cancelled' } },
    { termination: { ...schedule.termination, reason: ' ' } },
    { termination: { ...schedule.termination, previousUpdatedAt: '2026-10-17T00:00:00.000Z' } },
  ])
    assert.throws(() => validateViewingSchedule({ ...schedule, ...patch }));
  const requested = {
    ...schedule,
    version: '2',
    status: 'declined',
    proposedSlot: null,
    termination: { ...schedule.termination, kind: 'decline', fromStatus: 'requested' },
  };
  delete requested.agreement;
  assert.equal(validateViewingSchedule(requested).status, 'declined');
});
test('terminal detail cannot replace confirmed recorded time with ending time or omit private ending attribution', () => {
  for (const patch of [
    { terminationRecord: undefined },
    { confirmation: { ...detail.confirmation, recordedAt: endedAt } },
    { updatedAt: '2026-10-16T00:00:00.001Z' },
    { terminationRecord: { recordedById: 'invented' } },
    {
      schedule: {
        ...schedule,
        termination: { ...schedule.termination, previousUpdatedAt: '2026-10-12T00:00:00.000Z' },
      },
    },
  ])
    assert.throws(() => validateViewingDetail({ ...detail, ...patch }, id(3)));
});
test('original terminal receipt binds exact reason,kind,target,time/version and supports terminal conflict/refusal results', () => {
  assert.deepEqual(validate(receipt), receipt);
  for (const patch of [
    { kind: 'decline' },
    { viewingId: id(99) },
    { expectedVersion: '2' },
    { request: { reason: 'changed' } },
    { completedAt: '2026-10-16T00:00:00.001Z' },
    { result: { ...schedule, termination: { ...schedule.termination, reason: 'changed' } } },
  ])
    assert.throws(() => validate({ ...receipt, ...patch }));
  const conflict = {
    ...receipt,
    outcome: 'conflict',
    reason: 'VERSION_CONFLICT',
    observedVersion: '4',
    result: null,
  };
  assert.deepEqual(validate(conflict), conflict);
  assert.throws(() => validate({ ...conflict, observedVersion: '3' }));
  for (const reason of ['INVALID_STATE', 'RECORD_TIME_IN_FUTURE'])
    assert.equal(validate({ ...receipt, outcome: 'refused', reason, result: null }).reason, reason);
});
