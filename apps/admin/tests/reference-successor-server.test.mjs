import test from 'node:test';
import assert from 'node:assert/strict';
import {
  id,
  catalogue,
  command,
  receipt,
} from '../../../packages/api-client/tests/fixtures/reference-successor.mjs';
import { referenceSuccessorRequest as handle } from '../dist/tests/lib/reference-successor-server.js';
import { createReferenceSuccessorClient } from '../dist/tests/lib/reference-successor-client.js';
import {
  referenceSuccessorSession,
  prepareReferenceSuccessorAttempt,
  restoreReferenceSuccessorAttempt,
} from '../dist/tests/lib/reference-successor-workspace.js';
import {
  POST,
  dynamic,
} from '../dist/tests/app/api/staff/listings/[id]/reference-successor-operations/[operationId]/route.js';
import { POST as recoverPOST } from '../dist/tests/app/api/staff/listings/[id]/reference-successor-operations/[operationId]/recover/route.js';
const scope = { instanceId: id(9), tenantId: id(1), actorId: id(10), listingId: id(100) };
const base = `/api/staff/listings/${scope.listingId}/reference-successor-operations/${id(1000)}`;
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
test('successor BFF is default-closed, fixes current authority and recovers original by GET only', async (t) => {
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
    STAFF_PREVIEW_REFERENCE_SUCCESSOR: 'synthetic-reference-successor-v1',
    STAFF_PREVIEW_REFERENCE_MODERATION: 'synthetic-reference-transition-v1',
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
    delete process.env.STAFF_PREVIEW_REFERENCE_SUCCESSOR;
    assert.equal((await handle(request())).status, 403);
    assert.equal(calls.length, 0);
    process.env.STAFF_PREVIEW_REFERENCE_SUCCESSOR = 'synthetic-reference-successor-v1';
  });
  await t.test(
    'production, orphan flags and changed loopback scope are rejected before upstream I/O',
    async () => {
      for (const patch of [
        { NODE_ENV: 'production' },
        { STAFF_PREVIEW_REFERENCE_SUCCESSOR: 'live' },
        { STAFF_PREVIEW_REFERENCE_MODERATION: undefined },
        { STAFF_PREVIEW_REFERENCE_MODERATION: 'live' },
        { STAFF_PREVIEW_REFERENCE: undefined },
      ]) {
        reset();
        const before = { ...process.env };
        for (const [key, value] of Object.entries(patch))
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        try {
          assert.equal((await handle(request())).status, 403);
          assert.equal(calls.length, 0);
        } finally {
          for (const key of Object.keys(patch))
            if (before[key] === undefined) delete process.env[key];
            else process.env[key] = before[key];
        }
      }
      for (const headers of [
        { 'x-preview-instance': id(8) },
        { host: 'localhost:3001' },
        { authorization: 'Bearer caller' },
        { 'sec-fetch-site': 'cross-site' },
      ]) {
        reset();
        assert.equal((await handle(request(base, { headers }))).status, 403);
        assert.equal(calls.length, 0);
      }
    },
  );
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
    assert.ok(calls[2].url.endsWith('/reference-successor-operations/' + id(1000)));
  });
  await t.test('route/method/authority/framing failures cannot dispatch a write', async () => {
    for (const [path, opts] of [
      [base, { method: 'GET' }],
      [base + '?x=1', {}],
      [base.replace(id(100), id(101)), {}],
      [base, { headers: { 'x-role': 'admin' } }],
      [base, { headers: { cookie: 'session=caller' } }],
      [base, { headers: { 'content-encoding': 'gzip' } }],
      [base, { headers: { 'if-match': '2' } }],
      [base, { headers: { authorization: 'Bearer caller' } }],
      [base, { headers: { origin: 'http://evil.test' } }],
      [
        base,
        {
          body: JSON.stringify(command()).replace(
            '"expectedListingVersion":',
            '"expectedListingVersion":"2","expectedListingVersion":',
          ),
        },
      ],
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
    'invalid predecessor, catalogue substitution and aborts cannot become a second mutation',
    async () => {
      for (const patch of [
        { actorId: id(10) },
        { predecessor: { revision: 1, version: '4', state: 'draft' } },
        { expectedListingVersion: '9007199254740991' },
      ]) {
        reset();
        const r = await handle(request(base, { body: JSON.stringify({ ...command(), ...patch }) }));
        assert.notEqual(r.status, 200);
        assert.equal((await r.json()).submissionUncertain, false);
        assert.equal(calls.filter((c) => c.init.method === 'POST').length, 0);
      }
      reset();
      cat = { ...cat, version: '2' };
      assert.notEqual((await handle(request())).status, 200);
      assert.equal(calls.filter((c) => c.init.method === 'POST').length, 0);
      for (const recovering of [false, true]) {
        reset();
        const controller = new AbortController(),
          previous = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
          const r = await previous(url, init);
          if (url.includes('/reference-successor-operations/')) controller.abort();
          return r;
        };
        const response = await handle(
          request(base + (recovering ? '/recover' : ''), { signal: controller.signal }),
        );
        assert.equal(response.status, 499);
        assert.equal((await response.json()).submissionUncertain, !recovering);
        assert.equal(calls.filter((c) => c.init.method === 'POST').length, recovering ? 0 : 1);
      }
      reset();
      const stopped = new AbortController();
      stopped.abort();
      assert.equal((await handle(request(base, { signal: stopped.signal }))).status, 499);
      assert.equal(calls.length, 0);
    },
  );
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
  await t.test(
    'selected local catalogue and retained controller recover an uncertain BFF reply through explicit original GET only',
    async () => {
      reset();
      cat.amenities.push({
        id: id(999),
        code: 'unselected-land',
        label: 'Unselected land',
        propertyTypes: ['land'],
      });
      const map = new Map(),
        store = {
          getItem: (k) => map.get(k) ?? null,
          setItem: (k, v) => map.set(k, v),
          removeItem: (k) => map.delete(k),
        };
      const session = referenceSuccessorSession(store, scope),
        browserCalls = [];
      let corrupt = true;
      const browser = createReferenceSuccessorClient(scope, async (path, init) => {
        browserCalls.push({ path, init });
        const response = await handle(
          new Request('http://127.0.0.1:3001' + path, {
            ...init,
            headers: { ...init.headers, host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3001' },
          }),
        );
        if (corrupt && response.ok && !path.endsWith('/recover')) {
          corrupt = false;
          const data = await response.json();
          data.referenceDraft.revisionVersion = '4';
          return Response.json(data);
        }
        return response;
      });
      const original = prepareReferenceSuccessorAttempt(browser, session, command(), cat);
      assert.equal(original.catalogue.amenities.length, 1);
      await assert.rejects(
        () => original.submit(),
        (e) => e.submissionUncertain,
      );
      assert.equal(original.status, 'uncertain');
      assert.equal(original.canLeave, false);
      const before = calls.length,
        restored = await restoreReferenceSuccessorAttempt(browser, session);
      assert.equal(calls.length, before);
      assert.equal(browserCalls.length, 1);
      restored.verifyReload();
      assert.deepEqual(await restored.recoverOriginal(), receipt());
      assert.equal(browserCalls.length, 2);
      assert.equal(browserCalls[1].path, base + '/recover');
      assert.deepEqual(JSON.parse(browserCalls[1].init.body), command());
      assert.equal(calls.filter((c) => c.init.method === 'POST').length, 1);
      assert.deepEqual(
        calls.slice(before).map((c) => c.init.method),
        ['GET', 'GET', 'GET'],
      );
      assert.equal(calls.at(-1).init.body, undefined);
      assert.deepEqual(restored.freshDraftTarget, { listingId: scope.listingId, revision: 2 });
      restored.discard();
      assert.equal(map.size, 0);
    },
  );
});
test('successor browser adapter sends fixed same-origin requests without bearer and carries original recovery only in body', async () => {
  const calls = [],
    input = { ...scope },
    c = createReferenceSuccessorClient(input, async (url, init) => {
      calls.push({ url, init });
      return Response.json(url.includes('reference-catalogues') ? catalogue() : receipt());
    });
  input.actorId = id(11);
  assert.deepEqual(await c.create(command(), catalogue(), scope.actorId), receipt());
  assert.deepEqual(await c.recover(command(), catalogue(), scope.actorId), receipt());
  assert.equal(calls[0].url, base);
  assert.equal(calls[1].url, base + '/recover');
  for (const call of calls) {
    assert.equal(call.init.credentials, 'omit');
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.cache, 'no-store');
    assert.equal(call.init.headers.Authorization, undefined);
  }
  assert.deepEqual(JSON.parse(calls[1].init.body), command());
  await assert.rejects(() => c.create(command(), catalogue(), id(11)));
  assert.equal(calls.length, 2);
  let reads = 0;
  const hostile = { ...scope };
  Object.defineProperty(hostile, 'actorId', {
    enumerable: true,
    get() {
      reads++;
      return scope.actorId;
    },
  });
  assert.throws(() => createReferenceSuccessorClient(hostile));
  assert.equal(reads, 0);
});
test('browser parses valid large composite but cancels oversized success and oversized error streams', async () => {
  const cat = catalogue('1', true),
    cmd = command(100, 1000, cat, true),
    out = receipt(cmd, cat);
  assert.deepEqual(
    await createReferenceSuccessorClient(scope, async () => Response.json(out)).create(
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
    const c = createReferenceSuccessorClient(
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
    const c = createReferenceSuccessorClient(scope, (...args) => {
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
    stalled = createReferenceSuccessorClient(scope, () => new Promise(() => {}));
  const pending = stalled.create(command(), catalogue(), scope.actorId, abort.signal);
  abort.abort();
  await assert.rejects(pending, (e) => e.submissionUncertain === true);
  let calls = 0;
  await assert.rejects(() =>
    createReferenceSuccessorClient(scope, async () => {
      calls++;
      return Response.json(receipt());
    }).create(command(), catalogue(), scope.actorId, abort.signal),
  );
  assert.equal(calls, 0);
});
