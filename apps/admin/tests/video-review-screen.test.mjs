import test from 'node:test';
import assert from 'node:assert/strict';
import { readVideoReviewScreen } from '../dist/tests/lib/video-review-screen.js';
import { review, catalogue, id } from '../test-helpers/reference-moderation-fixture.mjs';
const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_PREVIEW_REFERENCE: 'synthetic-reference-draft-v1',
  STAFF_PREVIEW_REFERENCE_MODERATION: 'synthetic-reference-transition-v1',
  STAFF_PREVIEW_VIDEO_PUBLICATION: 'synthetic-listing-video-publication-v1',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
  STAFF_PREVIEW_TOKEN: 'a.b.c',
  STAFF_PREVIEW_INSTANCE: id(9),
};
test('review video loader binds metadata to before/after current identity and version without exposing token', async () => {
  const r = review(),
    context = { policy: 'synthetic-reference-context-v1', review: r, catalogue: catalogue() },
    calls = [];
  const transport = async (url) => {
    calls.push(url);
    return Response.json(
      url.endsWith('/reference-session')
        ? { policy: 'synthetic-reference-session-v1', tenantId: id(1), actorId: id(10) }
        : url.includes('/video/')
          ? {
              policy: 'synthetic-listing-video-state-v1',
              listingId: r.listingId,
              revision: r.revision,
              version: r.revisionVersion,
              video: {
                provider: 'youtube',
                videoId: 'abcdefghijk',
                title: 'Synthetic reviewer tour',
              },
            }
          : context,
      { headers: { 'cache-control': 'no-store' } },
    );
  };
  const screen = await readVideoReviewScreen(r.listingId, '1', r.revisionVersion, env, transport);
  assert.equal(screen.video.video.title, 'Synthetic reviewer tour');
  assert.equal(calls.length, 5);
  assert.ok(!JSON.stringify(screen).includes('a.b.c'));
});
test('video errors and changed current actor fail closed instead of supplying an enabled review', async () => {
  for (const mode of ['error', 'actor']) {
    const r = review(),
      context = { policy: 'synthetic-reference-context-v1', review: r, catalogue: catalogue() };
    let sessions = 0;
    const transport = async (url) => {
      if (url.includes('/video/'))
        return mode === 'error'
          ? Response.json(
              { error: { code: 'NOT_FOUND', message: 'Unavailable' } },
              { status: 404, headers: { 'cache-control': 'no-store' } },
            )
          : Response.json(
              {
                policy: 'synthetic-listing-video-state-v1',
                listingId: r.listingId,
                revision: 1,
                version: r.revisionVersion,
                video: null,
              },
              { headers: { 'cache-control': 'no-store' } },
            );
      return Response.json(
        url.endsWith('/reference-session')
          ? {
              policy: 'synthetic-reference-session-v1',
              tenantId: id(1),
              actorId: ++sessions > 1 ? id(11) : id(10),
            }
          : context,
      );
    };
    await assert.rejects(() =>
      readVideoReviewScreen(r.listingId, '1', r.revisionVersion, env, transport),
    );
  }
});
