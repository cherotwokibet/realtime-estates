import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
const listing = '00000000-0000-4000-8000-000000000400';
const publicState = {
  policy: 'synthetic-published-listing-video-v1',
  listingId: listing,
  revision: 1,
  approvedVersion: '5',
  video: { provider: 'vimeo', videoId: '12345', title: 'Synthetic approved tour' },
};
const client = (transport) =>
  new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'synthetic',
    fetch: transport,
  });
const reply = (data) => Response.json(data, { headers: { 'cache-control': 'no-store' } });
test('published video transport is anonymous GET and rejects authority before I/O', async () => {
  let calls = 0;
  const c = client(async (url, o) => {
    calls++;
    assert.equal(o.method, 'GET');
    assert.equal(o.credentials, 'omit');
    assert.equal(o.cache, 'no-store');
    assert.equal(o.redirect, 'error');
    assert.equal(new Headers(o.headers).has('authorization'), false);
    return reply(publicState);
  });
  assert.deepEqual(await c.getPublishedListingVideo(listing, 1), publicState);
  await assert.rejects(
    () => c.getPublishedListingVideo(listing, 1, { bearerToken: 'forbidden' }),
    (e) => e.kind === 'VALIDATION',
  );
  assert.equal(calls, 1);
});
test('published and reviewer reads fail on cacheable, mismatched or private extra facts', async () => {
  for (const data of [
    { ...publicState, revision: 2 },
    { ...publicState, operationId: listing },
    { ...publicState, video: { ...publicState.video, url: 'https://private.invalid' } },
  ])
    await assert.rejects(
      () => client(async () => reply(data)).getPublishedListingVideo(listing, 1),
      (e) => e.kind === 'INVALID_RESPONSE',
    );
  await assert.rejects(
    () => client(async () => Response.json(publicState)).getPublishedListingVideo(listing, 1),
    (e) => e.kind === 'INVALID_RESPONSE',
  );
  const state = {
    policy: 'synthetic-listing-video-state-v1',
    listingId: listing,
    revision: 1,
    version: '4',
    video: null,
  };
  assert.deepEqual(
    await client(async () => reply(state)).getReviewListingVideo(listing, 1, '4', {
      bearerToken: 'synthetic',
    }),
    state,
  );
  await assert.rejects(
    () =>
      client(async () => reply(state)).getReviewListingVideo(listing, 1, '3', {
        bearerToken: 'synthetic',
      }),
    (e) => e.kind === 'INVALID_RESPONSE',
  );
});
