import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { createHash } from 'node:crypto';
import {
  issueStaffInvitationSecret,
  hashStaffInvitationSecret,
} from '../dist/staff-invitation-secret.js';

test('issued secret is canonical 32-byte base64url and its digest binds the exact bytes', () => {
  const issued = issueStaffInvitationSecret(),
    token = issued.takeSecretOnce();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const bytes = Buffer.from(token, 'base64url');
  assert.equal(bytes.length, 32);
  assert.equal(issued.digest, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(hashStaffInvitationSecret(token), issued.digest);
  assert.throws(() => issued.takeSecretOnce(), /Invitation secret unavailable/);
});

test('ordinary serialization, inspection and enumeration never reveal or consume the raw secret', () => {
  const issued = issueStaffInvitationSecret();
  const json = JSON.stringify(issued),
    printed = inspect(issued, { showHidden: true });
  assert.deepEqual(JSON.parse(json), {
    policy: 'staff-invitation-secret-v1',
    digest: issued.digest,
  });
  assert.deepEqual(Object.keys(issued), ['policy', 'digest']);
  const token = issued.takeSecretOnce();
  assert.equal(json.includes(token), false);
  assert.equal(printed.includes(token), false);
  assert.equal(inspect(issued).includes(token), false);
  assert.ok(Object.isFrozen(issued));
  assert.throws(() => {
    issued.digest = 'changed';
  }, TypeError);
});

test('destroy is idempotent and permanently refuses later revelation', () => {
  const issued = issueStaffInvitationSecret(),
    digest = issued.digest;
  issued.destroy();
  issued.destroy();
  assert.throws(() => issued.takeSecretOnce());
  assert.equal(issued.digest, digest);
  const consumed = issueStaffInvitationSecret();
  consumed.takeSecretOnce();
  consumed.destroy();
  assert.throws(() => consumed.takeSecretOnce());
});

test('padding, whitespace, digest substitution, wrong lengths and noncanonical trailing bits are refused', () => {
  const valid = Buffer.alloc(32).toString('base64url');
  const bad = [
    null,
    {},
    true,
    Buffer.alloc(32),
    valid + '=',
    ' ' + valid,
    valid + '\n',
    valid.slice(1),
    valid + 'A',
    valid.slice(0, -1) + 'B',
    hashStaffInvitationSecret(valid),
    'é'.repeat(43),
    '-'.repeat(43),
  ];
  for (const value of bad)
    assert.throws(() => hashStaffInvitationSecret(value), /Invitation secret unavailable/);
  assert.match(hashStaffInvitationSecret(valid), /^[0-9a-f]{64}$/);
});

test('validation errors disclose no input and never coerce caller objects', () => {
  let calls = 0;
  const value = {
    toString() {
      calls++;
      return 'private';
    },
  };
  assert.throws(
    () => hashStaffInvitationSecret(value),
    (error) => error.message === 'Invitation secret unavailable.',
  );
  assert.equal(calls, 0);
  const marker = 'private-secret-marker';
  assert.throws(
    () => hashStaffInvitationSecret(marker),
    (error) => !error.message.includes(marker),
  );
});

test('separate issuance handles have independent consumption and digest state', () => {
  const first = issueStaffInvitationSecret(),
    second = issueStaffInvitationSecret();
  const token = first.takeSecretOnce();
  first.destroy();
  const other = second.takeSecretOnce();
  assert.notEqual(token, other);
  assert.notEqual(first.digest, second.digest);
  assert.equal(hashStaffInvitationSecret(token), first.digest);
  assert.equal(hashStaffInvitationSecret(other), second.digest);
});
