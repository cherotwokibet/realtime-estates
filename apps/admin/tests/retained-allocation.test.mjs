import test from 'node:test';
import assert from 'node:assert/strict';
import {
  id,
  command as rc,
  receipt as rr,
} from '../../../packages/api-client/tests/fixtures/reference-creation.mjs';
import {
  command as rs,
  receipt as sr,
} from '../../../packages/api-client/tests/fixtures/reference-successor.mjs';
import { retainedAllocationRequest } from '../dist/tests/lib/retained-allocation-server.js';
import { createListingCreationClient } from '../dist/tests/lib/listing-creation-client.js';
import { createListingSuccessorClient } from '../dist/tests/lib/listing-successor-client.js';
import { POST as creationPost } from '../dist/tests/app/api/staff/listings/[id]/retained-creation-operations/[operationId]/route.js';
import { GET as revisionGet } from '../dist/tests/app/api/staff/listings/[id]/retained-revision-operations/[operationId]/route.js';
const scope = { instanceId: id(9), tenantId: id(1), actorId: id(10) };
const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
  STAFF_PREVIEW_TOKEN: 'synthetic.server.token',
  STAFF_PREVIEW_INSTANCE: scope.instanceId,
};
const command = (kind) => {
  const { policy, selection, ...c } = kind === 'creation' ? rc() : rs();
  return c;
};
const receipt = (kind, c, actor = scope.actorId) =>
  kind === 'creation'
    ? rr({ ...rc(), ...c }, undefined, actor).creation
    : sr({ ...rs(), ...c }, undefined, actor).successor;
const path = (kind, c) =>
  `/api/staff/listings/${c.listingId}/retained-${kind}-operations/${c.operationId}`;
const body = (kind, c) =>
  kind === 'creation'
    ? { slug: c.slug, content: c.content }
    : {
        expectedListingVersion: c.expectedListingVersion,
        predecessor: c.predecessor,
        content: c.content,
      };
function req(kind, c, method = 'POST', headers = {}, suffix = '', raw) {
  return new Request('http://127.0.0.1:3001' + path(kind, c) + suffix, {
    method,
    headers: {
      host: '127.0.0.1:3001',
      'x-preview-instance': scope.instanceId,
      'x-allocation-tenant': scope.tenantId,
      'x-allocation-actor': scope.actorId,
      ...(method === 'GET'
        ? {}
        : { origin: 'http://127.0.0.1:3001', 'content-type': 'application/json' }),
      ...headers,
    },
    ...(method === 'GET' ? {} : { body: raw ?? JSON.stringify(body(kind, c)) }),
  });
}
async function fixture(work) {
  const prior = { ...process.env },
    oldFetch = globalThis.fetch;
  Object.assign(process.env, env);
  try {
    await work();
  } finally {
    globalThis.fetch = oldFetch;
    for (const k of Object.keys(process.env)) if (!(k in prior)) delete process.env[k];
    Object.assign(process.env, prior);
  }
}
const identity = {
  policy: 'current-staff-session-v2',
  tenantId: scope.tenantId,
  actorId: scope.actorId,
};
test('retained creation/revision routes recheck verified scope then dispatch only canonical ordinary operation with fixed bearer', () =>
  fixture(async () => {
    for (const kind of ['creation', 'revision']) {
      const c = command(kind),
        calls = [];
      globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return Response.json(url.endsWith('/session') ? identity : receipt(kind, c));
      };
      for (const method of ['POST', 'GET']) {
        const r = await retainedAllocationRequest(
          req(kind, c, method),
          { id: c.listingId, operationId: c.operationId },
          kind,
        );
        assert.equal(r.status, 200);
        assert.deepEqual(await r.json(), receipt(kind, c));
        assert.equal(r.headers.get('cache-control'), 'no-store');
      }
      assert.deepEqual(
        calls.map((x) => x.init.method),
        ['GET', 'POST', 'GET', 'GET'],
      );
      for (const call of calls) {
        assert.equal(
          new Headers(call.init.headers).get('authorization'),
          'Bearer synthetic.server.token',
        );
        assert.ok(!new Headers(call.init.headers).has('x-allocation-actor'));
        assert.equal(call.init.credentials, 'omit');
      }
      assert.equal(
        calls[1].url,
        `http://127.0.0.1:4101/v2/staff/listings/${c.listingId}/${kind === 'creation' ? 'creation' : 'revision'}-operations/${c.operationId}`,
      );
      assert.deepEqual(JSON.parse(calls[1].init.body), body(kind, c));
      assert.equal(calls[3].init.body, undefined);
    }
  }));
test('stale actor or tenant and denied current membership never forward allocation or recovery', () =>
  fixture(async () => {
    for (const kind of ['creation', 'revision'])
      for (const method of ['POST', 'GET'])
        for (const mode of ['actor', 'tenant', 'denied']) {
          const c = command(kind),
            calls = [];
          globalThis.fetch = async (url, init) => {
            calls.push({ url, init });
            return mode === 'denied'
              ? Response.json(
                  { error: { code: 'FORBIDDEN', message: 'safe', requestId: 'synthetic' } },
                  { status: 403 },
                )
              : Response.json({
                  ...identity,
                  ...(mode === 'actor' ? { actorId: id(11) } : { tenantId: id(2) }),
                });
          };
          const r = await retainedAllocationRequest(
            req(kind, c, method),
            { id: c.listingId, operationId: c.operationId },
            kind,
          );
          assert.ok([403, 409].includes(r.status));
          assert.equal((await r.json()).submissionUncertain, false);
          assert.equal(calls.length, 1);
          assert.ok(calls[0].url.endsWith('/session'));
        }
  }));
test('aliases, method, forged authority, origin, cookies, missing scope and GET framing fail before current identity read', () =>
  fixture(async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw Error('unexpected');
    };
    for (const kind of ['creation', 'revision']) {
      const c = command(kind),
        params = { id: c.listingId, operationId: c.operationId };
      for (const headers of [
        { 'x-allocation-actor': '' },
        { 'x-allocation-tenant': 'bad' },
        { 'x-preview-instance': id(99) },
        { 'x-actor-id': id(11) },
        { cookie: 'private' },
        { authorization: 'Bearer forged' },
        { origin: 'https://foreign.invalid' },
        { 'if-none-match': '*' },
        { 'transfer-encoding': 'chunked' },
      ])
        assert.ok(
          (await retainedAllocationRequest(req(kind, c, 'POST', headers), params, kind)).status >=
            400,
        );
      for (const suffix of ['?', '?a=b', '/', '#x'])
        assert.ok(
          (await retainedAllocationRequest(req(kind, c, 'POST', {}, suffix), params, kind))
            .status >= 400,
        );
      assert.equal(
        (await retainedAllocationRequest(req(kind, c, 'PUT'), params, kind)).status,
        405,
      );
      assert.equal(
        (
          await retainedAllocationRequest(
            req(kind, c, 'GET', { 'content-length': '0' }),
            params,
            kind,
          )
        ).status,
        400,
      );
    }
    assert.equal(calls, 0);
  }));
test('duplicate/body authority and aborted requests never forward mutation after context read', () =>
  fixture(async () => {
    for (const kind of ['creation', 'revision']) {
      const c = command(kind),
        calls = [];
      globalThis.fetch = async (url) => {
        calls.push(url);
        return Response.json(identity);
      };
      for (const raw of [
        '{"slug":"one","slug":"two","content":{}}',
        JSON.stringify({ ...body(kind, c), actorId: id(11) }),
      ]) {
        const r = await retainedAllocationRequest(
          req(kind, c, 'POST', {}, '', raw),
          { id: c.listingId, operationId: c.operationId },
          kind,
        );
        assert.equal(r.status, 400);
      }
      assert.ok(calls.every((url) => url.endsWith('/session')));
      const original = req(kind, c),
        abort = new AbortController();
      abort.abort();
      const r = await retainedAllocationRequest(
        new Request(original, { signal: abort.signal }),
        { id: c.listingId, operationId: c.operationId },
        kind,
      );
      assert.equal(r.status, 400);
    }
  }));
test('context and command retain one captured server configuration even when environment changes in flight', () =>
  fixture(async () => {
    const c = command('creation'),
      calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/session')) {
        process.env.STAFF_PREVIEW_TOKEN = 'changed.server.token';
        process.env.STAFF_PREVIEW_API_ORIGIN = 'http://127.0.0.1:4999';
        return Response.json(identity);
      }
      return Response.json(receipt('creation', c));
    };
    const r = await creationPost(req('creation', c), {
      params: Promise.resolve({ id: c.listingId, operationId: c.operationId }),
    });
    assert.equal(r.status, 200);
    assert.equal(calls.length, 2);
    assert.ok(calls[1].url.startsWith(env.STAFF_PREVIEW_API_ORIGIN));
    assert.equal(
      new Headers(calls[1].init.headers).get('authorization'),
      'Bearer synthetic.server.token',
    );
  }));
test('scoped browser adapters use retained routes and validated actor on every POST/GET without fallback or bearer', async () => {
  for (const kind of ['creation', 'revision']) {
    const c = command(kind),
      calls = [],
      factory = kind === 'creation' ? createListingCreationClient : createListingSuccessorClient;
    const api = factory({
      instanceId: scope.instanceId,
      scope,
      fetch: async (url, init) => {
        calls.push({ url, init });
        return Response.json(receipt(kind, c));
      },
    });
    await api.create(c);
    await api.recover(c);
    assert.deepEqual(
      calls.map((x) => x.init.method),
      ['POST', 'GET'],
    );
    for (const call of calls) {
      assert.equal(call.url, path(kind, c));
      const h = new Headers(call.init.headers);
      assert.equal(h.get('x-allocation-actor'), scope.actorId);
      assert.equal(h.get('x-allocation-tenant'), scope.tenantId);
      assert.equal(h.get('authorization'), null);
    }
    assert.equal(calls[1].init.body, undefined);
    const wrong = factory({
      instanceId: scope.instanceId,
      scope,
      fetch: async () => Response.json(receipt(kind, c, id(11))),
    });
    await assert.rejects(wrong.create(c), (e) => e.kind === 'response' && e.uncertain);
    await assert.rejects(wrong.recover(c), (e) => e.kind === 'response' && !e.uncertain);
    assert.throws(() => factory({ instanceId: id(99), scope }));
    assert.throws(() =>
      factory({ instanceId: scope.instanceId, scope: { ...scope, bearer: 'forged' } }),
    );
  }
});
test('actual revision GET route delegates only after verified staff comparison', () =>
  fixture(async () => {
    const c = command('revision');
    let calls = 0;
    globalThis.fetch = async (url) => {
      calls++;
      return Response.json(url.endsWith('/session') ? identity : receipt('revision', c));
    };
    const r = await revisionGet(req('revision', c, 'GET'), {
      params: Promise.resolve({ id: c.listingId, operationId: c.operationId }),
    });
    assert.equal(r.status, 200);
    assert.equal(calls, 2);
  }));
