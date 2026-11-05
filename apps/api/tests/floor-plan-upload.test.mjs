import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, id } from './floor-plan-api-fixture.mjs';
import { RealtorApiClient } from '../../../packages/api-client/dist/index.js';
import { LISTING, T, AGENT } from '../../../database/tests/public-media-fixtures.mjs';
const command = {
  policy: 'synthetic-floor-plan-preparation-command-v1',
  listingId: LISTING,
  revision: 1,
  expectedVersion: '2',
  requestId: id(2200),
};
const path = `/v2/staff/listings/${LISTING}/floor-plan-inputs/1/2/${command.requestId}`;
const prepared = {
  ...command,
  policy: 'synthetic-floor-plan-prepared-v1',
  width: 100,
  height: 100,
  bytes: 100,
  sha256: 'a'.repeat(64),
};
const request = (
  method = 'PUT',
  body = new Uint8Array([1, 2, 3]),
  headers = {},
  url = path,
  signal,
) =>
  new Request('https://synthetic.test' + url, {
    method,
    headers: {
      authorization: 'Bearer synthetic',
      ...(method === 'PUT' ? { 'content-type': 'application/octet-stream' } : {}),
      ...headers,
    },
    ...(method === 'PUT' ? { body, duplex: 'half' } : {}),
    ...(signal ? { signal } : {}),
  });
async function harness(t, changes = {}) {
  const f = await setup(t);
  const seen = [];
  const capability = {
    prepare: async (context, c, source) => {
      seen.push({ context, c, source });
      return { state: 'prepared', prepared };
    },
    recover: async (context, c) => {
      seen.push({ context, c });
      return { state: 'prepared', prepared };
    },
    ...changes,
  };
  return { ...f, seen, capability, run: f.open({ floorPlanPreparation: capability }) };
}
test('upload requires explicit synthetic capability; production composition remains closed', async (t) => {
  const f = await setup(t);
  assert.equal((await f.open()(request())).status, 404);
  assert.throws(() =>
    f.open({
      floorPlanMode: undefined,
      floorPlanPreparation: { prepare: async () => {}, recover: async () => {} },
    }),
  );
});
test('upload checks actual SQL authority and sends only verified server context', async (t) => {
  const f = await harness(t);
  assert.equal(
    (await f.run(request('PUT', new Uint8Array([1]), { authorization: 'Bearer customer' }))).status,
    403,
  );
  assert.equal(f.seen.length, 0);
  const r = await f.run(request());
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), prepared);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(f.seen[0].context.tenantId, T);
  assert.equal(f.seen[0].context.actorId, AGENT);
  assert.deepEqual(f.seen[0].c, command);
  assert.deepEqual([...f.seen[0].source], [1, 2, 3]);
});
test('stale target and untrusted header/query/oversize declarations refuse before capability', async (t) => {
  const f = await harness(t);
  for (const [headers, url, status] of [
    [{ 'x-actor-id': AGENT }, path, 400],
    [{ cookie: 'session=x' }, path, 400],
    [{ 'content-type': 'image/png' }, path, 400],
    [{ 'content-length': '10485761' }, path, 413],
    [{}, path + '?actor=x', 400],
    [{}, path.replace('/1/2/', '/1/1/'), 409],
  ])
    assert.equal((await f.run(request('PUT', new Uint8Array([1]), headers, url))).status, status);
  assert.equal(f.seen.length, 0);
});
test('empty, mismatched, failed and timed-out bodies never invoke preparation', async (t) => {
  const f = await harness(t, { bodyTimeoutMs: 10 });
  for (const body of [
    new Uint8Array(),
    new ReadableStream({
      start(c) {
        c.error(Error('read failed'));
      },
    }),
    new ReadableStream({ start() {}, cancel() {} }),
  ])
    assert.ok([400, 408].includes((await f.run(request('PUT', body))).status));
  assert.equal(
    (await f.run(request('PUT', new Uint8Array([1]), { 'content-length': '2' }))).status,
    400,
  );
  assert.equal(f.seen.length, 0);
});
test('one in-flight preparation refuses another write while original recovery remains available', async (t) => {
  let release, started;
  const ready = new Promise((r) => (started = r));
  const held = new Promise((r) => (release = r));
  const f = await harness(t, {
    prepare: async () => {
      started();
      await held;
      return { state: 'prepared', prepared };
    },
  });
  const first = f.run(request());
  await ready;
  assert.equal((await f.run(request())).status, 503);
  assert.equal((await f.run(request('GET'))).status, 200);
  release();
  assert.equal((await first).status, 200);
  assert.equal((await f.run(request())).status, 200);
});
test('blocked and mismatched preparation receipts are never exposed as success', async (t) => {
  const f = await harness(t, {
    prepare: async () => ({ state: 'prepared', prepared: { ...prepared, requestId: id(2201) } }),
    recover: async () => ({ state: 'blocked', reason: 'UNCONFIRMED' }),
  });
  assert.equal((await f.run(request())).status, 503);
  assert.equal((await f.run(request('GET'))).status, 503);
});
test('SDK sends a single snapshotted upload and explicitly reads original after malformed acknowledgement', async (t) => {
  const f = await harness(t);
  let puts = 0;
  const client = new RealtorApiClient({
    baseUrl: 'https://synthetic.test',
    privacyNoticeVersion: 'synthetic',
    fetch: async (url, init) => {
      const r = await f.run(new Request(url, init));
      if (init.method === 'PUT') {
        puts++;
        return new Response('{"data":', {
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        });
      }
      return r;
    },
  });
  await assert.rejects(
    client.prepareFloorPlan(command, new Uint8Array([1, 2, 3]), { bearerToken: 'synthetic' }),
    (e) => e.submissionUncertain === true,
  );
  assert.equal(puts, 1);
  assert.deepEqual(
    await client.getFloorPlanPreparationOriginal(command, { bearerToken: 'synthetic' }),
    prepared,
  );
  assert.equal(puts, 1);
});

test(
  'actual Windows upload prepares and recovers sealed output through the SDK without a second upload or native run',
  { skip: process.platform !== 'win32', timeout: 90000 },
  async (t) => {
    const { fixture } =
      await import('../../../packages/media/tests/floor-plan-preparation-fixture.mjs');
    const { readFile } = await import('node:fs/promises');
    const { createApiService } = await import('../dist/service.js');
    const { asActor } = await import('../../../database/tests/public-media-fixtures.mjs');
    const f = await fixture(t, true),
      coordinator = f.open();
    await f.db.exec(
      await readFile(
        new URL('../../../database/proposals/floor-plan-attachment.sql', import.meta.url),
        'utf8',
      ),
    );
    const original = { ...command, requestId: f.target.requestId };
    const target = (context, c) => ({
      companyId: context.tenantId,
      actorId: context.actorId,
      listingId: c.listingId,
      revision: c.revision,
      expectedVersion: Number(c.expectedVersion),
      requestId: c.requestId,
    });
    const run = createApiService({
      tenantId: T,
      privacyNoticeVersion: 'synthetic',
      floorPlanMode: 'synthetic-private-floor-plan-v1',
      verifyAuthorization: async () => ({ actorId: AGENT }),
      database: {
        transaction: (context, fn) =>
          asActor(f.db, context.tenantId, context.actorId, () =>
            fn({ query: (s, args) => f.db.query(s, args) }),
          ),
      },
      floorPlanPreparation: {
        prepare: (context, c, bytes) => coordinator.prepare(target(context, c), bytes),
        recover: (context, c) => coordinator.recover(target(context, c)),
      },
    });
    let puts = 0;
    const client = new RealtorApiClient({
      baseUrl: 'https://synthetic.test',
      privacyNoticeVersion: 'synthetic',
      fetch: async (url, init) => {
        const r = await run(new Request(url, init));
        if (init.method === 'PUT') {
          puts++;
          assert.equal(r.status, 200);
          const value = await r.json();
          return Response.json(
            { ...value, requestId: id(9999) },
            { headers: { 'cache-control': 'no-store' } },
          );
        }
        return r;
      },
    });
    await assert.rejects(
      client.prepareFloorPlan(original, f.source, { bearerToken: 'synthetic', timeoutMs: 60000 }),
      (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain === true,
    );
    const before = { ...f.calls };
    const result = await client.getFloorPlanPreparationOriginal(original, {
      bearerToken: 'synthetic',
    });
    assert.equal(result.requestId, original.requestId);
    assert.equal(result.policy, 'synthetic-floor-plan-prepared-v1');
    assert.equal(puts, 1);
    for (const k of ['register', 'source', 'claim', 'native', 'seal']) assert.equal(f.calls[k], 1);
    for (const k of ['register', 'source', 'claim', 'native', 'seal'])
      assert.equal(f.calls[k], before[k]);
    assert.ok(!JSON.stringify(result).includes('leaseNonce'));
  },
);

test('streaming source limits and cancellation refuse before any registration', async (t) => {
  const f = await harness(t);
  const oversized = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(10485761));
      c.close();
    },
  });
  assert.equal((await f.run(request('PUT', oversized))).status, 413);
  const control = new AbortController();
  control.abort();
  assert.equal(
    (await f.run(request('PUT', new Uint8Array([1]), {}, path, control.signal))).status,
    400,
  );
  assert.equal(f.seen.length, 0);
});
test('SDK refuses foreign original receipts and missing private-cache controls without retrying upload', async (t) => {
  for (const headers of [
    { 'content-type': 'application/json', 'cache-control': 'no-store' },
    { 'content-type': 'application/json' },
  ]) {
    let puts = 0;
    const client = new RealtorApiClient({
      baseUrl: 'https://synthetic.test',
      privacyNoticeVersion: 'synthetic',
      fetch: async () => {
        puts++;
        return Response.json({ ...prepared, requestId: id(2201) }, { headers });
      },
    });
    await assert.rejects(
      client.prepareFloorPlan(command, new Uint8Array([1]), { bearerToken: 'synthetic' }),
      (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain === true,
    );
    assert.equal(puts, 1);
  }
});
