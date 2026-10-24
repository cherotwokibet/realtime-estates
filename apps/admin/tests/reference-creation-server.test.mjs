import test from 'node:test';
import assert from 'node:assert/strict';
import {
  id,
  catalogue,
  command,
  receipt,
} from '../../../packages/api-client/tests/fixtures/reference-creation.mjs';
import { referenceCreationRequest as handle } from '../dist/tests/lib/reference-creation-server.js';
import { createReferenceCreationClient } from '../dist/tests/lib/reference-creation-client.js';
import {
  POST,
  dynamic,
} from '../dist/tests/app/api/staff/listings/[id]/reference-creation-operations/[operationId]/route.js';
import { POST as recoverPOST } from '../dist/tests/app/api/staff/listings/[id]/reference-creation-operations/[operationId]/recover/route.js';
const scope = { instanceId: id(9), tenantId: id(1), actorId: id(10), listingId: id(100) };
const base = `/api/staff/listings/${scope.listingId}/reference-creation-operations/${id(1000)}`;
const identity = {
  policy: 'synthetic-reference-session-v1',
  tenantId: scope.tenantId,
  actorId: scope.actorId,
};
function request(
  path = base,
  { method = 'POST', body = JSON.stringify(command()), headers = {}, signal } = {},
) {
  return new Request('http://127.0.0.1:3001' + path, {
    method,
    signal,
    ...(method === 'POST' ? { body } : {}),
    headers: {
      host: '127.0.0.1:3001',
      origin: 'http://127.0.0.1:3001',
      'content-type': 'application/json',
      'x-preview-instance': scope.instanceId,
      'x-reference-actor': scope.actorId,
      'x-reference-tenant': scope.tenantId,
      ...headers,
    },
  });
}
test('creation BFF is default-closed, fixes current authority and recovers original by GET only', async (t) => {
  const env = { ...process.env },
    oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
    for (const k of Object.keys(process.env)) if (!Object.hasOwn(env, k)) delete process.env[k];
    Object.assign(process.env, env);
  });
  Object.assign(process.env, {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_REFERENCE: 'synthetic-reference-draft-v1',
    STAFF_PREVIEW_REFERENCE_CREATION: 'synthetic-reference-creation-v1',
    STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
    STAFF_PREVIEW_TOKEN: 'a.b.c',
    STAFF_PREVIEW_INSTANCE: scope.instanceId,
  });
  let calls = [],
    actor = identity,
    cat = catalogue(),
    out = receipt(),
    fault = null;
  const reset = () => {
    calls = [];
    actor = identity;
    cat = catalogue();
    out = receipt();
    fault = null;
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/reference-session')) return Response.json(actor);
      if (url.includes('/reference-catalogues/')) return Response.json(cat);
      if (fault === 'lost') throw Error('lost after dispatch');
      if (fault === 'refused')
        return Response.json(
          { error: { code: 'CONFLICT', message: 'stale' }, requestId: id(9) },
          { status: 409 },
        );
      return Response.json(out);
    };
  };
  await t.test('explicit flag required before any upstream call', async () => {
    reset();
    delete process.env.STAFF_PREVIEW_REFERENCE_CREATION;
    assert.equal((await handle(request())).status, 403);
    assert.equal(calls.length, 0);
    process.env.STAFF_PREVIEW_REFERENCE_CREATION = 'synthetic-reference-creation-v1';
  });
  await t.test('one exact write and original body-free read with server bearer only', async () => {
    reset();
    assert.equal(dynamic, 'force-dynamic');
    assert.equal(POST, handle);
    assert.equal(recoverPOST, handle);
    const r = await POST(request());
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), receipt());
    assert.match(r.headers.get('cache-control'), /private, no-store/);
    assert.deepEqual(
      calls.map((c) => c.init.method),
      ['GET', 'GET', 'POST'],
    );
    assert.deepEqual(JSON.parse(calls[2].init.body), command());
    for (const c of calls) assert.equal(c.init.headers.Authorization, 'Bearer a.b.c');
    reset();
    const recovered = await recoverPOST(request(base + '/recover'));
    assert.equal(recovered.status, 200);
    assert.deepEqual(await recovered.json(), receipt());
    assert.deepEqual(
      calls.map((c) => c.init.method),
      ['GET', 'GET', 'GET'],
    );
    assert.equal(calls[2].init.body, undefined);
    assert.ok(calls[2].url.endsWith('/reference-creation-operations/' + id(1000)));
  });
  await t.test('route/method/authority/framing failures cannot dispatch a write', async () => {
    for (const [path, opts] of [
      [base, { method: 'GET' }],
      [base + '?x=1', {}],
      [base.replace(id(100), id(101)), {}],
      [base, { headers: { 'x-role': 'admin' } }],
      [base, { headers: { authorization: 'Bearer caller' } }],
      [base, { headers: { origin: 'http://evil.test' } }],
      [base, { body: JSON.stringify(command()).replace('"slug":', '"slug":"other","slug":') }],
      [base, { body: 'x'.repeat(131073) }],
    ]) {
      reset();
      assert.notEqual((await handle(request(path, opts))).status, 200);
      assert.equal(calls.filter((c) => c.init.method === 'POST').length, 0);
    }
  });
  await t.test('stale actor/company scope fails before catalogue or write', async () => {
    for (const patch of [{ actorId: id(11) }, { tenantId: id(2) }]) {
      reset();
      actor = { ...identity, ...patch };
      const r = await handle(request());
      assert.equal(r.status, 409);
      assert.equal((await r.json()).submissionUncertain, false);
      assert.equal(calls.length, 1);
    }
  });
  await t.test(
    'lost or altered write remains uncertain; failed recovery cannot become a write',
    async () => {
      for (const kind of ['lost', 'actor']) {
        reset();
        if (kind === 'lost') fault = 'lost';
        else out = receipt(command(), catalogue(), id(11));
        const r = await handle(request());
        assert.notEqual(r.status, 200);
        assert.equal((await r.json()).submissionUncertain, true);
        assert.equal(calls.filter((c) => c.init.method === 'POST').length, 1);
        calls = [];
        const recovered = await handle(request(base + '/recover'));
        assert.notEqual(recovered.status, 200);
        assert.equal((await recovered.json()).submissionUncertain, false);
        assert.equal(calls.filter((c) => c.init.method === 'POST').length, 0);
      }
      reset();
      fault = 'refused';
      const r = await handle(request());
      assert.equal(r.status, 409);
      assert.equal((await r.json()).submissionUncertain, false);
    },
  );
  await t.test(
    'valid Unicode composite above128KiB survives SDK and BFF without widening request bound',
    async () => {
      reset();
      cat = catalogue('1', true);
      const c = command(100, 1000, cat, true);
      out = receipt(c, cat);
      assert.ok(Buffer.byteLength(JSON.stringify(c)) <= 131072);
      assert.ok(Buffer.byteLength(JSON.stringify(out)) > 131072);
      const r = await handle(request(base, { body: JSON.stringify(c) }));
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), out);
    },
  );
});
test('creation browser adapter sends fixed same-origin requests without bearer and carries original recovery only in body', async () => {
  const calls = [],
    input = { ...scope },
    c = createReferenceCreationClient(input, async (url, init) => {
      calls.push({ url, init });
      return Response.json(url.includes('reference-catalogues') ? catalogue() : receipt());
    });
  input.actorId = id(11);
  assert.deepEqual(await c.catalogue('1'), catalogue());
  assert.deepEqual(await c.create(command(), catalogue(), scope.actorId), receipt());
  assert.deepEqual(await c.recover(command(), catalogue(), scope.actorId), receipt());
  assert.equal(calls[1].url, base);
  assert.equal(calls[2].url, base + '/recover');
  for (const call of calls) {
    assert.equal(call.init.credentials, 'omit');
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.cache, 'no-store');
    assert.equal(call.init.headers.Authorization, undefined);
  }
  assert.deepEqual(JSON.parse(calls[2].init.body), command());
  await assert.rejects(() => c.create(command(), catalogue(), id(11)));
  assert.equal(calls.length, 3);
  let reads = 0;
  const hostile = { ...scope };
  Object.defineProperty(hostile, 'actorId', {
    enumerable: true,
    get() {
      reads++;
      return scope.actorId;
    },
  });
  assert.throws(() => createReferenceCreationClient(hostile));
  assert.equal(reads, 0);
});
test('browser parses valid large composite but cancels oversized success and oversized error streams', async () => {
  const cat = catalogue('1', true),
    cmd = command(100, 1000, cat, true),
    out = receipt(cmd, cat);
  assert.deepEqual(
    await createReferenceCreationClient(scope, async () => Response.json(out)).create(
      cmd,
      cat,
      scope.actorId,
    ),
    out,
  );
  for (const [status, size] of [
    [200, 262273],
    [502, 131073],
  ]) {
    let cancelled = 0;
    const c = createReferenceCreationClient(
      scope,
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(size));
            },
            cancel() {
              cancelled++;
            },
          }),
          { status, headers: { 'content-type': 'application/json' } },
        ),
    );
    await assert.rejects(
      () => c.create(command(), catalogue(), scope.actorId),
      (e) => e.submissionUncertain === true,
    );
    assert.equal(cancelled, 1);
  }
});
test('browser uncertainty, strict wire failures and cancellation preserve one-write/no-auto-retry behavior', async () => {
  for (const transport of [
    async () => {
      throw Error('lost');
    },
    async () => Response.json(receipt(command(), catalogue(), id(11))),
    async () => new Response('{"x":1,"x":2}', { headers: { 'content-type': 'application/json' } }),
    async () =>
      new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }),
  ]) {
    let calls = 0;
    const c = createReferenceCreationClient(scope, (...args) => {
      calls++;
      return transport(...args);
    });
    await assert.rejects(
      () => c.create(command(), catalogue(), scope.actorId),
      (e) => e.submissionUncertain === true,
    );
    assert.equal(calls, 1);
    await assert.rejects(
      () => c.recover(command(), catalogue(), scope.actorId),
      (e) => e.submissionUncertain === false,
    );
    assert.equal(calls, 2);
  }
  const abort = new AbortController(),
    stalled = createReferenceCreationClient(scope, () => new Promise(() => {}));
  const pending = stalled.create(command(), catalogue(), scope.actorId, abort.signal);
  abort.abort();
  await assert.rejects(pending, (e) => e.submissionUncertain === true);
  let calls = 0;
  await assert.rejects(() =>
    createReferenceCreationClient(scope, async () => {
      calls++;
      return Response.json(receipt());
    }).create(command(), catalogue(), scope.actorId, abort.signal),
  );
  assert.equal(calls, 0);
});
