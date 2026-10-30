import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateStaffInvitationRequestRecord as receipt,
  validateStaffInvitationState as state,
  validateStaffInvitationRevocationCommand as command,
  validateStaffInvitationRevocationRecord as revoked,
  parseStaffInvitationJson as parse,
} from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const intent = () => ({
  policy: 'staff-invitation-intent-v1',
  operationId: id(1),
  recipientEmail: 'synthetic@example.invalid',
  requestedRole: 'agent',
  branchId: id(2),
  expiresAfterHours: 72,
});
const record = () => ({
  policy: 'staff-invitation-request-record-v1',
  operationId: id(1),
  actorId: id(3),
  recipientEmail: 'synthetic@example.invalid',
  requestedRole: 'agent',
  expiresAfterHours: 72,
  branch: { branchId: id(2), version: '1', name: 'Synthetic branch' },
  recordedAt: '2026-10-30T06:00:00.000Z',
  expiresAt: '2026-11-02T06:00:00.000Z',
  status: 'recorded',
  delivery: 'not_attempted',
  membershipGranted: false,
});
const cmd = () => ({
  policy: 'staff-invitation-revocation-command-v1',
  operationId: id(4),
  invitationId: id(1),
  expectedVersion: '1',
  reason: 'Synthetic cancellation.',
});
const result = () => ({
  policy: 'staff-invitation-revocation-record-v1',
  operationId: id(4),
  invitationId: id(1),
  actorId: id(3),
  expectedVersion: '1',
  version: '2',
  reason: 'Synthetic cancellation.',
  outcome: 'revoked',
  recordedAt: '2026-10-30T07:00:00.000Z',
});
test('capture receipt is frozen, exact, intent/actor bound and never proves delivery or membership', () => {
  const input = record(),
    saved = receipt(input, intent(), id(3));
  input.branch.name = 'Changed';
  assert.equal(saved.branch.name, 'Synthetic branch');
  assert.ok(Object.isFrozen(saved) && Object.isFrozen(saved.branch));
  for (const patch of [
    { delivery: 'sent' },
    { membershipGranted: true },
    { membershipGranted: 'false' },
    { status: 'accepted' },
    { token: 'secret' },
    { recipientEmail: 'changed@example.invalid' },
    { actorId: id(9) },
    { operationId: id(9) },
    { requestedRole: 'admin' },
    { branch: { ...record().branch, branchId: id(9) } },
  ])
    assert.throws(() => receipt({ ...record(), ...patch }, intent(), id(3)));
});
test('expiry is exact UTC milliseconds and bounded original lifetime, never a renewed deadline', () => {
  for (const patch of [
    { expiresAt: '2026-11-02T06:00:00.001Z' },
    { recordedAt: '2026-10-30T06:00:00Z' },
    { expiresAt: '2026-11-02T09:00:00.000+03:00' },
    { recordedAt: '2026-02-30T06:00:00.000Z' },
    { expiresAfterHours: 73 },
  ])
    assert.throws(() => receipt({ ...record(), ...patch }));
  assert.throws(() => receipt({ ...record(), branch: { ...record().branch, version: '01' } }));
});
test('current state omits private actor and does not imply authentication or use the client clock', () => {
  const { actorId, ...facts } = record();
  for (const [value, version] of [
    ['pending', '1'],
    ['expired', '1'],
    ['revoked', '2'],
  ])
    assert.equal(
      state({ ...facts, policy: 'staff-invitation-state-v1', state: value, version }, id(1)).state,
      value,
    );
  assert.throws(() =>
    state({ ...facts, policy: 'staff-invitation-state-v1', state: 'revoked', version: '1' }),
  );
  assert.throws(() =>
    state({
      ...facts,
      policy: 'staff-invitation-state-v1',
      state: 'pending',
      version: '1',
      actorId,
    }),
  );
  assert.throws(() =>
    state({ ...facts, policy: 'staff-invitation-state-v1', state: 'pending', version: '1' }, id(9)),
  );
});
test('revocation commands refuse authority and unsafe reasons or versions before a write', () => {
  assert.ok(Object.isFrozen(command(cmd())));
  for (const patch of [
    { actorId: id(3) },
    { tenantId: id(9) },
    { expectedVersion: '0' },
    { expectedVersion: '9007199254740991' },
    { expectedVersion: 1 },
    { reason: '<b>' },
    { reason: 'x\u0080y' },
    { reason: 'e\u0301' },
    { reason: 'x'.repeat(501) },
  ])
    assert.throws(() => command({ ...cmd(), ...patch }));
});
test('revocation outcomes have exact version relationships and immutable original-command identity', () => {
  assert.ok(Object.isFrozen(revoked(result(), cmd(), id(3))));
  for (const [outcome, expectedVersion, version] of [
    ['already_revoked', '2', '2'],
    ['expired', '1', '1'],
    ['conflict', '2', '1'],
  ])
    assert.equal(revoked({ ...result(), outcome, expectedVersion, version }).outcome, outcome);
  for (const patch of [
    { version: '1' },
    { expectedVersion: '2' },
    { outcome: 'sent' },
    { reason: 'Changed' },
    { actorId: id(9) },
    { invitationId: id(9) },
  ])
    assert.throws(() => revoked({ ...result(), ...patch }, cmd(), id(3)));
  assert.throws(() => revoked({ ...result(), outcome: 'conflict', expectedVersion: '2' }));
});
test('response getters, hidden fields and nested authority fail without invoking getters', () => {
  let reads = 0;
  const input = record();
  Object.defineProperty(input.branch, 'name', {
    enumerable: true,
    get() {
      reads++;
      return 'Synthetic';
    },
  });
  assert.throws(() => receipt(input));
  const get = result();
  Object.defineProperty(get, 'actorId', {
    enumerable: true,
    get() {
      reads++;
      return id(3);
    },
  });
  assert.throws(() => revoked(get));
  assert.equal(reads, 0);
  assert.throws(() => receipt(Object.defineProperty(record(), 'hidden', { value: true })));
});
test('bounded JSON rejects duplicate escaped keys and rounded/exponent expiry tokens before validation', () => {
  const json = JSON.stringify(record());
  assert.equal(receipt(parse(json)).expiresAfterHours, 72);
  for (const value of ['72.0', '7.2e1', '72.000000000000001', '"72"'])
    assert.throws(() =>
      parse(json.replace('"expiresAfterHours":72', '"expiresAfterHours":' + value)),
    );
  assert.throws(() => parse(json.replace('"policy":', '"\\u0070olicy":"bad","policy":')));
  assert.throws(() => parse(json.replace('"name":', '"name":"duplicate","name":')));
  assert.throws(() => parse(' '.repeat(65537)));
  assert.throws(() => parse('{'));
});
