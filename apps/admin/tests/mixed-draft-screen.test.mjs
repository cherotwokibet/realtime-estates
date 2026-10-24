import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readMixedDraftScreen,
  readReferenceEntryScreen,
} from '../dist/tests/lib/mixed-draft-screen.js';
import { id, catalogue, review } from '../test-helpers/reference-moderation-fixture.mjs';
const env = () => ({
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_PREVIEW_REFERENCE: 'synthetic-reference-draft-v1',
  STAFF_PREVIEW_REFERENCE_MODERATION: 'synthetic-reference-transition-v1',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4001',
  STAFF_PREVIEW_TOKEN: 'synthetic.server.secret',
  STAFF_PREVIEW_INSTANCE: id(9),
});
function fixture({
  protocol = 'synthetic-reference-v1',
  state = 'draft',
  active = '1',
  rotate = false,
  change = false,
  denied = false,
  mutate,
} = {}) {
  const calls = [];
  let sessions = 0,
    reads = 0;
  const transport = async (url, init) => {
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
      reads++;
      return Response.json({
        listingId: id(100),
        revision: 1,
        listingVersion: change && reads > 1 ? '3' : '2',
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
    if (String(url).endsWith('/reference-catalogues/current'))
      return Response.json({ ...catalogue(), version: active });
    if (String(url).endsWith('/workspace'))
      return Response.json({
        listingId: id(100),
        draft: { revision: 1, state: 'draft', version: '3', content: review().content },
        photos: [],
      });
    throw Error('Unexpected request ' + url);
  };
  return { calls, transport };
}
test('mixed draft reader chooses persisted protocol; ordinary rows do not infer reference IDs or read private context', async () => {
  const f = fixture({ protocol: 'ordinary-v2' }),
    result = await readMixedDraftScreen(id(100), '1', env(), f.transport);
  assert.equal(result.kind, 'ordinary');
  assert.equal(result.instanceId, id(9));
  assert.equal(f.calls.length, 2);
  assert.equal(result.context.protocol.protocol, 'ordinary-v2');
  assert.ok(Object.isFrozen(result));
});

test('explicit adoption uses a fresh matching ordinary target and refuses rotated authority', async () => {
  const f = fixture({ protocol: 'ordinary-v2' }),
    screen = await readReferenceEntryScreen(id(100), '1', env(), f.transport);
  assert.equal(screen.expectedVersion, '3');
  assert.equal(screen.scope.actorId, id(10));
  assert.equal(screen.initialSelection, undefined);
  const changed = fixture({ protocol: 'ordinary-v2', rotate: true });
  await assert.rejects(readReferenceEntryScreen(id(100), '1', env(), changed.transport));
});
test('adopted draft handoff preserves saved IDs and original catalogue with current scope/version recheck', async () => {
  const f = fixture(),
    result = await readMixedDraftScreen(id(100), '1', env(), f.transport);
  assert.equal(result.kind, 'reference');
  assert.equal(f.calls.length, 6);
  assert.equal(result.screen.expectedVersion, '3');
  assert.deepEqual(result.screen.scope, {
    instanceId: id(9),
    tenantId: id(1),
    actorId: id(10),
    listingId: id(100),
  });
  assert.deepEqual(result.screen.initialSelection, {
    catalogueVersion: '1',
    location: { countyId: id(200), localityId: null, neighbourhoodId: null },
    amenityIds: [],
  });
  assert.equal(result.screen.editingDisabled, false);
  assert.ok(!JSON.stringify(result).includes('secret'));
});
test('terminal reference or changed catalogue keeps a recovery shell but prohibits fresh edits', async () => {
  for (const config of [{ state: 'approved' }, { active: '2' }]) {
    const f = fixture(config),
      result = await readMixedDraftScreen(id(100), '1', env(), f.transport);
    assert.equal(result.kind, 'reference');
    assert.equal(result.screen.editingDisabled, true);
    assert.equal(result.screen.catalogue.version, '1');
    assert.equal(result.screen.initialSelection.location.countyId, id(200));
  }
  const f = fixture({ protocol: 'ordinary-v2', state: 'approved' });
  await assert.rejects(readMixedDraftScreen(id(100), '1', env(), f.transport));
});
test('scope, currency, denied context or missing reader capability never produce ordinary fallback', async () => {
  for (const config of [{ rotate: true }, { change: true }, { denied: true }]) {
    const f = fixture(config);
    await assert.rejects(readMixedDraftScreen(id(100), '1', env(), f.transport));
  }
  const f = fixture();
  await assert.rejects(
    readMixedDraftScreen(
      id(100),
      '1',
      { ...env(), STAFF_PREVIEW_REFERENCE_MODERATION: undefined },
      f.transport,
    ),
  );
  assert.equal(f.calls.length, 2);
  let calls = 0;
  await assert.rejects(
    readReferenceEntryScreen(
      id(100),
      '1',
      { ...env(), STAFF_PREVIEW_REFERENCE_MODERATION: undefined },
      async () => {
        calls++;
        throw Error();
      },
    ),
  );
  assert.equal(calls, 0);
});
test('captured server configuration cannot rotate between discovery and final context checks', async () => {
  const config = env(),
    f = fixture({
      mutate: () => {
        config.STAFF_PREVIEW_TOKEN = 'other.server.secret';
        config.STAFF_PREVIEW_API_ORIGIN = 'http://127.0.0.1:4002';
      },
    });
  await readMixedDraftScreen(id(100), '1', config, f.transport);
  for (const call of f.calls) {
    assert.ok(call.url.startsWith('http://127.0.0.1:4001/'));
    assert.equal(
      new Headers(call.init.headers).get('authorization'),
      'Bearer synthetic.server.secret',
    );
    assert.equal(call.init.method, 'GET');
  }
});
