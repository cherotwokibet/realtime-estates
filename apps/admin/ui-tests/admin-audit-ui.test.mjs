import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import View from '../dist/tests/components/AdminAuditView.js';
const id = '00000000-0000-4000-8000-000000000001';
const query = { limit: 5, before: null, actorId: null, objectId: null };
const page = { policy: 'admin-audit-page-v1', tenantId: id, items: [], nextBefore: null };
test('audit view renders empty and safe read-only filtering/pagination without client credential or storage code', () => {
  const html = renderToStaticMarkup(
    React.createElement(View, { page, query, nextHref: null, recentHref: '/audit?limit=5' }),
  );
  assert.match(html, /No matching events/);
  assert.match(html, /method="get"/);
  assert.match(html, /Apply filters/);
  assert.match(html, /End of this result/);
  assert.doesNotMatch(html, /Older events|bearer|localStorage|sessionStorage/);
});
test('audit view displays exact versions, actor references, time zone and escaped text with an older-page link', () => {
  const html = renderToStaticMarkup(
    React.createElement(View, {
      page: {
        ...page,
        items: [
          {
            id: '9007199254740994',
            actorId: id,
            objectType: 'company',
            objectId: id,
            action: 'company.settings.approved',
            objectVersion: '9007199254740993',
            occurredAt: '2026-11-03T16:00:00.000000Z',
          },
        ],
      },
      query,
      nextHref: '/audit?limit=5&before=9007199254740994',
      recentHref: '/audit?limit=5',
    }),
  );
  assert.match(html, /9007199254740993/);
  assert.match(html, /company settings approved/);
  assert.match(html, /EAT/);
  assert.match(html, /Actor reference/);
  assert.match(html, /Older events/);
  assert.match(html, /before=9007199254740994/);
  assert.doesNotMatch(html, /summary|correlation|operationId|<script/);
});
