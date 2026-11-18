import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HostedStaffWorkspace from '../dist/tests/components/HostedStaffWorkspace.js';
import { validateHostedStaffSession } from '../dist/tests/lib/hosted-staff-wire.js';
const tenantId = '00000000-0000-4000-8000-000000000001',
  actorId = '00000000-0000-4000-8000-000000000010';
const now = Date.now(),
  session = {
    policy: 'hosted-staff-session-v1',
    account: {
      tenantId,
      actorId,
      generation: 'a'.repeat(64),
      expiresAt: new Date(now + 600000).toISOString(),
    },
    csrf: 'c'.repeat(43),
    pending: null,
  };
test('hosted staff metadata refuses token/role fields, foreign scope, invalid actor types and stale sessions', () => {
  assert.deepEqual(validateHostedStaffSession(session, tenantId, now), session);
  for (const value of [
    { ...session, accessToken: 'synthetic.payload.signature' },
    { ...session, role: 'admin' },
    { ...session, policy: 'current-staff-session-v2' },
    { ...session, account: { ...session.account, tenantId: actorId } },
    { ...session, account: { ...session.account, actorId: [actorId] } },
    { ...session, account: { ...session.account, expiresAt: new Date(now).toISOString() } },
    { ...session, csrf: 'c'.repeat(64) },
    { ...session, pending: { role: 'admin' } },
  ])
    assert.throws(() => validateHostedStaffSession(value, tenantId, now));
});
test('hosted staff SSR waits for fresh client authority, exposes sign-in and never renders prior account data or preview controls', () => {
  const html = renderToStaticMarkup(createElement(HostedStaffWorkspace, { tenantId }));
  for (const text of [
    'Branch administration',
    'Current company admin access',
    'Manage sign-in',
    'Checking staff access',
    'Refresh branches and retained action',
  ])
    assert.ok(html.includes(text));
  assert.ok(html.includes('aria-busy="true"'));
  for (const forbidden of [
    actorId,
    tenantId,
    'synthetic.payload.signature',
    'Synthetic local preview',
    'Recipient email',
    'Save branch change',
    'x-preview-instance',
  ])
    assert.ok(!html.includes(forbidden));
});
