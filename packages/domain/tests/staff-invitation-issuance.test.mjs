import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  validateStaffInvitationIssueCommand as issue,
  validateStaffInvitationRedemptionCommand as redeem,
  validateStaffInvitationIssueRecord as issued,
  validateStaffInvitationRedemptionRecord as redeemed,
  validateStaffIssuedInvitationState as state,
  validateStaffInvitationIssueResponse as disclosure,
  validateStaffInvitationRawSecret as secret,
  parseStaffIssuedInvitationJson as parse,
} from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const command = () => ({
  policy: 'staff-invitation-issue-command-v1',
  operationId: id(1),
  invitationId: id(2),
});
const receipt = () => ({
  policy: 'staff-invitation-issuance-record-v1',
  operationId: id(1),
  invitationId: id(2),
  actorId: id(3),
  recordedAt: '2026-11-02T10:00:00.000Z',
  expiresAt: '2026-11-03T10:00:00.000Z',
  secretRecovery: 'revoke_and_replace',
  delivery: 'not_attempted',
  membershipGranted: false,
});
const used = () => ({
  policy: 'staff-invitation-redemption-record-v1',
  operationId: id(4),
  invitationId: id(2),
  memberId: id(5),
  requestedRole: 'agent',
  branchId: null,
  recordedAt: '2026-11-02T10:05:00.000Z',
  membershipGranted: true,
});
const current = () => ({
  policy: 'staff-issued-invitation-state-v1',
  operationId: id(1),
  invitationId: id(2),
  recordedAt: receipt().recordedAt,
  expiresAt: receipt().expiresAt,
  state: 'used',
});
test('retained commands freeze detached operation/target facts and reject secret or caller authority', () => {
  const source = command(),
    saved = issue(source);
  source.invitationId = id(9);
  assert.equal(saved.invitationId, id(2));
  assert.ok(Object.isFrozen(saved));
  assert.equal(
    redeem({ ...command(), policy: 'staff-invitation-redemption-command-v1' }).operationId,
    id(1),
  );
  for (const patch of [
    { secret: 'private' },
    { tenantId: id(8) },
    { email: 'private@example.invalid' },
    { actorId: id(3) },
    { requestedRole: 'admin' },
    { operationId: 'A0000000-0000-4000-8000-000000000001' },
    { invitationId: null },
    { policy: 'staff-invitation-intent-v1' },
  ])
    assert.throws(() => issue({ ...command(), ...patch }));
});
test('receipt validation binds issuer/recipient operations, role meaning and bounded immutable deadlines', () => {
  const source = receipt(),
    saved = issued(source, id(1), id(2), id(3));
  source.delivery = 'sent';
  assert.equal(saved.delivery, 'not_attempted');
  assert.ok(Object.isFrozen(saved));
  for (const patch of [
    { actorId: id(9) },
    { operationId: id(9) },
    { invitationId: id(9) },
    { secret: 'private' },
    { secretDigest: 'private' },
    { membershipGranted: true },
    { delivery: 'sent' },
    { recordedAt: '2026-02-30T10:00:00.000Z' },
    { expiresAt: receipt().recordedAt },
    { expiresAt: '2027-11-03T10:00:00.000Z' },
  ])
    assert.throws(() => issued({ ...receipt(), ...patch }, id(1), id(2), id(3)));
  assert.equal(redeemed(used(), id(4), id(2), id(5)).membershipGranted, true);
  for (const patch of [
    { memberId: id(9) },
    { operationId: id(9) },
    { invitationId: id(9) },
    { requestedRole: 'customer' },
    { requestedRole: 'admin', branchId: id(6) },
    { membershipGranted: false },
    { recipientEmail: 'private@example.invalid' },
  ])
    assert.throws(() => redeemed({ ...used(), ...patch }, id(4), id(2), id(5)));
});
test('issued current state is distinct from historical capture or active membership authority', () => {
  for (const kind of ['issued', 'used', 'revoked', 'expired'])
    assert.equal(state({ ...current(), state: kind }, id(1), id(2)).state, kind);
  for (const patch of [
    { state: 'pending' },
    { policy: 'staff-invitation-state-v1' },
    { membershipGranted: true },
    { version: '2' },
    { actorId: id(3) },
    { expiresAt: '2030-01-01T00:00:00.000Z' },
  ])
    assert.throws(() => state({ ...current(), ...patch }, id(1), id(2)));
  assert.throws(() => state(current(), id(9), id(2)));
  assert.throws(() => state(current(), id(1), id(9)));
});
test('canonical raw-secret validation is portable and refuses nonzero trailing bits without coercion', () => {
  for (let i = 0; i < 64; i++) {
    const raw = randomBytes(32).toString('base64url');
    assert.equal(secret(raw), raw);
    assert.equal(Buffer.from(raw, 'base64url').length, 32);
  }
  const raw = Buffer.alloc(32).toString('base64url');
  for (const candidate of [
    raw + '=',
    raw.slice(1),
    raw.slice(0, -1) + 'B',
    raw + ' ',
    raw.toLowerCase() + 'x',
    '0'.repeat(64),
    null,
    {},
    new String(raw),
  ])
    assert.throws(() => secret(candidate));
  let coercions = 0;
  assert.throws(() =>
    secret({
      toString() {
        coercions++;
        return raw;
      },
    }),
  );
  assert.equal(coercions, 0);
});
test('secret disclosure is explicit and cannot enter ordinary metadata or retained commands', () => {
  const raw = randomBytes(32).toString('base64url');
  for (const value of [raw, null]) {
    const parsed = disclosure(
      { policy: 'staff-invitation-issue-response-v1', record: receipt(), secret: value },
      id(1),
      id(2),
    );
    assert.equal(parsed.secret, value);
    assert.ok(Object.isFrozen(parsed.record));
  }
  assert.throws(() => issued({ ...receipt(), secret: raw }, id(1), id(2)));
  assert.throws(() => issue({ ...command(), secret: raw }));
  assert.throws(() =>
    disclosure(
      {
        policy: 'staff-invitation-issue-response-v1',
        record: receipt(),
        secret: raw,
        digest: 'private',
      },
      id(1),
      id(2),
    ),
  );
  let calls = 0;
  const hostile = Object.defineProperty(command(), 'operationId', {
    enumerable: true,
    get() {
      calls++;
      throw Error('private');
    },
  });
  assert.throws(() => issue(hostile));
  assert.equal(calls, 0);
});
test('bounded wire parsing refuses escaped duplicates and oversize payloads before interpreting facts', () => {
  assert.deepEqual(parse(JSON.stringify(command())), command());
  assert.throws(() => parse('{"operationId":"a","operation\\u0049d":"b"}'));
  assert.throws(() => parse('{"outer":{"secret":"a","secret":"b"}}'));
  assert.throws(() => parse(' '.repeat(8193)));
  assert.throws(() => parse('"' + '界'.repeat(2800) + '"'));
});
