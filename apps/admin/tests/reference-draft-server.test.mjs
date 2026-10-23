import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStaffDraftContentV2, snapshotListingReferenceAttributes } from '@realtor/domain';
import { referenceDraftRequest as handle } from '../dist/tests/lib/reference-draft-server.js';
import { readReferenceJson } from '../dist/tests/lib/reference-draft-wire.js';
import { GET as sessionGET, dynamic } from '../dist/tests/app/api/staff/reference-session/route.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  instance = id(9),
  session = { policy: 'synthetic-reference-session-v1', tenantId: id(1), actorId: id(10) },
  cat = {
    policy: 'synthetic-reference-catalogue-v1',
    version: '1',
    country: 'KE',
    locations: [],
    amenities: [],
  };
const command = {
  policy: 'synthetic-reference-draft-v1',
  listingId: id(100),
  operationId: id(300),
  revision: 1,
  expectedVersion: '2',
  content: normalizeStaffDraftContentV2({
    title: 'Synthetic BFF draft',
    location: { county: null, town: null, area: null },
    pricing: { declaration: 'not_declared', charges: [] },
  }),
  selection: {
    catalogueVersion: '1',
    location: { countyId: null, localityId: null, neighbourhoodId: null },
    amenityIds: [],
  },
};
const receipt = {
  ...command,
  actorId: id(10),
  revisionVersion: '3',
  attributes: snapshotListingReferenceAttributes(command.selection, cat, null),
};
const path = `/api/staff/listings/${id(100)}/reference-draft-operations/${id(300)}`;
function req(
  route = path,
  {
    method = route.includes('reference-draft-operations') ? 'POST' : 'GET',
    body = JSON.stringify(command),
    headers = {},
    signal,
  } = {},
) {
  return new Request('http://127.0.0.1:3001' + route, {
    method,
    signal,
    ...(method === 'POST'
      ? { body, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) }
      : {}),
    headers: {
      host: '127.0.0.1:3001',
      'x-preview-instance': instance,
      'x-reference-actor': id(10),
      'x-reference-tenant': id(1),
      ...(method === 'POST'
        ? { origin: 'http://127.0.0.1:3001', 'content-type': 'application/json' }
        : {}),
      ...headers,
    },
  });
}
test('synthetic reference BFF current scope, strict commands and explicit read recovery', async (t) => {
  const oldEnv = { ...process.env },
    oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
    for (const k of Object.keys(process.env)) if (!Object.hasOwn(oldEnv, k)) delete process.env[k];
    Object.assign(process.env, oldEnv);
  });
  Object.assign(process.env, {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_REFERENCE: 'synthetic-reference-draft-v1',
    STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
    STAFF_PREVIEW_TOKEN: 'a.b.c',
    STAFF_PREVIEW_INSTANCE: instance,
  });
  let calls = [],
    identity = session,
    deny = false,
    lose = false,
    conflict = false,
    badReceipt = false;
  const reset = () => {
    calls = [];
    identity = session;
    deny = false;
    lose = false;
    conflict = false;
    badReceipt = false;
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      if (deny)
        return Response.json(
          { error: { code: 'FORBIDDEN', message: 'Unavailable' }, requestId: instance },
          { status: 403 },
        );
      if (url.endsWith('/reference-session')) return Response.json(identity);
      if (url.includes('/reference-catalogues/')) return Response.json(cat);
      if (conflict)
        return Response.json(
          { error: { code: 'CONFLICT', message: 'Stale draft' }, requestId: instance },
          { status: 409 },
        );
      if (lose) throw Error('Lost after dispatch');
      return Response.json(badReceipt ? { ...receipt, actorId: id(11) } : receipt);
    };
  };
  await t.test(
    'fresh identity is server-authorized, private and credential-free in response',
    async () => {
      reset();
      assert.equal(dynamic, 'force-dynamic');
      const r = await sessionGET(req('/api/staff/reference-session'));
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { ...session, instanceId: instance });
      assert.match(r.headers.get('cache-control'), /private, no-store/);
      assert.equal(calls[0].init.headers.Authorization, 'Bearer a.b.c');
    },
  );
  await t.test(
    'one combined POST and explicit recovery use original historical catalogue and one body-free upstream GET',
    async () => {
      reset();
      const r = await handle(req());
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), receipt);
      assert.deepEqual(
        calls.map((c) => c.init.method),
        ['GET', 'GET', 'POST'],
      );
      assert.ok(calls[1].url.endsWith('/reference-catalogues/1'));
      assert.deepEqual(JSON.parse(calls[2].init.body), command);
      assert.equal(calls[2].init.headers['X-Reference-Actor'], undefined);
      reset();
      assert.equal((await handle(req(path + '/recover'))).status, 200);
      assert.deepEqual(
        calls.map((c) => c.init.method),
        ['GET', 'GET', 'GET'],
      );
      assert.equal(calls[2].init.body, undefined);
    },
  );
  await t.test(
    'stale actor or company is conflict before any command dispatch; revocation denies',
    async () => {
      for (const current of [
        { ...session, actorId: id(11) },
        { ...session, tenantId: id(2) },
      ]) {
        reset();
        identity = current;
        assert.equal((await handle(req())).status, 409);
        assert.equal(calls.length, 1);
      }
      reset();
      deny = true;
      assert.equal((await handle(req())).status, 403);
      assert.equal(calls.length, 1);
    },
  );
  await t.test(
    'default-off, production, cross-origin, browser authority and stale instance never dispatch',
    async () => {
      for (const h of [
        { origin: 'https://other.invalid' },
        { authorization: 'Bearer other' },
        { 'x-preview-instance': id(99) },
        { cookie: 'secret' },
        { 'x-actor-id': id(10) },
        { 'content-encoding': 'gzip' },
        { 'idempotency-key': id(300) },
      ]) {
        reset();
        assert.ok((await handle(req(path, { headers: h }))).status >= 400);
        assert.equal(calls.length, 0);
      }
      for (const [key, value] of [
        ['STAFF_PREVIEW_REFERENCE', 'off'],
        ['NODE_ENV', 'production'],
      ]) {
        const previous = process.env[key];
        process.env[key] = value;
        reset();
        assert.equal((await handle(req())).status, 403);
        assert.equal(calls.length, 0);
        process.env[key] = previous;
      }
    },
  );
  await t.test(
    'duplicate, fractional, oversized, changed route and unexpected query do not write',
    async () => {
      for (const body of [
        JSON.stringify(command).replace('"revision":1', '"revision":1,"revision":1'),
        JSON.stringify(command).replace('"revision":1', '"revision":1.0'),
        ' '.repeat(131073),
        JSON.stringify({ ...command, listingId: id(101) }),
        JSON.stringify({ ...command, actorId: id(10) }),
      ]) {
        reset();
        assert.equal((await handle(req(path, { body }))).status, 400);
        assert.ok(calls.every((c) => c.init.method === 'GET'));
      }
      reset();
      assert.equal((await handle(req(path + '?x=1'))).status, 400);
      assert.equal(calls.length, 0);
    },
  );
  await t.test(
    'post-dispatch loss and malformed receipt remain uncertain, recovery errors never write',
    async () => {
      for (const mode of ['lose', 'bad']) {
        reset();
        lose = mode === 'lose';
        badReceipt = mode === 'bad';
        const r = await handle(req());
        assert.equal(r.status, 502);
        assert.equal((await r.json()).submissionUncertain, true);
        assert.equal(calls.filter((c) => c.init.method === 'POST').length, 1);
      }
      reset();
      deny = true;
      const r = await handle(req(path + '/recover'));
      assert.equal(r.status, 403);
      assert.equal((await r.json()).submissionUncertain, false);
      assert.ok(calls.every((c) => c.init.method === 'GET'));
    },
  );
  await t.test('catalogue reads check fresh scope and exact historical version', async () => {
    reset();
    const r = await handle(req('/api/staff/reference-catalogues/1'));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), cat);
    reset();
    assert.equal((await handle(req('/api/staff/reference-catalogues/2'))).status, 502);
  });
  await t.test('aborted body cannot dispatch', async () => {
    reset();
    const c = new AbortController();
    c.abort();
    assert.equal((await handle(req(path, { signal: c.signal }))).status, 499);
    assert.equal(calls.length, 0);
  });
  await t.test(
    'definitive stale version is a known refusal without an uncertain replacement',
    async () => {
      reset();
      conflict = true;
      const r = await handle(req());
      assert.equal(r.status, 409);
      assert.equal((await r.json()).submissionUncertain, false);
      assert.equal(calls.filter((c) => c.init.method === 'POST').length, 1);
    },
  );
});
test('reference bounded wire reader rejects framing, duplicate fields, UTF8, empty and stalled streams', async () => {
  const signal = new AbortController().signal;
  for (const r of [
    new Response('{"a":1,"a":2}', { headers: { 'content-type': 'application/json' } }),
    new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }),
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '3' } }),
    new Response('{}', {
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    }),
  ])
    await assert.rejects(readReferenceJson(r, 10000, signal));
  await assert.rejects(
    readReferenceJson(
      new Response('12345', { headers: { 'content-type': 'application/json' } }),
      4,
      signal,
    ),
  );
  const empty = new Response(
    new ReadableStream({
      pull(c) {
        c.enqueue(new Uint8Array());
      },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
  await assert.rejects(readReferenceJson(empty, 100, signal));
  const abort = new AbortController(),
    stalled = new Response(
      new ReadableStream({
        pull() {
          return new Promise(() => {});
        },
        cancel() {
          return new Promise(() => {});
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  const pending = readReferenceJson(stalled, 100, abort.signal);
  setTimeout(() => abort.abort(), 5);
  await assert.rejects(pending);
});
import { createReferenceDraftClient } from '../dist/tests/lib/reference-draft-client.js';
test('browser reference adapter sends no bearer and connects original recovery to a read-only BFF action', async () => {
  const scope = { instanceId: instance, tenantId: id(1), actorId: id(10), listingId: id(100) },
    calls = [];
  const client = createReferenceDraftClient(scope, async (url, init) => {
    calls.push({ url, init });
    return Response.json(url.includes('reference-catalogues') ? cat : receipt);
  });
  scope.actorId = id(11);
  assert.deepEqual(await client.catalogue('1'), cat);
  assert.deepEqual(await client.create(command, cat, id(10)), receipt);
  assert.deepEqual(await client.recover(command, cat, id(10)), receipt);
  assert.ok(calls[2].url.endsWith('/recover'));
  assert.equal(calls[1].init.credentials, 'omit');
  assert.equal(calls[1].init.redirect, 'error');
  assert.equal(calls[1].init.headers.Authorization, undefined);
  assert.equal(calls[1].init.headers['X-Reference-Actor'], id(10));
  assert.deepEqual(JSON.parse(calls[1].init.body), command);
  await assert.rejects(client.create(command, cat, id(11)));
  assert.equal(calls.length, 3);
  let reads = 0;
  const malicious = { ...scope };
  Object.defineProperty(malicious, 'actorId', {
    enumerable: true,
    get() {
      reads++;
      return id(10);
    },
  });
  assert.throws(() => createReferenceDraftClient(malicious));
  assert.equal(reads, 0);
});
test('browser write uncertainty includes lost/altered responses and late abort; known stale refusal stays definitive', async () => {
  const scope = { instanceId: instance, tenantId: id(1), actorId: id(10), listingId: id(100) };
  for (const transport of [
    async () => {
      throw Error('lost');
    },
    async () => Response.json({ ...receipt, actorId: id(11) }),
    async () => new Response('{"x":1,"x":2}', { headers: { 'content-type': 'application/json' } }),
  ])
    await assert.rejects(
      createReferenceDraftClient(scope, transport).create(command, cat, id(10)),
      (e) => e.submissionUncertain === true,
    );
  const known = createReferenceDraftClient(scope, async () =>
    Response.json({ error: { code: 'CONFLICT' }, submissionUncertain: false }, { status: 409 }),
  );
  await assert.rejects(
    known.create(command, cat, id(10)),
    (e) => e.status === 409 && !e.submissionUncertain,
  );
  const abort = new AbortController(),
    stalled = createReferenceDraftClient(scope, () => new Promise(() => {}));
  const pending = stalled.create(command, cat, id(10), abort.signal);
  setTimeout(() => abort.abort(), 5);
  await assert.rejects(pending, (e) => e.submissionUncertain === true);
  const pre = new AbortController();
  pre.abort();
  let calls = 0;
  await assert.rejects(
    createReferenceDraftClient(scope, async () => {
      calls++;
      return Response.json(receipt);
    }).create(command, cat, id(10), pre.signal),
  );
  assert.equal(calls, 0);
});
