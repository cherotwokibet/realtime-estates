import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReferenceDraftEditor from '../dist/tests/components/ReferenceDraftEditor.js';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
import ReferenceDraftOriginal from '../dist/tests/components/ReferenceDraftOriginal.js';
import { draftToForm } from '../dist/tests/lib/editor-model.js';
import { referenceFormCommand } from '../dist/tests/lib/reference-draft-form.js';
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

test('saved reference IDs are selected on first markup and a read-only snapshot keeps fresh controls disabled', () => {
  const p = props();
  p.initialSelection = {
    catalogueVersion: '1',
    location: { countyId: id(200), localityId: null, neighbourhoodId: null },
    amenityIds: [],
  };
  p.editingDisabled = true;
  const html = renderToStaticMarkup(React.createElement(ReferenceDraftEditor, p));
  assert.ok(html.includes('<option value="' + id(200) + '" selected="">'));
  assert.ok(html.includes('Retained original recovery remains available.'));
  assert.match(html, /<fieldset disabled="">/);
  assert.ok(html.includes('Private address (staff only)'));
  assert.ok(html.includes('PRIVATE-NOT-FOR-RENDER'));
});
test('reference editor initial markup preserves UUID choices and unknown selection without text-to-ID inference', () => {
  const html = renderToStaticMarkup(React.createElement(ReferenceDraftEditor, props()));
  assert.ok(html.includes('value="' + id(200) + '"'));
  assert.ok(html.includes('value="' + id(201) + '"'));
  assert.ok(html.includes('Synthetic repeated county (00000200)'));
  assert.ok(html.includes('Synthetic repeated county (00000201)'));
  assert.match(html, /<option value="" selected="">Unknown county/);
  assert.equal(html.includes('Hidden until parent selected'), false);
  assert.ok(html.includes('Private address (staff only)'));
  assert.ok(html.includes('PRIVATE-NOT-FOR-RENDER'));
});
test('reference editor starts disabled before storage recovery and has explicit replacement consent/status', () => {
  const html = renderToStaticMarkup(React.createElement(ReferenceDraftEditor, props()));
  assert.match(html, /<fieldset disabled="">/);
  assert.match(html, /Apply this selection, including unknown values/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Review reference draft/);
  assert.match(html, /Submission and publication require separate checks/);
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
  assert.ok(html.includes('Private address (staff only)'));
  assert.ok(html.includes('PRIVATE-NOT-FOR-RENDER'));
});

test('combined staff form renders editable facts as disabled first markup with exact cents and unknown fees', () => {
  const p = props();
  p.content = normalizeStaffDraftContentV2({
    ...p.content,
    title: 'Synthetic <script>title</script>',
    description: 'Private facts',
    purpose: 'sale',
    amountMinor: 1234567,
    pricing: {
      declaration: 'incomplete',
      charges: [
        {
          id: id(400),
          name: 'Synthetic service',
          amountStatus: 'quote_required',
          amountMinor: null,
          timing: 'one_off',
          classification: 'fee',
          mandatory: false,
        },
      ],
    },
  });
  const html = renderToStaticMarkup(React.createElement(ReferenceDraftEditor, p));
  for (const fact of [
    'Property facts and exact costs',
    '12345.67',
    'Quote required',
    'Private address (staff only)',
    'Public location precision',
    'Bedrooms',
    'Private bathrooms',
    'Shared bathrooms',
    'Synthetic &lt;script&gt;title&lt;/script&gt;',
  ])
    assert.ok(html.includes(fact));
  assert.match(html, /<fieldset disabled=""><legend>Property facts/);
  assert.ok(!html.includes('<script>title</script>'));
  assert.ok(!html.includes('Send reviewed draft'));
  assert.ok(!html.includes('Recover original'));
});
test('reviewed draft shows full immutable original, canonical target and historical IDs without current-price invention', () => {
  const p = props(),
    f = draftToForm(p.content);
  f.title = 'Historical <script> title';
  f.amount = '123.45';
  f.purpose = 'sale';
  f.declaration = 'incomplete';
  f.privateAddress = 'Synthetic staff-only original';
  f.charges = [
    {
      id: id(410),
      name: 'Quoted service',
      amountStatus: 'quote_required',
      amount: '',
      timing: 'one_off',
      classification: 'fee',
      mandatory: true,
    },
  ];
  const command = referenceFormCommand(
    f,
    {
      catalogueVersion: '1',
      location: { countyId: id(200), localityId: null, neighbourhoodId: null },
      amenityIds: [],
    },
    p.catalogue,
    { operationId: id(300), listingId: p.scope.listingId, revision: 1, expectedVersion: '2' },
  );
  const html = renderToStaticMarkup(
    React.createElement(ReferenceDraftOriginal, { command, catalogue: p.catalogue }),
  );
  for (const fact of [
    'Retained original facts',
    '123.45',
    'Quote required',
    'Expected revision version:',
    'Original catalogue:',
    'Synthetic staff-only original',
    id(300),
    'Historical &lt;script&gt; title',
  ])
    assert.ok(html.includes(fact));
  assert.ok(!html.includes('<script>'));
  assert.throws(() =>
    renderToStaticMarkup(
      React.createElement(ReferenceDraftOriginal, {
        command: { ...command, expectedVersion: '0' },
        catalogue: p.catalogue,
      }),
    ),
  );
});
