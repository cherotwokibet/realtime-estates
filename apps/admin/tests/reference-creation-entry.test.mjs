import test from 'node:test';
import assert from 'node:assert/strict';
import {
  id,
  catalogue,
  command,
  receipt,
} from '../../../packages/api-client/tests/fixtures/reference-creation.mjs';
import { openReferenceCreationEntry } from '../dist/tests/lib/reference-creation-entry.js';
import {
  prepareReferenceCreationAttempt,
  restoreReferenceCreationAttempt,
} from '../dist/tests/lib/reference-creation-workspace.js';
import { readReferenceCreationScreen } from '../dist/tests/lib/reference-creation-screen.js';
const identity = { instanceId: id(9), tenantId: id(1), actorId: id(10) };
const memory = () => {
  const map = new Map();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
};
const client = () => ({
  catalogue: async (version) => {
    assert.equal(version, '1');
    return catalogue();
  },
  create: async (c, cat, actor) => receipt(c, cat, actor),
  recover: async (c, cat, actor) => receipt(c, cat, actor),
});
test('entry restores target before generating any new ID and atomically holds original in that same key', async () => {
  const store = memory();
  let ids = 0;
  const e = openReferenceCreationEntry(store, identity, () => {
    ids++;
    return id(100);
  });
  const c = client();
  c.create = async (original) => {
    assert.equal(store.map.size, 1);
    assert.equal(JSON.parse([...store.map.values()][0]).listingId, original.listingId);
    assert.deepEqual(e.session.load().candidate, original);
    throw Error('lost');
  };
  const attempt = prepareReferenceCreationAttempt(c, e.session, command(), catalogue());
  await assert.rejects(() => attempt.submit());
  assert.throws(() => e.release(attempt));
  const reopened = openReferenceCreationEntry(store, identity, () => {
    throw Error('must not generate target');
  });
  assert.equal(reopened.scope.listingId, id(100));
  let reads = 0;
  const transport = client();
  transport.catalogue = async (v) => {
    reads++;
    assert.equal(v, '1');
    return catalogue();
  };
  const restored = await restoreReferenceCreationAttempt(transport, reopened.session);
  assert.equal(reads, 1);
  assert.equal(restored.status, 'uncertain');
  assert.equal(ids, 1);
  await restored.recoverOriginal();
  reopened.release(restored);
  assert.equal(store.map.size, 0);
  assert.equal(openReferenceCreationEntry(store, identity, () => id(101)).scope.listingId, id(101));
});
test('empty reserved target survives reload and cannot be replaced by an unrelated prepared target', () => {
  const store = memory(),
    entry = openReferenceCreationEntry(store, identity, () => id(100));
  const reopened = openReferenceCreationEntry(store, identity, () => {
    throw Error('new ID forbidden');
  });
  assert.equal(reopened.scope.listingId, id(100));
  assert.equal(reopened.session.load(), null);
  const other = openReferenceCreationEntry(memory(), identity, () => id(101));
  const a = prepareReferenceCreationAttempt(client(), other.session, command(101), catalogue());
  assert.throws(() => entry.release(a));
  assert.equal(store.map.size, 1);
});
test('corrupt entry/original/scope fails closed before ID generation without destroying evidence', () => {
  for (const change of [
    () => '{invalid',
    () => ' '.repeat(393217),
    (raw) => raw.replace('"listingId":"' + id(100) + '"', '"listingId":"bad"'),
    (raw) => raw.replace('"actorId":"' + id(10) + '"', '"actorId":"' + id(11) + '"'),
    (raw) => raw.replace('"original":null', '"original":"broken"'),
    (raw) => raw.replace('"original":null', '"original":null,"original":null'),
  ]) {
    const store = memory();
    openReferenceCreationEntry(store, identity, () => id(100));
    const key = [...store.map.keys()][0],
      raw = change(store.map.get(key));
    store.map.set(key, raw);
    let generated = 0;
    assert.throws(() =>
      openReferenceCreationEntry(store, identity, () => {
        generated++;
        return id(101);
      }),
    );
    assert.equal(generated, 0);
    assert.equal(store.map.get(key), raw);
  }
});
test('quota or readback failure prevents entry activation; changed target blocks retained dispatch', async () => {
  for (const store of [
    {
      getItem: () => null,
      setItem() {
        throw Error('quota');
      },
      removeItem() {},
    },
    { getItem: () => null, setItem() {}, removeItem() {} },
  ])
    assert.throws(() => openReferenceCreationEntry(store, identity, () => id(100)));
  const store = memory(),
    entry = openReferenceCreationEntry(store, identity, () => id(100));
  let writes = 0;
  const c = client();
  c.create = async () => {
    writes++;
    return receipt();
  };
  const a = prepareReferenceCreationAttempt(c, entry.session, command(), catalogue()),
    key = [...store.map.keys()][0];
  store.map.set(key, store.map.get(key).replace(id(100), id(101)));
  await assert.rejects(() => a.submit());
  assert.equal(writes, 0);
});
test('identity descriptors are detached without accessor execution and each identity has its own entry', () => {
  const store = memory(),
    input = { ...identity };
  const entry = openReferenceCreationEntry(store, input, () => id(100));
  input.actorId = id(11);
  assert.equal(entry.scope.actorId, id(10));
  for (const patch of [{ actorId: id(11) }, { tenantId: id(2) }, { instanceId: id(8) }])
    assert.equal(
      openReferenceCreationEntry(store, { ...identity, ...patch }, () => id(101)).scope.listingId,
      id(101),
    );
  let calls = 0;
  const hostile = { ...identity };
  Object.defineProperty(hostile, 'actorId', {
    enumerable: true,
    get() {
      calls++;
      return id(10);
    },
  });
  assert.throws(() => openReferenceCreationEntry(store, hostile, () => id(100)));
  assert.equal(calls, 0);
});
test('full pricing/private original survives reload and release failure cannot authorize a new target', async () => {
  const store = memory(),
    entry = openReferenceCreationEntry(store, identity, () => id(100)),
    cat = catalogue('1', true),
    cmd = command(100, 1000, cat, true);
  const c = client();
  c.catalogue = async () => cat;
  const a = prepareReferenceCreationAttempt(c, entry.session, cmd, cat);
  await a.submit();
  const loaded = openReferenceCreationEntry(store, identity, () => {
    throw Error();
  });
  assert.deepEqual(loaded.session.load().candidate, cmd);
  const restored = await restoreReferenceCreationAttempt(c, loaded.session);
  await restored.recoverOriginal();
  store.removeItem = () => {
    throw Error('blocked removal');
  };
  assert.throws(() => loaded.release(restored));
  assert.equal(
    openReferenceCreationEntry(store, identity, () => {
      throw Error();
    }).scope.listingId,
    id(100),
  );
});
test('screen reads current fixed identity and catalogue without exposing bearer or choosing a target', async () => {
  const env = {
      NODE_ENV: 'development',
      STAFF_PREVIEW_MODE: 'synthetic',
      STAFF_PREVIEW_REFERENCE: 'synthetic-reference-draft-v1',
      STAFF_PREVIEW_REFERENCE_CREATION: 'synthetic-reference-creation-v1',
      STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
      STAFF_PREVIEW_TOKEN: 'a.b.c',
      STAFF_PREVIEW_INSTANCE: identity.instanceId,
    },
    calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return Response.json(
      url.endsWith('/reference-session')
        ? {
            policy: 'synthetic-reference-session-v1',
            actorId: identity.actorId,
            tenantId: identity.tenantId,
          }
        : catalogue(),
    );
  };
  const props = await readReferenceCreationScreen(env, fetch);
  assert.deepEqual(props, { identity, catalogue: catalogue() });
  assert.equal(JSON.stringify(props).includes('a.b.c'), false);
  assert.equal(props.identity.listingId, undefined);
  assert.deepEqual(
    calls.map((c) => c.init.method),
    ['GET', 'GET'],
  );
  assert.ok(calls[1].url.endsWith('/reference-catalogues/current'));
  for (const c of calls) assert.equal(c.init.headers.Authorization, 'Bearer a.b.c');
  calls.length = 0;
  await assert.rejects(() =>
    readReferenceCreationScreen({ ...env, STAFF_PREVIEW_REFERENCE_CREATION: undefined }, fetch),
  );
  await assert.rejects(() =>
    readReferenceCreationScreen({ ...env, NODE_ENV: 'production' }, fetch),
  );
  assert.equal(calls.length, 0);
});
test('explicit reload requires an uncertain original with exact stored readback and rejects sending, tampered or confirmed attempts', async () => {
  const store = memory(),
    entry = openReferenceCreationEntry(store, identity, () => id(100)),
    c = client();
  let rejectWrite,
    writes = 0;
  c.create = () => {
    writes++;
    return new Promise((_, reject) => {
      rejectWrite = reject;
    });
  };
  const attempt = prepareReferenceCreationAttempt(c, entry.session, command(), catalogue());
  assert.throws(() => entry.verifyReload(attempt));
  const sending = attempt.submit();
  assert.equal(attempt.status, 'sending');
  assert.throws(() => entry.verifyReload(attempt));
  rejectWrite(Error('Synthetic lost result'));
  await assert.rejects(sending);
  assert.equal(attempt.status, 'uncertain');
  assert.doesNotThrow(() => entry.verifyReload(attempt));
  assert.equal(writes, 1);
  const key = [...store.map.keys()][0],
    raw = store.map.get(key);
  store.map.set(key, raw.replace('synthetic-reference-100', 'changed-original'));
  assert.throws(() => entry.verifyReload(attempt));
  assert.equal(writes, 1);
  store.map.set(key, raw);
  await attempt.recoverOriginal();
  assert.equal(attempt.status, 'received');
  assert.throws(() => entry.verifyReload(attempt));
  entry.release(attempt);
  assert.throws(() => entry.verifyReload(attempt));
});
