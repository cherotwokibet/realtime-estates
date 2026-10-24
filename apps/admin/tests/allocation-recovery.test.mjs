import test from 'node:test';
import assert from 'node:assert/strict';
import {
  id,
  command as referenceCommand,
  receipt as referenceReceipt,
} from '../../../packages/api-client/tests/fixtures/reference-creation.mjs';
import {
  command as referenceSuccessor,
  receipt as referenceSuccessorReceipt,
} from '../../../packages/api-client/tests/fixtures/reference-successor.mjs';
import {
  creationAllocationSession,
  successorAllocationSession,
  prepareCreationAllocation,
  prepareSuccessorAllocation,
  restoreCreationAllocation,
  restoreSuccessorAllocation,
  openCreationAllocation,
  openSuccessorAllocation,
  captureAllocationIdentity,
} from '../dist/tests/lib/allocation-recovery.js';
import { ListingCreationError } from '../dist/tests/lib/listing-creation-client.js';
import { staffListingFixture } from '../../../packages/domain/test-helpers/staff-listing-fixtures.mjs';
const identity = { instanceId: id(9), tenantId: id(1), actorId: id(10) };
const creation = () => {
  const { policy, selection, ...c } = referenceCommand();
  return structuredClone(c);
};
const successor = () => {
  const { policy, selection, ...c } = referenceSuccessor();
  return c;
};
const created = (c, actor = identity.actorId) =>
  referenceReceipt({ ...referenceCommand(), ...c }, undefined, actor).creation;
const succeeded = (c, actor = identity.actorId) =>
  referenceSuccessorReceipt({ ...referenceSuccessor(), ...c }, undefined, actor).successor;
function memory() {
  const map = new Map();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}
function client(reply = created) {
  const calls = [];
  return {
    calls,
    async create(c) {
      calls.push(['POST', c]);
      return reply(c);
    },
    async recover(c) {
      calls.push(['GET', c]);
      return reply(c);
    },
  };
}
test('creation retains exact detached original before transport and reload allocates no IDs or requests', async () => {
  const store = memory(),
    c = creation(),
    api = client((c) => {
      assert.deepEqual(session.load(), c);
      return created(c);
    }),
    session = creationAllocationSession(store, identity);
  const attempt = prepareCreationAllocation(api, session, c);
  c.content.title = 'Changed after preparation';
  // The client receives the validated original, unaffected by caller mutation.
  api.create = () => {
    throw Error('method replacement must not change captured transport');
  };
  // Use the captured original as the storage expectation.
  c.content.title = attempt.original.content.title;
  await attempt.submit();
  assert.equal(attempt.status, 'received');
  assert.deepEqual(attempt.freshDraftTarget, { listingId: c.listingId, revision: 1 });
  const opened = openCreationAllocation(api, store, identity);
  assert.equal(opened.restored.status, 'uncertain');
  let ids = 0;
  assert.throws(() =>
    opened.prepare(
      { slug: c.slug, content: c.content },
      () => {
        ids++;
        return id(101);
      },
      () => {
        ids++;
        return id(1001);
      },
    ),
  );
  assert.equal(ids, 0);
  assert.equal(api.calls.length, 1);
  assert.equal(opened.restored.original.content.privateAddress, c.content.privateAddress);
  assert.equal(opened.restored.original.content.amountMinor, 2000001);
});
test('quota and failed write readback block POST; another retained original cannot be overwritten', async () => {
  for (const store of [
    {
      getItem: () => null,
      setItem: () => {
        throw Error('quota');
      },
      removeItem() {},
    },
    { getItem: () => null, setItem() {}, removeItem() {} },
  ]) {
    const api = client(),
      attempt = prepareCreationAllocation(
        api,
        creationAllocationSession(store, identity),
        creation(),
      );
    await assert.rejects(attempt.submit());
    assert.equal(api.calls.length, 0);
  }
  const store = memory(),
    api = client(),
    session = creationAllocationSession(store, identity),
    a = prepareCreationAllocation(api, session, creation()),
    b = prepareCreationAllocation(api, session, creation());
  await a.submit();
  await assert.rejects(b.submit());
  assert.equal(api.calls.length, 1);
});
test('uncertainty survives reload and denied recovery; explicit replay uses exact original', async () => {
  const store = memory(),
    session = creationAllocationSession(store, identity),
    calls = [];
  const api = {
    async create(c) {
      calls.push(['POST', structuredClone(c)]);
      throw new ListingCreationError('network', 0, true);
    },
    async recover(c) {
      calls.push(['GET', structuredClone(c)]);
      throw new ListingCreationError('http', 403, false);
    },
  };
  const a = prepareCreationAllocation(api, session, creation());
  await assert.rejects(a.submit());
  assert.equal(a.status, 'uncertain');
  a.verifyReload();
  assert.throws(() => a.discard());
  const b = restoreCreationAllocation(api, session);
  assert.equal(calls.length, 1);
  await assert.rejects(b.recoverOriginal());
  assert.equal(b.status, 'uncertain');
  await assert.rejects(b.replayOriginal());
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['POST', 'GET', 'POST'],
  );
  assert.deepEqual(calls[0][1], calls[2][1]);
  assert.equal(b.freshDraftTarget, null);
});
test('wrong actor, malformed receipt and changed retained bytes remain uncertain without draft handoff', async () => {
  for (const mode of ['actor', 'receipt', 'storage']) {
    const store = memory(),
      session = creationAllocationSession(store, identity),
      api = client((c) => {
        if (mode === 'storage') {
          const [key] = store.map.keys();
          store.map.set(key, '{}');
        }
        return mode === 'receipt' ? {} : created(c, mode === 'actor' ? id(11) : identity.actorId);
      });
    const a = prepareCreationAllocation(api, session, creation());
    await assert.rejects(a.submit());
    assert.equal(a.status, 'uncertain');
    assert.equal(a.freshDraftTarget, null);
    assert.throws(() => a.discard());
  }
});
test('storage rejects corruption, duplicate keys, cross-scope envelopes and oversize bytes without deleting originals', () => {
  for (const mutate of [
    (raw) => '{}',
    (raw) => raw.replace('"schema":', '"schema":"duplicate","schema":'),
    (raw) => raw.replace(identity.actorId, id(11)),
    (raw) => 'x'.repeat(262145),
  ]) {
    const store = memory(),
      session = creationAllocationSession(store, identity);
    session.retain(creation());
    const [key] = store.map.keys(),
      bad = mutate(store.map.get(key));
    store.map.set(key, bad);
    assert.throws(() => session.load());
    assert.equal(store.map.get(key), bad);
  }
});
test('successful discard clears only matching retained original and invalidates draft target', async () => {
  const store = memory(),
    session = creationAllocationSession(store, identity),
    a = prepareCreationAllocation(client(), session, creation());
  await a.submit();
  a.discard();
  assert.equal(session.load(), null);
  assert.equal(a.freshDraftTarget, null);
  await assert.rejects(a.replayOriginal());
  assert.throws(() => a.discard());
});
test('successor restores exact fixed-listing original and validates actor before target handoff', async () => {
  const store = memory(),
    c = successor(),
    session = successorAllocationSession(store, identity, c.listingId),
    api = client(succeeded),
    a = prepareSuccessorAllocation(api, session, c);
  assert.throws(() =>
    prepareSuccessorAllocation(api, successorAllocationSession(memory(), identity, id(101)), c),
  );
  await a.submit();
  assert.equal(a.freshDraftTarget.revision, c.predecessor.revision + 1);
  const b = restoreSuccessorAllocation(api, session);
  assert.equal(b.status, 'uncertain');
  assert.equal(api.calls.length, 1);
  await b.recoverOriginal();
  assert.deepEqual(
    api.calls.map((c) => c[0]),
    ['POST', 'GET'],
  );
  assert.deepEqual(b.original, c);
});
test('pre-aborted submission and malformed identities fail locally without retained command or I/O', async () => {
  const store = memory(),
    session = creationAllocationSession(store, identity),
    api = client(),
    a = prepareCreationAllocation(api, session, creation());
  await assert.rejects(a.submit(AbortSignal.abort()));
  assert.equal(api.calls.length, 0);
  assert.equal(session.load(), null);
  assert.throws(() => captureAllocationIdentity({ ...identity, token: 'untrusted' }));
  assert.throws(() => captureAllocationIdentity({ ...identity, actorId: 'invalid' }));
});

test('current successor draft does not hide retained original; only terminal fresh state allocates an operation', () => {
  const c = successor(),
    store = memory(),
    api = client(succeeded),
    current = staffListingFixture(100);
  successorAllocationSession(store, identity, c.listingId).retain(c);
  const opened = openSuccessorAllocation(api, store, identity, c.listingId, current);
  assert.equal(opened.restored.status, 'uncertain');
  assert.equal(opened.eligible, false);
  let ids = 0;
  const allocate = () => {
    ids++;
    return id(1001);
  };
  assert.throws(() => opened.prepare(c.content, allocate));
  assert.equal(ids, 0);
  assert.equal(api.calls.length, 0);
  const fresh = openSuccessorAllocation(api, memory(), identity, c.listingId, current);
  assert.throws(() => fresh.prepare(c.content, allocate));
  assert.equal(ids, 0);
  const terminal = {
    ...current,
    version: c.expectedListingVersion,
    publicationStatus: 'unpublished',
    publishedRevision: null,
    latest: {
      ...current.latest,
      revision: c.predecessor.revision,
      version: c.predecessor.version,
      state: c.predecessor.state,
    },
  };
  const eligible = openSuccessorAllocation(api, memory(), identity, c.listingId, terminal);
  assert.equal(eligible.eligible, true);
  const prepared = eligible.prepare(c.content, allocate);
  assert.equal(ids, 1);
  assert.equal(prepared.original.expectedListingVersion, c.expectedListingVersion);
  assert.deepEqual(prepared.original.predecessor, c.predecessor);
});
test('sending cannot be discarded or navigated away and cancellation of reply retains uncertainty', async () => {
  const store = memory(),
    session = creationAllocationSession(store, identity),
    abort = new AbortController();
  let resolve;
  const api = {
    create: () =>
      new Promise((r) => {
        resolve = r;
      }),
    recover: async () => {
      throw Error('unused');
    },
  };
  const a = prepareCreationAllocation(api, session, creation()),
    pending = a.submit(abort.signal);
  assert.equal(a.status, 'sending');
  assert.equal(a.canLeave, false);
  assert.throws(() => a.discard());
  abort.abort();
  resolve(created(a.original));
  await assert.rejects(pending);
  assert.equal(a.status, 'uncertain');
  assert.ok(session.load());
  assert.equal(a.freshDraftTarget, null);
});
