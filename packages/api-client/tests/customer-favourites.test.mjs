import test from 'node:test';
import assert from 'node:assert/strict';
import { CustomerFavouritesClient, CustomerApiError } from '../dist/index.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const scope = { tenantId: id(1), customerId: id(13) },
  auth = { bearerToken: 'synthetic.header.signature' },
  c = {
    policy: 'customer-favourite-command-v1',
    operationId: id(100),
    listingId: id(200),
    expectedVersion: '0',
    saved: true,
  };
const r = {
  policy: 'customer-favourite-receipt-v1',
  ...scope,
  operationId: c.operationId,
  listingId: c.listingId,
  expectedVersion: '0',
  version: '1',
  requestedSaved: true,
  saved: true,
  outcome: 'applied',
  recordedAt: '2026-11-03T00:00:00.000Z',
};
const json = (v) => Response.json(v, { headers: { 'Cache-Control': 'no-store' } });
const client = (fetch) =>
  new CustomerFavouritesClient({ baseUrl: 'https://synthetic.example.invalid', scope, fetch });
test('SDK sends only explicit bearer/no-store/omit/error policy and never adds caller scope', async () => {
  const calls = [];
  const a = client(async (url, init) => {
    calls.push({ url, init });
    return json(r);
  });
  assert.deepEqual(await a.setFavourite(c, auth), r);
  assert.deepEqual(await a.getFavouriteOriginal(c, auth), r);
  assert.deepEqual(
    calls.map((x) => x.init.method),
    ['POST', 'GET'],
  );
  for (const { url, init } of calls) {
    assert(!url.includes(scope.customerId));
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
  }
  assert.deepEqual(JSON.parse(calls[0].init.body), c);
});
test('SDK binds company/customer/original and treats malformed success or network loss as uncertain without retry', async () => {
  for (const payload of [
    { ...r, customerId: id(14) },
    { ...r, tenantId: id(2) },
    { ...r, privateAddress: 'secret' },
    { ...r, version: '4' },
  ]) {
    let count = 0;
    const a = client(async () => {
      count++;
      return json(payload);
    });
    await assert.rejects(
      () => a.setFavourite(c, auth),
      (e) => e.kind === 'invalid_response' && e.submissionUncertain,
    );
    assert.equal(count, 1);
  }
  let count = 0;
  await assert.rejects(
    () =>
      client(async () => {
        count++;
        throw Error('secret');
      }).setFavourite(c, auth),
    (e) => e.submissionUncertain && !e.message.includes('secret'),
  );
  assert.equal(count, 1);
  await assert.rejects(
    () => client(async () => new Response('', { status: 403 })).setFavourite(c, auth),
    (e) => e.status === 403 && !e.submissionUncertain,
  );
});
test('SDK rejects unsafe origin/authority/getters and already-aborted writes before transport', async () => {
  let calls = 0;
  const a = client(async () => {
    calls++;
    return json(r);
  });
  for (const url of [
    'http://external.invalid',
    'https://synthetic.invalid/path',
    'https://user:secret@synthetic.invalid',
    'https://synthetic.invalid/?customer=x',
    'https://synthetic.invalid/#x',
  ])
    assert.throws(() => new CustomerFavouritesClient({ baseUrl: url, scope }));
  let getterCalls = 0;
  const bad = { ...c };
  Object.defineProperty(bad, 'saved', {
    enumerable: true,
    get() {
      getterCalls++;
      return true;
    },
  });
  await assert.rejects(() => a.setFavourite(bad, auth));
  await assert.rejects(() => a.setFavourite(c, { ...auth, customerId: id(14) }));
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(
    () => a.setFavourite(c, { ...auth, signal: ctrl.signal }),
    (e) => e.kind === 'cancelled' && !e.submissionUncertain,
  );
  assert.equal(calls, 0);
  assert.equal(getterCalls, 0);
});
test('SDK cancellation rejects late ignored-abort replies and bounds a stalled success body', async () => {
  const ctrl = new AbortController();
  const a = client(async () => {
    ctrl.abort();
    return json(r);
  });
  await assert.rejects(
    () => a.setFavourite(c, { ...auth, signal: ctrl.signal }),
    (e) => e.kind === 'cancelled' && e.submissionUncertain,
  );
  let cancelled = false;
  const b = new CustomerFavouritesClient({
    baseUrl: 'https://synthetic.invalid',
    scope,
    timeoutMs: 25,
    fetch: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
      ),
  });
  await assert.rejects(
    () => b.setFavourite(c, auth),
    (e) => e.kind === 'cancelled' && e.submissionUncertain,
  );
  assert.equal(cancelled, true);
});

// Watchdog assertions distinguish request settlement from merely setting AbortSignal.
const bounded = async (operation) => {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Request did not settle independently.')), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
test('SDK deadline settles an uncooperative pending transport for reads and writes, without retry', async () => {
  for (const write of [false, true]) {
    let calls = 0,
      resolveResponse,
      cancelled = 0,
      transportSignal;
    const a = new CustomerFavouritesClient({
      baseUrl: 'https://synthetic.invalid',
      scope,
      timeoutMs: 20,
      fetch: async (_url, init) => {
        calls++;
        transportSignal = init.signal;
        return new Promise((resolve) => {
          resolveResponse = resolve;
        });
      },
    });
    try {
      await assert.rejects(
        () => bounded(write ? a.setFavourite(c, auth) : a.getAccount(auth)),
        (e) =>
          e instanceof CustomerApiError &&
          e.kind === 'cancelled' &&
          e.submissionUncertain === write,
      );
      assert.equal(transportSignal.aborted, true);
      assert.equal(calls, 1);
    } finally {
      resolveResponse(
        new Response(
          new ReadableStream({
            cancel() {
              cancelled++;
            },
          }),
          {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          },
        ),
      );
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(cancelled, 1);
    assert.equal(calls, 1);
  }
});
test('SDK caller cancellation settles before a delayed transport rejects and preserves uncertainty', async () => {
  const ctrl = new AbortController();
  let rejectTransport,
    calls = 0;
  const a = client(async () => {
    calls++;
    return new Promise((_, reject) => {
      rejectTransport = reject;
    });
  });
  const operation = a.setFavourite(c, { ...auth, signal: ctrl.signal });
  ctrl.abort();
  try {
    await assert.rejects(
      () => bounded(operation),
      (e) => e instanceof CustomerApiError && e.kind === 'cancelled' && e.submissionUncertain,
    );
    assert.equal(calls, 1);
  } finally {
    rejectTransport(Error('late private transport detail'));
    await new Promise((resolve) => setImmediate(resolve));
  }
});
