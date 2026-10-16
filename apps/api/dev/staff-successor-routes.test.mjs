import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startStaffPreview, STAFF_PREVIEW_FIXTURES } from './staff-preview.mjs';
import {
  RealtorApiClient,
  validateListingSuccessorCommand,
} from '../../../packages/api-client/dist/index.js';

test('successor review routes retain exact revision, current tenant, methods and pending-state guards', async () => {
  const p = await startStaffPreview({
    port: 0,
    actor: 'admin',
    successorTerminalFixture: 'rejected',
  });
  try {
    const options = { bearerToken: p.bearerToken };
    const api = new RealtorApiClient({
      baseUrl: p.origin,
      privacyNoticeVersion: 'synthetic-preview-v1',
      allowLoopbackHttp: true,
    });
    const listing = await api.getStaffListingV2(p.listingId, options);
    assert.equal(listing.latest.state, 'rejected');
    const predecessor = {
      revision: listing.latest.revision,
      version: listing.latest.version,
      state: listing.latest.state,
    };
    const command = validateListingSuccessorCommand({
      listingId: p.listingId,
      operationId: randomUUID(),
      expectedListingVersion: listing.version,
      predecessor,
      content: {
        title: 'Synthetic rejected successor',
        pricing: { declaration: 'not_declared', charges: [] },
        location: { county: null, town: null, area: null },
      },
    });
    assert.equal((await api.startListingRevisionV2(command, options)).decision.outcome, 'applied');
    const review = await api.getReviewV2(p.listingId, 2, options);
    assert.equal(review.state, 'draft');
    assert.equal(review.revision, 2);
    assert.equal(review.photos.length, 0);
    await assert.rejects(
      () =>
        api.decideReviewV2(
          p.listingId,
          2,
          { expectedVersion: review.version, decision: 'approve', reason: null },
          options,
        ),
      (e) => e.status === 409,
    );
    const authorization = { Authorization: `Bearer ${p.bearerToken}` };
    const route = `/v2/staff/reviews/${p.listingId}/revisions/2`;
    assert.equal(
      (await fetch(p.origin + route, { method: 'POST', headers: authorization })).status,
      405,
    );
    assert.equal(
      (await fetch(p.origin + route + '/decision', { headers: authorization })).status,
      405,
    );
    assert.equal(
      (
        await fetch(p.origin + route.replace(p.listingId, STAFF_PREVIEW_FIXTURES.sampleListingId), {
          headers: authorization,
        })
      ).status,
      404,
    );
    for (const revision of ['0', '02', '-1', '2.0', '2147483648'])
      assert.ok(
        [400, 404].includes(
          (await fetch(p.origin + route.replace('/2', '/' + revision), { headers: authorization }))
            .status,
        ),
      );
    const after = await api.getStaffDraftWorkspaceV2(p.listingId, 2, options);
    assert.equal(after.draft.version, '2');
    assert.equal(after.draft.state, 'draft');
    assert.equal((await api.getStaffListingV2(p.listingId, options)).publishedRevision, null);
  } finally {
    await p.close();
  }
});
test('later-revision moderator paths preserve staff-role denials', async () => {
  for (const actor of ['agent', 'customer', 'revoked-agent']) {
    const p = await startStaffPreview({ port: 0, actor, successorTerminalFixture: 'approved' });
    try {
      const response = await fetch(p.origin + `/v2/staff/reviews/${p.listingId}/revisions/2`, {
        headers: { Authorization: `Bearer ${p.bearerToken}` },
      });
      assert.equal(response.status, 403, actor);
    } finally {
      await p.close();
    }
  }
});
