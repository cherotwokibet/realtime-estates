import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
import ReferenceReviewWorkspace from '../dist/tests/components/ReferenceReviewWorkspace.js';
import { catalogue, review, scope } from '../test-helpers/reference-moderation-fixture.mjs';
const props = () => ({
  scope: scope(),
  context: {
    policy: 'synthetic-reference-context-v1',
    review: review(),
    catalogue: catalogue(),
  },
});
test('private reviewer initial markup shows complete historical facts and locks decisions until original restoration', () => {
  const p = props();
  const html = renderToStaticMarkup(React.createElement(ReferenceReviewWorkspace, p));
  assert.ok(html.includes('PRIVATE BFF REVIEW'));
  assert.ok(html.includes('Synthetic original county'));
  assert.ok(html.includes('Catalogue version 1'));
  assert.ok(html.includes('editorial version 3'));
  assert.ok(html.includes(p.context.review.photos[0].sha256));
  assert.ok(html.includes('publication paused'));
  assert.ok(html.includes('<fieldset disabled="">'));
  assert.ok(html.includes('Rejection reason'));
  assert.ok(html.includes('Approve saved review'));
  assert.ok(html.includes('Reject with reason'));
  assert.ok(!html.includes('Check original result'));
  assert.ok(!html.includes('Verified review photos'));
  assert.equal(
    (html.match(/<dt>/g) ?? []).length,
    Object.keys(p.context.review.content).length + 3,
  );
  assert.ok(html.includes('Advertised price'));
});
test('recovery shell has no fresh decision controls or fabricated review data', () => {
  const html = renderToStaticMarkup(
    React.createElement(ReferenceReviewWorkspace, { scope: scope(), context: null }),
  );
  assert.ok(html.includes('Checking this tab for an original decision'));
  assert.ok(!html.includes('Approve saved review'));
  assert.ok(!html.includes('PRIVATE BFF REVIEW'));
});
test('review prices retain exact cents and quote-required fees remain explicitly unknown', () => {
  const p = structuredClone(props());
  p.context.review.content = normalizeStaffDraftContentV2({
    ...p.context.review.content,
    purpose: 'rent',
    rentPeriod: 'month',
    amountMinor: 2000001,
    pricing: {
      declaration: 'complete',
      charges: [
        {
          id: 'service',
          name: 'Synthetic service fee',
          timing: 'per_rental_period',
          classification: 'fee',
          mandatory: true,
          amountStatus: 'known',
          amountMinor: 100001,
        },
        {
          id: 'quote',
          name: 'Synthetic quote fee',
          timing: 'one_off',
          classification: 'fee',
          mandatory: false,
          amountStatus: 'quote_required',
          amountMinor: null,
        },
      ],
    },
  });
  const html = renderToStaticMarkup(React.createElement(ReferenceReviewWorkspace, p));
  assert.ok(html.includes('KES 20,000.01'));
  assert.ok(html.includes('KES 1,000.01'));
  assert.ok(html.includes('Quote required'));
  assert.ok(!html.includes('2000001'));
  assert.ok(!html.includes('amountMinor'));
});
test('review content is escaped and mismatched historical context cannot render controls', () => {
  const p = structuredClone(props());
  p.context.review.content.privateAddress = '<script>synthetic()</script>';
  const html = renderToStaticMarkup(React.createElement(ReferenceReviewWorkspace, p));
  assert.ok(html.includes('&lt;script&gt;synthetic()&lt;/script&gt;'));
  assert.ok(!html.includes('<script>synthetic'));
  p.context.catalogue.version = '2';
  assert.throws(() => renderToStaticMarkup(React.createElement(ReferenceReviewWorkspace, p)));
});
