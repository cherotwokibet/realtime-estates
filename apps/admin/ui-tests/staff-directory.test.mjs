import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StaffDirectoryWorkspace from '../dist/tests/components/StaffDirectoryWorkspace.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('staff workspace SSR shows explicit request-only scope, bounded directories and disabled writes until retained storage opens', () => {
  const html = renderToStaticMarkup(
    React.createElement(StaffDirectoryWorkspace, {
      scope: { instanceId: id(1), tenantId: id(2), actorId: id(3) },
      branches: { policy: 'staff-branch-page-v1', items: [], nextAfter: null },
      invitations: { policy: 'staff-invitation-page-v1', items: [], nextAfter: null },
    }),
  );
  for (const text of [
    'Retained operation',
    'Create branch metadata',
    'Branch name',
    'Recipient email',
    'Requested role',
    'Request lifetime',
    'No email, secret, acceptance or access grant',
    'Opening retained operation storage',
    'Prepare invitation request',
    'Branches · current page',
    'Invitation requests · current page',
  ])
    assert.ok(html.includes(text), text);
  assert.match(html, /<fieldset disabled/);
  assert.doesNotMatch(html, /synthetic\.bearer|signature|type="password"/);
});
