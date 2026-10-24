import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  id,
  catalogue,
  command,
} from '../../../packages/api-client/tests/fixtures/reference-successor.mjs';
import { staffListingFixture } from '../../../packages/domain/test-helpers/staff-listing-fixtures.mjs';
import ReferenceSuccessorWorkspace from '../dist/tests/components/ReferenceSuccessorWorkspace.js';
import ReferenceSuccessorOriginal from '../dist/tests/components/ReferenceSuccessorOriginal.js';
import { registerHooks } from 'node:module';
// A Node markup harness has no RSC bundler. Stub only the server-only poison marker;
// real server loaders/SDKs and real client component modules still execute.
registerHooks({
  resolve(specifier, context, next) {
    return specifier === 'server-only'
      ? { url: 'data:text/javascript,export {}', shortCircuit: true }
      : next(specifier, context);
  },
});
const { default: Page } = await import('../dist/tests/app/listings/[id]/successor/page.js');
const props = () => ({
  scope: { instanceId: id(9), actorId: id(10), tenantId: id(1), listingId: id(100) },
  listing: staffListingFixture(100),
  catalogue: catalogue(),
});

test('actual page uses retained ordinary default and exact reference mode renders a current-draft recovery shell', async () => {
  const saved = { ...process.env },
    oldFetch = globalThis.fetch,
    scope = props().scope;
  const env = {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
    STAFF_PREVIEW_TOKEN: 'synthetic.server.token',
    STAFF_PREVIEW_INSTANCE: scope.instanceId,
    STAFF_PREVIEW_REFERENCE: 'synthetic-reference-draft-v1',
    STAFF_PREVIEW_REFERENCE_MODERATION: 'synthetic-reference-transition-v1',
    STAFF_PREVIEW_REFERENCE_SUCCESSOR: 'synthetic-reference-successor-v1',
  };
  const main = (p) =>
    p.props.children.find((x) => x?.props?.id === 'successor-main').props.children;
  try {
    Object.assign(process.env, env);
    let calls = 0;
    globalThis.fetch = async (url) => {
      calls++;
      return Response.json(
        url.endsWith('/reference-session')
          ? {
              policy: 'synthetic-reference-session-v1',
              tenantId: scope.tenantId,
              actorId: scope.actorId,
            }
          : url.endsWith('/listings/' + scope.listingId)
            ? props().listing
            : catalogue(),
      );
    };
    let child = main(await Page({ params: Promise.resolve({ id: scope.listingId }) }));
    assert.equal(child.type, ReferenceSuccessorWorkspace);
    assert.equal(child.props.listing.latest.state, 'draft');
    assert.equal(calls, 3);
    process.env.STAFF_PREVIEW_REFERENCE_SUCCESSOR = 'true';
    calls = 0;
    child = main(await Page({ params: Promise.resolve({ id: scope.listingId }) }));
    assert.equal(child.type, 'p');
    assert.equal(calls, 0);
    delete process.env.STAFF_PREVIEW_REFERENCE_SUCCESSOR;
    globalThis.fetch = async (url) =>
      Response.json(
        url.endsWith('/session')
          ? { policy: 'current-staff-session-v2', tenantId: scope.tenantId, actorId: scope.actorId }
          : {
              ...props().listing,
              latest: { ...props().listing.latest, state: 'approved' },
            },
      );
    child = main(await Page({ params: Promise.resolve({ id: scope.listingId }) }));
    assert.equal(child.type.name, 'AllocationWorkspace');
    assert.equal(child.props.kind, 'revision');
  } finally {
    globalThis.fetch = oldFetch;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
test('successor initial markup locks allocation until storage restoration and does not allocate target IDs', () => {
  const html = renderToStaticMarkup(React.createElement(ReferenceSuccessorWorkspace, props()));
  assert.match(html, /Reference successor workspace/);
  assert.match(html, /Checking for an original successor/);
  assert.match(html, /<fieldset disabled="">/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Review successor/);
  assert.equal(html.includes('Retained target:'), false);
  assert.equal(html.includes('Finish and open current draft'), false);
  assert.equal(html.includes('Replay identical original'), false);
});
test('successor provides explicit unknown reference choices, canonical property types and exact cost inputs', () => {
  const html = renderToStaticMarkup(React.createElement(ReferenceSuccessorWorkspace, props()));
  assert.match(html, /Unknown type/);
  assert.match(html, /Unknown purpose/);
  assert.match(html, /Base price \(KES; blank is unknown\)/);
  assert.match(html, /refundable/i);
  assert.match(html, /Additional fees and refundable deposits/);
  assert.match(html, /value="bedsitter"/);
  assert.equal(html.includes('value="house"'), false);
  assert.match(html, /Unknown<\/option>/);
  assert.match(html, /Review these explicit successor facts/);
  assert.match(html, /aria-live="polite"/);
});
test('reference labels are escaped and unknown property type cannot preselect an amenity', () => {
  const p = props();
  p.catalogue.amenities[0].label = '<script>synthetic</script>';
  const html = renderToStaticMarkup(React.createElement(ReferenceSuccessorWorkspace, p));
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
    React.createElement(ReferenceSuccessorOriginal, { command: c, catalogue: catalogue() }),
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
      React.createElement(ReferenceSuccessorOriginal, {
        command: { ...c, selection: { ...c.selection, catalogueVersion: '2' } },
        catalogue: catalogue(),
      }),
    ),
  );
});
