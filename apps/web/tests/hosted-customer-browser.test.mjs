import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBrowserSession } from '../dist/tests/lib/customer-browser.js';
const tenantId = '00000000-0000-4000-8000-000000000001',
  actorId = '00000000-0000-4000-8000-000000000013';
const now = Date.now();
const session = {
  policy: 'hosted-customer-browser-session-v1',
  account: {
    tenantId,
    customerId: actorId,
    label: 'Your account',
    generation: 'a'.repeat(64),
    expiresAt: new Date(now + 3590000).toISOString(),
  },
  csrf: 'c'.repeat(43),
  pending: null,
  choices: [],
};
test('hosted browser session accepts only its explicit policy, server scope and no account chooser', () => {
  assert.deepEqual(validateBrowserSession(session, tenantId, now, 'hosted'), session);
  assert.throws(() => validateBrowserSession(session, tenantId, now));
  for (const value of [
    { ...session, policy: 'customer-browser-session-v1' },
    { ...session, accessToken: 'synthetic.payload.signature' },
    { ...session, choices: [{ id: actorId, label: 'Synthetic Customer A' }] },
    { ...session, account: { ...session.account, tenantId: actorId } },
    { ...session, account: { ...session.account, label: 'Synthetic Customer A' } },
    {
      ...session,
      account: { ...session.account, expiresAt: new Date(now + 3600001).toISOString() },
    },
    { ...session, csrf: 'a'.repeat(64) },
  ])
    assert.throws(() => validateBrowserSession(value, tenantId, now, 'hosted'));
});
