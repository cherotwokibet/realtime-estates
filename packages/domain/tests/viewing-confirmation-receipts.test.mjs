import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateViewingSchedule,
  validateViewingDetail,
  validateViewingPage,
  validateViewingConfirmationReceipt,
  planViewingConfirmation,
} from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const slot = {
  startAt: '2090-01-01T09:00:00.000Z',
  endAt: '2090-01-01T10:00:00.000Z',
  timeZone: 'Africa/Nairobi',
};
const command = {
  operationId: id(1),
  expectedVersion: '2',
  slot,
  channel: 'phone',
  agreedAt: '2026-10-14T07:00:00.000Z',
  notes: '  Synthetic phone agreement.  ',
};
const agreement = { channel: 'phone', agreedAt: command.agreedAt, notes: command.notes };
const schedule = {
  viewingId: id(2),
  enquiryId: id(3),
  listingId: id(4),
  version: '3',
  status: 'confirmed',
  preferredSlots: [],
  proposedSlot: slot,
  agreement,
};
const receipt = {
  operationId: id(1),
  enquiryId: id(3),
  viewingId: id(2),
  actorId: id(5),
  kind: 'confirm',
  expectedVersion: '2',
  observedVersion: '2',
  request: { slot, ...agreement },
  outcome: 'applied',
  reason: null,
  result: schedule,
  completedAt: '2026-10-14T08:00:00.000Z',
};
const detail = {
  schedule,
  notes: 'Original private interest.',
  requestedById: id(6),
  assignedAgentId: id(5),
  createdAt: '2026-10-13T00:00:00.000Z',
  updatedAt: receipt.completedAt,
  confirmation: {
    proposedAt: '2026-10-14T06:00:00.000Z',
    recordedAt: receipt.completedAt,
    recordedById: id(5),
  },
};
const validate = (input) => validateViewingConfirmationReceipt(input, id(3), id(2), command);
test('confirmed snapshot and detail require exact phone evidence and immutable attributable time metadata', () => {
  const value = validateViewingDetail(detail, id(3), id(2));
  assert.deepEqual(value, detail);
  assert.ok(Object.isFrozen(value.confirmation) && Object.isFrozen(value.schedule.agreement));
  assert.deepEqual(
    validateViewingPage({ items: [detail], limit: 25, truncated: false }, id(3), 25).items[0],
    detail,
  );
  for (const patch of [
    { agreement: undefined },
    { version: '2' },
    { proposedSlot: null },
    { agreement: { ...agreement, agreedAt: slot.startAt } },
    { agreement: { ...agreement, channel: 'customer_token' } },
    { agreement: { ...agreement, actorId: id(5) } },
  ])
    assert.throws(() => validateViewingSchedule({ ...schedule, ...patch }));
  assert.throws(() => validateViewingSchedule({ ...schedule, status: 'proposed', version: '2' }));
});
test('confirmed detail refuses missing metadata,preproposal agreement,future agreement and inconsistent author/time', () => {
  for (const patch of [
    { confirmation: undefined },
    { confirmation: { ...detail.confirmation, recordedAt: '2026-10-14T09:00:00.000Z' } },
    { confirmation: { ...detail.confirmation, proposedAt: '2026-10-14T07:00:00.001Z' } },
    { confirmation: { ...detail.confirmation, recordedById: 'invented' } },
    {
      schedule: { ...schedule, agreement: { ...agreement, agreedAt: '2026-10-14T08:00:00.001Z' } },
    },
  ])
    assert.throws(() => validateViewingDetail({ ...detail, ...patch }, id(3)));
  assert.equal(
    planViewingConfirmation(detail, { ...command, expectedVersion: '3' }, receipt.completedAt)
      .reason,
    'INVALID_STATE',
  );
});
test('original confirmation receipt binds exact slot,phone notes,time,target and historical version', () => {
  assert.deepEqual(validate(receipt), receipt);
  for (const patch of [
    { viewingId: id(99) },
    { enquiryId: id(99) },
    { operationId: id(99) },
    { kind: 'propose' },
    { expectedVersion: '1' },
    { observedVersion: '3' },
    { request: { ...receipt.request, notes: 'changed' } },
    { request: { ...receipt.request, agreedAt: '2026-10-14T07:00:00.001Z' } },
    { result: { ...schedule, agreement: { ...agreement, notes: 'changed' } } },
    { result: { ...schedule, proposedSlot: { ...slot, endAt: '2090-01-01T11:00:00.000Z' } } },
    { completedAt: '2026-10-14T06:00:00.000Z' },
  ])
    assert.throws(() => validate({ ...receipt, ...patch }));
});
test('confirmation conflicts/refusals are terminal original facts with no confirmed result', () => {
  const conflict = {
    ...receipt,
    outcome: 'conflict',
    reason: 'VERSION_CONFLICT',
    observedVersion: '3',
    result: null,
  };
  assert.deepEqual(validate(conflict), conflict);
  assert.throws(() => validate({ ...conflict, observedVersion: '2' }));
  for (const reason of [
    'ENQUIRY_CLOSED',
    'LISTING_UNAVAILABLE',
    'INVALID_STATE',
    'PROPOSED_SLOT_MISMATCH',
    'AGREEMENT_BEFORE_PROPOSAL',
  ]) {
    const refusal = { ...receipt, outcome: 'refused', reason, result: null };
    assert.deepEqual(validate(refusal), refusal);
  }
  assert.throws(() =>
    validate({ ...receipt, outcome: 'refused', reason: 'AGREEMENT_IN_FUTURE', result: null }),
  );
  assert.throws(() =>
    validate({ ...receipt, outcome: 'refused', reason: 'SLOT_NOT_FUTURE', result: null }),
  );
  assert.throws(() =>
    validate({ ...receipt, outcome: 'refused', reason: 'invented', result: null }),
  );
});
