import test from 'node:test';
import assert from 'node:assert/strict';
import { startStaffPreview } from './staff-preview.mjs';
import {
  RealtorApiClient,
  validateListingSuccessorCommand,
} from '../../../packages/api-client/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('successor preview commits once, GET recovers, later draft read is current and stale conflicts do not consume reply fault', async () => {
  const p = await startStaffPreview({
    port: 0,
    successorTerminalFixture: 'approved',
    successorReplyFault: 'invalid-first-applied-v1',
  });
  try {
    const api = new RealtorApiClient({
      baseUrl: p.origin,
      privacyNoticeVersion: 'synthetic-preview-v1',
      allowLoopbackHttp: true,
    });
    const options = { bearerToken: p.bearerToken };
    const before = await api.getStaffListingV2(p.listingId, options);
    assert.equal(before.latest.state, 'approved');
    const terminal = await api.getStaffDraftV2(p.listingId, before.latest.revision, options);
    const blocked = await fetch(p.origin + `/v2/staff/listings/${p.listingId}/drafts/2`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${p.bearerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 0, content: terminal.content }),
    });
    assert.equal(blocked.status, 400, 'A direct zero-version edit cannot allocate a successor.');
    assert.deepEqual(await api.getStaffListingV2(p.listingId, options), before);
    const command = validateListingSuccessorCommand({
      listingId: p.listingId,
      operationId: id(9900),
      expectedListingVersion: before.version,
      predecessor: {
        revision: before.latest.revision,
        version: before.latest.version,
        state: before.latest.state,
      },
      content: {
        title: 'Explicit successor',
        pricing: { declaration: 'not_declared', charges: [] },
        location: { county: null, town: null, area: null },
      },
    });
    const stale = { ...command, operationId: id(9901), expectedListingVersion: '1' };
    assert.equal((await api.startListingRevisionV2(stale, options)).decision.outcome, 'conflict');
    await assert.rejects(
      () => api.startListingRevisionV2(command, options),
      (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain,
    );
    const original = await api.getListingSuccessorReceiptV2(command, options);
    assert.equal(original.decision.outcome, 'applied');
    assert.deepEqual(await api.startListingRevisionV2(command, options), original);
    const after = await api.getStaffListingV2(p.listingId, options);
    assert.equal(after.latest.state, 'draft');
    assert.equal(after.latest.revision, before.latest.revision + 1);
    const workspace = await api.getStaffDraftWorkspaceV2(
      p.listingId,
      after.latest.revision,
      options,
    );
    assert.equal(workspace.draft.version, '2');
    assert.equal(workspace.draft.content.title, 'Explicit successor');
    assert.equal(workspace.photos.length, 0);
    assert.equal(
      (
        await api.saveStaffDraftV2(
          p.listingId,
          after.latest.revision,
          {
            expectedVersion: workspace.draft.version,
            content: { ...workspace.draft.content, title: 'Explicit later edit' },
          },
          options,
        )
      ).version,
      '3',
    );
    assert.equal(after.publishedRevision, before.publishedRevision);
    assert.equal(after.publicationStatus, before.publicationStatus);
    assert.equal(
      (await api.startListingRevisionV2({ ...command, operationId: id(9902) }, options)).decision
        .outcome,
      'conflict',
    );
  } finally {
    await p.close();
  }
});
test('successor preview options reject unknown and incompatible fixture modes', async () => {
  for (const options of [
    { successorReplyFault: 'other' },
    { successorTerminalFixture: 'draft' },
    { successorTerminalFixture: 'approved', seedAcceptedMedia: false },
    { successorTerminalFixture: 'rejected', seedPendingReviews: true },
  ])
    await assert.rejects(() => startStaffPreview({ port: 0, ...options }));
});
