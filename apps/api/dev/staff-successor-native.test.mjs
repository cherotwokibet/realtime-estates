import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { startStaffPreview, STAFF_PREVIEW_FIXTURES } from './staff-preview.mjs';
import {
  RealtorApiClient,
  validateListingSuccessorCommand,
} from '../../../packages/api-client/dist/index.js';
import { syntheticPng } from '../../../packages/media/tests/fixtures.mjs';

test(
  'native successor revision2 attaches actual synthetic image bytes and moderator approval alone selects the new public revision',
  { skip: process.platform !== 'win32', timeout: 180000 },
  async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'realtor-successor-native-'));
    t.diagnostic(`Owned synthetic media root retained: ${root}`);
    const preview = await startStaffPreview({
      port: 0,
      actor: 'admin',
      successorTerminalFixture: 'approved',
      nativeUploads: {
        mode: 'synthetic-native-v1',
        rootDirectory: root,
        powerShellPath: path.join(
          homedir(),
          '.cache',
          'codex-runtimes',
          'codex-primary-runtime',
          'dependencies',
          'native',
          'powershell',
          'pwsh.exe',
        ),
      },
    });
    try {
      const api = new RealtorApiClient({
        baseUrl: preview.origin,
        privacyNoticeVersion: 'synthetic-preview-v1',
        allowLoopbackHttp: true,
      });
      const options = { bearerToken: preview.bearerToken };
      const before = await api.getStaffListingV2(preview.listingId, options);
      assert.equal(before.latest.state, 'approved');
      assert.equal(before.publishedRevision, 1);
      assert.equal(preview.successorHistoricalMetadataOnly, true);
      const old = await api.getReviewV2(preview.listingId, 1, options);
      const command = validateListingSuccessorCommand({
        listingId: preview.listingId,
        operationId: randomUUID(),
        expectedListingVersion: before.version,
        predecessor: { revision: 1, version: before.latest.version, state: 'approved' },
        content: {
          ...old.content,
          title: 'Explicit successor with independently generated synthetic images',
        },
      });
      const original = await api.startListingRevisionV2(command, options);
      assert.equal(original.decision.outcome, 'applied');
      let workspace = await api.getStaffDraftWorkspaceV2(preview.listingId, 2, options);
      assert.equal(workspace.photos.length, 0);
      await assert.rejects(() =>
        api.submitStaffDraftV2(
          preview.listingId,
          2,
          { expectedVersion: workspace.draft.version },
          options,
        ),
      );
      const prefix = `/v2/staff/listings/${preview.listingId}/revisions/2`;
      for (let position = 0; position < 4; position++) {
        const registration = await api.registerMediaUploadV2(
          preview.listingId,
          2,
          {
            registrationId: randomUUID(),
            expectedVersion: workspace.draft.version,
            altText: `Synthetic independent image ${position + 1}`,
          },
          options,
        );
        const pixels = syntheticPng(24 + position, 24, (x, y) => [
          (x * 7 + position * 23) % 256,
          (y * 9) % 256,
          120,
          255,
        ]);
        const response = await fetch(
          preview.origin + prefix + `/media-jobs/${registration.jobId}/uploads/${randomUUID()}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${preview.bearerToken}`,
              'Content-Type': 'application/octet-stream',
            },
            body: pixels,
          },
        );
        assert.equal(response.status, 200, await response.clone().text());
        const operationId = randomUUID();
        const intent = await api.createMediaAttachIntentV2(
          preview.listingId,
          2,
          { operationId, jobId: registration.jobId, expectedVersion: workspace.draft.version },
          options,
        );
        assert.equal(intent.status, 'ready');
        assert.equal(
          (await api.getMediaAttachIntentV2(preview.listingId, 2, operationId, options)).status,
          'ready',
        );
        const applied = await api.finalizeMediaAttachIntentV2(
          preview.listingId,
          2,
          operationId,
          options,
        );
        assert.equal(applied.status, 'applied');
        assert.deepEqual(
          await api.finalizeMediaAttachIntentV2(preview.listingId, 2, operationId, options),
          applied,
        );
        workspace = await api.getStaffDraftWorkspaceV2(preview.listingId, 2, options);
        assert.equal(workspace.photos.length, position + 1);
        const media = workspace.photos[position];
        assert.equal(media.accepted, true);
        const image = await api.getStaffMediaPreviewV2(
          preview.listingId,
          2,
          media.id,
          workspace.draft.version,
          options,
        );
        assert.equal(Buffer.from(image.data).toString('ascii', 0, 4), 'RIFF');
        assert.equal(Buffer.from(image.data).toString('ascii', 8, 12), 'WEBP');
        assert.equal(
          (await api.getStaffListingV2(preview.listingId, options)).publishedRevision,
          1,
        );
      }
      const oldRead = await api.getReviewV2(preview.listingId, 1, options);
      for (let start = 0; start < workspace.photos.length; start += 2) {
        const images = await Promise.all(
          workspace.photos
            .slice(start, start + 2)
            .map((photo) =>
              api.getStaffMediaPreviewV2(
                preview.listingId,
                2,
                photo.id,
                workspace.draft.version,
                options,
              ),
            ),
        );
        assert.equal(images.length, 2);
        assert.ok(
          images.every((image) => Buffer.from(image.data).toString('ascii', 8, 12) === 'WEBP'),
        );
      }
      const { listingVersion: oldListingVersion, ...oldRevision } = old;
      const { listingVersion: currentListingVersion, ...currentOldRevision } = oldRead;
      assert.equal(oldListingVersion, before.version);
      assert.equal(currentListingVersion, original.decision.result.listingVersion);
      assert.deepEqual(
        currentOldRevision,
        oldRevision,
        'Old approved revision/content/media/review remain immutable; listing version advances.',
      );
      const submitted = await api.submitStaffDraftV2(
        preview.listingId,
        2,
        { expectedVersion: workspace.draft.version },
        options,
      );
      const review = await api.getReviewV2(preview.listingId, 2, options);
      assert.equal(review.state, 'pending');
      assert.equal(review.photos.length, 4);
      assert.equal(review.version, submitted.version);
      assert.equal((await api.getStaffListingV2(preview.listingId, options)).publishedRevision, 1);
      const approved = await api.decideReviewV2(
        preview.listingId,
        2,
        { expectedVersion: review.version, decision: 'approve', reason: null },
        options,
      );
      assert.equal(approved.state, 'approved');
      assert.equal((await api.getStaffListingV2(preview.listingId, options)).publishedRevision, 2);
      assert.deepEqual(await api.getListingSuccessorReceiptV2(command, options), original);
      const foreign =
        prefix.replace(preview.listingId, STAFF_PREVIEW_FIXTURES.sampleListingId) + '/workspace';
      assert.equal(
        (
          await fetch(preview.origin + foreign, {
            headers: { Authorization: `Bearer ${preview.bearerToken}` },
          })
        ).status,
        404,
      );
    } finally {
      await preview.close();
    }
  },
);
