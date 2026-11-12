import test from 'node:test';
import assert from 'node:assert/strict';
import { createMobileReferenceReadSession } from '../dist/tests/src/reference-read-session.js';
const scope = {
  mode: 'synthetic-reference-public-v1',
  tenantSlug: 'sample-homes',
  apiOrigin: 'https://synthetic.invalid',
  allowLoopbackHttp: false,
};
const query = { offset: 0, limit: 24 };
const page = (overrides = {}) =>
  Response.json({
    policy: 'synthetic-reference-search-v1',
    items: [],
    total: 0,
    limit: 24,
    offset: 0,
    sort: 'catalogue',
    hasMore: false,
    maxOffset: 10000,
    ...overrides,
  });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
test('one anonymous read per attempt; failed refresh offers an explicit timestamped previous response', async () => {
  let calls = 0,
    time = 1000;
  const session = createMobileReferenceReadSession(scope, {
    now: () => time,
    fetch: async (_url, init) => {
      calls++;
      assert.equal(init.credentials, 'omit');
      assert.equal(new Headers(init.headers).has('authorization'), false);
      assert.equal(init.cache, 'no-store');
      if (calls > 1) throw Error('offline');
      return page();
    },
  });
  const first = await session.read(query);
  assert.equal(first.freshness, 'current');
  assert.equal(first.loadedAt, 1000);
  time = 2000;
  const old = await session.read({ limit: 24, offset: 0 });
  assert.equal(old.freshness, 'previous');
  assert.equal(old.loadedAt, 1000);
  assert.equal(calls, 2);
  assert.equal(old.items, first.items);
  assert.ok(Object.isFrozen(old));
});
test('different query or page discards the one-response fallback instead of showing mismatched stock', async () => {
  let calls = 0;
  const session = createMobileReferenceReadSession(scope, {
    fetch: async () => (++calls === 1 ? page() : Promise.reject(Error('offline'))),
  });
  assert.equal((await session.read(query)).status, 'ready');
  assert.equal((await session.read({ ...query, offset: 24 })).status, 'error');
  assert.equal((await session.read(query)).status, 'error');
  const other = createMobileReferenceReadSession(
    { ...scope, tenantSlug: 'realtime-estates' },
    {
      fetch: async () => {
        throw Error('offline');
      },
    },
  );
  assert.equal((await other.read(query)).status, 'error');
});
test('fallback expires without refreshing its age on failures and refuses a backwards or broken clock', async () => {
  for (const failure of [
    () => 1101,
    () => 999,
    () => NaN,
    () => {
      throw Error();
    },
  ]) {
    let time = () => 1000,
      calls = 0;
    const session = createMobileReferenceReadSession(scope, {
      now: () => time(),
      maxAgeMs: 100,
      fetch: async () => (++calls === 1 ? page() : Promise.reject(Error('offline'))),
    });
    await session.read(query);
    time = () => 1050;
    assert.equal((await session.read(query)).loadedAt, 1000);
    time = failure;
    assert.equal((await session.read(query)).status, 'error');
  }
  assert.throws(() => createMobileReferenceReadSession(scope, { maxAgeMs: 300001 }));
});
test('clear invalidates an in-flight result and prevents it repopulating the fallback', async () => {
  const pending = deferred();
  const entered = deferred();
  let calls = 0;
  const session = createMobileReferenceReadSession(scope, {
    fetch: async () => {
      if (++calls > 1) throw Error('offline');
      entered.resolve();
      return pending.promise;
    },
  });
  const old = session.read(query);
  await entered.promise;
  session.clear();
  pending.resolve(page());
  assert.equal((await old).status, 'error');
  assert.equal((await session.read(query)).status, 'error');
});
test('a superseded response cannot replace the latest successful search', async () => {
  const pending = deferred(),
    entered = deferred();
  let calls = 0;
  const session = createMobileReferenceReadSession(scope, {
    fetch: async () => {
      calls++;
      if (calls === 1) {
        entered.resolve();
        return pending.promise;
      }
      if (calls === 2) return page();
      throw Error('offline');
    },
  });
  const old = session.read(query);
  await entered.promise;
  assert.equal((await session.read({ ...query, location: 'Second place' })).freshness, 'current');
  pending.resolve(page());
  assert.equal((await old).status, 'error');
  assert.equal((await session.read({ ...query, location: 'Second place' })).freshness, 'previous');
});
test('cancellation offers no cached fallback and late fetch completion cannot refill it', async () => {
  const pending = deferred(),
    entered = deferred();
  let calls = 0;
  const session = createMobileReferenceReadSession(scope, {
    fetch: async () => {
      if (++calls === 1) {
        entered.resolve();
        return pending.promise;
      }
      throw Error('offline');
    },
  });
  const controller = new AbortController();
  const work = session.read(query, controller.signal);
  await entered.promise;
  controller.abort();
  assert.equal((await work).status, 'error');
  pending.resolve(page());
  assert.equal((await session.read(query)).status, 'error');
});
test('input is detached before I/O; accessors, unknown fields and malformed replies do not become a cache', async () => {
  const pending = deferred(),
    entered = deferred();
  let url,
    calls = 0;
  const session = createMobileReferenceReadSession(scope, {
    fetch: async (requested) => {
      calls++;
      url = requested;
      entered.resolve();
      return pending.promise;
    },
  });
  const input = { ...query, location: 'Original' };
  const work = session.read(input);
  await entered.promise;
  input.location = 'Changed';
  pending.resolve(page({ privateNotes: 'must be rejected' }));
  assert.equal((await work).status, 'error');
  assert.equal(new URL(url).searchParams.get('location'), 'Original');
  let invoked = false;
  assert.equal(
    (
      await session.read(
        Object.defineProperty({}, 'location', {
          enumerable: true,
          get() {
            invoked = true;
            return 'no';
          },
        }),
      )
    ).status,
    'error',
  );
  assert.equal(invoked, false);
  assert.equal((await session.read(JSON.parse('{"__proto__":"unsupported"}'))).status, 'error');
  assert.equal(calls, 1);
});

const apiFailure = (status) =>
  Response.json(
    {
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic service response.' },
      requestId: '00000000-0000-4000-8000-000000000001',
    },
    { status },
  );

test('a temporary API failure preserves a recent result but an access denial or invalid response clears it', async () => {
  for (const failure of [
    () => apiFailure(401),
    () => apiFailure(403),
    () => apiFailure(404),
    () => page({ items: ['invalid listing'] }),
    () => Response.redirect('https://synthetic.invalid/sign-in'),
  ]) {
    let calls = 0;
    const session = createMobileReferenceReadSession(scope, {
      fetch: async () => {
        switch (++calls) {
          case 1:
            return page();
          case 2:
            return apiFailure(503);
          case 3:
            return failure();
          default:
            throw Error('offline again');
        }
      },
    });
    assert.equal((await session.read(query)).freshness, 'current');
    assert.equal((await session.read(query)).freshness, 'previous');
    assert.deepEqual(await session.read(query), { status: 'error' });
    assert.deepEqual(await session.read(query), { status: 'error' });
    assert.equal(calls, 4);
  }
});
