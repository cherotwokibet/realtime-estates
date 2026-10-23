import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClientError } from '@realtor/api-client';
import {
  referenceModerationSession as session,
  prepareReferenceModerationAttempt as prepare,
  restoreReferenceModerationAttempt as restore,
  REFERENCE_MODERATION_ORIGINAL_MAX_BYTES,
} from '../dist/tests/lib/reference-moderation-workspace.js';
import {
  id,
  scope,
  catalogue,
  command,
  receipt,
} from '../test-helpers/reference-moderation-fixture.mjs';
const store = () => {
  const data = new Map();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
};
const client = (overrides = {}) => ({
  catalogue: async () => catalogue(),
  read: async () => {
    throw Error('Unused read');
  },
  transition: async () => receipt(),
  recover: async () => receipt(),
  ...overrides,
});
test('all four actions retain their exact original review and rejection text; a completed rejection is a received receipt', async () => {
  for (const action of ['submit', 'withdraw', 'approve', 'reject']) {
    const c = structuredClone(command());
    c.action = action;
    c.review.state = action === 'submit' ? 'draft' : 'pending';
    c.reason = action === 'reject' ? 'Synthetic evidence is incomplete' : null;
    const expected = {
      ...c,
      actorId: id(10),
      revisionVersion: '4',
      state: { submit: 'pending', withdraw: 'draft', approve: 'approved', reject: 'rejected' }[
        action
      ],
    };
    const storage = store(),
      s = session(storage, scope()),
      a = prepare(
        client({
          transition: async (original) => {
            assert.deepEqual(original, c);
            return expected;
          },
        }),
        s,
        c,
        catalogue(),
      );
    assert.deepEqual(await a.submit(), expected);
    assert.equal(a.status, 'received');
    assert.equal(a.receipt.reason, c.reason);
    a.discard();
    assert.equal(storage.data.size, 0);
  }
});
test('original is captured and stored/read back before a single transition; storage excludes catalogue and credentials', async () => {
  const storage = store(),
    s = session(storage, scope()),
    c = structuredClone(command()),
    cat = catalogue();
  let calls = 0;
  const api = client({
      transition: async (original) => {
        calls++;
        assert.ok(s.load());
        assert.deepEqual(original, command());
        return receipt();
      },
    }),
    a = prepare(api, s, c, cat);
  c.review.content.privateAddress = 'Changed';
  cat.locations[0].label = 'Changed';
  assert.equal(storage.data.size, 0);
  assert.ok(Object.isFrozen(a.original.review.photos[0]));
  await a.submit();
  assert.equal(calls, 1);
  assert.equal(a.status, 'received');
  assert.equal(a.canDiscard, true);
  assert.deepEqual(a.receipt, receipt());
  const raw = [...storage.data.values()][0];
  assert.ok(raw.includes('PRIVATE BFF REVIEW'));
  assert.ok(!raw.includes('bearerToken') && !raw.includes('synthetic-reference-catalogue-v1'));
  assert.ok(Buffer.byteLength(raw) < REFERENCE_MODERATION_ORIGINAL_MAX_BYTES);
  a.discard();
  assert.equal(storage.data.size, 0);
  assert.equal(a.canDiscard, false);
  await assert.rejects(() => a.submit());
});
test('one-flight and first storage claim prevent duplicate sends from identical or different prepared handles', async () => {
  const storage = store(),
    s = session(storage, scope());
  let resolve,
    calls = 0;
  const api = client({
      transition: () => {
        calls++;
        return new Promise((r) => (resolve = r));
      },
    }),
    a = prepare(api, s, command(), catalogue()),
    b = prepare(api, s, command(), catalogue());
  const pending = a.submit();
  assert.equal(a.status, 'sending');
  assert.equal(a.canDiscard, false);
  await assert.rejects(() => a.submit());
  await assert.rejects(() => a.recoverOriginal());
  assert.throws(() => a.discard());
  await assert.rejects(() => b.submit());
  b.discard();
  assert.ok(s.load());
  assert.equal(calls, 1);
  resolve(receipt());
  await pending;
  a.discard();
});
test('uncertain result keeps the original locked through denied and malformed recovery; no replacement or replay is allowed', async () => {
  const storage = store(),
    s = session(storage, scope());
  let mode = 'denied',
    posts = 0,
    gets = 0;
  const api = client({
    transition: async () => {
      posts++;
      throw new ApiClientError('NETWORK', 'Lost', { submissionUncertain: true });
    },
    recover: async () => {
      gets++;
      if (mode === 'denied') throw new ApiClientError('HTTP', 'Denied', { status: 403 });
      if (mode === 'bad') return { ...receipt(), actorId: id(11) };
      return receipt();
    },
  });
  const a = prepare(api, s, command(), catalogue());
  await assert.rejects(() => a.submit());
  const original = [...storage.data.values()][0];
  assert.equal(a.status, 'uncertain');
  assert.equal(a.canDiscard, false);
  assert.throws(() => a.discard());
  await assert.rejects(() => a.submit());
  assert.throws(() => prepare(api, s, { ...command(), operationId: id(401) }, catalogue()));
  await assert.rejects(() => a.recoverOriginal());
  mode = 'bad';
  await assert.rejects(() => a.recoverOriginal());
  assert.equal(a.status, 'uncertain');
  assert.equal([...storage.data.values()][0], original);
  mode = 'good';
  await a.recoverOriginal();
  assert.equal(a.status, 'received');
  assert.equal(posts, 1);
  assert.equal(gets, 3);
  a.discard();
});
test('reload restores only the original catalogue version and starts uncertain without automatic send or recovery', async () => {
  const storage = store(),
    s = session(storage, scope()),
    api = client({
      transition: async () => {
        throw Error('Lost');
      },
    }),
    a = prepare(api, s, command(), catalogue());
  await assert.rejects(() => a.submit());
  let cats = [],
    posts = 0,
    gets = 0;
  const after = client({
    catalogue: async (version) => {
      cats.push(version);
      return catalogue();
    },
    transition: async () => {
      posts++;
      return receipt();
    },
    recover: async () => {
      gets++;
      return receipt();
    },
  });
  const restored = await restore(after, session(storage, scope()));
  assert.deepEqual(cats, ['1']);
  assert.equal(posts, 0);
  assert.equal(gets, 0);
  assert.equal(restored.status, 'uncertain');
  assert.deepEqual(restored.original, command());
  await assert.rejects(() => restored.submit());
  await restored.recoverOriginal();
  assert.equal(gets, 1);
  restored.discard();
});
test('scope isolation and tampered envelopes fail before historical catalogue reads or any write', async () => {
  const storage = store(),
    s = session(storage, scope());
  s.retain(command(), catalogue());
  const raw = [...storage.data.values()][0];
  let calls = 0;
  const api = client({
    catalogue: async () => {
      calls++;
      return catalogue();
    },
  });
  for (const change of [
    { instanceId: id(8) },
    { actorId: id(13) },
    { tenantId: id(2) },
    { listingId: id(101) },
    { revision: 2 },
  ])
    assert.equal(session(storage, { ...scope(), ...change }).load(), null);
  const foreign = { ...storage, getItem: () => raw };
  await assert.rejects(() => restore(api, session(foreign, { ...scope(), actorId: id(13) })));
  assert.equal(calls, 0);
  for (const mutate of [
    (row) => (row.schema = 'other'),
    (row) => (row.actorId = id(13)),
    (row) => (row.revision = 2),
    (row) => (row.command.listingId = id(101)),
    (row) => (row.command.review.revision = 2),
    (row) => (row.bearerToken = 'secret'),
  ]) {
    const row = JSON.parse(raw);
    mutate(row);
    const damaged = { ...storage, getItem: () => JSON.stringify(row) };
    await assert.rejects(() => restore(api, session(damaged, scope())));
  }
  assert.equal(calls, 0);
});
test('invalid historical facts or storage replacement during restoration cannot become an original attempt', async () => {
  const storage = store(),
    s = session(storage, scope());
  s.retain(command(), catalogue());
  await assert.rejects(() =>
    restore(client({ catalogue: async () => ({ ...catalogue(), version: '2' }) }), s),
  );
  const before = [...storage.data.values()][0];
  await assert.rejects(() =>
    restore(
      client({
        catalogue: async () => {
          const [key] = storage.data.keys();
          storage.data.set(key, before + ' ');
          return catalogue();
        },
      }),
      s,
    ),
  );
  assert.ok(storage.data.size);
});
test('storage write/readback failures block dispatch and settled clear failure never deletes a different original', async () => {
  for (const mode of ['throw', 'drop', 'change']) {
    const storage = store();
    storage.setItem = (key, value) => {
      if (mode === 'throw') throw Error('Full');
      if (mode === 'change') storage.data.set(key, value + ' ');
    };
    let posts = 0;
    const a = prepare(
      client({
        transition: async () => {
          posts++;
          return receipt();
        },
      }),
      session(storage, scope()),
      command(),
      catalogue(),
    );
    await assert.rejects(() => a.submit());
    assert.equal(posts, 0);
  }
  const storage = store(),
    s = session(storage, scope()),
    a = prepare(client(), s, command(), catalogue());
  await a.submit();
  const [key] = storage.data.keys();
  storage.data.set(key, 'Different original');
  assert.throws(() => a.discard());
  assert.equal(storage.data.get(key), 'Different original');
  assert.equal(a.canDiscard, true);
});
test('malformed tokens, oversize raw text and scope/command accessors are refused without invoking getters', async () => {
  const storage = store(),
    s = session(storage, scope());
  s.retain(command(), catalogue());
  const raw = [...storage.data.values()][0];
  for (const bad of [
    raw.replace('"revision":1', '"revision":1.0'),
    raw.replace('"schema":', '"schema":"duplicate","schema":'),
    'x'.repeat(REFERENCE_MODERATION_ORIGINAL_MAX_BYTES + 1),
  ]) {
    const damaged = { ...storage, getItem: () => bad };
    assert.throws(() => session(damaged, scope()).load());
  }
  let calls = 0;
  const badScope = scope();
  Object.defineProperty(badScope, 'actorId', {
    enumerable: true,
    get() {
      calls++;
      return id(10);
    },
  });
  assert.throws(() => session(storage, badScope));
  const badCommand = structuredClone(command());
  Object.defineProperty(badCommand.review, 'state', {
    enumerable: true,
    get() {
      calls++;
      return 'pending';
    },
  });
  assert.throws(() => prepare(client(), session(store(), scope()), badCommand, catalogue()));
  assert.equal(calls, 0);
});
test('known rejection can be cleared, but unexpected failures and post-dispatch cancellation stay uncertain', async () => {
  const storage = store(),
    s = session(storage, scope()),
    a = prepare(
      client({
        transition: async () => {
          throw new ApiClientError('HTTP', 'Conflict', { status: 409 });
        },
      }),
      s,
      command(),
      catalogue(),
    );
  await assert.rejects(() => a.submit());
  assert.equal(a.status, 'rejected');
  a.discard();
  assert.equal(storage.data.size, 0);
  const ctrl = new AbortController();
  ctrl.abort();
  let posts = 0;
  const b = prepare(
    client({
      transition: async () => {
        posts++;
        return receipt();
      },
    }),
    s,
    command(),
    catalogue(),
  );
  await assert.rejects(() => b.submit(ctrl.signal));
  assert.equal(b.status, 'ready');
  assert.equal(storage.data.size, 0);
  assert.equal(posts, 0);
  b.discard();
  const after = new AbortController(),
    c = prepare(
      client({
        transition: async () => {
          after.abort();
          return receipt();
        },
      }),
      s,
      command(),
      catalogue(),
    );
  await assert.rejects(() => c.submit(after.signal));
  assert.equal(c.status, 'uncertain');
  assert.equal(c.canDiscard, false);
});
test('storage changes during a successful network response keep even a valid receipt uncertain', async () => {
  const storage = store(),
    s = session(storage, scope());
  let original;
  const api = client({
      transition: async () => {
        const [key] = storage.data.keys();
        original = storage.data.get(key);
        storage.data.set(key, original + ' ');
        return receipt();
      },
    }),
    a = prepare(api, s, command(), catalogue());
  await assert.rejects(() => a.submit());
  assert.equal(a.status, 'uncertain');
  assert.equal(a.receipt, null);
  assert.throws(() => a.discard());
  const [key] = storage.data.keys();
  storage.data.set(key, original);
  await a.recoverOriginal();
  assert.equal(a.status, 'received');
});
