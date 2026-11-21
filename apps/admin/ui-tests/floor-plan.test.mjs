import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderAfterVerifiedLease as render } from './verified-workspace-render.mjs';
import FloorPlanWorkspace from '../dist/tests/components/FloorPlanWorkspace.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const props = {
  scope: { instanceId: id(1), tenantId: id(2), actorId: id(3), listingId: id(4), revision: 1 },
  state: {
    policy: 'synthetic-floor-plan-state-v1',
    listingId: id(4),
    revision: 1,
    version: '2',
    state: 'draft',
    floorPlan: null,
  },
  editable: true,
};
test('floor-plan screen exposes labelled file preparation/removal and waits for retained-original verification', () => {
  const html = render(React.createElement(FloorPlanWorkspace, props));
  assert.match(html, /Private floor plan/);
  assert.match(html, /PNG or JPEG file \(maximum 10 MiB\)/);
  assert.match(html, /Review file preparation/);
  assert.match(html, /Review removal/);
  assert.match(html, /Saved floor plan: None/);
  assert.match(html, /<fieldset disabled/);
  assert.match(html, /Checking this tab for an original request/);
  assert.doesNotMatch(html, /<iframe|<video|<img|Bearer|leaseNonce|generationId|storeId/);
});
test('read-only floor-plan view shows actual saved metadata and makes no implicit image or upload request', () => {
  const html = render(
    React.createElement(FloorPlanWorkspace, {
      ...props,
      editable: false,
      state: {
        ...props.state,
        state: 'pending',
        floorPlan: {
          operationId: id(6),
          requestId: id(5),
          width: 100,
          height: 80,
          bytes: 200,
          sha256: 'a'.repeat(64),
        },
      },
    }),
  );
  assert.match(html, /Saved floor plan: 100 × 80 pixels · 200 bytes/);
  assert.match(html, /saved revision is read-only/);
  assert.match(html, /<fieldset disabled/);
  assert.doesNotMatch(html, /<img|<iframe|<video|https?:/);
});

test('reviewer reload stays on the review route while the author route remains separate', () => {
  const html = render(
    React.createElement(FloorPlanWorkspace, {
      ...props,
      editable: false,
      audience: 'reviewer',
      state: { ...props.state, state: 'pending' },
    }),
  );
  assert.ok(html.includes(`/reviews/${props.scope.listingId}/1/floor-plan`));
  assert.ok(!html.includes(`/drafts/${props.scope.listingId}/1/floor-plan`));
});
