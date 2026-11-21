import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStaffAccessLease } from '../dist/index.js';
const now = Date.now();
const lease = () => ({
  policy: 'staff-access-lease-v1',
  tenantId: '00000000-0000-4000-8000-000000000001',
  actorId: '00000000-0000-4000-8000-000000000010',
  role: 'agent',
  checkedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 30000).toISOString(),
});
test('bounded staff lease is immutable, canonical and contains no credential or caller permission fields', () => {
  const input = lease(),
    parsed = validateStaffAccessLease(input, now);
  assert.deepEqual(parsed, input);
  assert.ok(Object.isFrozen(parsed));
  assert.notEqual(parsed, input);
  for (const patch of [
    { token: 'private' },
    { expiresAt: new Date(now + 30001).toISOString() },
    { expiresAt: new Date(now).toISOString() },
    { checkedAt: new Date(now - 15001).toISOString() },
    { checkedAt: new Date(now + 10001).toISOString() },
    { role: 'customer' },
    { actorId: [] },
    { tenantId: 'foreign' },
    { checkedAt: '2026-01-01' },
    { expiresAt: 'invalid' },
  ])
    assert.throws(() => validateStaffAccessLease({ ...input, ...patch }, now));
  for (const value of [null, [], {}, new Date(), Object.create({ ...input })])
    assert.throws(() => validateStaffAccessLease(value, now));
  const accessor = lease();
  Object.defineProperty(accessor, 'actorId', {
    enumerable: true,
    get() {
      throw Error('must not execute');
    },
  });
  assert.throws(() => validateStaffAccessLease(accessor, now), /Fresh staff/);
});
