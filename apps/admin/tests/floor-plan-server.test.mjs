import test from 'node:test';
import assert from 'node:assert/strict';
import { floorPlanRequest, readFloorPlanScreen } from '../dist/tests/lib/floor-plan-server.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_PREVIEW_REFERENCE: 'synthetic-reference-draft-v1',
  STAFF_PREVIEW_FLOOR_PLAN: 'synthetic-private-floor-plan-v1',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4001',
  STAFF_PREVIEW_TOKEN: 'synthetic.server.secret',
  STAFF_PREVIEW_INSTANCE: id(9),
};
const command = {
  policy: 'synthetic-floor-plan-preparation-command-v1',
  listingId: id(100),
  revision: 1,
  expectedVersion: '2',
  requestId: id(2200),
};
const prepared = {
  ...command,
  policy: 'synthetic-floor-plan-prepared-v1',
  width: 100,
  height: 100,
  bytes: 100,
  sha256: 'a'.repeat(64),
};
const attachment = {
  policy: 'synthetic-floor-plan-attachment-command-v1',
  listingId: id(100),
  revision: 1,
  expectedVersion: '2',
  operationId: id(2201),
  requestId: command.requestId,
};
const inputPath = `/api/staff/listings/${id(100)}/floor-plan-inputs/1/2/${command.requestId}`;
const opPath = `/api/staff/listings/${id(100)}/floor-plan-operations/${attachment.operationId}`;
const req = (path = inputPath, method = 'PUT', body = new Uint8Array([1, 2]), changes = {}) =>
  new Request('http://127.0.0.1:3132' + path, {
    method,
    headers: {
      Host: '127.0.0.1:3132',
      Origin: 'http://127.0.0.1:3132',
      'X-Preview-Instance': id(9),
      'X-Reference-Actor': id(11),
      'X-Reference-Tenant': id(1),
      ...(method === 'PUT'
        ? { 'content-type': 'application/octet-stream' }
        : method === 'POST'
          ? { 'content-type': 'application/json' }
          : {}),
      ...changes,
    },
    ...(method === 'PUT' || method === 'POST' ? { body, duplex: 'half' } : {}),
  });
function harness(options = {}) {
  const calls = [];
  let protocols = 0;
  const transport = async (url, init) => {
    calls.push({ url: String(url), init });
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer synthetic.server.secret');
    const p = new URL(url).pathname;
    let data;
    if (p === '/v3/staff/reference-session')
      data = { policy: 'synthetic-reference-session-v1', tenantId: id(1), actorId: id(11) };
    else if (p === '/v2/staff/session')
      data = {
        policy: 'current-staff-session-v2',
        tenantId: id(1),
        actorId: options.changedFinalActor ? id(12) : id(11),
      };
    else if (p.includes('/revision-protocol/')) {
      protocols++;
      data = {
        listingId: id(100),
        revision: 1,
        listingVersion: '1',
        revisionVersion: options.changedProtocol && protocols > 1 ? '3' : (options.version ?? '2'),
        state: 'draft',
        editable: true,
        protocol: 'synthetic-reference-v1',
      };
    } else if (p.includes('/floor-plan-revisions/'))
      data = {
        policy: 'synthetic-floor-plan-state-v1',
        listingId: id(100),
        revision: 1,
        version: options.version ?? '2',
        state: 'draft',
        floorPlan: null,
      };
    else if (p.includes('/floor-plan-inputs/')) {
      if (options.hold) await options.hold;
      if (options.invalidAck && init.method === 'PUT') data = { ...prepared, requestId: id(999) };
      else data = prepared;
    } else if (p.includes('/floor-plan-operations/'))
      data = {
        policy: 'synthetic-floor-plan-attachment-v1',
        command: attachment,
        actorId: id(11),
        resultVersion: '3',
        floorPlan: {
          operationId: attachment.operationId,
          requestId: command.requestId,
          width: 100,
          height: 100,
          bytes: 100,
          sha256: 'a'.repeat(64),
        },
      };
    else throw Error('Unexpected URL ' + p);
    return Response.json(data, { headers: { 'cache-control': 'no-store' } });
  };
  return { calls, transport };
}
test('floor-plan BFF is default closed and refuses production/foreign origin before upstream work', async () => {
  let count = 0;
  const transport = async () => {
    count++;
    throw Error();
  };
  for (const e of [
    {},
    { ...env, NODE_ENV: 'production' },
    { ...env, STAFF_PREVIEW_FLOOR_PLAN: undefined },
  ])
    assert.equal((await floorPlanRequest(req(), e, transport)).status, 403);
  assert.equal(
    (
      await floorPlanRequest(
        req(inputPath, 'PUT', new Uint8Array([1]), { Origin: 'https://foreign.test' }),
        env,
        transport,
      )
    ).status,
    403,
  );
  assert.equal(count, 0);
});
test('loader binds adopted revision to current identity and refuses a changed protocol', async () => {
  const f = harness();
  const screen = await readFloorPlanScreen(id(100), '1', env, f.transport);
  assert.equal(screen.scope.actorId, id(11));
  assert.equal(screen.state.version, '2');
  assert.ok(!JSON.stringify(screen).includes('secret'));
  await assert.rejects(
    readFloorPlanScreen(id(100), '1', env, harness({ changedProtocol: true }).transport),
  );
});
test('upload uses server-only credentials and exact command, then recovery performs GET without resending bytes', async () => {
  const f = harness();
  const put = await floorPlanRequest(req(), env, f.transport);
  assert.equal(put.status, 200);
  assert.deepEqual(await put.json(), prepared);
  assert.ok(put.headers.get('cache-control').includes('no-store'));
  const get = await floorPlanRequest(req(inputPath, 'GET'), env, f.transport);
  assert.equal(get.status, 200);
  const inputs = f.calls.filter((c) => c.url.includes('/floor-plan-inputs/'));
  assert.deepEqual(
    inputs.map((x) => x.init.method),
    ['PUT', 'GET'],
  );
  assert.deepEqual([...inputs[0].init.body], [1, 2]);
  assert.equal(inputs[1].init.body, undefined);
});
test('stale actor/version and spoofed framing never dispatch an upload or read its body', async () => {
  for (const [headers, e, status] of [
    [{ 'x-reference-actor': id(12) }, {}, 409],
    [{ cookie: 'x=y' }, {}, 400],
    [{ 'x-owner': id(11) }, {}, 400],
    [{}, { version: '3' }, 409],
    [{ 'content-length': '10485761' }, {}, 413],
  ]) {
    const f = harness(e),
      r = req(inputPath, 'PUT', new Uint8Array([1]), headers);
    assert.equal((await floorPlanRequest(r, env, f.transport)).status, status);
    assert.equal(r.bodyUsed, false);
    assert.equal(f.calls.filter((c) => c.url.includes('/floor-plan-inputs/')).length, 0);
  }
});
test('malformed acknowledgement stays uncertain while original recovery permits its older draft version', async () => {
  const f = harness({ invalidAck: true });
  const r = await floorPlanRequest(req(), env, f.transport);
  assert.equal(r.status, 502);
  assert.equal((await r.json()).submissionUncertain, true);
  const g = harness({ version: '3' });
  assert.equal((await floorPlanRequest(req(inputPath, 'GET'), env, g.transport)).status, 200);
  assert.equal(g.calls.filter((x) => x.init.method === 'PUT').length, 0);
});
test('identity change after upstream write refuses the receipt and retains submission uncertainty', async () => {
  const f = harness({ changedFinalActor: true }),
    r = await floorPlanRequest(req(), env, f.transport);
  assert.equal(r.status, 403);
  assert.equal((await r.json()).submissionUncertain, true);
});
test('attachment BFF binds route/body and its recovery uses GET upstream', async () => {
  const f = harness();
  assert.equal(
    (await floorPlanRequest(req(opPath, 'POST', JSON.stringify(attachment)), env, f.transport))
      .status,
    200,
  );
  assert.equal(
    (
      await floorPlanRequest(
        req(opPath + '/recover', 'POST', JSON.stringify(attachment)),
        env,
        f.transport,
      )
    ).status,
    200,
  );
  assert.deepEqual(
    f.calls.filter((x) => x.url.includes('/floor-plan-operations/')).map((x) => x.init.method),
    ['POST', 'GET'],
  );
  const g = harness();
  assert.equal(
    (
      await floorPlanRequest(
        req(opPath, 'POST', JSON.stringify({ ...attachment, operationId: id(999) })),
        env,
        g.transport,
      )
    ).status,
    400,
  );
  assert.equal(g.calls.length, 0);
});
test('concurrent BFF upload is refused while read-only recovery stays separate', async () => {
  let release, started;
  const ready = new Promise((r) => (started = r)),
    hold = new Promise((r) => (release = r));
  const f = harness({ hold }),
    original = f.transport;
  const transport = async (url, init) => {
    if (init.method === 'PUT') started();
    return original(url, init);
  };
  const first = floorPlanRequest(req(), env, transport);
  await ready;
  const g = harness();
  assert.equal((await floorPlanRequest(req(), env, g.transport)).status, 503);
  release();
  assert.equal((await first).status, 200);
  assert.equal((await floorPlanRequest(req(inputPath, 'GET'), env, g.transport)).status, 200);
});

test('browser adapter snapshots one binary upload, carries comparison stamps and keeps recovery GET-only', async () => {
  const { createFloorPlanClient } = await import('../dist/tests/lib/floor-plan-client.js');
  const seen = [];
  const client = createFloorPlanClient(
    { instanceId: id(9), tenantId: id(1), actorId: id(11), listingId: id(100), revision: 1 },
    async (url, init) => {
      seen.push({ url, init });
      return Response.json(prepared, { headers: { 'cache-control': 'no-store' } });
    },
  );
  const source = new Uint8Array([1, 2]);
  const pending = client.prepare(command, source);
  source[0] = 9;
  await pending;
  await client.recoverPreparation(command);
  assert.deepEqual([...seen[0].init.body], [1, 2]);
  assert.equal(seen[1].init.method, 'GET');
  assert.equal(seen[1].init.body, undefined);
  for (const { init } of seen) {
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).has('authorization'), false);
    assert.equal(new Headers(init.headers).get('x-reference-actor'), id(11));
  }
});
test('browser adapter marks malformed upload responses uncertain and never retries', async () => {
  const { createFloorPlanClient } = await import('../dist/tests/lib/floor-plan-client.js');
  let calls = 0;
  const client = createFloorPlanClient(
    { instanceId: id(9), tenantId: id(1), actorId: id(11), listingId: id(100), revision: 1 },
    async () => {
      calls++;
      return Response.json(
        { ...prepared, requestId: id(999) },
        { headers: { 'cache-control': 'no-store' } },
      );
    },
  );
  await assert.rejects(
    client.prepare(command, new Uint8Array([1])),
    (e) => e.submissionUncertain === true,
  );
  assert.equal(calls, 1);
  await assert.rejects(client.recoverPreparation(command), (e) => e.submissionUncertain === false);
  assert.equal(calls, 2);
  await assert.rejects(client.prepare(command, new Uint8Array(new SharedArrayBuffer(1))));
  assert.equal(calls, 2);
});
test(
  'actual Windows retained originals cross adapter/BFF/API and recover lost preparation and attachment replies without repeat writes',
  { skip: process.platform !== 'win32', timeout: 90000 },
  async (t) => {
    const { fixture } =
      await import('../../../packages/media/tests/floor-plan-preparation-fixture.mjs');
    const { readFile } = await import('node:fs/promises');
    const { createApiService } = await import('../../api/dist/service.js');
    const { asActor, T, AGENT } = await import('../../../database/tests/public-media-fixtures.mjs');
    const { createFloorPlanClient } = await import('../dist/tests/lib/floor-plan-client.js');
    const f = await fixture(t, true),
      coordinator = f.open();
    await f.db.exec(
      await readFile(
        new URL('../../../database/proposals/floor-plan-attachment.sql', import.meta.url),
        'utf8',
      ),
    );
    const target = (context, c) => ({
      companyId: context.tenantId,
      actorId: context.actorId,
      listingId: c.listingId,
      revision: c.revision,
      expectedVersion: Number(c.expectedVersion),
      requestId: c.requestId,
    });
    const api = createApiService({
      tenantId: T,
      privacyNoticeVersion: 'synthetic',
      floorPlanMode: 'synthetic-private-floor-plan-v1',
      verifyAuthorization: async () => ({ actorId: AGENT }),
      database: {
        transaction: (ctx, fn) =>
          asActor(f.db, ctx.tenantId, ctx.actorId, () =>
            fn({ query: (s, args) => f.db.query(s, args) }),
          ),
      },
      floorPlanPreparation: {
        prepare: (ctx, c, bytes) => coordinator.prepare(target(ctx, c), bytes),
        recover: (ctx, c) => coordinator.recover(target(ctx, c)),
      },
    });
    const state = { version: '2' },
      mock = harness(state),
      seen = [];
    const upstream = async (url, init) => {
      seen.push({ url: String(url), method: init.method });
      if (String(url).includes('/floor-plan-')) {
        const response = await api(new Request(url, init));
        if (init.method === 'POST' && response.status === 200) state.version = '3';
        return response;
      }
      return mock.transport(url, init);
    };
    const { floorPlanAttempt, floorPlanSession } =
      await import('../dist/tests/lib/floor-plan-session.js');
    const scope = {
      instanceId: id(9),
      tenantId: T,
      actorId: AGENT,
      listingId: f.target.listingId,
      revision: 1,
    };
    const storage = {
      values: new Map(),
      getItem(k) {
        return this.values.get(k) ?? null;
      },
      setItem(k, v) {
        this.values.set(k, v);
      },
      removeItem(k) {
        this.values.delete(k);
      },
    };
    const client = createFloorPlanClient(scope, async (url, init) => {
      const response = await floorPlanRequest(
        new Request('http://127.0.0.1:3132' + url, {
          ...init,
          headers: { ...init.headers, Host: '127.0.0.1:3132', Origin: 'http://127.0.0.1:3132' },
        }),
        env,
        upstream,
      );
      if (
        ['PUT', 'POST'].includes(init.method) &&
        !String(url).endsWith('/recover') &&
        response.status === 200
      ) {
        const value = await response.json();
        return Response.json(
          init.method === 'PUT'
            ? { ...value, requestId: id(999) }
            : { ...value, resultVersion: '99' },
          { headers: { 'cache-control': 'private, no-store, max-age=0' } },
        );
      }
      return response;
    });
    const original = { ...command, requestId: f.target.requestId };
    const first = floorPlanAttempt(storage, scope, client, original);
    await assert.rejects(first.send(f.source), (e) => e.submissionUncertain === true);
    assert.equal(first.status, 'uncertain');
    assert.throws(() => first.clear());
    const restored = floorPlanAttempt(
      storage,
      scope,
      client,
      floorPlanSession(storage, scope).load().command,
      true,
    );
    await restored.recover();
    assert.equal(restored.receipt.policy, 'synthetic-floor-plan-prepared-v1');
    const attach = restored.handoff({ ...attachment, requestId: original.requestId });
    await assert.rejects(attach.send(), (e) => e.submissionUncertain === true);
    assert.equal(attach.status, 'uncertain');
    const reloaded = floorPlanAttempt(
      storage,
      scope,
      client,
      floorPlanSession(storage, scope).load().command,
      true,
    );
    await reloaded.recover();
    assert.equal(reloaded.receipt.resultVersion, '3');
    reloaded.clear();
    assert.equal(storage.values.size, 0);
    assert.equal(seen.filter((c) => c.method === 'PUT').length, 1);
    assert.equal(seen.filter((c) => c.method === 'POST').length, 1);
    for (const k of ['register', 'source', 'claim', 'native', 'seal']) assert.equal(f.calls[k], 1);
  },
);
