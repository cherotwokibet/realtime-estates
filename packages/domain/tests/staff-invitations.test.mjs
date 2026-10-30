import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStaffInvitationIntent, validateStaffInvitationEmail } from '../dist/index.js';
const id = '00000000-0000-4000-8000-000000000001';
const intent = () => ({
  policy: 'staff-invitation-intent-v1',
  operationId: id,
  recipientEmail: 'synthetic+staff@example.invalid',
  requestedRole: 'agent',
  branchId: null,
  expiresAfterHours: 72,
});
test('invitation intent snapshots only requested facts and never issues authority or a token', () => {
  const input = intent(),
    value = validateStaffInvitationIntent(input);
  input.recipientEmail = 'other@example.invalid';
  assert.equal(value.recipientEmail, 'synthetic+staff@example.invalid');
  assert.ok(Object.isFrozen(value));
  assert.deepEqual(Object.keys(value).sort(), Object.keys(intent()).sort());
  for (const hours of [24, 72, 168])
    assert.equal(
      validateStaffInvitationIntent({ ...intent(), expiresAfterHours: hours }).expiresAfterHours,
      hours,
    );
  assert.equal(validateStaffInvitationIntent({ ...intent(), branchId: id }).branchId, id);
  assert.equal(
    validateStaffInvitationIntent({ ...intent(), requestedRole: 'admin' }).requestedRole,
    'admin',
  );
});
test('caller authority, unsupported roles, branch-limited admin and arbitrary expiry cannot enter an intent', () => {
  for (const patch of [
    { tenantId: id },
    { actorId: id },
    { role: 'admin' },
    { token: 'ignored' },
    { requestedRole: 'owner' },
    { requestedRole: 'customer' },
    { requestedRole: 'admin', branchId: id },
    { branchId: 'name' },
    { expiresAfterHours: 0 },
    { expiresAfterHours: 169 },
    { expiresAfterHours: '72' },
    { policy: null },
    { operationId: null },
  ])
    assert.throws(() => validateStaffInvitationIntent({ ...intent(), ...patch }));
});
test('mail headers, display names, noncanonical/ambiguous delivery addresses and excessive local/domain lengths fail', () => {
  for (const value of [
    ' A@example.invalid',
    'A@example.invalid',
    'a@example.invalid\r\nBcc:x@example.invalid',
    'Display <a@example.invalid>',
    'a..b@example.invalid',
    '.a@example.invalid',
    'a.@example.invalid',
    'a@-example.invalid',
    'a@example..invalid',
    'a@localhost',
    'a@éxample.invalid',
    'a'.repeat(65) + '@example.invalid',
    'a@' + 'b'.repeat(64) + '.invalid',
    null,
  ])
    assert.throws(() => validateStaffInvitationEmail(value));
});
test('hidden fields, symbols, inherited objects and accessors fail without reading a getter', () => {
  let reads = 0;
  const get = { ...intent() };
  Object.defineProperty(get, 'recipientEmail', {
    enumerable: true,
    get() {
      reads++;
      return 'a@example.invalid';
    },
  });
  for (const value of [
    get,
    Object.create(intent()),
    Object.assign({ ...intent() }, { [Symbol('authority')]: true }),
    Object.defineProperty({ ...intent() }, 'hidden', { value: true }),
  ])
    assert.throws(() => validateStaffInvitationIntent(value));
  assert.equal(reads, 0);
});
