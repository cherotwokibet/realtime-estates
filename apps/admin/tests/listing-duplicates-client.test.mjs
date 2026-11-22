import { decodedJsonResponse } from './helpers/decoded-json-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readListingDuplicateCandidates } from '../dist/tests/lib/listing-duplicates-client.js';
const listingId = '00000000-0000-4000-8000-000000000001',
  instance = '00000000-0000-4000-8000-000000000009';
const input = { listingId, listingVersion: '2', revision: 3, revisionVersion: '4', limit: 20 };
const { limit, ...target } = input;
const data = () => ({
  kind: 'listing_duplicate_candidates',
  policy: 'exact-current-work-v1',
  target,
  comparison: 'compared',
  matches: [],
  hasMore: false,
});
const read = (fetch, signal = new AbortController().signal, value = input) =>
  readListingDuplicateCandidates(instance, value, signal, fetch);
test('duplicate browser lookup fixes GET and original currency without browser credentials', async () => {
  let calls = 0;
  const original = { ...input };
  const result = await readListingDuplicateCandidates(
    instance,
    original,
    new AbortController().signal,
    async (url, init) => {
      calls++;
      assert.equal(
        url,
        `/api/staff/listings/${listingId}/duplicate-candidates?listingVersion=2&revision=3&revisionVersion=4&limit=20`,
      );
      assert.equal(init.method, 'GET');
      assert.deepEqual(init.headers, {
        Accept: 'application/json',
        'X-Preview-Instance': instance,
      });
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      assert.equal(init.body, undefined);
      original.revisionVersion = '9';
      return Response.json(data());
    },
  );
  assert.equal(result.target.revisionVersion, '4');
  assert.ok(Object.isFrozen(result));
  assert.equal(calls, 1);
});
test('duplicate browser lookup rejects invalid input and cancellation before dispatch', async () => {
  let calls = 0;
  const transport = async () => {
    calls++;
    return Response.json(data());
  };
  await assert.rejects(() => read(transport, undefined, { ...input, actorId: listingId }));
  await assert.rejects(() =>
    readListingDuplicateCandidates('stale', input, new AbortController().signal, transport),
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(() => read(transport, abort.signal));
  assert.equal(calls, 0);
});
test('duplicate browser lookup rejects denial, stale facts, malformed framing and private fields with one attempt', async () => {
  for (const response of [
    () => Response.json(data(), { status: 403 }),
    () => Response.json(data(), { status: 409 }),
    () => Response.json({ ...data(), privateAddress: 'private' }),
    () => Response.json({ ...data(), target: { ...target, listingVersion: '3' } }),
    () => new Response('x'.repeat(1048577), { headers: { 'content-type': 'application/json' } }),
    () => new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }),
    () => Response.json(data(), { headers: { 'content-length': '01' } }),
    () => Response.json(data(), { headers: { 'content-encoding': 'unknown' } }),
    () =>
      new Response('{"kind":"listing_duplicate_candidates","kind":"changed"}', {
        headers: { 'content-type': 'application/json' },
      }),
  ]) {
    let calls = 0;
    await assert.rejects(() =>
      read(async () => {
        calls++;
        return response();
      }),
    );
    assert.equal(calls, 1);
  }
});
test('duplicate browser cancellation closes stalled response and ignores late fetch resolution', async () => {
  let cancelled = false;
  const abort = new AbortController();
  const pending = read(
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    abort.signal,
  );
  await new Promise((resolve) => setImmediate(resolve));
  abort.abort();
  await assert.rejects(() => pending);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
  let resolveFetch;
  const lateAbort = new AbortController();
  const late = read(
    () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    lateAbort.signal,
  );
  lateAbort.abort();
  await assert.rejects(() => late);
  let lateCancelled = false;
  resolveFetch(
    new Response(
      new ReadableStream({
        cancel() {
          lateCancelled = true;
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    ),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lateCancelled, true);
});

test('decoded compressed Fetch responses preserve exact original facts and identity length checks', async () => {
  for (const encoding of ['gzip', 'br', 'deflate', 'identity']) {
    assert.deepEqual(await read(async () => decodedJsonResponse(data(), encoding)), data());
  }
});
