import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { startStaffPreview } from './staff-preview.mjs';
import { RealtorApiClient } from '../../../packages/api-client/dist/index.js';
import { syntheticPng } from '../../../packages/media/tests/fixtures.mjs';
test(
  'actual image-backed 0/3/4/12/13 boundaries retain duplicate receipts, reject corrupt input and never attach the thirteenth photo',
  { skip: process.platform !== 'win32', timeout: 180000 },
  async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'realtor native boundaries '));
    t.diagnostic(`Owned synthetic image boundary root retained: ${root}`);
    const preview = await startStaffPreview({
      port: 0,
      actor: 'admin',
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
        }),
        options = { bearerToken: preview.bearerToken };
      let workspace = await api.getStaffDraftWorkspaceV2(
        preview.listingId,
        preview.revision,
        options,
      );
      assert.equal(workspace.photos.length, 0);
      const base = `/v2/staff/listings/${preview.listingId}/revisions/${preview.revision}`;
      const submit = () =>
        api.submitStaffDraftV2(
          preview.listingId,
          preview.revision,
          { expectedVersion: workspace.draft.version },
          options,
        );
      await assert.rejects(submit);
      assert.equal(
        (await api.getStaffDraftWorkspaceV2(preview.listingId, preview.revision, options)).draft
          .version,
        workspace.draft.version,
      );
      async function register() {
        return api.registerMediaUploadV2(
          preview.listingId,
          preview.revision,
          {
            registrationId: randomUUID(),
            expectedVersion: workspace.draft.version,
            altText: 'Independently generated synthetic boundary image',
          },
          options,
        );
      }
      async function upload(registration, pixels) {
        const uploadId = randomUUID(),
          url = preview.origin + base + `/media-jobs/${registration.jobId}/uploads/${uploadId}`;
        const response = await fetch(url, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${preview.bearerToken}`,
            'Content-Type': 'application/octet-stream',
          },
          body: pixels,
        });
        assert.equal(response.status, 200, await response.clone().text());
        const result = await response.json();
        const read = await fetch(url, {
          headers: { Authorization: `Bearer ${preview.bearerToken}` },
        });
        assert.equal(read.status, 200);
        assert.deepEqual(await read.json(), result);
        return result;
      }
      const corrupt = await register(),
        bad = await upload(
          corrupt,
          Buffer.from('This is not a PNG despite its intended extension.'),
        );
      assert.equal(bad.state, 'native_failed');
      assert.equal(
        (await api.getStaffDraftWorkspaceV2(preview.listingId, preview.revision, options)).photos
          .length,
        0,
      );
      for (let position = 0; position < 13; position++) {
        const registration = await register();
        const pixels = syntheticPng(32 + position, 24, (x, y) => [
          (x * 9 + position * 17) % 256,
          (y * 11) % 256,
          80 + position,
          255,
        ]);
        const verified = await upload(registration, pixels);
        assert.equal(verified.state, 'verified');
        const operationId = randomUUID(),
          intent = await api.createMediaAttachIntentV2(
            preview.listingId,
            preview.revision,
            { operationId, jobId: registration.jobId, expectedVersion: workspace.draft.version },
            options,
          );
        assert.equal(intent.status, 'ready');
        const before = workspace.draft.version,
          receipt = await api.finalizeMediaAttachIntentV2(
            preview.listingId,
            preview.revision,
            operationId,
            options,
          );
        assert.deepEqual(
          await api.finalizeMediaAttachIntentV2(
            preview.listingId,
            preview.revision,
            operationId,
            options,
          ),
          receipt,
        );
        workspace = await api.getStaffDraftWorkspaceV2(
          preview.listingId,
          preview.revision,
          options,
        );
        if (position < 12) {
          assert.equal(receipt.status, 'applied');
          assert.equal(workspace.photos.length, position + 1);
          assert.notEqual(workspace.draft.version, before);
        } else {
          assert.equal(receipt.status, 'rejected');
          assert.equal(receipt.receipt.reason, 'CAPACITY_REACHED');
          assert.equal(workspace.photos.length, 12);
          assert.equal(workspace.draft.version, before);
        }
        if (position === 2) {
          await assert.rejects(submit);
          assert.equal(
            (await api.getStaffDraftWorkspaceV2(preview.listingId, preview.revision, options))
              .photos.length,
            3,
          );
        }
        if (position === 3) {
          assert.equal(workspace.photos.length, 4);
          assert.ok(workspace.photos.every((photo) => photo.accepted));
        }
      }
      assert.equal(new Set(workspace.photos.map((photo) => photo.id)).size, 12);
      const submitted = await submit(),
        review = await api.getReviewV2(preview.listingId, preview.revision, options);
      assert.equal(review.state, 'pending');
      assert.equal(review.photos.length, 12);
      assert.equal(review.version, submitted.version);
      assert.equal(
        (await api.getStaffListingV2(preview.listingId, options)).publishedRevision,
        null,
      );
    } finally {
      await preview.close();
    }
  },
);
