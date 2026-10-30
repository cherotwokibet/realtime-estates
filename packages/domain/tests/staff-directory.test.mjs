import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateStaffDirectoryQuery as query,
  validateStaffBranchCurrent as current,
  validateStaffBranchPage as branches,
  validateStaffInvitationPage as invitations,
} from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const branch = (n = 1) => ({
  policy: 'staff-branch-current-v1',
  branchId: id(n),
  version: '1',
  name: 'Synthetic branch',
  active: true,
  recordedAt: '2026-10-30T06:00:00.000Z',
});
const state = (n = 1) => ({
  policy: 'staff-invitation-state-v1',
  operationId: id(n),
  recipientEmail: 'synthetic@example.invalid',
  requestedRole: 'agent',
  expiresAfterHours: 24,
  branch: null,
  recordedAt: '2026-10-30T06:00:00.000Z',
  expiresAt: '2026-10-31T06:00:00.000Z',
  status: 'recorded',
  delivery: 'not_attempted',
  membershipGranted: false,
  version: '1',
  state: 'pending',
});
const q = { limit: 2, after: null };
test('exact bounded directory query refuses caller authority and accessors without invoking them', () => {
  assert.deepEqual(query(q), q);
  assert.ok(Object.isFrozen(query(q)));
  for (const value of [0, -1, 21, 1.5, NaN, Infinity, '2', null])
    assert.throws(() => query({ ...q, limit: value }));
  for (const bad of [
    { limit: 2 },
    { ...q, tenantId: id(2) },
    { ...q, after: id(1).toUpperCase() + 'x' },
    Object.assign(Object.create({ tenant: id(1) }), q),
  ])
    assert.throws(() => query(bad));
  let calls = 0;
  const accessor = { after: null };
  Object.defineProperty(accessor, 'limit', {
    enumerable: true,
    get() {
      calls++;
      return 2;
    },
  });
  assert.throws(() => query(accessor));
  assert.equal(calls, 0);
});
test('private branch projection freezes detached facts and refuses hidden authority or invalid current values', () => {
  const b = branch(),
    v = current(b, id(1));
  b.name = 'Changed';
  assert.equal(v.name, 'Synthetic branch');
  assert.ok(Object.isFrozen(v));
  for (const change of [
    { actorId: id(2) },
    { reason: 'Private' },
    { version: '0' },
    { version: '9007199254740992' },
    { active: 1 },
    { name: '<markup>' },
    { name: ' x ' },
    { name: 'e\u0301' },
    { recordedAt: '2026-02-30T06:00:00.000Z' },
  ])
    assert.throws(() => current({ ...branch(), ...change }));
  assert.throws(() => current(branch(), id(2)));
});
test('branch pages bind page size, cursor and strictly increasing IDs; arrays are immutable snapshots', () => {
  const p = { policy: 'staff-branch-page-v1', items: [branch(1), branch(2)], nextAfter: id(2) };
  const v = branches(p, q);
  p.items[0].name = 'Changed';
  assert.equal(v.items[0].name, 'Synthetic branch');
  assert.ok(Object.isFrozen(v.items));
  assert.ok(Object.isFrozen(v));
  assert.deepEqual(branches({ policy: p.policy, items: [], nextAfter: null }, q).items, []);
  for (const bad of [
    { ...p, items: [branch(2), branch(1)] },
    { ...p, items: [branch(1), branch(1)] },
    { ...p, nextAfter: id(3) },
    { ...p, items: [branch(1)] },
    { ...p, items: [branch(1), branch(2), branch(3)] },
    { ...p, tenantId: id(1) },
  ])
    assert.throws(() => branches(bad, q));
  assert.throws(() => branches(p, { limit: 2, after: id(1) }));
  const sparse = [];
  sparse.length = 2;
  assert.throws(() => branches({ ...p, items: sparse }, q));
  let calls = 0;
  const a = [branch(1)];
  Object.defineProperty(a, '0', {
    enumerable: true,
    get() {
      calls++;
      return branch(1);
    },
  });
  assert.throws(() => branches({ ...p, items: a, nextAfter: null }, q));
  assert.equal(calls, 0);
});
test('invitation pages validate every private state, nested snapshots and projection privacy', () => {
  const p = { policy: 'staff-invitation-page-v1', items: [state(1), state(2)], nextAfter: id(2) };
  const v = invitations(p, q);
  assert.ok(Object.isFrozen(v.items[0]));
  for (const change of [
    { actorId: id(3) },
    { membershipGranted: true },
    { delivery: 'sent' },
    { state: 'revoked', version: '1' },
    { operationId: id(3) },
  ])
    assert.throws(() => invitations({ ...p, items: [{ ...state(1), ...change }, state(2)] }, q));
  const revoked = { ...state(1), state: 'revoked', version: '2' };
  assert.equal(
    invitations({ ...p, items: [revoked], nextAfter: null }, q).items[0].state,
    'revoked',
  );
  const nested = { ...state(1), branch: { branchId: id(8), version: '1', name: 'Synthetic' } };
  const copy = invitations({ ...p, items: [nested], nextAfter: null }, q);
  nested.branch.name = 'Changed';
  assert.equal(copy.items[0].branch.name, 'Synthetic');
  assert.ok(Object.isFrozen(copy.items[0].branch));
});
