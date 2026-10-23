import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceModerationRequest as handle } from '../dist/tests/lib/reference-moderation-server.js';
import { createReferenceModerationClient } from '../dist/tests/lib/reference-moderation-client.js';
import {
  id,
  scope,
  catalogue,
  review,
  command,
  receipt,
  path,
  readPath,
  env,
  request,
} from '../test-helpers/reference-moderation-fixture.mjs';
test('unmounted synthetic moderation BFF scopes current authority, historical reads and GET-only recovery', async (t) => {
  const oldEnv = { ...process.env },
    oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
    for (const k of Object.keys(process.env)) if (!Object.hasOwn(oldEnv, k)) delete process.env[k];
    Object.assign(process.env, oldEnv);
  });
  Object.assign(process.env, env);
  let calls = [],
    actor = id(10),
    mode = 'valid';
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.headers.Authorization, 'Bearer a.b.c');
    if (url.endsWith('/reference-session'))
      return Response.json({
        policy: 'synthetic-reference-session-v1',
        tenantId: id(1),
        actorId: actor,
      });
    if (url.includes('/reference-catalogues/'))
      return Response.json({ ...catalogue(), version: url.endsWith('/2') ? '2' : '1' });
    if (url.includes('/reference-revisions/')) return Response.json(review());
    if (mode === 'conflict')
      return Response.json(
        { error: { code: 'CONFLICT', message: 'Unavailable' }, requestId: id(9) },
        { status: 409, headers: { 'x-request-id': id(9) } },
      );
    if (mode === 'lost') throw Error('Lost after dispatch');
    if (mode === 'bad') return Response.json({ ...receipt(), actorId: id(11) });
    return Response.json(receipt());
  };
  await t.test(
    'mode, host, identity headers, authority overrides and query framing refuse safely',
    async () => {
      delete process.env.STAFF_PREVIEW_REFERENCE_MODERATION;
      assert.equal((await handle(request())).status, 403);
      assert.equal(calls.length, 0);
      Object.assign(process.env, env);
      for (const headers of [
        { authorization: 'Bearer injected' },
        { host: 'evil.invalid' },
        { cookie: 'x=y' },
        { 'x-role': 'admin' },
        { 'if-match': '3' },
      ])
        assert.ok([400, 403].includes((await handle(request(path, { headers }))).status));
      assert.equal((await handle(request(path + '?x=1'))).status, 400);
      assert.equal(
        (await handle(request(path, { headers: { 'x-reference-actor': id(13) } }))).status,
        409,
      );
      actor = id(13);
      const r = await handle(request());
      assert.equal(r.status, 409);
      assert.equal((await r.json()).submissionUncertain, false);
      actor = id(10);
      assert.equal(calls.filter((c) => c.url.includes('reference-transition')).length, 0);
      calls = [];
    },
  );
  await t.test(
    'review uses exact historical catalogue and rejects a hint that mismatches the saved attributes',
    async () => {
      const r = await handle(request(readPath));
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), review());
      assert.match(r.headers.get('cache-control'), /private, no-store/);
      assert.match(calls[1].url, /reference-catalogues\/1$/);
      assert.match(calls[2].url, /reference-revisions\/1\/3$/);
      assert.ok(calls.every((c) => c.init.method === 'GET'));
      assert.equal((await handle(request(readPath.slice(0, -1) + '2'))).status, 502);
      calls = [];
    },
  );
  await t.test(
    'one transition POST and browser recovery POST carry no private facts upstream in URLs',
    async () => {
      const r = await handle(request());
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), receipt());
      assert.equal(calls.filter((c) => c.init.method === 'POST').length, 1);
      calls = [];
      assert.equal((await handle(request(path + '/recover'))).status, 200);
      assert.ok(calls.every((c) => c.init.method === 'GET'));
      assert.ok(calls.every((c) => !c.url.includes('PRIVATE') && !c.url.includes('?')));
      calls = [];
    },
  );
  await t.test(
    'duplicate and decimal integer tokens, invalid UTF8 and declared length refuse before API reads',
    async () => {
      const json = JSON.stringify(command());
      for (const body of [
        json.replace('"position":0', '"position":0.0'),
        json.replace('"revision":1', '"revision":1,"revision":1'),
        new Uint8Array([0xff]),
      ])
        assert.equal((await handle(request(path, { body }))).status, 400);
      assert.equal(
        (await handle(request(path, { headers: { 'content-length': '1' } }))).status,
        400,
      );
      assert.equal(calls.length, 0);
    },
  );
  await t.test(
    'lost or malformed write remains uncertain; known conflict and GET recovery failure remain explicit',
    async () => {
      for (const m of ['lost', 'bad']) {
        mode = m;
        const r = await handle(request());
        assert.equal(r.status, 502);
        assert.equal((await r.json()).submissionUncertain, true);
        const recover = await handle(request(path + '/recover'));
        assert.equal(recover.status, 502);
        assert.equal((await recover.json()).submissionUncertain, false);
      }
      mode = 'conflict';
      const r = await handle(request());
      assert.equal(r.status, 409);
      assert.equal((await r.json()).submissionUncertain, false);
      mode = 'valid';
    },
  );
});
test('browser moderation adapter captures originals, uses no bearer and binds review and receipt scope', async () => {
  const c = structuredClone(command()),
    cat = catalogue(),
    calls = [],
    s = scope();
  const adapter = createReferenceModerationClient(s, async (url, init) => {
    calls.push({ url, init });
    c.review.content.privateAddress = 'Changed';
    cat.locations[0].label = 'Changed';
    return Response.json(receipt());
  });
  const out = await adapter.transition(c, cat);
  assert.deepEqual(out, receipt());
  assert.deepEqual(JSON.parse(calls[0].init.body), command());
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'error');
  await adapter.recover(command(), catalogue());
  assert.match(calls[1].url, /\/recover$/);
  assert.equal(calls[1].init.method, 'POST');
  const reader = createReferenceModerationClient(scope(), async (url, init) => {
    assert.equal(url, readPath);
    assert.equal(init.method, 'GET');
    return Response.json(review());
  });
  assert.deepEqual(await reader.read('review', '3', catalogue()), review());
  await assert.rejects(() => adapter.transition({ ...command(), revision: 2 }, catalogue()));
  const wrong = createReferenceModerationClient({ ...scope(), actorId: id(11) }, async () =>
    Response.json(receipt()),
  );
  await assert.rejects(
    () => wrong.transition(command(), catalogue()),
    (e) => e.submissionUncertain === true,
  );
});
test('browser malformed envelopes and byte/empty-frame limits keep failed writes uncertain', async () => {
  const bad = createReferenceModerationClient(scope(), async () =>
    Response.json(
      { error: { code: 'x', message: 'x' }, submissionUncertain: false, extra: true },
      { status: 403 },
    ),
  );
  await assert.rejects(
    () => bad.transition(command(), catalogue()),
    (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain,
  );
  const denied = createReferenceModerationClient(scope(), async () =>
    Response.json(
      { error: { code: 'x', message: 'x' }, submissionUncertain: false },
      { status: 403 },
    ),
  );
  await assert.rejects(
    () => denied.recover(command(), catalogue()),
    (e) => e.kind === 'HTTP' && e.status === 403 && !e.submissionUncertain,
  );
  for (const empty of [false, true]) {
    let cancelled = false;
    const adapter = createReferenceModerationClient(
      scope(),
      async () =>
        new Response(
          new ReadableStream({
            pull(c) {
              c.enqueue(empty ? new Uint8Array() : new Uint8Array(131073));
            },
            cancel() {
              cancelled = true;
              return new Promise(() => {});
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    await assert.rejects(
      () => adapter.transition(command(), catalogue()),
      (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain,
    );
    assert.equal(cancelled, true);
  }
});
test('browser abort before dispatch makes no request; late uncooperative response is cancelled after uncertain dispatch', async () => {
  let calls = 0,
    finish,
    cancelled = false;
  const ctrl = new AbortController();
  ctrl.abort();
  const adapter = createReferenceModerationClient(scope(), () => {
    calls++;
    return new Promise((resolve) => (finish = resolve));
  });
  await assert.rejects(
    () => adapter.transition(command(), catalogue(), ctrl.signal),
    (e) => e.kind === 'CANCELLED' && !e.submissionUncertain,
  );
  assert.equal(calls, 0);
  const after = new AbortController(),
    pending = adapter.transition(command(), catalogue(), after.signal);
  after.abort();
  await assert.rejects(
    () => pending,
    (e) => e.kind === 'CANCELLED' && e.submissionUncertain,
  );
  finish(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
          return new Promise(() => {});
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    ),
  );
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(cancelled, true);
  assert.equal(calls, 1);
});
