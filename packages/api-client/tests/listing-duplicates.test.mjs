import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
const listingId = '00000000-0000-4000-8000-000000000001';
const input = { listingId, listingVersion: '2', revision: 3, revisionVersion: '4', limit: 2 };
const { limit, ...target } = input;
const result = () => ({
  kind: 'listing_duplicate_candidates',
  policy: 'exact-current-work-v1',
  target,
  comparison: 'compared',
  matches: [],
  hasMore: false,
});
const options = { bearerToken: 'synthetic' };
const client = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'synthetic',
    fetch,
  });
test('duplicate SDK fixes bounded GET query and credentials, captures immutable original target', async () => {
  let calls = 0;
  const original = { ...input };
  const sdk = client(async (url, init) => {
    calls++;
    assert.equal(
      url,
      `https://synthetic.invalid/v2/staff/listings/${listingId}/duplicate-candidates?listingVersion=2&revision=3&revisionVersion=4&limit=2`,
    );
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer synthetic');
    assert.equal(init.body, undefined);
    original.revisionVersion = '9';
    return Response.json(result());
  });
  const read = await sdk.getListingDuplicateCandidatesV2(original, options);
  assert.equal(read.target.revisionVersion, '4');
  assert.ok(Object.isFrozen(read));
  assert.equal(calls, 1);
});
test('duplicate SDK refuses invalid original context before dispatch and altered projections after dispatch', async () => {
  let calls = 0;
  const sdk = client(async () => {
    calls++;
    return Response.json({ ...result(), target: { ...target, revisionVersion: '9' } });
  });
  await assert.rejects(
    () => sdk.getListingDuplicateCandidatesV2({ ...input, actorId: listingId }, options),
    (e) => e.kind === 'VALIDATION',
  );
  assert.equal(calls, 0);
  await assert.rejects(
    () => sdk.getListingDuplicateCandidatesV2(input, options),
    (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
  );
  assert.equal(calls, 1);
});
test('duplicate SDK bounds body/framing and cancellation with no retries or mutation uncertainty', async () => {
  for (const response of [
    new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '01' } }),
    new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }),
    Response.json(result(), { headers: { 'content-encoding': 'gzip' } }),
  ]) {
    let calls = 0;
    await assert.rejects(
      () =>
        client(async () => {
          calls++;
          return response;
        }).getListingDuplicateCandidatesV2(input, options),
      (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
    );
    assert.equal(calls, 1);
  }
  let cancelled = false;
  const sdk = client(
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  await assert.rejects(
    () => sdk.getListingDuplicateCandidatesV2(input, { ...options, timeoutMs: 20 }),
    (e) => e.kind === 'TIMEOUT' && !e.submissionUncertain,
  );
  assert.equal(cancelled, true);
});
