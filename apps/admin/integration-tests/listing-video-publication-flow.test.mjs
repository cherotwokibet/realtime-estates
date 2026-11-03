import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '@realtor/api-client';
import { startStaffPreview } from '../../api/dev/staff-preview.mjs';
const modes = {
  port: 0,
  actor: 'admin',
  listingVideoMode: 'synthetic-private-listing-video-v1',
  listingVideoPublicationMode: 'synthetic-listing-video-publication-v1',
  referenceDraftMode: 'synthetic-reference-draft-v1',
  referenceModerationMode: 'synthetic-reference-transition-v1',
  referencePublicMode: 'synthetic-reference-public-v1',
};
test('signed reviewer and anonymous public video routes compose through JWKS and restricted SQL without provider requests', async () => {
  const p = await startStaffPreview(modes);
  try {
    const c = new RealtorApiClient({
      baseUrl: p.origin,
      allowLoopbackHttp: true,
      privacyNoticeVersion: 'synthetic',
    });
    const r = await c.getReviewListingVideo(p.listingId, 1, p.referenceReviewVersion, {
      bearerToken: p.bearerToken,
    });
    assert.equal(r.video, null);
    await assert.rejects(
      () => c.getReviewListingVideo(p.listingId, 1, '1', { bearerToken: p.bearerToken }),
      (e) => e.status === 409,
    );
    await assert.rejects(
      () =>
        c.getReviewListingVideo(p.listingId, 1, p.referenceReviewVersion, {
          bearerToken: 'invalid',
        }),
      (e) => e.status === 401,
    );
    const pub = await c.getPublishedListingVideo(p.referencePublicListingId, 1);
    assert.equal(pub.video, null);
    assert.equal(pub.listingId, p.referencePublicListingId);
    await assert.rejects(
      () => c.getPublishedListingVideo(p.listingId, 1),
      (e) => e.status === 404,
    );
    const direct = await fetch(
      p.origin + `/v3/properties/${p.referencePublicListingId}/revisions/1/video`,
      { headers: { Authorization: 'Bearer ' + p.bearerToken } },
    );
    assert.equal(direct.status, 400);
  } finally {
    await p.close();
  }
});
test('video publication default is unavailable and unsupported startup mode is rejected', async () => {
  const p = await startStaffPreview({ port: 0, actor: 'admin' });
  try {
    const r = await fetch(p.origin + `/v3/properties/${p.listingId}/revisions/1/video`);
    assert.equal(r.status, 404);
  } finally {
    await p.close();
  }
  await assert.rejects(() =>
    startStaffPreview({
      port: 0,
      listingVideoPublicationMode: 'synthetic-listing-video-publication-v1',
    }),
  );
});
