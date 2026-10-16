import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient, validateListingSuccessorCommand } from '@realtor/api-client';
import {
  GET,
  POST,
} from '../dist/tests/app/api/staff/listings/[id]/revision-operations/[operationId]/route.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  instance = id(1),
  c = validateListingSuccessorCommand({
    listingId: id(3),
    operationId: id(4),
    expectedListingVersion: '7',
    predecessor: { revision: 3, version: '5', state: 'approved' },
    content: {
      pricing: { declaration: 'not_declared', charges: [] },
      location: { county: null, town: null, area: null },
    },
  }),
  original = {
    listingId: c.listingId,
    operationId: c.operationId,
    actorId: id(2),
    kind: 'start_revision',
    request: {
      expectedListingVersion: c.expectedListingVersion,
      predecessor: c.predecessor,
      content: c.content,
    },
    decision: {
      outcome: 'applied',
      reason: null,
      result: { listingVersion: '8', revision: 4, revisionVersion: '2' },
    },
    completedAt: '2026-10-15T12:00:00.000Z',
  },
  context = () => ({ params: Promise.resolve({ id: c.listingId, operationId: c.operationId }) });
const env = {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
    STAFF_PREVIEW_TOKEN: 'synthetic.server.token',
    STAFF_PREVIEW_INSTANCE: instance,
  },
  path = `http://127.0.0.1:3001/api/staff/listings/${c.listingId}/revision-operations/${c.operationId}`;
const req = (write = true, { value = original.request, raw, headers = {}, suffix = '' } = {}) =>
  new Request(path + suffix, {
    method: write ? 'POST' : 'GET',
    headers: {
      host: '127.0.0.1:3001',
      'x-preview-instance': instance,
      ...(write ? { origin: 'http://127.0.0.1:3001', 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(write ? { body: raw ?? JSON.stringify(value) } : {}),
  });
test('successor BFF uses fixed server-only identity, one POST and original GET only', async (t) => {
  const prior = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]])),
    oldFetch = globalThis.fetch,
    calls = [];
  Object.assign(process.env, env);
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return Response.json(original);
  };
  try {
    await t.test('write and read forward fixed IDs without caller authority', async () => {
      assert.deepEqual(await (await POST(req(), context())).json(), original);
      assert.deepEqual(await (await GET(req(false), context())).json(), original);
      assert.deepEqual(
        calls.map((c) => c.init.method),
        ['POST', 'GET'],
      );
      for (const call of calls) {
        assert.equal(
          new Headers(call.init.headers).get('authorization'),
          'Bearer synthetic.server.token',
        );
        assert.equal(
          call.url,
          `http://127.0.0.1:4101/v2/staff/listings/${c.listingId}/revision-operations/${c.operationId}`,
        );
      }
      assert.equal(calls[1].init.body, undefined);
    });
    await t.test(
      'query,body authority,duplicate facts and forged instance fail before upstream',
      async () => {
        calls.length = 0;
        for (const options of [
          { suffix: '?' },
          { value: { ...original.request, actorId: id(2) } },
          {
            raw: JSON.stringify(original.request).replace(
              '"expectedListingVersion":',
              '"expectedListingVersion":"7","expectedListingVersion":',
            ),
          },
          { headers: { cookie: 'x=1' } },
          { headers: { 'x-actor': id(2) } },
          { headers: { 'x-tenant': id(2) } },
          {
            raw: JSON.stringify(original.request).replace(
              '"revision":3',
              '"revision":3.0000000000000000001',
            ),
          },
          { headers: { 'content-length': '01' } },
        ])
          assert.equal((await POST(req(true, options), context())).status, 400);
        assert.equal(
          (await POST(req(true, { headers: { 'x-preview-instance': id(99) } }), context())).status,
          403,
        );
        assert.equal(calls.length, 0);
      },
    );
    await t.test(
      'malformed dispatched write stays uncertain and GET never becomes a write',
      async () => {
        calls.length = 0;
        globalThis.fetch = async (url, init) => {
          calls.push({ url, init });
          return Response.json({ ...original, listingId: id(99) });
        };
        assert.equal((await (await POST(req(), context())).json()).submissionUncertain, true);
        assert.equal((await (await GET(req(false), context())).json()).submissionUncertain, false);
        assert.deepEqual(
          calls.map((c) => c.init.method),
          ['POST', 'GET'],
        );
      },
    );
    await t.test('production refuses boundary before upstream credentials are used', async () => {
      calls.length = 0;
      process.env.NODE_ENV = 'production';
      assert.equal((await POST(req(), context())).status, 403);
      assert.equal(calls.length, 0);
    });
    await t.test('unknown failure after write dispatch is uncertain and sanitized', async () => {
      process.env.NODE_ENV = 'development';
      const previous = RealtorApiClient.prototype.startListingRevisionV2;
      RealtorApiClient.prototype.startListingRevisionV2 = async () => {
        throw new Error('PRIVATE unknown write outcome');
      };
      try {
        const response = await POST(req(), context());
        assert.equal(response.status, 502);
        const value = await response.json();
        assert.equal(value.submissionUncertain, true);
        assert.equal(JSON.stringify(value).includes('PRIVATE'), false);
      } finally {
        RealtorApiClient.prototype.startListingRevisionV2 = previous;
      }
    });
  } finally {
    globalThis.fetch = oldFetch;
    for (const [k, v] of Object.entries(prior))
      v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
});
