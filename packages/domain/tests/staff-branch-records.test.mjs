import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateStaffBranchCommand as command,
  validateStaffBranchRecord as receipt,
} from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cmd = () => ({
  policy: 'staff-branch-command-v1',
  operationId: id(1),
  branchId: id(2),
  expectedVersion: '0',
  name: 'Synthetic branch',
  active: true,
  reason: 'Synthetic creation.',
});
const saved = () => ({
  ...cmd(),
  policy: 'staff-branch-record-v1',
  actorId: id(3),
  version: '1',
  outcome: 'applied',
  recordedAt: '2026-10-30T06:00:00.000Z',
});
test('branch command is exact, detached, bounded and contains no tenant/actor/grant authority', () => {
  const c = cmd(),
    v = command(c);
  c.name = 'Changed';
  assert.equal(v.name, 'Synthetic branch');
  assert.ok(Object.isFrozen(v));
  for (const patch of [
    { expectedVersion: '01' },
    { expectedVersion: '-1' },
    { expectedVersion: '9007199254740991' },
    { expectedVersion: 0 },
    { active: 'true' },
    { actorId: id(3) },
    { tenantId: id(3) },
    { name: '<markup>' },
    { name: ' x ' },
    { name: 'e\u0301' },
    { reason: 'x\r\n' },
    { reason: 'x'.repeat(501) },
  ])
    assert.throws(() => command({ ...cmd(), ...patch }));
  assert.equal(command({ ...cmd(), name: '\u{1f3e0}'.repeat(160) }).name.length, 320);
});
test('branch command accessors/hidden/inherited fields are refused without invoking getters', () => {
  let calls = 0;
  const c = cmd();
  Object.defineProperty(c, 'name', {
    enumerable: true,
    get() {
      calls++;
      return 'Synthetic';
    },
  });
  assert.throws(() => command(c));
  assert.equal(calls, 0);
  const hidden = cmd();
  Object.defineProperty(hidden, 'tenant', { value: id(4) });
  assert.throws(() => command(hidden));
  assert.throws(() => command(Object.assign(Object.create({ actorId: id(4) }), cmd())));
});
test('branch receipts distinguish applied/no-op/terminal conflicts with exact version arithmetic', () => {
  assert.equal(receipt(saved(), cmd(), id(3)).version, '1');
  assert.ok(Object.isFrozen(receipt(saved())));
  assert.equal(
    receipt({ ...saved(), expectedVersion: '1', version: '1', outcome: 'unchanged' }).outcome,
    'unchanged',
  );
  assert.equal(
    receipt({ ...saved(), expectedVersion: '2', version: '0', outcome: 'conflict' }).version,
    '0',
  );
  assert.equal(
    receipt({ ...saved(), expectedVersion: '9007199254740990', version: '9007199254740991' })
      .version,
    '9007199254740991',
  );
  for (const patch of [
    { version: '0' },
    { version: '2' },
    { outcome: 'unchanged', version: '0' },
    { outcome: 'conflict', version: '0' },
    { outcome: 'accepted' },
    { version: '9007199254740992' },
    { recordedAt: '2026-02-30T06:00:00.000Z' },
  ])
    assert.throws(() => receipt({ ...saved(), ...patch }));
});
test('branch original receipt binds actor and every original requested fact even for conflict', () => {
  const r = saved();
  for (const patch of [
    { operationId: id(4) },
    { branchId: id(4) },
    { name: 'Changed' },
    { active: false },
    { reason: 'Changed' },
    { expectedVersion: '1' },
  ])
    assert.throws(() => receipt(r, { ...cmd(), ...patch }, id(3)));
  assert.throws(() => receipt(r, cmd(), id(4)));
  assert.throws(() => receipt({ ...r, membershipGranted: true }));
});
