import test from 'node:test';
import assert from 'node:assert/strict';
import { readReferenceSubmissionScreen as read } from '../dist/tests/lib/reference-submission-screen.js';
import {
  id,
  catalogue,
  review,
  env as template,
} from '../test-helpers/reference-moderation-fixture.mjs';
function fixture({
  state = 'draft',
  protocol = 'synthetic-reference-v1',
  rotate = false,
  change = false,
  denied = false,
  mutate,
} = {}) {
  let sessions = 0,
    protocols = 0;
  const calls = [];
  return {
    calls,
    transport: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/reference-session')) {
        sessions++;
        mutate?.();
        return Response.json({
          policy: 'synthetic-reference-session-v1',
          tenantId: id(1),
          actorId: id(rotate && sessions > 1 ? 11 : 10),
        });
      }
      if (String(url).includes('/revision-protocol/')) {
        protocols++;
        return Response.json({
          listingId: id(100),
          revision: 1,
          listingVersion: change && protocols > 1 ? '3' : '2',
          revisionVersion: '3',
          state,
          editable: state === 'draft',
          protocol,
        });
      }
      if (String(url).endsWith('/context'))
        return denied
          ? Response.json({ error: { code: 'FORBIDDEN', message: 'unavailable' } }, { status: 403 })
          : Response.json({
              policy: 'synthetic-reference-context-v1',
              review: { ...review(), state },
              catalogue: catalogue(),
            });
      throw Error('Unexpected route');
    },
  };
}
test('author loader reads exact draft/pending snapshots and rechecks identity/version before exposing safe props', async () => {
  for (const state of ['draft', 'pending']) {
    const f = fixture({ state }),
      s = await read(id(100), '1', { ...template }, f.transport);
    assert.equal(s.context.review.state, state);
    assert.equal(s.context.catalogue.version, '1');
    assert.equal(f.calls.length, 5);
    assert.ok(f.calls.every((c) => c.init.method === 'GET'));
    assert.ok(!JSON.stringify(s).includes(template.STAFF_PREVIEW_TOKEN));
    assert.ok(Object.isFrozen(s.scope));
  }
});
test('terminal adopted row is a scoped recovery shell with no fresh action context', async () => {
  const f = fixture({ state: 'approved' }),
    s = await read(id(100), '1', { ...template }, f.transport);
  assert.equal(s.context, null);
  assert.equal(s.scope.actorId, id(10));
  assert.equal(f.calls.length, 4);
});
test('ordinary/missing reader/denied/rotated or changed targets fail closed without stale snapshot fallback', async () => {
  for (const options of [
    { protocol: 'ordinary-v2' },
    { denied: true },
    { rotate: true },
    { change: true },
  ]) {
    const f = fixture(options);
    await assert.rejects(read(id(100), '1', { ...template }, f.transport));
  }
  const f = fixture();
  await assert.rejects(
    read(id(100), '1', { ...template, STAFF_PREVIEW_REFERENCE_MODERATION: undefined }, f.transport),
  );
  assert.equal(f.calls.length, 0);
  await assert.rejects(read('../foreign', '1', { ...template }, f.transport));
  assert.equal(f.calls.length, 0);
});
test('one immutable server configuration is used across awaited reads even if the environment rotates', async () => {
  const env = { ...template },
    f = fixture({
      mutate: () => {
        env.STAFF_PREVIEW_TOKEN = 'changed.secret.value';
        env.STAFF_PREVIEW_API_ORIGIN = 'http://127.0.0.1:9999';
        env.STAFF_PREVIEW_INSTANCE = id(999);
      },
    });
  const s = await read(id(100), '1', env, f.transport);
  assert.equal(s.scope.instanceId, id(9));
  assert.ok(f.calls.every((c) => c.url.startsWith(template.STAFF_PREVIEW_API_ORIGIN + '/')));
  assert.ok(
    f.calls.every(
      (c) =>
        new Headers(c.init.headers).get('authorization') ===
        'Bearer ' + template.STAFF_PREVIEW_TOKEN,
    ),
  );
});
