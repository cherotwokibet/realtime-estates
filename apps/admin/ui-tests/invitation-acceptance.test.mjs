import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import InvitationAcceptanceWorkspace from '../dist/tests/components/InvitationAcceptanceWorkspace.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('recipient screen initially requires retained storage and never offers fabricated membership or provider authority', () => {
  const html = renderToStaticMarkup(
    React.createElement(InvitationAcceptanceWorkspace, {
      instanceId: id(1),
      session: {
        policy: 'synthetic-staff-invitation-recipient-session-v1',
        tenantId: id(2),
        actorId: id(50),
        recipientEmail: 'recipient@example.invalid',
        authority: 'identity_only',
      },
    }),
  );
  for (const text of [
    'Verified recipient',
    'Identity verification alone grants no staff role or membership',
    'Opening retained acceptance storage',
    'Invitation code',
    'type="password"',
  ])
    assert.ok(html.includes(text), text);
  assert.match(html, /autocomplete="off"/i);
  assert.match(html, /<input[^>]+type="password"[^>]+disabled/);
  assert.doesNotMatch(
    html,
    /Original membership grant|Prepare acceptance request|Accept reviewed invitation|bearerToken|STAFF_INVITATION_RECIPIENT_TOKEN/,
  );
});
