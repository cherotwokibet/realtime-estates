import test from 'node:test';
import assert from 'node:assert/strict';
import { listingDuplicateCandidatesRequest } from '../dist/tests/lib/listing-duplicates-server.js';
import {
  GET,
  dynamic,
} from '../dist/tests/app/api/staff/listings/[id]/duplicate-candidates/route.js';
const listingId = '00000000-0000-4000-8000-000000000001',
  instance = '00000000-0000-4000-8000-000000000009';
const path = `/api/staff/listings/${listingId}/duplicate-candidates`,
  query = '?listingVersion=2&revision=3&revisionVersion=4&limit=2';
const data = () => ({
  kind: 'listing_duplicate_candidates',
  policy: 'exact-current-work-v1',
  target: { listingId, listingVersion: '2', revision: 3, revisionVersion: '4' },
  comparison: 'compared',
  matches: [],
  hasMore: false,
});
const req = ({ suffix = query, headers = {}, method = 'GET', signal } = {}) =>
  new Request('http://127.0.0.1:3001' + path + suffix, {
    method,
    signal,
    headers: {
      host: '127.0.0.1:3001',
      'x-preview-instance': instance,
      'sec-fetch-site': 'same-origin',
      ...headers,
    },
  });
const privateReply = (r) => {
  assert.match(r.headers.get('cache-control'), /private, no-store/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(r.headers.has('set-cookie'), false);
};
test('duplicate read proxy is server-only, fixed, bounded and read-only', async (t) => {
  const env = { ...process.env },
    fetch = globalThis.fetch;
  Object.assign(process.env, {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
    STAFF_PREVIEW_TOKEN: 'a.b.c',
    STAFF_PREVIEW_INSTANCE: instance,
  });
  t.after(() => {
    globalThis.fetch = fetch;
    for (const key of Object.keys(process.env))
      if (!Object.hasOwn(env, key)) delete process.env[key];
    Object.assign(process.env, env);
  });
  let calls = [];
  const mock = (response = () => Response.json(data())) => {
    calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return response();
    };
  };
  await t.test(
    'compiled GET fixes upstream and server bearer, excludes browser context and freezes validated target',
    async () => {
      mock();
      const r = await GET(req());
      assert.equal(dynamic, 'force-dynamic');
      assert.equal(r.status, 200);
      privateReply(r);
      assert.deepEqual(await r.json(), data());
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'http://127.0.0.1:4101' + path.replace('/api/', '/v2/') + query);
      assert.equal(calls[0].init.method, 'GET');
      assert.equal(calls[0].init.body, undefined);
      assert.equal(calls[0].init.headers.Authorization, 'Bearer a.b.c');
      assert.equal(calls[0].init.headers['x-preview-instance'], undefined);
      assert.equal(calls[0].init.credentials, 'omit');
      assert.equal(calls[0].init.redirect, 'error');
    },
  );
  await t.test(
    'production, stale instance, alternate Host and browser bearer fail before dispatch',
    async () => {
      for (const headers of [
        { 'x-preview-instance': 'stale' },
        { host: 'localhost:3001' },
        { authorization: 'Bearer caller' },
        { 'sec-fetch-site': 'cross-site' },
      ]) {
        mock();
        assert.equal((await GET(req({ headers }))).status, 403);
        assert.equal(calls.length, 0);
      }
      mock();
      process.env.NODE_ENV = 'production';
      assert.equal((await GET(req())).status, 403);
      process.env.NODE_ENV = 'development';
      assert.equal(calls.length, 0);
    },
  );
  await t.test('query ambiguity and caller authority fail without dispatch', async () => {
    for (const suffix of [
      '',
      query + '&limit=2',
      query + '#fragment',
      query.replace('limit=2', 'limit=26'),
      query.replace('revision=3', 'revision=03'),
      query.replace('listingVersion=2', 'listingVersion=9007199254740992'),
      query.replace('limit=2', 'limit=%32'),
    ]) {
      mock();
      assert.equal((await GET(req({ suffix }))).status, 400);
      assert.equal(calls.length, 0);
    }
    for (const name of [
      'cookie',
      'content-type',
      'content-length',
      'range',
      'idempotency-key',
      'x-role',
      'x-actor-id',
      'x-tenant-id',
      'if-match',
      'x-revision-version',
    ]) {
      mock();
      assert.equal((await GET(req({ headers: { [name]: '0' } }))).status, 400);
      assert.equal(calls.length, 0);
    }
    mock();
    assert.equal((await GET(req({ headers: { origin: 'https://other.invalid' } }))).status, 400);
    assert.equal(calls.length, 0);
    assert.equal(
      (
        await listingDuplicateCandidatesRequest(
          req({ method: 'POST', headers: { origin: 'http://127.0.0.1:3001' } }),
        )
      ).status,
      405,
    );
  });
  await t.test(
    'malformed/private response and oversized/framed body are hidden without retries',
    async () => {
      for (const response of [
        () => Response.json({ ...data(), privateAddress: 'SECRET' }),
        () => Response.json({ ...data(), target: { ...data().target, revisionVersion: '5' } }),
        () =>
          new Response('x'.repeat(1024 * 1024 + 1), {
            headers: { 'content-type': 'application/json' },
          }),
        () => Response.json(data(), { headers: { 'content-encoding': 'gzip' } }),
      ]) {
        mock(response);
        const r = await GET(req());
        assert.equal(r.status, 502);
        privateReply(r);
        assert.doesNotMatch(await r.text(), /SECRET|a\.b\.c/);
        assert.equal(calls.length, 1);
      }
    },
  );
  await t.test('upstream denial and stale conflict remain safe read-only results', async () => {
    for (const status of [401, 403, 404, 409, 429, 503]) {
      mock(() =>
        Response.json(
          { error: { code: 'SYNTHETIC', message: 'PRIVATE' }, requestId: instance },
          { status },
        ),
      );
      const r = await GET(req());
      assert.equal(r.status, status);
      privateReply(r);
      const body = await r.json();
      assert.equal(body.submissionUncertain, false);
      assert.equal(calls.length, 1);
      assert.doesNotMatch(JSON.stringify(body), /PRIVATE/);
    }
  });
  await t.test('cancellation prevents dispatch or cancels stalled upstream read', async () => {
    const stopped = new AbortController();
    stopped.abort();
    mock();
    assert.equal((await GET(req({ signal: stopped.signal }))).status, 499);
    assert.equal(calls.length, 0);
    let cancelled = false;
    mock(
      () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    const abort = new AbortController();
    const pending = GET(req({ signal: abort.signal }));
    await new Promise((resolve) => setImmediate(resolve));
    abort.abort();
    assert.equal((await pending).status, 499);
    assert.equal(cancelled, true);
    assert.equal(calls.length, 1);
  });
});
