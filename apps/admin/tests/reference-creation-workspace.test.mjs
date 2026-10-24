import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClientError } from '@realtor/api-client';
import {
  id,
  catalogue,
  command,
  receipt,
} from '../../../packages/api-client/tests/fixtures/reference-creation.mjs';
import {
  buildReferenceCreationCommand,
  referenceCreationSession,
  prepareReferenceCreationAttempt,
  restoreReferenceCreationAttempt,
} from '../dist/tests/lib/reference-creation-workspace.js';
const scope = { instanceId: id(9), tenantId: id(1), actorId: id(10), listingId: id(100) };
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
    async catalogue(version) {
      calls.push(['catalogue', version]);
      assert.equal(version, '1');
      return catalogue();
    },
    async create(c, cat, actor) {
      calls.push(['POST', c]);
      assert.equal(actor, scope.actorId);
      return receipt(c, cat, actor);
    },
    async recover(c, cat, actor) {
      calls.push(['GET', c]);
      assert.equal(actor, scope.actorId);
      return receipt(c, cat, actor);
    },
  };
}
test('creation picker explicitly derives selected labels and preserves slug, private facts and exact pricing', () => {
  const { policy, ...input } = structuredClone(command());
  input.content.location.county = 'Legacy text';
  input.content.locality = 'Legacy text';
  const built = buildReferenceCreationCommand(input, catalogue());
  assert.deepEqual(built, command());
  assert.equal(built.slug, input.slug);
  assert.throws(() => buildReferenceCreationCommand({ ...input, revision: 1 }, catalogue()));
  let reads = 0;
  const hostile = { ...input };
  Object.defineProperty(hostile, 'content', {
    enumerable: true,
    get() {
      reads++;
      return input.content;
    },
  });
  assert.throws(() => buildReferenceCreationCommand(hostile, catalogue()));
  assert.equal(reads, 0);
});
test('storage is scoped by instance/company/actor/listing and never replaces a different retained creation', () => {
  const store = memory(),
    session = referenceCreationSession(store, scope);
  session.retain(command(), catalogue());
  for (const patch of [
    { instanceId: id(8) },
    { tenantId: id(2) },
    { actorId: id(11) },
    { listingId: id(101) },
  ])
    assert.equal(referenceCreationSession(store, { ...scope, ...patch }).load(), null);
  assert.throws(() => session.retain({ ...command(), slug: 'other' }, catalogue()));
  assert.throws(() => prepareReferenceCreationAttempt(client(), session, command(), catalogue()));
  assert.deepEqual(session.load().candidate, command());
  session.clear(command());
  assert.equal(session.load(), null);
});
test('synchronous retention and readback failures prevent every write', async () => {
  for (const store of [
    {
      getItem: () => null,
      setItem() {
        throw Error('quota');
      },
      removeItem() {},
    },
    { getItem: () => null, setItem() {}, removeItem() {} },
  ]) {
    const c = client(),
      a = prepareReferenceCreationAttempt(
        c,
        referenceCreationSession(store, scope),
        command(),
        catalogue(),
      );
    await assert.rejects(() => a.submit());
    assert.equal(c.calls.length, 0);
    assert.equal(a.status, 'ready');
  }
});
test('single flight dispatch retains detached command and catalogue before I/O; receipt needs explicit clearing', async () => {
  const store = memory(),
    session = referenceCreationSession(store, scope),
    c = client(),
    input = structuredClone(command()),
    cat = catalogue();
  let finish;
  c.create = async (original, originalCat, actor) => {
    c.calls.push(['POST', original]);
    assert.deepEqual(session.load().candidate, original);
    return new Promise((resolve) => {
      finish = () => resolve(receipt(original, originalCat, actor));
    });
  };
  const a = prepareReferenceCreationAttempt(c, session, input, cat),
    pending = a.submit();
  input.slug = 'changed';
  input.content.title = 'changed';
  cat.amenities[0].label = 'changed';
  assert.equal(a.status, 'sending');
  assert.equal(a.canDiscard, false);
  assert.throws(() => a.discard());
  await assert.rejects(() => a.submit());
  await assert.rejects(() => a.recoverOriginal());
  finish();
  assert.deepEqual(await pending, receipt());
  assert.equal(a.status, 'received');
  assert.ok(session.load());
  a.discard();
  assert.equal(session.load(), null);
  await assert.rejects(() => a.submit());
});
test('lost creation remains uncertain through denied recovery and reload fetches only historical catalogue', async () => {
  const store = memory(),
    session = referenceCreationSession(store, scope),
    c = client();
  c.create = async () => {
    c.calls.push(['POST']);
    throw new ApiClientError('NETWORK', 'lost', { submissionUncertain: true });
  };
  c.recover = async () => {
    c.calls.push(['GET']);
    throw new ApiClientError('HTTP', 'denied', { status: 403 });
  };
  const a = prepareReferenceCreationAttempt(c, session, command(), catalogue());
  await assert.rejects(() => a.submit());
  assert.equal(a.status, 'uncertain');
  assert.throws(() => a.discard());
  await assert.rejects(() => a.recoverOriginal());
  assert.equal(a.status, 'uncertain');
  assert.equal(a.canDiscard, false);
  const restoredClient = client(),
    restored = await restoreReferenceCreationAttempt(restoredClient, session);
  assert.deepEqual(restoredClient.calls, [['catalogue', '1']]);
  assert.equal(restored.status, 'uncertain');
  await assert.rejects(() => restored.submit());
  assert.deepEqual(await restored.recoverOriginal(), receipt());
  assert.deepEqual(
    restoredClient.calls.map((c) => c[0]),
    ['catalogue', 'GET'],
  );
  restored.discard();
  assert.equal(session.load(), null);
  assert.equal(c.calls.filter((x) => x[0] === 'POST').length, 1);
});
test('replay is explicit and bound to exact original; malformed recovery cannot settle uncertainty', async () => {
  const session = referenceCreationSession(memory(), scope),
    c = client();
  let writes = 0;
  c.create = async (original, cat, actor) => {
    assert.deepEqual(original, command());
    if (++writes === 1) throw Error('unknown interruption');
    return receipt(original, cat, actor);
  };
  c.recover = async () => ({
    ...receipt(),
    creation: { ...receipt().creation, request: { ...receipt().creation.request, slug: 'wrong' } },
  });
  const a = prepareReferenceCreationAttempt(c, session, command(), catalogue());
  await assert.rejects(() => a.submit());
  await assert.rejects(() => a.recoverOriginal());
  assert.equal(a.status, 'uncertain');
  assert.equal(a.receipt, null);
  assert.ok(session.load());
  assert.deepEqual(await a.replayOriginal(), receipt());
  assert.equal(writes, 2);
});
test('known refusal can be cleared; late cancellation and malformed successful writes preserve uncertainty', async () => {
  const c = client(),
    session = referenceCreationSession(memory(), scope);
  c.create = async () => {
    throw new ApiClientError('HTTP', 'conflict', { status: 409 });
  };
  const a = prepareReferenceCreationAttempt(c, session, command(), catalogue());
  await assert.rejects(() => a.submit());
  assert.equal(a.status, 'rejected');
  a.discard();
  assert.equal(session.load(), null);
  for (const mode of ['actor', 'version', 'cancel']) {
    const c = client(),
      controller = new AbortController();
    c.create = async () => {
      const r = receipt();
      if (mode === 'actor') r.creation.actorId = id(11);
      if (mode === 'version') r.referenceDraft.revisionVersion = '4';
      if (mode === 'cancel') controller.abort();
      return r;
    };
    const session = referenceCreationSession(memory(), scope),
      a = prepareReferenceCreationAttempt(c, session, command(), catalogue());
    await assert.rejects(() => a.submit(controller.signal));
    assert.equal(a.status, 'uncertain');
    assert.ok(session.load());
    assert.throws(() => a.discard());
  }
});
test('corrupt stored envelope fails before catalogue transport and remains available for explicit resolution', async () => {
  for (const change of [
    (raw) => raw.replace('"actorId":"' + id(10) + '"', '"actorId":"' + id(11) + '"'),
    (raw) => raw.replace('"slug":', '"slug":"wrong","slug":'),
    (raw) => raw.replace('"catalogueVersion":"1"', '"catalogueVersion":1'),
    (raw) =>
      raw.replace(
        '"policy":"synthetic-reference-creation-v1"',
        '"policy":"synthetic-reference-draft-v1"',
      ),
    () => '{invalid',
    () => ' '.repeat(163841),
  ]) {
    const store = memory(),
      session = referenceCreationSession(store, scope);
    session.retain(command(), catalogue());
    const key = [...store.map.keys()][0];
    store.map.set(key, change(store.map.get(key)));
    const c = client();
    await assert.rejects(() => restoreReferenceCreationAttempt(c, session));
    assert.equal(c.calls.length, 0);
    assert.ok(store.map.has(key));
  }
});
test('pre-abort performs no storage or transport, and modified retained command blocks later recovery', async () => {
  const store = memory(),
    session = referenceCreationSession(store, scope),
    c = client(),
    abort = new AbortController();
  abort.abort();
  const a = prepareReferenceCreationAttempt(c, session, command(), catalogue());
  await assert.rejects(() => a.submit(abort.signal));
  assert.equal(store.map.size, 0);
  assert.equal(c.calls.length, 0);
  session.retain(command(), catalogue());
  const restored = await restoreReferenceCreationAttempt(c, session);
  const key = [...store.map.keys()][0];
  store.map.set(key, store.map.get(key).replace('synthetic-reference-100', 'changed-slug'));
  await assert.rejects(() => restored.recoverOriginal());
  assert.equal(restored.status, 'uncertain');
  assert.equal(c.calls.filter((x) => x[0] === 'GET').length, 0);
});
