import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateStaffMembershipCommand as command,
  validateStaffMembershipRecord as receipt,
  validateStaffMembershipCurrent as current,
} from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const request = (patch = {}) => ({
  policy: 'staff-membership-command-v1',
  operationId: id(1),
  memberId: id(2),
  expectedVersion: '1',
  requestedRole: 'agent',
  active: false,
  reason: 'Reassigned existing staff responsibilities',
  ...patch,
});
const result = (patch = {}) => ({
  ...request(),
  policy: 'staff-membership-record-v1',
  actorId: id(3),
  version: '2',
  outcome: 'applied',
  recordedAt: '2026-11-02T09:00:00.000Z',
  ...patch,
});
const state = (patch = {}) => ({
  policy: 'staff-membership-current-v1',
  memberId: id(2),
  role: 'agent',
  active: false,
  version: '2',
  revokedAt: '2026-11-02T09:00:00.000Z',
  ...patch,
});
test('existing staff commands detach and freeze exact facts without actor or tenant authority', () => {
  const raw = request(),
    validated = command(raw);
  raw.reason = 'Changed after validation';
  assert.equal(validated.reason, request().reason);
  assert.ok(Object.isFrozen(validated));
  assert.equal(command(request({ requestedRole: 'admin', active: true })).requestedRole, 'admin');
  for (const patch of [
    { tenantId: id(9) },
    { actorId: id(3) },
    { branchId: null },
    { create: true },
    { requestedRole: 'customer' },
    { requestedRole: 'owner' },
    { active: 1 },
    { operationId: 'A0000000-0000-4000-8000-000000000001' },
    { memberId: 'not-a-uuid' },
  ])
    assert.throws(() => command(request(patch)));
});
test('versions use canonical positive safe decimal strings and reserve one increment for commands', () => {
  for (const expectedVersion of [
    '0',
    '01',
    '+1',
    '1.0',
    '1e1',
    '9007199254740991',
    '9007199254740992',
    1,
  ])
    assert.throws(() => command(request({ expectedVersion })));
  const max = request({ expectedVersion: '9007199254740990' });
  assert.equal(
    receipt(result({ expectedVersion: max.expectedVersion, version: '9007199254740991' }), max)
      .version,
    '9007199254740991',
  );
  assert.equal(current(state({ version: '9007199254740991' })).version, '9007199254740991');
  assert.throws(() => current(state({ version: '9007199254740992' })));
});
test('reasons are bounded NFC plain facts with no controls, markup, bidi or lone surrogates', () => {
  assert.equal(command(request({ reason: 'é'.repeat(500) })).reason.length, 500);
  assert.equal(command(request({ reason: '🏠'.repeat(500) })).reason.length, 1000);
  for (const reason of [
    '',
    ' leading',
    'trailing ',
    'e\u0301',
    'x'.repeat(501),
    'x\n',
    'x\u0080y',
    'x\u202ey',
    'x\u2066y',
    '<b>',
    '\ud800',
  ])
    assert.throws(() => command(request({ reason })));
});
test('accessors, inherited properties, hidden fields and symbols never become trusted facts', () => {
  let reads = 0;
  for (const [validate, factory] of [
    [command, request],
    [receipt, result],
    [current, state],
  ]) {
    const accessor = factory();
    Object.defineProperty(accessor, 'memberId', {
      enumerable: true,
      get() {
        reads++;
        return id(2);
      },
    });
    assert.throws(() => validate(accessor));
    assert.throws(() => validate(Object.assign(Object.create({ extra: true }), factory())));
    assert.throws(() => validate(Object.defineProperty(factory(), 'hidden', { value: true })));
    assert.throws(() => validate({ ...factory(), [Symbol('authority')]: true }));
    const nonenumerable = factory();
    Object.defineProperty(nonenumerable, 'memberId', { value: id(2), enumerable: false });
    assert.throws(() => validate(nonenumerable));
    assert.ok(Object.isFrozen(validate(Object.assign(Object.create(null), factory()))));
  }
  assert.equal(reads, 0);
});
test('receipt outcomes preserve exact applied, unchanged and terminal conflict version arithmetic', () => {
  assert.equal(receipt(result(), request(), id(3)).outcome, 'applied');
  assert.equal(receipt(result({ outcome: 'unchanged', version: '1' })).outcome, 'unchanged');
  assert.equal(receipt(result({ outcome: 'conflict', version: '4' })).outcome, 'conflict');
  assert.equal(
    receipt(result({ outcome: 'conflict', expectedVersion: '4', version: '1' })).outcome,
    'conflict',
  );
  for (const patch of [
    { version: '1' },
    { version: '3' },
    { outcome: 'unchanged' },
    { outcome: 'conflict', version: '1' },
    { outcome: 'denied' },
    { version: '0' },
  ])
    assert.throws(() => receipt(result(patch)));
});
test('private original recovery binds every request field and the verified actor; self targeting is refused', () => {
  for (const patch of [
    { operationId: id(9) },
    { memberId: id(9) },
    { expectedVersion: '2', version: '3' },
    { requestedRole: 'admin' },
    { active: true },
    { reason: 'Different reason' },
    { actorId: id(9) },
  ])
    assert.throws(() => receipt(result(patch), request(), id(3)));
  assert.throws(() => receipt(result({ actorId: id(2) })));
  assert.throws(() => receipt(result(), request(), id(2)));
  const raw = result(),
    verified = receipt(raw, request(), id(3));
  raw.reason = 'Changed later';
  assert.equal(verified.reason, request().reason);
  assert.ok(Object.isFrozen(verified));
});
test('receipt timestamps require real canonical UTC millisecond instants', () => {
  for (const recordedAt of [
    '2026-11-02T09:00:00Z',
    '2026-11-02T12:00:00.000+03:00',
    '2026-02-30T09:00:00.000Z',
    'bad',
  ])
    assert.throws(() => receipt(result({ recordedAt })));
});
test('current state binds the requested existing member and omits private operation metadata', () => {
  const raw = state(),
    verified = current(raw, id(2));
  raw.active = true;
  assert.equal(verified.active, false);
  assert.ok(Object.isFrozen(verified));
  assert.throws(() => current(state(), id(9)));
  for (const patch of [
    { role: 'customer' },
    { active: 'false' },
    { actorId: id(3) },
    { reason: 'Private' },
    { operationId: id(1) },
    { tenantId: id(9) },
    { policy: 'staff-membership-record-v1' },
    { active: true },
    { revokedAt: null },
    { revokedAt: '2026-11-02T09:00:00Z' },
  ])
    assert.throws(() => current(state(patch)));
  assert.equal(current(state({ active: true, revokedAt: null })).revokedAt, null);
});
