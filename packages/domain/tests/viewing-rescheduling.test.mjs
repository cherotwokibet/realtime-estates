import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateViewingRescheduleCommand,
  planFirstViewingReschedule,
  validateViewingSchedule,
  planViewingTermination,
} from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const oldSlot = {
  startAt: '2026-10-15T09:00:00.000Z',
  endAt: '2026-10-15T10:00:00.000Z',
  timeZone: 'Africa/Nairobi',
};
const newSlot = {
  ...oldSlot,
  startAt: '2026-10-16T09:00:00.000Z',
  endAt: '2026-10-16T10:00:00.000Z',
};
const now = '2026-10-14T09:00:00.000Z';
const command = () => ({
  operationId: id(1),
  expectedVersion: '2',
  slot: { ...newSlot },
  reason: '  Synthetic change of time.\nKeep exact reason.  ',
});
function detail(status = 'proposed') {
  const createdAt = '2026-10-13T00:00:00.000Z',
    updatedAt = status === 'requested' ? createdAt : '2026-10-14T08:00:00.000Z';
  return {
    schedule: {
      viewingId: id(2),
      enquiryId: id(3),
      listingId: id(4),
      version: { requested: '1', proposed: '2', confirmed: '3' }[status],
      status,
      preferredSlots: [oldSlot],
      proposedSlot: status === 'requested' ? null : oldSlot,
      ...(status === 'confirmed'
        ? {
            agreement: {
              channel: 'phone',
              agreedAt: '2026-10-14T07:00:00.000Z',
              notes: '  Previous phone agreement.  ',
            },
          }
        : {}),
    },
    notes: 'Original interest.',
    requestedById: id(5),
    assignedAgentId: id(6),
    createdAt,
    updatedAt,
    ...(status === 'confirmed'
      ? {
          confirmation: {
            proposedAt: '2026-10-14T06:00:00.000Z',
            recordedAt: updatedAt,
            recordedById: id(6),
          },
        }
      : {}),
  };
}
test('reschedule command retains immutable exact original slot and reason without caller authority', () => {
  const raw = command(),
    saved = validateViewingRescheduleCommand(raw);
  raw.reason = 'changed';
  raw.slot.startAt = 'changed';
  assert.equal(saved.reason, command().reason);
  assert.deepEqual(saved.slot, newSlot);
  assert.ok(Object.isFrozen(saved) && Object.isFrozen(saved.slot));
  for (const key of [
    'actorId',
    'tenantId',
    'cycleNumber',
    'status',
    'agreement',
    'confirmed',
    'notify',
    'kind',
  ])
    assert.throws(() => validateViewingRescheduleCommand({ ...command(), [key]: id(9) }));
});
test('reschedule command is timeless and bounds raw Unicode reasons,versions and exact Nairobi slot', () => {
  assert.equal(
    [...validateViewingRescheduleCommand({ ...command(), reason: '😀'.repeat(1000) }).reason]
      .length,
    1000,
  );
  assert.equal(
    validateViewingRescheduleCommand({
      ...command(),
      expectedVersion: '9007199254740990',
      slot: oldSlot,
    }).expectedVersion,
    '9007199254740990',
  );
  for (const patch of [
    { reason: ' ' },
    { reason: '😀'.repeat(1001) },
    { reason: 'bad\u0000reason' },
    { reason: 'bad\ud800reason' },
    { expectedVersion: 2 },
    { expectedVersion: '02' },
    { expectedVersion: '9007199254740991' },
    { slot: { ...newSlot, timeZone: 'UTC' } },
  ])
    assert.throws(() => validateViewingRescheduleCommand({ ...command(), ...patch }));
});
test('first proposed reschedule creates a separate unagreed second cycle and retains previous evidence', () => {
  const input = detail(),
    before = structuredClone(input),
    result = planFirstViewingReschedule(input, command(), now);
  assert.equal(result.outcome, 'applied');
  assert.equal(result.next.version, '3');
  assert.equal(result.next.cycleNumber, '2');
  assert.equal(result.next.status, 'proposed');
  assert.deepEqual(result.next.proposedSlot, newSlot);
  assert.equal(result.next.proposedAt, now);
  assert.deepEqual(result.previous, before);
  assert.deepEqual(input, before);
  assert.ok(
    Object.isFrozen(result.previous.schedule.preferredSlots) &&
      Object.isFrozen(result.next.reschedule),
  );
  assert.equal(result.next.reschedule.reason, command().reason);
  assert.equal(Object.hasOwn(result.next, 'agreement'), false);
  // This projection must not accidentally pass the unchanged first-cycle persisted read contract.
  assert.throws(() => validateViewingSchedule(result.next));
});
test('rescheduling confirmed viewing keeps exact original agreement and confirming actor only in previous cycle', () => {
  const input = detail('confirmed'),
    result = planFirstViewingReschedule(input, { ...command(), expectedVersion: '3' }, now);
  assert.equal(result.next.version, '4');
  assert.equal(result.next.reschedule.fromStatus, 'confirmed');
  assert.deepEqual(result.previous.confirmation, input.confirmation);
  assert.deepEqual(result.previous.schedule.agreement, input.schedule.agreement);
  assert.equal(Object.hasOwn(result.next, 'agreement'), false);
  assert.equal(Object.hasOwn(result.next, 'confirmation'), false);
  assert.deepEqual(result.next.preferredSlots, input.schedule.preferredSlots);
  assert.notEqual(result.previous, input);
});
test('reschedule conflicts take precedence over invalid state,unchanged slot and clock rules', () => {
  for (const input of [detail(), detail('confirmed'), detail('requested')])
    assert.deepEqual(
      planFirstViewingReschedule(
        input,
        { ...command(), expectedVersion: '4', slot: oldSlot },
        '2026-10-12T00:00:00.000Z',
      ),
      { outcome: 'conflict', reason: 'VERSION_CONFLICT', next: null, previous: null },
    );
  assert.equal(
    planFirstViewingReschedule(detail('requested'), { ...command(), expectedVersion: '1' }, now)
      .reason,
    'INVALID_STATE',
  );
  const input = detail('confirmed'),
    terminal = planViewingTermination(
      input,
      'cancel',
      { operationId: id(8), expectedVersion: '3', reason: 'Synthetic ending.' },
      now,
    ),
    ended = {
      ...input,
      schedule: terminal.next,
      updatedAt: now,
      terminationRecord: { recordedById: id(6) },
    };
  assert.equal(
    planFirstViewingReschedule(ended, { ...command(), expectedVersion: '4' }, now).reason,
    'INVALID_STATE',
  );
});
test('rescheduling requires a different future slot and a clock at or after the current saved record', () => {
  assert.equal(
    planFirstViewingReschedule(detail(), command(), '2026-10-14T07:59:59.999Z').reason,
    'RECORD_TIME_IN_FUTURE',
  );
  assert.equal(
    planFirstViewingReschedule(detail(), { ...command(), slot: oldSlot }, now).reason,
    'SLOT_UNCHANGED',
  );
  assert.equal(
    planFirstViewingReschedule(detail(), command(), newSlot.startAt).reason,
    'SLOT_NOT_FUTURE',
  );
  assert.equal(
    planFirstViewingReschedule(detail(), command(), detail().updatedAt).outcome,
    'applied',
  );
  const shifted = {
    ...oldSlot,
    startAt: '2026-10-15T09:30:00.000Z',
    endAt: '2026-10-15T10:30:00.000Z',
  };
  assert.equal(
    planFirstViewingReschedule(detail(), { ...command(), slot: shifted }, now).outcome,
    'applied',
  );
});
test('a historical slot passing does not expire its evidence or prevent a different future proposal', () => {
  const later = '2026-10-15T12:00:00.000Z',
    input = detail('confirmed'),
    result = planFirstViewingReschedule(input, { ...command(), expectedVersion: '3' }, later);
  assert.equal(result.outcome, 'applied');
  assert.deepEqual(result.previous.schedule.proposedSlot, oldSlot);
  assert.equal(result.previous.confirmation.recordedAt, input.confirmation.recordedAt);
  assert.equal(result.next.proposedAt, later);
});
test('rescheduling rejects hidden data and getters without executing caller code', () => {
  let touched = false;
  const raw = command();
  Object.defineProperty(raw, 'slot', {
    enumerable: true,
    get() {
      touched = true;
      return newSlot;
    },
  });
  assert.throws(() => validateViewingRescheduleCommand(raw));
  assert.equal(touched, false);
  const input = detail();
  Object.defineProperty(input, 'schedule', {
    enumerable: true,
    get() {
      touched = true;
      return detail().schedule;
    },
  });
  assert.throws(() => planFirstViewingReschedule(input, command(), now));
  assert.equal(touched, false);
  const hidden = command();
  Object.defineProperty(hidden, 'actor', { value: id(9) });
  assert.throws(() => validateViewingRescheduleCommand(hidden));
});
