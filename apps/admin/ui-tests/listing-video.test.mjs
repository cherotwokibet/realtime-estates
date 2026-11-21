import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderAfterVerifiedLease as render } from './verified-workspace-render.mjs';
import Workspace from '../dist/tests/components/ListingVideoWorkspace.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  props = {
    scope: { instanceId: id(1), tenantId: id(2), actorId: id(3), listingId: id(4), revision: 1 },
    state: {
      policy: 'synthetic-listing-video-state-v1',
      listingId: id(4),
      revision: 1,
      version: '3',
      video: { provider: 'youtube', videoId: 'abcdefghijk', title: 'Synthetic tour' },
    },
    editable: true,
  };
test('private video form has labelled identifiers and review while making no provider/image/embed requests', () => {
  const html = render(React.createElement(Workspace, props));
  assert.match(html, /Private listing video/);
  assert.match(html, /Video identifier/);
  assert.match(html, /Review video change/);
  assert.match(html, /Synthetic tour/);
  assert.doesNotMatch(html, /<iframe|<img|<video|preconnect|youtube\.com|vimeo\.com|Bearer/);
});
test('read-only saved revisions expose no enabled preparation or invented default video', () => {
  const html = render(
    React.createElement(Workspace, {
      ...props,
      editable: false,
      state: { ...props.state, video: null },
    }),
  );
  assert.match(html, /read-only/);
  assert.match(html, /<fieldset disabled/);
  assert.match(html, /Current selection: None/);
});
