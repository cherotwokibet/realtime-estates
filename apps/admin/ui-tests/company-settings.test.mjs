import { renderAfterVerifiedLease } from './verified-workspace-render.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CompanySettingsWorkspace from '../dist/tests/components/CompanySettingsWorkspace.js';
test('settings SSR labels approval, version, bounded history and recovery limits without fake modules or side effects', () => {
  const html = renderAfterVerifiedLease(
    React.createElement(CompanySettingsWorkspace, {
      initialState: {
        policy: 'company-settings-state-v1',
        version: '0',
        current: null,
        history: [],
        hasMore: false,
      },
      instanceId: '00000000-0000-4000-8000-000000000001',
      scope: {
        instanceId: '00000000-0000-4000-8000-000000000001',
        tenantId: '00000000-0000-4000-8000-000000000002',
        actorId: '00000000-0000-4000-8000-000000000003',
      },
    }),
  );
  assert.match(html, /Company name/);
  assert.match(html, /I have reviewed the preview/);
  assert.match(html, /UNSAVED BRAND PREVIEW/);
  assert.match(html, /Latest20 records/);
  assert.match(html, /Approve and save content/);
  assert.doesNotMatch(html, /href="\/(?:payments|exports|advertising|staff)"/);
  assert.doesNotMatch(html, /synthetic\.bearer|signature/);
});
