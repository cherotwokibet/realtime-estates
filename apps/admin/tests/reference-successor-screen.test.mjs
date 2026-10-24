import test from 'node:test';
import assert from 'node:assert/strict';
import {
  id,
  catalogue,
  command,
  receipt,
} from '../../../packages/api-client/tests/fixtures/reference-successor.mjs';
import { staffListingFixture } from '../../../packages/domain/test-helpers/staff-listing-fixtures.mjs';
import { openReferenceSuccessorEntry } from '../dist/tests/lib/reference-successor-entry.js';
import { referenceSuccessorSession } from '../dist/tests/lib/reference-successor-workspace.js';
import { readReferenceSuccessorScreen } from '../dist/tests/lib/reference-successor-screen.js';

const scope = { instanceId: id(9), tenantId: id(1), actorId: id(10), listingId: id(100) };
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
const identity = {
  policy: 'synthetic-reference-session-v1',
  tenantId: scope.tenantId,
  actorId: scope.actorId,
};
const listing = () => staffListingFixture(100);
const terminal = () => ({
  ...listing(),
  version: '1',
  publicationStatus: 'unpublished',
  publishedRevision: null,
  latest: { ...listing().latest, revision: 1, version: '4', state: 'rejected' },
});
function memory() {
  const map = new Map();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}
function client() {
  const calls = [];
  return {
    calls,
    create: async (c) => {
      calls.push('POST');
      return receipt(c, catalogue(), scope.actorId);
    },
    recover: async (c) => {
      calls.push('GET');
      return receipt(c, catalogue(), scope.actorId);
    },
  };
}
function upstream(calls) {
  return async (url, init) => {
    calls.push({ url, init });
    return Response.json(
      url.endsWith('/reference-session')
        ? identity
        : url.endsWith('/listings/' + scope.listingId)
          ? listing()
          : catalogue(),
    );
  };
}
test('committed successor/current draft restores historical original locally before fresh eligibility without UUID or requests', async () => {
  const store = memory(),
    c = client();
  referenceSuccessorSession(store, scope).retain(command(), catalogue());
  const opened = await openReferenceSuccessorEntry(store, scope, listing(), c);
  assert.equal(opened.eligible, false);
  assert.equal(opened.restored.status, 'uncertain');
  assert.deepEqual(opened.restored.original, command());
  assert.deepEqual(c.calls, []);
  let ids = 0;
  assert.throws(() =>
    opened.prepare(command(), catalogue(), () => {
      ids++;
      return id(2000);
    }),
  );
  assert.equal(ids, 0);
  opened.restored.verifyReload();
  await opened.restored.recoverOriginal();
  const target = opened.restored.freshDraftTarget;
  opened.restored.discard();
  assert.deepEqual(target, { listingId: scope.listingId, revision: 2 });
  assert.equal(opened.restored.freshDraftTarget, null);
  assert.equal(store.map.size, 0);
  assert.deepEqual(c.calls, ['GET']);
});
test('fresh terminal preparation allocates one operation only and requires review before any network call', async () => {
  const store = memory(),
    c = client();
  const opened = await openReferenceSuccessorEntry(store, scope, terminal(), c);
  let ids = 0;
  const attempt = opened.prepare(command(), catalogue(), () => {
    ids++;
    return id(1000);
  });
  assert.equal(opened.eligible, true);
  assert.equal(ids, 1);
  assert.equal(attempt.original.listingId, scope.listingId);
  assert.deepEqual(attempt.original, command());
  assert.deepEqual(c.calls, []);
  assert.equal(store.map.size, 0);
  await attempt.submit();
  assert.deepEqual(c.calls, ['POST']);
});
test('fresh draft, pending or absent latest never generates a new operation', async () => {
  for (const current of [
    listing(),
    { ...listing(), latest: { ...listing().latest, state: 'pending' } },
    { ...listing(), publicationStatus: 'unpublished', publishedRevision: null, latest: null },
  ]) {
    const c = client(),
      opened = await openReferenceSuccessorEntry(memory(), scope, current, c);
    assert.equal(opened.eligible, false);
    assert.equal(opened.restored, null);
    assert.throws(() =>
      opened.prepare(command(), catalogue(), () => {
        throw Error('UUID must not run');
      }),
    );
    assert.deepEqual(c.calls, []);
  }
});
test('corrupt/misbound retained original blocks fresh allocation without changing storage or rescoping', async () => {
  for (const change of [
    (row) => ({ ...row, actorId: id(11) }),
    (row) => ({ ...row, listingId: id(101) }),
    (row) => ({ ...row, command: { ...row.command, expectedListingVersion: '0' } }),
  ]) {
    const store = memory();
    referenceSuccessorSession(store, scope).retain(command(), catalogue());
    const [key, raw] = [...store.map][0];
    store.map.set(key, JSON.stringify(change(JSON.parse(raw))));
    const before = [...store.map];
    await assert.rejects(() => openReferenceSuccessorEntry(store, scope, terminal(), client()));
    assert.deepEqual([...store.map], before);
  }
});
test('concurrent retained original blocks preparation before UUID allocation', async () => {
  const store = memory(),
    opened = await openReferenceSuccessorEntry(store, scope, terminal(), client());
  referenceSuccessorSession(store, scope).retain(command(), catalogue());
  let ids = 0;
  assert.throws(() =>
    opened.prepare(command(), catalogue(), () => {
      ids++;
      return id(2000);
    }),
  );
  assert.equal(ids, 0);
});
test('server loader returns recovery shell for draft latest, fixed identity and catalogue, never bearer', async () => {
  const calls = [],
    p = await readReferenceSuccessorScreen(scope.listingId, env, upstream(calls));
  assert.deepEqual(p.scope, scope);
  assert.equal(p.listing.latest.state, 'draft');
  assert.deepEqual(p.catalogue, catalogue());
  assert.equal(JSON.stringify(p).includes(env.STAFF_PREVIEW_TOKEN), false);
  assert.equal(calls.length, 3);
  for (const { init } of calls) {
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.equal(
      new Headers(init.headers).get('authorization'),
      'Bearer ' + env.STAFF_PREVIEW_TOKEN,
    );
  }
});
test('screen exact flags/default closed/production guard before any upstream dispatch', async () => {
  for (const patch of [
    { NODE_ENV: 'production' },
    ...[
      'STAFF_PREVIEW_REFERENCE',
      'STAFF_PREVIEW_REFERENCE_MODERATION',
      'STAFF_PREVIEW_REFERENCE_SUCCESSOR',
    ].flatMap((k) => [{ [k]: undefined }, { [k]: 'true' }]),
  ]) {
    const calls = [];
    await assert.rejects(() =>
      readReferenceSuccessorScreen(scope.listingId, { ...env, ...patch }, upstream(calls)),
    );
    assert.equal(calls.length, 0);
  }
});
