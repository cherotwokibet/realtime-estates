import { renderAfterVerifiedLease } from './verified-workspace-render.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import Workspace from '../dist/tests/components/ReferenceReviewWorkspace.js';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, next) {
    return specifier === 'server-only'
      ? { url: 'data:text/javascript,export {}', shortCircuit: true }
      : next(specifier, context);
  },
});
const { default: Page } =
  await import('../dist/tests/app/drafts/[id]/[revision]/submission/page.js');
import { scope, review, catalogue, id } from '../test-helpers/reference-moderation-fixture.mjs';
const props = (state) => ({
  purpose: 'author',
  scope: scope(),
  context: {
    policy: 'synthetic-reference-context-v1',
    review: { ...review(), state },
    catalogue: catalogue(),
  },
});
test('author markup discloses saved private exact snapshot and separately gated submit/withdraw, never reviewer decisions', () => {
  for (const state of ['draft', 'pending']) {
    const h = renderAfterVerifiedLease(React.createElement(Workspace, props(state)));
    assert.ok(h.includes('Submit or withdraw saved listing'));
    assert.ok(h.includes('<fieldset disabled="">'));
    assert.ok(
      h.includes(
        state === 'draft' ? 'Submit saved revision for review' : 'Withdraw saved revision',
      ),
    );
    assert.ok(
      !h.includes(
        state === 'draft' ? 'Withdraw saved revision' : 'Submit saved revision for review',
      ),
    );
    assert.ok(!h.includes('Approve saved review'));
    assert.ok(!h.includes('Reject with reason'));
    assert.ok(!h.includes('Rejection reason'));
    assert.ok(!h.includes('Verified review photos'));
    assert.ok(h.includes('does not publish'));
    assert.ok(h.includes('PRIVATE BFF REVIEW'));
  }
});
test('terminal author recovery shell has no fabricated fresh action and does not show private context', () => {
  const h = renderAfterVerifiedLease(
    React.createElement(Workspace, { purpose: 'author', scope: scope(), context: null }),
  );
  assert.ok(h.includes('Checking this tab for an original'));
  assert.ok(!h.includes('Submit saved revision for review'));
  assert.ok(!h.includes('Withdraw saved revision'));
  assert.ok(!h.includes('PRIVATE BFF REVIEW'));
});
test('default-off submission page stays unavailable without synthetic server scope', async () => {
  const p = await Page({ params: Promise.resolve({ id: id(100), revision: '1' }) });
  const h = render(p);
  assert.ok(h.includes('Reference submission unavailable'));
  assert.ok(!h.includes('PRIVATE BFF REVIEW'));
  assert.ok(!h.includes('Submit saved revision for review'));
});
