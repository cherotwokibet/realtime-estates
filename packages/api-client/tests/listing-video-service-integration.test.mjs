import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RealtorApiClient } from '../dist/index.js';
import { startStaffPreview } from '../../../apps/api/dev/staff-preview.mjs';
const mode = { port: 0, actor: 'agent', listingVideoMode: 'synthetic-private-listing-video-v1' };
const client = (p, fetch) =>
  new RealtorApiClient({
    baseUrl: p.origin,
    privacyNoticeVersion: 'synthetic-staff-notice-v1',
    allowLoopbackHttp: true,
    fetch,
  });
test('signed SDK HTTP and restricted SQL preserve video original through lost committed reply and explicit GET recovery', async () => {
  const p = await startStaffPreview(mode);
  try {
    let post = 0;
    const api = client(p, async (url, init) => {
      const r = await fetch(url, init);
      if (init.method === 'POST' && post++ === 0) {
        assert.equal(r.status, 200);
        await r.text();
        throw Error('Synthetic reply loss after HTTP commit');
      }
      return r;
    });
    const auth = { bearerToken: p.bearerToken };
    const initial = await api.getPrivateListingVideo(p.listingId, 1, auth),
      command = {
        policy: 'synthetic-listing-video-command-v1',
        operationId: randomUUID(),
        listingId: p.listingId,
        revision: 1,
        expectedVersion: initial.version,
        video: { provider: 'youtube', videoId: 'abcdefghijk', title: 'Synthetic private tour' },
      };
    await assert.rejects(
      () => api.savePrivateListingVideo(command, auth),
      (e) => e.submissionUncertain === true,
    );
    assert.equal(post, 1);
    const recovered = await api.getPrivateListingVideoOriginal(command, auth);
    assert.deepEqual(recovered.command, command);
    assert.equal(post, 1);
    assert.equal(recovered.resultVersion, String(BigInt(initial.version) + 1n));
    assert.deepEqual(await api.savePrivateListingVideo(command, auth), recovered);
    assert.equal(post, 2);
    const current = await api.getPrivateListingVideo(p.listingId, 1, auth);
    assert.equal(current.video.title, command.video.title);
    await assert.rejects(
      () => api.savePrivateListingVideo({ ...command, operationId: randomUUID() }, auth),
      (e) => e.status === 409,
    );
    const cleared = {
      ...command,
      operationId: randomUUID(),
      expectedVersion: current.version,
      video: null,
    };
    await api.savePrivateListingVideo(cleared, auth);
    assert.equal((await api.getPrivateListingVideo(p.listingId, 1, auth)).video, null);
    assert.deepEqual(await api.getPrivateListingVideoOriginal(command, auth), recovered);
    assert.equal((await fetch(p.origin + `/v2/public/listings/${p.listingId}/video`)).status, 404);
  } finally {
    await p.close();
  }
});
test('signed video requests cannot supply another listing, foreign signature or role authority; omitted mode stays absent', async () => {
  const p = await startStaffPreview(mode);
  try {
    const api = client(p),
      auth = { bearerToken: p.bearerToken };
    await assert.rejects(
      () => api.getPrivateListingVideo(p.listingId, 1, { bearerToken: p.bearerToken + 'x' }),
      (e) => e.status === 401,
    );
    const other = randomUUID();
    await assert.rejects(
      () => api.getPrivateListingVideo(other, 1, auth),
      (e) => e.status === 404,
    );
  } finally {
    await p.close();
  }
  const ordinary = await startStaffPreview({ port: 0, actor: 'agent' });
  try {
    await assert.rejects(
      () =>
        client(ordinary).getPrivateListingVideo(ordinary.listingId, 1, {
          bearerToken: ordinary.bearerToken,
        }),
      (e) => e.status === 404,
    );
  } finally {
    await ordinary.close();
  }
});
