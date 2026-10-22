import test from 'node:test';
import assert from 'node:assert/strict';
import { planListingVerification } from '@realtor/domain';
import {
  GET,
  POST,
  dynamic,
} from '../dist/tests/app/api/staff/listings/[id]/verification-operations/[operationId]/route.js';
import { GET as historyGET } from '../dist/tests/app/api/staff/listings/[id]/verification-history/route.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const instance = id(9),
  path = `/api/staff/listings/${id(100)}/verification-operations/${id(300)}`;
const command = () => ({
  operationId: id(300),
  policy: 'synthetic-check-record-v1',
  target: { listingId: id(100), listingVersion: '1', revision: 1, revisionVersion: '2' },
  expectedVerificationVersion: '0',
  subject: 'identity',
  outcome: 'supported',
  evidenceReference: 'synthetic:fixture',
  note: 'Synthetic assessment.',
  observedAt: '2026-01-01T00:00:00.000Z',
});
const receipt = () => ({
  kind: 'listing_verification_receipt',
  operationId: id(300),
  listingId: id(100),
  actorId: id(10),
  request: command(),
  completedAt: '2026-10-22T20:00:00.000Z',
  decision: {
    outcome: 'recorded',
    reason: null,
    record: planListingVerification(
      command(),
      { target: command().target, verificationVersion: '0', lastRecordedAt: null },
      'admin',
      id(10),
      '2026-10-22T20:00:00.000Z',
    ).record,
  },
});
function req({ method = 'GET', url = path, body, headers = {}, signal } = {}) {
  return new Request('http://127.0.0.1:3001' + url, {
    method,
    signal,
    body: body === undefined && method === 'POST' ? JSON.stringify(command()) : body,
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
    headers: {
      host: '127.0.0.1:3001',
      'x-preview-instance': instance,
      'sec-fetch-site': 'same-origin',
      ...(method === 'POST'
        ? { origin: 'http://127.0.0.1:3001', 'content-type': 'application/json' }
        : {}),
      ...headers,
    },
  });
}
test('private verification boundary retains fixed originals, current authorization and read-only recovery', async (t) => {
  const env = { ...process.env },
    originalFetch = globalThis.fetch;
  Object.assign(process.env, {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
    STAFF_PREVIEW_TOKEN: 'a.b.c',
    STAFF_PREVIEW_INSTANCE: instance,
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env))
      if (!Object.hasOwn(env, key)) delete process.env[key];
    Object.assign(process.env, env);
  });
  let calls = [];
  const mock = (reply = () => Response.json(receipt())) => {
    calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return reply();
    };
  };
  await t.test(
    'one fixed write and body-free original read use server-only credentials',
    async () => {
      mock();
      const response = await POST(req({ method: 'POST' }));
      assert.equal(dynamic, 'force-dynamic');
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), receipt());
      assert.match(response.headers.get('cache-control'), /private, no-store/);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'http://127.0.0.1:4101' + path.replace('/api/', '/v2/'));
      assert.deepEqual(JSON.parse(calls[0].init.body), command());
      assert.equal(calls[0].init.headers.Authorization, 'Bearer a.b.c');
      assert.equal(calls[0].init.credentials, 'omit');
      assert.equal(calls[0].init.redirect, 'error');
      assert.equal((await GET(req())).status, 200);
      assert.equal(calls[1].init.method, 'GET');
      assert.equal(calls[1].init.body, undefined);
    },
  );
  await t.test(
    'cross-origin, stale instance, production and browser identity fail without dispatch',
    async () => {
      for (const headers of [
        { origin: 'https://other.invalid' },
        { authorization: 'Bearer other' },
        { 'x-preview-instance': 'stale' },
        { host: 'localhost:3001' },
        { 'sec-fetch-site': 'cross-site' },
      ]) {
        mock();
        assert.ok((await GET(req({ headers }))).status >= 400);
        assert.equal(calls.length, 0);
      }
      mock();
      process.env.NODE_ENV = 'production';
      assert.equal((await GET(req())).status, 403);
      process.env.NODE_ENV = 'development';
      assert.equal(calls.length, 0);
    },
  );
  await t.test(
    'ambiguous framing, context, duplicate decoded keys and revision aliases never write',
    async () => {
      for (const change of [
        { url: path + '?' },
        { url: path + '?a=1' },
        { headers: { cookie: 'x=y' } },
        { headers: { 'content-encoding': 'gzip' } },
        { headers: { 'content-length': '01' } },
        { headers: { 'content-length': '2' } },
        { headers: { 'x-actor-id': id(10) } },
        { body: JSON.stringify(command()).replace('"revision":1', '"revision":1e0') },
        { body: JSON.stringify(command()).replace('"note":', '"note":"discarded","n\\u006fte":') },
        { body: JSON.stringify({ ...command(), operationId: id(301) }) },
        { body: ' '.repeat(16385) },
      ]) {
        mock();
        const r = await POST(req({ method: 'POST', ...change }));
        assert.equal(r.status, 400);
        assert.equal((await r.json()).submissionUncertain, false);
        assert.equal(calls.length, 0);
      }
    },
  );
  await t.test('history binds exclusive cursor and rejects query aliases or a write', async () => {
    const data = {
        kind: 'listing_verification_history',
        listingId: id(100),
        verificationVersion: '1',
        beforeVersion: '1',
        records: [],
        hasMore: false,
      },
      url = `/api/staff/listings/${id(100)}/verification-history?limit=2&beforeVersion=1`;
    mock(() => Response.json(data));
    assert.equal((await historyGET(req({ url }))).status, 200);
    assert.equal(calls[0].url, 'http://127.0.0.1:4101' + url.replace('/api/', '/v2/'));
    assert.equal(calls[0].init.method, 'GET');
    for (const suffix of [
      '?limit=02',
      '?limit=26',
      '?limit=2&beforeVersion=0',
      '?limit=2&beforeVersion=9007199254740992',
      '?beforeVersion=1&limit=2',
      '?limit=2&limit=2',
    ]) {
      mock();
      assert.equal((await historyGET(req({ url: url.split('?')[0] + suffix }))).status, 400);
      assert.equal(calls.length, 0);
    }
    mock();
    assert.equal((await POST(req({ method: 'POST', url }))).status, 400);
    assert.equal(calls.length, 0);
  });
  await t.test(
    'lost or altered write replies stay uncertain; failed recovery never writes',
    async () => {
      for (const response of [
        () => {
          throw Error('secret upstream detail');
        },
        () => Response.json({ ...receipt(), actorId: id(11) }),
        () => new Response('not json'),
      ]) {
        mock(response);
        const r = await POST(req({ method: 'POST' }));
        assert.equal(r.status, 502);
        const body = await r.json();
        assert.equal(body.submissionUncertain, true);
        assert.ok(!JSON.stringify(body).includes('secret'));
        assert.equal(calls.length, 1);
      }
      mock(() =>
        Response.json(
          { error: { code: 'FORBIDDEN', message: 'Private' }, requestId: instance },
          { status: 403 },
        ),
      );
      const r = await GET(req());
      assert.equal(r.status, 403);
      assert.equal((await r.json()).submissionUncertain, false);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].init.method, 'GET');
    },
  );
  await t.test(
    'endless empty input yields to cancellation without memory growth or dispatch',
    async () => {
      let reads = 0,
        cancelled = 0;
      const controller = new AbortController(),
        stream = new ReadableStream(
          {
            pull(c) {
              reads++;
              c.enqueue(new Uint8Array());
            },
            cancel() {
              cancelled++;
            },
          },
          { highWaterMark: 0 },
        );
      mock();
      const timer = setTimeout(() => controller.abort(), 10);
      try {
        const response = await POST(
          req({ method: 'POST', body: stream, signal: controller.signal }),
        );
        assert.equal(response.status, 499);
        assert.equal(calls.length, 0);
        assert.ok(reads > 0);
        assert.equal(cancelled, 1);
        assert.equal(stream.locked, false);
      } finally {
        clearTimeout(timer);
      }
    },
  );
  await t.test('aborting a stalled input cancels it without starting a write', async () => {
    let cancel = 0;
    const controller = new AbortController(),
      stream = new ReadableStream(
        {
          cancel() {
            cancel++;
          },
        },
        { highWaterMark: 0 },
      );
    mock();
    const pending = POST(req({ method: 'POST', body: stream, signal: controller.signal }));
    await new Promise((r) => setImmediate(r));
    controller.abort();
    const response = await pending;
    assert.equal(response.status, 499);
    assert.equal((await response.json()).submissionUncertain, false);
    assert.equal(calls.length, 0);
    assert.equal(cancel, 1);
    assert.equal(stream.locked, false);
  });
});
