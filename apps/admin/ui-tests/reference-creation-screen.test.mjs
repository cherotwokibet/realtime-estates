import { renderAfterVerifiedLease } from './verified-workspace-render.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  id,
  catalogue,
  command,
} from '../../../packages/api-client/tests/fixtures/reference-creation.mjs';
import ReferenceCreationWorkspace from '../dist/tests/components/ReferenceCreationWorkspace.js';
import ReferenceCreationOriginal from '../dist/tests/components/ReferenceCreationOriginal.js';
const props = () => ({
  identity: { instanceId: id(9), actorId: id(10), tenantId: id(1) },
  catalogue: catalogue(),
});
test('creation initial markup locks allocation until storage restoration and does not allocate target IDs', () => {
  const html = renderAfterVerifiedLease(React.createElement(ReferenceCreationWorkspace, props()));
  assert.match(html, /Reference creation workspace/);
  assert.match(html, /Checking for an original creation/);
  assert.match(html, /<fieldset disabled="">/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Create once/);
  assert.equal(html.includes('Retained target:'), false);
  assert.equal(html.includes('Finish and open current draft'), false);
  assert.equal(html.includes('Replay identical original'), false);
});
test('creation provides explicit unknown reference choices, canonical property types and exact cost inputs', () => {
  const html = renderAfterVerifiedLease(React.createElement(ReferenceCreationWorkspace, props()));
  assert.match(html, /Unknown type/);
  assert.match(html, /Unknown purpose/);
  assert.match(html, /Base price \(KES; blank is unknown\)/);
  assert.match(html, /refundable/i);
  assert.match(html, /Additional fees and refundable deposits/);
  assert.match(html, /value="bedsitter"/);
  assert.equal(html.includes('value="house"'), false);
  assert.match(html, /Unknown<\/option>/);
  assert.match(html, /Create with these explicit facts/);
  assert.match(html, /aria-live="polite"/);
});
test('reference labels are escaped and unknown property type cannot preselect an amenity', () => {
  const p = props();
  p.catalogue.amenities[0].label = '<script>synthetic</script>';
  const html = renderAfterVerifiedLease(React.createElement(ReferenceCreationWorkspace, p));
  assert.equal(html.includes('<script>synthetic</script>'), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<input type="checkbox" disabled=""/);
  assert.equal(html.includes(' checked=""'), false);
});
test('retained original review displays full historical private facts and exact costs without treating its versions as current', () => {
  const c = structuredClone(command());
  c.content.pricing = {
    declaration: 'incomplete',
    charges: [
      {
        id: 'deposit',
        name: 'Synthetic deposit',
        amountStatus: 'known',
        amountMinor: 12345,
        timing: 'one_off',
        classification: 'refundable_deposit',
        mandatory: true,
      },
      {
        id: 'quote',
        name: 'Synthetic quote',
        amountStatus: 'quote_required',
        amountMinor: null,
        timing: 'per_rental_period',
        classification: 'fee',
        mandatory: false,
      },
    ],
  };
  const html = renderToStaticMarkup(
    React.createElement(ReferenceCreationOriginal, { command: c, catalogue: catalogue() }),
  );
  assert.match(html, /PRIVATE-SYNTHETIC-CREATION/);
  assert.match(html, /20,000\.01/);
  assert.match(html, /123\.45/);
  assert.match(html, /Quote required/);
  assert.match(html, /refundable deposit/);
  assert.match(html, /Synthetic original lift/);
  assert.match(html, /historical facts/);
  assert.match(html, /fresh read/);
  assert.throws(() =>
    renderToStaticMarkup(
      React.createElement(ReferenceCreationOriginal, {
        command: { ...c, selection: { ...c.selection, catalogueVersion: '2' } },
        catalogue: catalogue(),
      }),
    ),
  );
});
