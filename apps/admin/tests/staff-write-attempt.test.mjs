import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareStaffWrite as prepare,
  markStaffWriteUncertain as uncertain,
  resolveStaffWrite as resolve,
  serializeStaffWrite as serialize,
  restoreStaffWrite as restore,
  canDiscardStaffWrite as discard,
} from '../dist/tests/lib/staff-write-attempt.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { instanceId: id(1), tenantId: id(2), actorId: id(3) };
const branch = () => ({
  policy: 'staff-branch-command-v1',
  operationId: id(4),
  branchId: id(5),
  expectedVersion: '0',
  name: 'Synthetic',
  active: true,
  reason: 'Synthetic creation.',
});
const receipt = () => ({
  ...branch(),
  policy: 'staff-branch-record-v1',
  actorId: id(3),
  version: '1',
  outcome: 'applied',
  recordedAt: '2026-10-31T03:00:00.000Z',
});
test('retained staff attempt snapshots exact command and binds instance/company/actor without granting authority', () => {
  const c = branch(),
    s = { ...scope },
    a = prepare(s, 'branch', c);
  c.name = 'Changed';
  s.actorId = id(9);
  assert.equal(a.command.name, 'Synthetic');
  assert.equal(a.scope.actorId, id(3));
  assert.ok(Object.isFrozen(a.command));
  assert.ok(Object.isFrozen(a.scope));
  assert.ok(Object.isFrozen(a));
  assert.equal(discard(a), true);
  for (const key of ['instanceId', 'tenantId', 'actorId'])
    assert.throws(() => uncertain(a, { ...scope, [key]: id(8) }));
  assert.throws(() => prepare({ ...scope, token: 'secret' }, 'branch', branch()));
});
test('uncertain staff requests cannot discard; only exact original resolves and durable conflicts stay known', () => {
  const a = uncertain(prepare(scope, 'branch', branch()), scope);
  assert.equal(discard(a), false);
  const r = resolve(a, scope, receipt());
  assert.equal(discard(r), true);
  assert.equal(r.receipt.version, '1');
  assert.throws(() => uncertain(r, scope));
  for (const patch of [{ actorId: id(8) }, { operationId: id(8) }, { name: 'Changed' }])
    assert.throws(() => resolve(a, scope, { ...receipt(), ...patch }));
  const future = uncertain(prepare(scope, 'branch', { ...branch(), expectedVersion: '2' }), scope);
  assert.equal(
    resolve(future, scope, { ...receipt(), expectedVersion: '2', outcome: 'conflict' }).receipt
      .outcome,
    'conflict',
  );
});
test('retained serialization stores original request only; restores always require GET recovery and reject stale scope/duplicates', () => {
  const a = resolve(prepare(scope, 'branch', branch()), scope, receipt()),
    text = serialize(a);
  assert.equal(text.includes('recordedAt'), false);
  const r = restore(text, scope);
  assert.equal(r.phase, 'uncertain');
  assert.equal(r.receipt, null);
  assert.equal(discard(r), false);
  assert.deepEqual(r.command, a.command);
  assert.throws(() => restore(text, { ...scope, instanceId: id(8) }));
  assert.throws(() => restore(text.replace('"policy":', '"policy":"bad","policy":'), scope));
  assert.throws(() => restore(text.slice(0, -1) + ',"membershipGranted":true}', scope));
  assert.throws(() => restore(' '.repeat(12289), scope));
});
test('invitation and revocation attempts retain exact recipient/target originals without sent/grant claims', () => {
  const intent = {
    policy: 'staff-invitation-intent-v1',
    operationId: id(4),
    recipientEmail: 'synthetic@example.invalid',
    requestedRole: 'agent',
    branchId: null,
    expiresAfterHours: 24,
  };
  const a = uncertain(prepare(scope, 'invitation', intent), scope),
    facts = {
      policy: 'staff-invitation-request-record-v1',
      operationId: id(4),
      actorId: id(3),
      recipientEmail: intent.recipientEmail,
      requestedRole: 'agent',
      expiresAfterHours: 24,
      branch: null,
      recordedAt: '2026-10-31T03:00:00.000Z',
      expiresAt: '2026-11-01T03:00:00.000Z',
      status: 'recorded',
      delivery: 'not_attempted',
      membershipGranted: false,
    };
  assert.equal(resolve(a, scope, facts).receipt.membershipGranted, false);
  assert.throws(() => resolve(a, scope, { ...facts, recipientEmail: 'changed@example.invalid' }));
  const command = {
      policy: 'staff-invitation-revocation-command-v1',
      operationId: id(6),
      invitationId: id(4),
      expectedVersion: '1',
      reason: 'Synthetic cancellation.',
    },
    rev = uncertain(prepare(scope, 'revocation', command), scope);
  assert.equal(
    resolve(rev, scope, {
      ...command,
      policy: 'staff-invitation-revocation-record-v1',
      actorId: id(3),
      version: '2',
      outcome: 'revoked',
      recordedAt: '2026-10-31T03:00:00.000Z',
    }).receipt.outcome,
    'revoked',
  );
});
