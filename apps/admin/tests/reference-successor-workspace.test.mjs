import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClientError } from '@realtor/api-client';
import {
  id,
  catalogue,
  command,
  receipt,
} from '../../../packages/api-client/tests/fixtures/reference-successor.mjs';
import {
  buildReferenceSuccessorCommand,
  referenceSuccessorSession,
  prepareReferenceSuccessorAttempt,
  restoreReferenceSuccessorAttempt,
  selectedSuccessorCatalogue,
  REFERENCE_SUCCESSOR_STORAGE_MAX_BYTES,
} from '../dist/tests/lib/reference-successor-workspace.js';
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
test('successor picker explicitly derives selected labels and preserves predecessor, private facts and exact pricing', () => {
  const { policy, ...input } = structuredClone(command());
  input.content.location.county = 'Legacy text';
  input.content.locality = 'Legacy text';
  const built = buildReferenceSuccessorCommand(input, catalogue());
  assert.deepEqual(built, command());
  assert.deepEqual(built.predecessor, input.predecessor);
  assert.throws(() => buildReferenceSuccessorCommand({ ...input, revision: 1 }, catalogue()));
  let reads = 0;
  const hostile = { ...input };
  Object.defineProperty(hostile, 'content', {
    enumerable: true,
    get() {
      reads++;
      return input.content;
    },
  });
  assert.throws(() => buildReferenceSuccessorCommand(hostile, catalogue()));
  assert.equal(reads, 0);
});

test('one atomic entry retains only selected historical ancestry and amenities, including a large valid Unicode original', async () => {
  const cat = catalogue('1', true);
  cat.locations.push(
    { id: id(201), kind: 'locality', parentId: id(200), label: 'Synthetic locality' },
    { id: id(202), kind: 'neighbourhood', parentId: id(201), label: 'Synthetic neighbourhood' },
    { id: id(299), kind: 'county', parentId: null, label: 'Unselected county' },
  );
  cat.amenities.push({
    id: id(999),
    code: 'unselected-feature',
    label: 'Unselected feature',
    propertyTypes: ['land'],
  });
  const base = command(100, 1000, catalogue('1', true), true);
  const { policy: _policy, ...input } = structuredClone(base);
  input.selection.location = { countyId: id(200), localityId: id(201), neighbourhoodId: id(202) };
  const built = buildReferenceSuccessorCommand(input, cat),
    selected = selectedSuccessorCatalogue(built, cat);
  assert.deepEqual(
    selected.locations.map((r) => r.id),
    [id(200), id(201), id(202)],
  );
  assert.equal(selected.amenities.length, 50);
  const fresh = prepareReferenceSuccessorAttempt(
    client(),
    referenceSuccessorSession(memory(), scope),
    built,
    cat,
  );
  assert.deepEqual(fresh.catalogue, selected);
  const store = memory(),
    session = referenceSuccessorSession(store, scope);
  session.retain(built, cat);
  assert.equal(store.map.size, 1);
  const raw = [...store.map.values()][0];
  assert.ok(new TextEncoder().encode(raw).byteLength <= REFERENCE_SUCCESSOR_STORAGE_MAX_BYTES);
  assert.ok(!raw.includes('Unselected feature') && !raw.includes('Unselected county'));
  const c = client(),
    restored = await restoreReferenceSuccessorAttempt(c, session);
  assert.equal(c.calls.length, 0);
  assert.deepEqual(restored.catalogue, selected);
  assert.deepEqual(restored.original, built);
  assert.deepEqual(await restored.recoverOriginal(), receipt(built, selected, scope.actorId));
});

test('a second prepared controller cannot dispatch while the same original is already retained', async () => {
  const c = client(),
    session = referenceSuccessorSession(memory(), scope);
  let settle;
  c.create = async (original, cat, actor) => {
    c.calls.push(['POST']);
    return new Promise((resolve) => (settle = () => resolve(receipt(original, cat, actor))));
  };
  const a = prepareReferenceSuccessorAttempt(c, session, command(), catalogue()),
    b = prepareReferenceSuccessorAttempt(c, session, command(), catalogue());
  const pending = a.submit();
  await assert.rejects(() => b.submit());
  assert.equal(c.calls.length, 1);
  settle();
  await pending;
});

test('storage changed while a write is in flight cannot confirm or unlock its original', async () => {
  const c = client(),
    store = memory(),
    session = referenceSuccessorSession(store, scope);
  c.create = async (original, cat, actor) => {
    store.map.set([...store.map.keys()][0], '{changed');
    return receipt(original, cat, actor);
  };
  const a = prepareReferenceSuccessorAttempt(c, session, command(), catalogue());
  await assert.rejects(() => a.submit());
  assert.equal(a.status, 'uncertain');
  assert.equal(a.receipt, null);
  assert.equal(a.canLeave, false);
  assert.throws(() => a.verifyReload());
  assert.throws(() => a.discard());
});

test('only a storage-verified uncertain original can reload; a confirmed handoff exposes identity without stale edit versions', async () => {
  const c = client(),
    store = memory(),
    session = referenceSuccessorSession(store, scope);
  let settle;
  c.create = async () =>
    new Promise(
      (resolve, reject) =>
        (settle = () =>
          reject(new ApiClientError('NETWORK', 'lost', { submissionUncertain: true }))),
    );
  const a = prepareReferenceSuccessorAttempt(c, session, command(), catalogue());
  assert.throws(() => a.verifyReload());
  assert.equal(a.freshDraftTarget, null);
  const pending = a.submit();
  assert.throws(() => a.verifyReload());
  assert.equal(a.canLeave, false);
  settle();
  await assert.rejects(() => pending);
  a.verifyReload();
  const restored = await restoreReferenceSuccessorAttempt(c, session);
  restored.verifyReload();
  await restored.recoverOriginal();
  assert.throws(() => restored.verifyReload());
  assert.deepEqual(restored.freshDraftTarget, { listingId: scope.listingId, revision: 2 });
  assert.equal('revisionVersion' in restored.freshDraftTarget, false);
  assert.equal(restored.canLeave, true);
  restored.discard();
  assert.equal(restored.canLeave, true);
  assert.equal(restored.freshDraftTarget, null);
  assert.throws(() => restored.verifyReload());
});
test('storage is scoped by instance/company/actor/listing and never replaces a different retained successor', () => {
  const store = memory(),
    session = referenceSuccessorSession(store, scope);
  session.retain(command(), catalogue());
  for (const patch of [
    { instanceId: id(8) },
    { tenantId: id(2) },
    { actorId: id(11) },
    { listingId: id(101) },
  ])
    assert.equal(referenceSuccessorSession(store, { ...scope, ...patch }).load(), null);
  assert.throws(() => session.retain({ ...command(), expectedListingVersion: '2' }, catalogue()));
  assert.throws(() => prepareReferenceSuccessorAttempt(client(), session, command(), catalogue()));
  assert.deepEqual(session.load().candidate, command());
  session.clear(command(), catalogue());
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
      a = prepareReferenceSuccessorAttempt(
        c,
        referenceSuccessorSession(store, scope),
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
    session = referenceSuccessorSession(store, scope),
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
  const a = prepareReferenceSuccessorAttempt(c, session, input, cat),
    pending = a.submit();
  input.predecessor.version = '9';
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
test('lost successor remains uncertain through denied recovery and reload restores historical catalogue without requests', async () => {
  const store = memory(),
    session = referenceSuccessorSession(store, scope),
    c = client();
  c.create = async () => {
    c.calls.push(['POST']);
    throw new ApiClientError('NETWORK', 'lost', { submissionUncertain: true });
  };
  c.recover = async () => {
    c.calls.push(['GET']);
    throw new ApiClientError('HTTP', 'denied', { status: 403 });
  };
  const a = prepareReferenceSuccessorAttempt(c, session, command(), catalogue());
  await assert.rejects(() => a.submit());
  assert.equal(a.status, 'uncertain');
  assert.throws(() => a.discard());
  await assert.rejects(() => a.recoverOriginal());
  assert.equal(a.status, 'uncertain');
  assert.equal(a.canDiscard, false);
  const restoredClient = client(),
    restored = await restoreReferenceSuccessorAttempt(restoredClient, session);
  assert.deepEqual(restoredClient.calls, []);
  assert.equal(restored.status, 'uncertain');
  await assert.rejects(() => restored.submit());
  assert.deepEqual(await restored.recoverOriginal(), receipt());
  assert.deepEqual(
    restoredClient.calls.map((c) => c[0]),
    ['GET'],
  );
  restored.discard();
  assert.equal(session.load(), null);
  assert.equal(c.calls.filter((x) => x[0] === 'POST').length, 1);
});
test('replay is explicit and bound to exact original; malformed recovery cannot settle uncertainty', async () => {
  const session = referenceSuccessorSession(memory(), scope),
    c = client();
  let writes = 0;
  c.create = async (original, cat, actor) => {
    assert.deepEqual(original, command());
    if (++writes === 1) throw Error('unknown interruption');
    return receipt(original, cat, actor);
  };
  c.recover = async () => ({
    ...receipt(),
    successor: {
      ...receipt().successor,
      request: { ...receipt().successor.request, expectedListingVersion: '2' },
    },
  });
  const a = prepareReferenceSuccessorAttempt(c, session, command(), catalogue());
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
    session = referenceSuccessorSession(memory(), scope);
  c.create = async () => {
    throw new ApiClientError('HTTP', 'conflict', { status: 409 });
  };
  const a = prepareReferenceSuccessorAttempt(c, session, command(), catalogue());
  await assert.rejects(() => a.submit());
  assert.equal(a.status, 'rejected');
  a.discard();
  assert.equal(session.load(), null);
  for (const mode of ['actor', 'version', 'cancel']) {
    const c = client(),
      controller = new AbortController();
    c.create = async () => {
      const r = receipt();
      if (mode === 'actor') r.successor.actorId = id(11);
      if (mode === 'version') r.referenceDraft.revisionVersion = '4';
      if (mode === 'cancel') controller.abort();
      return r;
    };
    const session = referenceSuccessorSession(memory(), scope),
      a = prepareReferenceSuccessorAttempt(c, session, command(), catalogue());
    await assert.rejects(() => a.submit(controller.signal));
    assert.equal(a.status, 'uncertain');
    assert.ok(session.load());
    assert.throws(() => a.discard());
  }
});
test('corrupt stored envelope fails before catalogue transport and remains available for explicit resolution', async () => {
  for (const change of [
    (raw) => raw.replace('"actorId":"' + id(10) + '"', '"actorId":"' + id(11) + '"'),
    (raw) =>
      raw.replace(
        '"expectedListingVersion":',
        '"expectedListingVersion":"2","expectedListingVersion":',
      ),
    (raw) => raw.replace('"catalogueVersion":"1"', '"catalogueVersion":1'),
    (raw) =>
      raw.replace(
        '"policy":"synthetic-reference-successor-v1"',
        '"policy":"synthetic-reference-draft-v1"',
      ),
    () => '{invalid',
    () => ' '.repeat(262145),
  ]) {
    const store = memory(),
      session = referenceSuccessorSession(store, scope);
    session.retain(command(), catalogue());
    const key = [...store.map.keys()][0];
    store.map.set(key, change(store.map.get(key)));
    const c = client();
    await assert.rejects(() => restoreReferenceSuccessorAttempt(c, session));
    assert.equal(c.calls.length, 0);
    assert.ok(store.map.has(key));
  }
});
test('pre-abort performs no storage or transport, and modified retained command blocks later recovery', async () => {
  const store = memory(),
    session = referenceSuccessorSession(store, scope),
    c = client(),
    abort = new AbortController();
  abort.abort();
  const a = prepareReferenceSuccessorAttempt(c, session, command(), catalogue());
  await assert.rejects(() => a.submit(abort.signal));
  assert.equal(store.map.size, 0);
  assert.equal(c.calls.length, 0);
  session.retain(command(), catalogue());
  const restored = await restoreReferenceSuccessorAttempt(c, session);
  const key = [...store.map.keys()][0];
  store.map.set(key, store.map.get(key).replace('PRIVATE-SYNTHETIC-CREATION', 'CHANGED-PRIVATE'));
  await assert.rejects(() => restored.recoverOriginal());
  assert.equal(restored.status, 'uncertain');
  assert.equal(c.calls.filter((x) => x[0] === 'GET').length, 0);
});
