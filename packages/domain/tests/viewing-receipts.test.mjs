import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateViewingReceipt,
  validateViewingDetail,
  validateViewingPage,
  validateViewingOriginal,
} from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const slot = {
  startAt: '2090-01-01T09:00:00.000Z',
  endAt: '2090-01-01T10:00:00.000Z',
  timeZone: 'Africa/Nairobi',
};
const enquiry = id(1),
  viewing = id(2),
  listing = id(3),
  actor = id(4),
  operation = id(5),
  time = '2026-10-13T20:00:00.000Z',
  notes = '  Private fictional interest.\nKeep exact.  ';
const original = {
  kind: 'request',
  command: {
    operationId: operation,
    expectedEnquiryVersion: '3',
    listingId: listing,
    preferredSlots: [slot],
    notes,
  },
};
const schedule = {
  viewingId: viewing,
  enquiryId: enquiry,
  listingId: listing,
  version: '1',
  status: 'requested',
  preferredSlots: [slot],
  proposedSlot: null,
};
const receipt = {
  operationId: operation,
  enquiryId: enquiry,
  viewingId: viewing,
  actorId: actor,
  kind: 'request',
  expectedVersion: '3',
  observedVersion: '3',
  request: { listingId: listing, preferredSlots: [slot], notes },
  outcome: 'applied',
  reason: null,
  result: schedule,
  completedAt: time,
};
const detail = {
  schedule,
  notes,
  requestedById: actor,
  assignedAgentId: actor,
  createdAt: time,
  updatedAt: time,
};

test('viewing original command and historical applied receipt preserve exact immutable facts', () => {
  const input = structuredClone(original),
    snapshot = validateViewingOriginal(input);
  input.command.notes = 'changed';
  assert.equal(snapshot.command.notes, notes);
  assert.ok(Object.isFrozen(snapshot.command.preferredSlots[0]));
  const result = validateViewingReceipt(receipt, enquiry, original);
  assert.equal(result.request.notes, notes);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.result));
  const historical = {
    ...original,
    command: {
      ...original.command,
      preferredSlots: [
        { ...slot, startAt: '2026-01-01T09:00:00.000Z', endAt: '2026-01-01T10:00:00.000Z' },
      ],
    },
  };
  const old = {
    ...receipt,
    completedAt: '2025-12-01T00:00:00.000Z',
    request: { ...receipt.request, preferredSlots: historical.command.preferredSlots },
    result: { ...schedule, preferredSlots: historical.command.preferredSlots },
  };
  assert.doesNotThrow(() => validateViewingReceipt(old, enquiry, historical));
});
test('altered successful receipt facts,wrong targets,caller authority and impossible outcome/version combinations fail', () => {
  for (const altered of [
    { ...receipt, operationId: id(9) },
    { ...receipt, enquiryId: id(9) },
    { ...receipt, request: { ...receipt.request, notes: notes.trim() } },
    { ...receipt, request: { ...receipt.request, listingId: id(9) } },
    { ...receipt, observedVersion: '4' },
    { ...receipt, result: { ...schedule, viewingId: id(9) } },
    { ...receipt, result: { ...schedule, status: 'confirmed' } },
    { ...receipt, tenantId: id(9) },
    { ...receipt, completedAt: '2091-01-01T00:00:00.000Z' },
    { ...receipt, result: { ...schedule, preferredSlots: [] } },
  ])
    assert.throws(() => validateViewingReceipt(altered, enquiry, original));
  assert.throws(() => validateViewingOriginal({ ...original, companyId: id(9) }));
});
test('original stale conflicts and business refusals have no saved schedule or invented viewing ID', () => {
  const conflict = {
    ...receipt,
    viewingId: null,
    outcome: 'conflict',
    reason: 'VERSION_CONFLICT',
    observedVersion: '4',
    result: null,
  };
  assert.equal(validateViewingReceipt(conflict, enquiry, original).outcome, 'conflict');
  const refused = {
    ...receipt,
    viewingId: null,
    outcome: 'refused',
    reason: 'LISTING_UNAVAILABLE',
    result: null,
  };
  assert.equal(validateViewingReceipt(refused, enquiry, original).reason, 'LISTING_UNAVAILABLE');
  for (const bad of [
    { ...conflict, observedVersion: '3' },
    { ...conflict, viewingId: viewing },
    { ...refused, result: schedule },
    { ...refused, reason: 'INVALID_STATE' },
    { ...refused, reason: 'SLOT_NOT_FUTURE' },
    { ...refused, observedVersion: '4' },
  ])
    assert.throws(() => validateViewingReceipt(bad, enquiry, original));
});
test('proposal receipt binds original target,slot and first version and cannot claim confirmation', () => {
  const command = {
    kind: 'propose',
    viewingId: viewing,
    command: { operationId: operation, expectedVersion: '1', slot },
  };
  const response = {
    ...receipt,
    kind: 'propose',
    expectedVersion: '1',
    observedVersion: '1',
    request: { slot },
    result: { ...schedule, status: 'proposed', version: '2', proposedSlot: slot },
  };
  assert.equal(validateViewingReceipt(response, enquiry, command).result.status, 'proposed');
  const conflict = {
    ...response,
    outcome: 'conflict',
    reason: 'VERSION_CONFLICT',
    observedVersion: '2',
    result: null,
  };
  assert.equal(validateViewingReceipt(conflict, enquiry, command).viewingId, viewing);
  for (const bad of [
    { ...response, viewingId: id(9) },
    { ...response, result: { ...response.result, version: '3' } },
    { ...response, request: { slot: { ...slot, endAt: '2090-01-01T11:00:00.000Z' } } },
    { ...response, request: { slot, notes: 'override' } },
    { ...response, result: { ...response.result, proposedSlot: null } },
  ])
    assert.throws(() => validateViewingReceipt(bad, enquiry, command));
});
test('viewing detail binds current target and historical timestamps while keeping original notes private and intact', () => {
  const result = validateViewingDetail(detail, enquiry, viewing);
  assert.equal(result.notes, notes);
  assert.ok(Object.isFrozen(result.schedule));
  const old = {
    ...detail,
    createdAt: '2025-12-01T00:00:00.000Z',
    updatedAt: '2025-12-01T00:00:00.000Z',
    schedule: {
      ...schedule,
      preferredSlots: [
        { ...slot, startAt: '2026-01-01T09:00:00.000Z', endAt: '2026-01-01T10:00:00.000Z' },
      ],
    },
  };
  assert.doesNotThrow(() => validateViewingDetail(old, enquiry));
  for (const bad of [
    { ...detail, notes: ' ' },
    { ...detail, updatedAt: '2026-10-13T20:00:01.000Z' },
    { ...detail, requestedById: null },
    { ...detail, schedule: { ...schedule, version: '2' } },
    { ...detail, createdAt: '2091-01-01T00:00:00.000Z' },
    { ...detail, privateAddress: 'forged' },
  ])
    assert.throws(() => validateViewingDetail(bad, enquiry));
  assert.throws(() => validateViewingDetail(detail, id(9)));
  assert.throws(() => validateViewingDetail(detail, enquiry, id(9)));
});
test('bounded viewing page rejects duplicates,foreign records,wrong order,truncation and accessor/sparse data', () => {
  const second = { ...detail, schedule: { ...schedule, viewingId: id(8) } };
  const page = { items: [detail, second], limit: 2, truncated: false };
  assert.equal(validateViewingPage(page, enquiry, 2).items.length, 2);
  for (const bad of [
    { ...page, items: [detail, detail] },
    { ...page, items: [second, detail] },
    { ...page, items: [{ ...detail, schedule: { ...schedule, enquiryId: id(9) } }] },
    { ...page, items: [detail], truncated: true },
    { ...page, items: new Array(1) },
    { ...page, limit: '2' },
    { ...page, token: 'extra' },
  ])
    assert.throws(() => validateViewingPage(bad, enquiry, 2));
  assert.throws(() => validateViewingPage({ items: [], limit: 26, truncated: false }, enquiry, 26));
  let read = 0;
  const rows = [detail];
  Object.defineProperty(rows, '0', {
    enumerable: true,
    get() {
      read++;
      return detail;
    },
  });
  assert.throws(() => validateViewingPage({ items: rows, limit: 1, truncated: false }, enquiry, 1));
  assert.equal(read, 0);
});
