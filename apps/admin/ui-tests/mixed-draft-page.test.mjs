import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { id, catalogue, review } from '../test-helpers/reference-moderation-fixture.mjs';
registerHooks({
  resolve(specifier, context, next) {
    return specifier === 'server-only'
      ? { url: 'data:text/javascript,export {}', shortCircuit: true }
      : next(specifier, context);
  },
});
const { default: Page } = await import('../dist/tests/app/drafts/[id]/[revision]/page.js');
function nodes(element) {
  if (!element || typeof element !== 'object') return [];
  return [element, ...React.Children.toArray(element.props?.children).flatMap(nodes)];
}
async function fixture(
  mode,
  work,
  { protocol = 'synthetic-reference-v1', denied = false, state = 'draft' } = {},
) {
  const before = { ...process.env },
    prior = globalThis.fetch;
  let calls = 0;
  Object.assign(process.env, {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4001',
    STAFF_PREVIEW_TOKEN: 'synthetic.server.secret',
    STAFF_PREVIEW_INSTANCE: id(9),
    STAFF_PREVIEW_REFERENCE_MODERATION: 'synthetic-reference-transition-v1',
  });
  if (mode === undefined) delete process.env.STAFF_PREVIEW_REFERENCE;
  else process.env.STAFF_PREVIEW_REFERENCE = mode;
  globalThis.fetch = async (url) => {
    calls++;
    const path = new URL(url).pathname;
    if (denied)
      return Response.json(
        { error: { code: 'FORBIDDEN', message: 'unavailable' } },
        { status: 403 },
      );
    if (path.endsWith('/reference-session'))
      return Response.json({
        policy: 'synthetic-reference-session-v1',
        tenantId: id(1),
        actorId: id(10),
      });
    if (path.includes('/revision-protocol/'))
      return Response.json({
        listingId: id(100),
        revision: 1,
        listingVersion: '2',
        revisionVersion: '3',
        state,
        editable: state === 'draft',
        protocol,
      });
    if (path.endsWith('/context'))
      return Response.json({
        policy: 'synthetic-reference-context-v1',
        review: { ...review(), state },
        catalogue: catalogue(),
      });
    return Response.json(catalogue());
  };
  try {
    await work(
      await Page({ params: Promise.resolve({ id: id(100), revision: '1' }) }),
      () => calls,
    );
  } finally {
    globalThis.fetch = prior;
    for (const key of Object.keys(process.env))
      if (!Object.hasOwn(before, key)) delete process.env[key];
    Object.assign(process.env, before);
  }
}
test('ordinary default page keeps its existing editor without enabling reference reads', async () => {
  await fixture(undefined, async (page, calls) => {
    assert.equal(calls(), 0);
    assert.ok(nodes(page).some((n) => n.type?.name === 'DraftEditor'));
    assert.ok(!nodes(page).some((n) => n.type?.name === 'ReferenceDraftWorkspace'));
  });
});
test('candidate ordinary row offers explicit adoption while adopted rows mount the saved-ID reference workspace', async () => {
  const mode = 'synthetic-reference-draft-v1';
  await fixture(
    mode,
    async (page) => {
      assert.ok(nodes(page).some((n) => n.type?.name === 'DraftEditor'));
      assert.ok(
        nodes(page).some(
          (n) => n.type === 'a' && n.props.children === 'Edit location and amenities',
        ),
      );
    },
    { protocol: 'ordinary-v2' },
  );
  await fixture(mode, async (page) => {
    const node = nodes(page).find((n) => n.type?.name === 'ReferenceDraftWorkspace');
    assert.ok(node);
    assert.equal(node.props.initialSelection.location.countyId, id(200));
    assert.equal(node.props.editingDisabled, false);
    assert.ok(!nodes(page).some((n) => n.type?.name === 'DraftEditor'));
  });
});
test('terminal adopted row retains a read-only recovery workspace rather than ordinary editing', async () => {
  await fixture(
    'synthetic-reference-draft-v1',
    async (page) => {
      const node = nodes(page).find((n) => n.type?.name === 'ReferenceDraftWorkspace');
      assert.ok(node);
      assert.equal(node.props.editingDisabled, true);
      assert.ok(!nodes(page).some((n) => n.type?.name === 'DraftEditor'));
    },
    { state: 'approved' },
  );
});
test('invalid configuration and denied discovery render unavailable without stale private props or v2 fallback', async () => {
  for (const [mode, options] of [
    ['off', {}],
    ['synthetic-reference-draft-v1', { denied: true }],
  ])
    await fixture(
      mode,
      async (page) => {
        const html = renderToStaticMarkup(page);
        assert.ok(html.includes('Draft unavailable'));
        assert.ok(!html.includes('PRIVATE BFF REVIEW'));
        assert.ok(
          !nodes(page).some((n) =>
            ['DraftEditor', 'ReferenceDraftWorkspace'].includes(n.type?.name),
          ),
        );
      },
      options,
    );
});
