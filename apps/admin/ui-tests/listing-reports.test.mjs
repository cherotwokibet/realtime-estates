import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ListingReportsWorkspace } from '../dist/tests/components/ListingReportsWorkspace.js';
test('reports initial render discloses unverified concerns, requires explicit queue load, and exposes no private records or review action', () => {
  const html = renderToStaticMarkup(
    React.createElement(ListingReportsWorkspace, {
      instanceId: '00000000-0000-4000-8000-000000000001',
    }),
  );
  assert.match(html, /Report concerns are unverified/);
  assert.match(html, /does not change property publication/);
  assert.match(html, /Queue status/);
  assert.match(html, /Load current reports/);
  assert.doesNotMatch(
    html,
    /Save report review|Original review:|bearer|signature|reportId|actorId/,
  );
});
