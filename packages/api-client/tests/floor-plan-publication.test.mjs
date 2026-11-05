import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
const listing = '00000000-0000-4000-8000-000000000100';
const state = {
  policy: 'synthetic-published-floor-plan-v1',
  listingId: listing,
  revision: 1,
  approvedVersion: '5',
  floorPlan: { width: 512, height: 384, bytes: 93652, sha256: 'a'.repeat(64) },
};
const client = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'synthetic',
    fetch,
  });
const reply = (data) => Response.json(data, { headers: { 'cache-control': 'no-store' } });
test('public floor-plan read is anonymous, uncached, credential-free and authority options fail before I/O', async () => {
  let calls = 0;
  const c = client(async (url, o) => {
    calls++;
    assert.equal(
      String(url),
      'https://synthetic.invalid/v3/properties/' + listing + '/revisions/1/floor-plan',
    );
    assert.equal(o.method, 'GET');
    assert.equal(o.cache, 'no-store');
    assert.equal(o.redirect, 'error');
    assert.equal(o.credentials, 'omit');
    assert.equal(new Headers(o.headers).has('authorization'), false);
    return reply(state);
  });
  assert.deepEqual(await c.getPublishedFloorPlan(listing, 1), state);
  await assert.rejects(
    () => c.getPublishedFloorPlan(listing, 1, { bearerToken: 'forbidden' }),
    (e) => e.kind === 'VALIDATION',
  );
  assert.equal(calls, 1);
});
test('public floor-plan reader rejects cached, duplicate, mismatched or private metadata', async () => {
  for (const v of [
    { ...state, revision: 2 },
    { ...state, requestId: listing },
    { ...state, floorPlan: { ...state.floorPlan, operationId: listing } },
  ])
    await assert.rejects(
      () => client(async () => reply(v)).getPublishedFloorPlan(listing, 1),
      (e) => e.kind === 'INVALID_RESPONSE',
    );
  await assert.rejects(
    () => client(async () => Response.json(state)).getPublishedFloorPlan(listing, 1),
    (e) => e.kind === 'INVALID_RESPONSE',
  );
  await assert.rejects(
    () =>
      client(
        async () =>
          new Response(JSON.stringify(state).replace('"revision":1', '"revision":1,"revision":1'), {
            headers: { 'cache-control': 'no-store', 'content-type': 'application/json' },
          }),
      ).getPublishedFloorPlan(listing, 1),
    (e) => e.kind === 'INVALID_RESPONSE',
  );
});
test('review floor-plan reader requires staff token and exact pending/approved version', async () => {
  const data = {
    policy: 'synthetic-floor-plan-state-v1',
    listingId: listing,
    revision: 1,
    version: '4',
    state: 'pending',
    floorPlan: null,
  };
  const c = client(async (url, o) => {
    assert.equal(new Headers(o.headers).get('authorization'), 'Bearer synthetic');
    assert.ok(String(url).endsWith('/floor-plan/4'));
    return reply(data);
  });
  assert.deepEqual(await c.getReviewFloorPlan(listing, 1, '4', { bearerToken: 'synthetic' }), data);
  for (const d of [
    { ...data, state: 'draft' },
    { ...data, version: '5' },
  ])
    await assert.rejects(
      () =>
        client(async () => reply(d)).getReviewFloorPlan(listing, 1, '4', {
          bearerToken: 'synthetic',
        }),
      (e) => e.kind === 'INVALID_RESPONSE',
    );
  await assert.rejects(
    () => c.getReviewFloorPlan(listing, 1, '04', { bearerToken: 'synthetic' }),
    (e) => e.kind === 'VALIDATION',
  );
});
