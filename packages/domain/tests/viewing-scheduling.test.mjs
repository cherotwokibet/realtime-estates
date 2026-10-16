import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateViewingSlot,
  validateViewingRequestCommand,
  validateViewingProposalCommand,
  validateViewingSchedule,
  viewingRequestHasFutureAlternatives,
  planViewingProposal,
} from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const slot = (startAt = '2026-10-14T09:00:00.000Z', endAt = '2026-10-14T10:00:00.000Z') => ({
  startAt,
  endAt,
  timeZone: 'Africa/Nairobi',
});
const request = () => ({
  operationId: id(1),
  expectedEnquiryVersion: '2',
  listingId: id(2),
  preferredSlots: [slot()],
  notes: '  Fictional viewing interest.\nKeep this original.  ',
});
const schedule = () => ({
  viewingId: id(3),
  enquiryId: id(4),
  listingId: id(2),
  version: '1',
  status: 'requested',
  preferredSlots: [slot()],
  proposedSlot: null,
});
const proposal = () => ({ operationId: id(5), expectedVersion: '1', slot: slot() });
const now = '2026-10-13T19:00:00.000Z';

test('viewing interest is immutable and has no automatic confirmed slot or caller authority', () => {
  const input = request(),
    saved = validateViewingRequestCommand(input);
  input.notes = 'changed';
  input.preferredSlots[0].startAt = 'bad';
  input.preferredSlots.push(slot());
  assert.equal(saved.notes, '  Fictional viewing interest.\nKeep this original.  ');
  assert.equal(saved.preferredSlots.length, 1);
  assert.equal(saved.preferredSlots[0].startAt, '2026-10-14T09:00:00.000Z');
  assert.ok(
    Object.isFrozen(saved) &&
      Object.isFrozen(saved.preferredSlots) &&
      Object.isFrozen(saved.preferredSlots[0]),
  );
  assert.equal(Object.hasOwn(saved, 'confirmedSlot'), false);
  for (const field of [
    'actorId',
    'companyId',
    'assignedAgentId',
    'status',
    'confirmed',
    'customerAgreement',
  ])
    assert.throws(() => validateViewingRequestCommand({ ...request(), [field]: id(9) }));
});
test('interest without a time is valid but overlap,duplicates,overfull and noncanonical alternatives fail', () => {
  assert.deepEqual(
    validateViewingRequestCommand({ ...request(), preferredSlots: [] }).preferredSlots,
    [],
  );
  const adjacent = slot('2026-10-14T10:00:00.000Z', '2026-10-14T10:15:00.000Z');
  assert.equal(
    validateViewingRequestCommand({ ...request(), preferredSlots: [adjacent, slot()] })
      .preferredSlots.length,
    2,
  );
  for (const preferredSlots of [
    [slot(), slot()],
    [slot(), slot('2026-10-14T09:59:59.999Z', '2026-10-14T10:59:59.999Z')],
    Array(4).fill(adjacent),
    new Array(1),
    Object.assign([slot()], { private: 'extra' }),
  ])
    assert.throws(() => validateViewingRequestCommand({ ...request(), preferredSlots }));
});
test('slot bounds retain intended Nairobi zone and exact instants', () => {
  assert.deepEqual(
    validateViewingSlot(slot('2026-10-14T09:00:00.123Z', '2026-10-14T09:15:00.123Z')),
    slot('2026-10-14T09:00:00.123Z', '2026-10-14T09:15:00.123Z'),
  );
  assert.doesNotThrow(() =>
    validateViewingSlot(slot('2026-10-14T09:00:00.000Z', '2026-10-14T13:00:00.000Z')),
  );
  for (const bad of [
    slot('2026-10-14T09:00:00.000Z', '2026-10-14T09:14:59.999Z'),
    slot('2026-10-14T09:00:00.000Z', '2026-10-14T13:00:00.001Z'),
    slot('2026-10-14T10:00:00.000Z', '2026-10-14T09:00:00.000Z'),
    { ...slot(), timeZone: 'UTC' },
    { ...slot(), confirmed: true },
    { ...slot(), startAt: '2026-10-14T12:00:00+03:00' },
    { ...slot(), startAt: '2026-02-30T09:00:00.000Z' },
    { ...slot(), startAt: '0000-10-14T09:00:00.000Z' },
  ])
    assert.throws(() => validateViewingSlot(bad));
});
test('timeless original request/proposal validation survives its slot passing while first execution refuses stale time', () => {
  const command = validateViewingRequestCommand(request());
  assert.equal(viewingRequestHasFutureAlternatives(command, now), true);
  assert.equal(viewingRequestHasFutureAlternatives(command, '2026-10-14T09:00:00.000Z'), false);
  assert.doesNotThrow(() => validateViewingRequestCommand(command));
  assert.doesNotThrow(() => validateViewingProposalCommand(proposal()));
  assert.equal(
    planViewingProposal(schedule(), proposal(), '2026-10-14T09:00:00.000Z').reason,
    'SLOT_NOT_FUTURE',
  );
  assert.equal(
    viewingRequestHasFutureAlternatives(
      { ...command, preferredSlots: [] },
      '2027-01-01T00:00:00.000Z',
    ),
    true,
  );
  assert.throws(() => viewingRequestHasFutureAlternatives(command, '2026-10-13'));
  assert.throws(() => planViewingProposal(schedule(), proposal(), 'bad'));
});
test('first proposal increments only viewing state without confirming or mutating original preferences', () => {
  const original = schedule(),
    command = proposal(),
    result = planViewingProposal(original, command, now);
  assert.equal(result.outcome, 'applied');
  assert.equal(result.next.status, 'proposed');
  assert.equal(result.next.version, '2');
  assert.deepEqual(result.next.proposedSlot, slot());
  assert.equal(result.next.enquiryId, original.enquiryId);
  assert.equal(result.next.listingId, original.listingId);
  assert.deepEqual(result.next.preferredSlots, original.preferredSlots);
  assert.equal(original.status, 'requested');
  assert.equal(original.version, '1');
  command.slot.endAt = 'changed';
  assert.equal(result.next.proposedSlot.endAt, '2026-10-14T10:00:00.000Z');
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.next));
  assert.equal(Object.hasOwn(result.next, 'confirmedSlot'), false);
});
test('stale proposal returns conflict and never silently adopts a version or overrides an existing proposal', () => {
  const newer = { ...schedule(), version: '3' };
  assert.deepEqual(planViewingProposal(newer, proposal(), now), {
    outcome: 'conflict',
    reason: 'VERSION_CONFLICT',
    next: null,
  });
  const applied = planViewingProposal(schedule(), proposal(), now).next;
  assert.deepEqual(planViewingProposal(applied, { ...proposal(), expectedVersion: '2' }, now), {
    outcome: 'refused',
    reason: 'INVALID_STATE',
    next: null,
  });
  assert.deepEqual(planViewingProposal(applied, proposal(), '2027-01-01T00:00:00.000Z'), {
    outcome: 'conflict',
    reason: 'VERSION_CONFLICT',
    next: null,
  });
});
test('safe version bounds cannot overflow and opaque IDs must be canonical', () => {
  for (const version of ['0', '01', '-1', '1.0', '1e0', '9007199254740992', 1, null]) {
    assert.throws(() =>
      validateViewingRequestCommand({ ...request(), expectedEnquiryVersion: version }),
    );
    assert.throws(() =>
      validateViewingProposalCommand({ ...proposal(), expectedVersion: version }),
    );
  }
  assert.throws(() =>
    validateViewingProposalCommand({ ...proposal(), expectedVersion: '9007199254740991' }),
  );
  const maximum = planViewingProposal(
    { ...schedule(), version: '9007199254740990' },
    { ...proposal(), expectedVersion: '9007199254740990' },
    now,
  );
  assert.equal(maximum.next.version, '9007199254740991');
  for (const field of ['operationId', 'listingId'])
    assert.throws(() => validateViewingRequestCommand({ ...request(), [field]: 'not-an-id' }));
  assert.throws(() =>
    validateViewingRequestCommand({
      ...request(),
      operationId: '00000000-0000-0000-0000-000000000000',
    }),
  );
});
test('private original notes support bounded Unicode without accepting blank,unsafe or extra facts', () => {
  assert.equal(
    validateViewingRequestCommand({ ...request(), notes: '😀'.repeat(2000) }).notes,
    '😀'.repeat(2000),
  );
  for (const notes of [' \n\t ', '😀'.repeat(2001), 'bad\u0000note', 'bad\ud800note', null])
    assert.throws(() => validateViewingRequestCommand({ ...request(), notes }));
  for (const bad of [
    { ...proposal(), companyId: id(8) },
    { ...proposal(), confirmedSlot: slot() },
    { ...proposal(), slot: { ...slot(), agreement: 'invented' } },
  ])
    assert.throws(() => validateViewingProposalCommand(bad));
});
test('strict plain-data contracts reject hidden keys,getters,custom prototypes and sparse/accessor arrays without reading them', () => {
  let reads = 0;
  const getter = { ...request() };
  Object.defineProperty(getter, 'notes', {
    enumerable: true,
    get() {
      reads++;
      return 'private';
    },
  });
  assert.throws(() => validateViewingRequestCommand(getter));
  assert.equal(reads, 0);
  const symbol = { ...request(), [Symbol('caller')]: true };
  assert.throws(() => validateViewingRequestCommand(symbol));
  assert.throws(() =>
    validateViewingRequestCommand(Object.assign(Object.create({ companyId: id(9) }), request())),
  );
  const hidden = { ...request() };
  Object.defineProperty(hidden, 'private', { value: true });
  assert.throws(() => validateViewingRequestCommand(hidden));
  const rows = [slot()];
  Object.defineProperty(rows, '0', {
    enumerable: true,
    get() {
      reads++;
      return slot();
    },
  });
  assert.throws(() => validateViewingRequestCommand({ ...request(), preferredSlots: rows }));
  assert.equal(reads, 0);
});
test('read snapshots cannot imply confirmation or inconsistent proposed state', () => {
  for (const bad of [
    { ...schedule(), status: 'confirmed' },
    { ...schedule(), proposedSlot: slot() },
    { ...schedule(), status: 'proposed' },
    { ...schedule(), confirmed: true },
    { ...schedule(), status: 'proposed', proposedSlot: { ...slot(), timeZone: 'Europe/London' } },
  ])
    assert.throws(() => validateViewingSchedule(bad));
  assert.doesNotThrow(() =>
    validateViewingSchedule({ ...schedule(), status: 'proposed', proposedSlot: slot() }),
  );
});
