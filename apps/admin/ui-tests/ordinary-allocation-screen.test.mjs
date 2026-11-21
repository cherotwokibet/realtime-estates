import { renderAfterVerifiedLease } from './verified-workspace-render.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { registerHooks } from 'node:module';
import {
  id,
  command as reference,
} from '../../../packages/api-client/tests/fixtures/reference-creation.mjs';
import { staffListingFixture } from '../../../packages/domain/test-helpers/staff-listing-fixtures.mjs';
import Workspace from '../dist/tests/components/AllocationWorkspace.js';
import Original from '../dist/tests/components/AllocationOriginal.js';
registerHooks({
  resolve(specifier, context, next) {
    return specifier === 'server-only'
      ? { url: 'data:text/javascript,export {}', shortCircuit: true }
      : next(specifier, context);
  },
});
const { default: CreationPage } = await import('../dist/tests/app/listings/new/page.js');
const { default: SuccessorPage } =
  await import('../dist/tests/app/listings/[id]/successor/page.js');
const scope = { instanceId: id(9), tenantId: id(1), actorId: id(10) };
const main = (page, key) => page.props.children.find((x) => x?.props?.id === key).props.children;
const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
  STAFF_PREVIEW_TOKEN: 'synthetic.server.secret',
  STAFF_PREVIEW_INSTANCE: scope.instanceId,
};
async function fixture(work) {
  const prior = { ...process.env },
    old = globalThis.fetch;
  for (const k of [
    'STAFF_PREVIEW_REFERENCE',
    'STAFF_PREVIEW_REFERENCE_CREATION',
    'STAFF_PREVIEW_REFERENCE_SUCCESSOR',
    'STAFF_PREVIEW_REFERENCE_MODERATION',
  ])
    delete process.env[k];
  Object.assign(process.env, env);
  try {
    await work();
  } finally {
    globalThis.fetch = old;
    for (const k of Object.keys(process.env)) if (!(k in prior)) delete process.env[k];
    Object.assign(process.env, prior);
  }
}
test('ordinary creation and current-draft successor markup lock new IDs/requests until local storage restoration', () => {
  for (const props of [
    { kind: 'creation', scope },
    { kind: 'revision', scope, listing: staffListingFixture(100) },
  ]) {
    const html = renderAfterVerifiedLease(React.createElement(Workspace, props));
    assert.match(html, /Checking for a retained original/);
    assert.match(html, /<fieldset disabled="">/);
    assert.match(html, /Closing the tab can remove it/);
    assert.ok(!html.includes('Send exact original'));
    assert.ok(!html.includes('Recover exact original with GET'));
    assert.ok(!html.includes('Open current draft for a fresh read'));
    assert.ok(!html.includes('synthetic.server.secret'));
  }
});
test('retained ordinary facts include escaped private content, exact cost/charge facts and historical version semantics', () => {
  const { policy, selection, ...c } = structuredClone(reference());
  c.content.privateAddress = '<script>PRIVATE ORIGINAL</script>';
  c.content.pricing = {
    declaration: 'complete',
    charges: [
      {
        id: 'deposit',
        name: 'Synthetic refundable deposit',
        amountStatus: 'known',
        amountMinor: 12345,
        timing: 'one_off',
        classification: 'refundable_deposit',
        mandatory: true,
      },
    ],
  };
  const html = renderToStaticMarkup(React.createElement(Original, { command: c }));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;PRIVATE ORIGINAL/);
  assert.match(html, /20,000\.01/);
  assert.match(html, /123\.45/);
  assert.match(html, /refundable_deposit/);
  assert.match(html, /Mandatory/);
  assert.match(html, /current editable versions require a fresh read/);
});
test('ordinary pages use verified current scope, and successor current draft still mounts the recovery workspace', () =>
  fixture(async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(url);
      return Response.json(
        url.endsWith('/session')
          ? { policy: 'current-staff-session-v2', tenantId: scope.tenantId, actorId: scope.actorId }
          : staffListingFixture(100),
      );
    };
    const create = main(await CreationPage(), 'creation-main');
    assert.equal(create.type, Workspace);
    assert.equal(create.props.kind, 'creation');
    assert.deepEqual(create.props.scope, scope);
    assert.equal(calls.length, 1);
    const next = main(
      await SuccessorPage({ params: Promise.resolve({ id: id(100) }) }),
      'successor-main',
    );
    assert.equal(next.type, Workspace);
    assert.equal(next.props.kind, 'revision');
    assert.equal(next.props.listing.latest.state, 'draft');
    assert.deepEqual(next.props.scope, scope);
    assert.equal(calls.length, 3);
    assert.ok(calls.every((url) => !url.includes('/v3/')));
    assert.ok(!renderToStaticMarkup(create).includes('secret'));
  }));
test('unavailable or malformed staff identity never mounts ordinary allocation, with no fallback reference or caller identity', () =>
  fixture(async () => {
    for (const value of [
      { policy: 'current-staff-session-v2', tenantId: scope.tenantId, actorId: 'invalid' },
      {
        policy: 'current-staff-session-v2',
        tenantId: scope.tenantId,
        actorId: scope.actorId,
        token: 'must reject',
      },
    ]) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return Response.json(value);
      };
      assert.equal(main(await CreationPage(), 'creation-main').type, 'p');
      const next = main(
        await SuccessorPage({ params: Promise.resolve({ id: id(100) }) }),
        'successor-main',
      );
      assert.equal(next.type, 'section');
      assert.equal(calls, 2);
    }
  }));
