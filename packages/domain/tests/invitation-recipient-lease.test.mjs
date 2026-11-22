import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInvitationRecipientLease as validate } from '../dist/index.js';
const now = Date.now(),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const lease = () => ({
  policy: 'invitation-recipient-lease-v1',
  tenantId: id(1),
  actorId: id(50),
  recipientEmail: 'recipient@example.invalid',
  authority: 'identity_only',
  checkedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 30000).toISOString(),
});
test('recipient display lifetime carries canonical identity-only facts and is immutable', () => {
  const original = lease(),
    value = validate(original, now);
  assert.deepEqual(value, original);
  assert.ok(Object.isFrozen(value));
  assert.equal(Object.hasOwn(value, 'role'), false);
});
test('recipient lifetime rejects role grants, stale/expired/long/noncanonical windows and accessor input', () => {
  for (const patch of [
    { role: 'admin' },
    { authority: 'membership' },
    { recipientEmail: 'Recipient@example.invalid' },
    { expiresAt: new Date(now).toISOString() },
    { checkedAt: new Date(now - 15001).toISOString() },
    { checkedAt: new Date(now + 10001).toISOString() },
    { expiresAt: new Date(now + 30001).toISOString() },
    { checkedAt: new Date(now).toISOString().replace('Z', '+00:00') },
    { policy: 'staff-access-lease-v1' },
  ]) {
    const value = { ...lease(), ...patch };
    if (JSON.stringify(value) === JSON.stringify(lease())) continue;
    assert.throws(() => validate(value, now));
  }
  const hostile = lease();
  Object.defineProperty(hostile, 'actorId', {
    enumerable: true,
    get() {
      throw Error('Never invoke');
    },
  });
  assert.throws(() => validate(hostile, now));
});
