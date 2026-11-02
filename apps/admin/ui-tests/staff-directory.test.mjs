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
  assert.doesNotMatch(html, /Existing staff access|Review current access for/);
});
test('staff SSR membership directory marks own access unavailable and offers only peer review without credentials', () => {
  const html = renderToStaticMarkup(
    React.createElement(StaffDirectoryWorkspace, {
      scope: { instanceId: id(1), tenantId: id(2), actorId: id(3) },
      branches: { policy: 'staff-branch-page-v1', items: [], nextAfter: null },
      invitations: { policy: 'staff-invitation-page-v1', items: [], nextAfter: null },
      memberships: {
        policy: 'staff-membership-page-v1',
        items: [
          {
            policy: 'staff-membership-current-v1',
            memberId: id(3),
            role: 'admin',
            active: true,
            version: '1',
            revokedAt: null,
          },
          {
            policy: 'staff-membership-current-v1',
            memberId: id(4),
            role: 'agent',
            active: false,
            version: '2',
            revokedAt: '2026-11-02T09:00:00.000Z',
          },
        ],
        nextAfter: id(4),
      },
    }),
  );
  for (const text of [
    'Existing staff access',
    'Your own access cannot be',
    'No new membership is created',
    'You; own access changes unavailable',
    'Refresh first staff page',
    'Next staff page',
    'Review current access for ' + id(4),
    'Inactive',
  ])
    assert.ok(html.includes(text), text);
  assert.ok(!html.includes('Review current access for ' + id(3)));
  assert.ok(!html.includes('Change existing staff access'));
  assert.doesNotMatch(html, /bearerToken|STAFF_PREVIEW_TOKEN|type="password"/);
});
test('staff SSR escapes displayed branch labels while membership administration stays hidden when disabled', () => {
  const html = renderToStaticMarkup(
    React.createElement(StaffDirectoryWorkspace, {
      scope: { instanceId: id(1), tenantId: id(2), actorId: id(3) },
      branches: {
        policy: 'staff-branch-page-v1',
        items: [
          {
            policy: 'staff-branch-current-v1',
            branchId: id(4),
            version: '1',
            name: 'Synthetic <north> & branch',
            active: true,
            recordedAt: '2026-11-02T09:00:00.000Z',
          },
        ],
        nextAfter: null,
      },
      invitations: { policy: 'staff-invitation-page-v1', items: [], nextAfter: null },
      memberships: null,
    }),
  );
  assert.ok(html.includes('Synthetic &lt;north&gt; &amp; branch'));
  assert.ok(!html.includes('<north>'));
  assert.doesNotMatch(
    html,
    /Existing staff access|Review current access for|bearerToken|STAFF_PREVIEW_TOKEN/,
  );
});
