import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReferenceDraftEditor from '../dist/tests/components/ReferenceDraftEditor.js';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const props = () => ({
  scope: { instanceId: id(9), tenantId: id(1), actorId: id(10), listingId: id(100) },
  revision: 1,
  expectedVersion: '2',
  content: normalizeStaffDraftContentV2({
    locality: 'Synthetic old town',
    privateAddress: 'PRIVATE-NOT-FOR-RENDER',
    location: { county: 'Synthetic repeated county', town: null, area: null },
    pricing: { declaration: 'not_declared', charges: [] },
  }),
  catalogue: {
    policy: 'synthetic-reference-catalogue-v1',
    version: '1',
    country: 'KE',
    locations: [
      { id: id(200), kind: 'county', parentId: null, label: 'Synthetic repeated county' },
      { id: id(201), kind: 'county', parentId: null, label: 'Synthetic repeated county' },
      { id: id(202), kind: 'locality', parentId: id(200), label: 'Hidden until parent selected' },
    ],
    amenities: [
      {
        id: id(210),
        code: 'synthetic-lift',
        label: 'Synthetic lift',
        propertyTypes: ['apartment'],
      },
    ],
  },
});
test('reference editor initial markup preserves UUID choices and unknown selection without text-to-ID inference', () => {
  const html = renderToStaticMarkup(React.createElement(ReferenceDraftEditor, props()));
  assert.ok(html.includes('value="' + id(200) + '"'));
  assert.ok(html.includes('value="' + id(201) + '"'));
  assert.ok(html.includes('Synthetic repeated county (00000200)'));
  assert.ok(html.includes('Synthetic repeated county (00000201)'));
  assert.match(html, /<option value="" selected="">Unknown county/);
  assert.equal(html.includes('Hidden until parent selected'), false);
  assert.equal(html.includes('PRIVATE-NOT-FOR-RENDER'), false);
});
test('reference editor starts disabled before storage recovery and has explicit replacement consent/status', () => {
  const html = renderToStaticMarkup(React.createElement(ReferenceDraftEditor, props()));
  assert.match(html, /<fieldset disabled="">/);
  assert.match(html, /Apply this selection, including unknown values/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Save reference draft/);
  assert.match(html, /drafts cannot be submitted yet/);
});
test('unknown property type does not promise type-inapplicable amenities', () => {
  const html = renderToStaticMarkup(React.createElement(ReferenceDraftEditor, props()));
  assert.match(html, /Synthetic lift.*unavailable for this property type/);
  assert.match(html, /<input type="checkbox" disabled=""/);
});
import ReferenceDraftWorkspace from '../dist/tests/components/ReferenceDraftWorkspace.js';
test('mounted reference workspace includes explicit refresh and retains disabled recovery-first initial state', () => {
  const html = renderToStaticMarkup(React.createElement(ReferenceDraftWorkspace, props()));
  assert.match(html, /Refresh current reference draft/);
  assert.match(html, /Reference draft editor/);
  assert.match(html, /fieldset disabled/);
  assert.ok(!html.includes('PRIVATE-NOT-FOR-RENDER'));
});
