import assert from 'node:assert/strict';
import test from 'node:test';
import { validateViewingTerminationCommand, planViewingTermination } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const slot = {
  startAt: '2026-10-15T09:00:00.000Z',
  endAt: '2026-10-15T10:00:00.000Z',
  timeZone: 'Africa/Nairobi',
};
const command = () => ({
  operationId: id(1),
  expectedVersion: '2',
  reason: '  Fictional cancellation reason.\nKeep exact history.  ',
});
function current(status = 'proposed') {
  const version = { requested: '1', proposed: '2', confirmed: '3' }[status],
    createdAt = '2026-10-13T00:00:00.000Z',
    updatedAt = status === 'requested' ? createdAt : '2026-10-14T08:00:00.000Z';
  return {
    schedule: {
      viewingId: id(2),
      enquiryId: id(3),
      listingId: id(4),
      version,
      status,
      preferredSlots: [slot],
      proposedSlot: status === 'requested' ? null : slot,
      ...(status === 'confirmed'
        ? {
            agreement: {
              channel: 'phone',
              agreedAt: '2026-10-14T07:00:00.000Z',
              notes: 'Original phone agreement.',
            },
          }
        : {}),
    },
    notes: 'Original viewing interest.',
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
const now = '2026-10-14T09:00:00.000Z';
test('termination command freezes exact original reason and rejects caller authority or hidden action fields', () => {
  const raw = command(),
    saved = validateViewingTerminationCommand(raw);
  raw.reason = 'changed';
  assert.equal(saved.reason, command().reason);
  assert.ok(Object.isFrozen(saved));
  for (const key of [
    'actorId',
    'companyId',
    'customerId',
    'assignedAgentId',
    'status',
    'kind',
    'delete',
    'notify',
  ])
    assert.throws(() => validateViewingTerminationCommand({ ...command(), [key]: id(9) }));
});
test('termination reason uses bounded Unicode facts without blank,unsafe or lossy version values', () => {
  assert.equal(
    [...validateViewingTerminationCommand({ ...command(), reason: '😀'.repeat(1000) }).reason]
      .length,
    1000,
  );
  for (const patch of [
    { reason: ' ' },
    { reason: '😀'.repeat(1001) },
    { reason: 'bad\u0000reason' },
    { expectedVersion: 2 },
    { expectedVersion: '02' },
    { expectedVersion: '9007199254740991' },
  ])
    assert.throws(() => validateViewingTerminationCommand({ ...command(), ...patch }));
});
test('explicit cancellation plans requested,proposed or confirmed terminal state with one viewing version increment', () => {
  for (const status of ['requested', 'proposed', 'confirmed']) {
    const original = current(status),
      result = planViewingTermination(
        original,
        'cancel',
        { ...command(), expectedVersion: original.schedule.version },
        now,
      );
    assert.equal(result.outcome, 'applied');
    assert.equal(result.next.status, 'cancelled');
    assert.equal(result.next.version, String(Number(original.schedule.version) + 1));
    assert.equal(result.next.termination.fromStatus, status);
    assert.equal(original.schedule.status, status);
  }
});
test('decline is available for requested or proposed interest but cannot replace a recorded confirmation', () => {
  for (const status of ['requested', 'proposed']) {
    const original = current(status),
      result = planViewingTermination(
        original,
        'decline',
        { ...command(), expectedVersion: original.schedule.version },
        now,
      );
    assert.equal(result.next.status, 'declined');
    assert.equal(result.next.termination.kind, 'decline');
  }
  assert.equal(
    planViewingTermination(
      current('confirmed'),
      'decline',
      { ...command(), expectedVersion: '3' },
      now,
    ).reason,
    'INVALID_STATE',
  );
});
test('stale version conflicts before decline-state or clock refusal and never adopts current facts', () => {
  const value = planViewingTermination(
    current('confirmed'),
    'decline',
    command(),
    '2026-10-13T00:00:00.000Z',
  );
  assert.deepEqual(value, { outcome: 'conflict', reason: 'VERSION_CONFLICT', next: null });
  assert.equal(
    planViewingTermination(current(), 'cancel', command(), '2026-10-14T07:59:59.999Z').reason,
    'RECORD_TIME_IN_FUTURE',
  );
  assert.equal(
    planViewingTermination(current(), 'cancel', command(), current().updatedAt).outcome,
    'applied',
  );
});
test('cancellation preserves past proposed slot,original phone evidence and immutable reason history', () => {
  const original = current('confirmed'),
    before = structuredClone(original),
    result = planViewingTermination(
      original,
      'cancel',
      { ...command(), expectedVersion: '3' },
      '2026-10-16T00:00:00.000Z',
    );
  assert.equal(result.outcome, 'applied');
  assert.deepEqual(result.next.agreement, original.schedule.agreement);
  assert.deepEqual(result.next.proposedSlot, slot);
  assert.deepEqual(result.next.preferredSlots, [slot]);
  assert.deepEqual(original, before);
  assert.ok(Object.isFrozen(result.next.termination));
  assert.equal(result.next.termination.reason, command().reason);
  assert.equal(result.next.termination.previousUpdatedAt, original.updatedAt);
});
test('termination contracts reject getters and unsupported terminal input without running caller getters', () => {
  let touched = false;
  const raw = command();
  Object.defineProperty(raw, 'reason', {
    enumerable: true,
    get() {
      touched = true;
      return 'invented';
    },
  });
  assert.throws(() => validateViewingTerminationCommand(raw));
  assert.equal(touched, false);
  const detail = current();
  Object.defineProperty(detail, 'schedule', {
    enumerable: true,
    get() {
      touched = true;
      return current().schedule;
    },
  });
  assert.throws(() => planViewingTermination(detail, 'cancel', command(), now));
  assert.equal(touched, false);
  assert.throws(() => planViewingTermination(current(), 'delete', command(), now));
  const ended = planViewingTermination(current(), 'cancel', command(), now);
  assert.throws(() =>
    planViewingTermination(
      { ...current(), schedule: ended.next },
      'cancel',
      { ...command(), expectedVersion: '3' },
      now,
    ),
  );
});
