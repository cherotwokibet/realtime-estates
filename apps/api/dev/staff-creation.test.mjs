import test from 'node:test';
import assert from 'node:assert/strict';
import { startStaffPreview } from './staff-preview.mjs';
import {
  RealtorApiClient,
  validateListingCreationCommand,
} from '../../../packages/api-client/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('synthetic creation preview corrupts only the first committed created reply and exact GET recovers it', async () => {
  const p = await startStaffPreview({ port: 0, creationReplyFault: 'invalid-first-created-v1' });
  try {
    const api = new RealtorApiClient({
        baseUrl: p.origin,
        privacyNoticeVersion: 'synthetic-preview-v1',
        allowLoopbackHttp: true,
      }),
      options = { bearerToken: p.bearerToken },
      command = validateListingCreationCommand({
        listingId: id(9000),
        operationId: id(9100),
        slug: 'synthetic-preview-created',
        content: {
          title: 'Synthetic creation preview',
          pricing: { declaration: 'not_declared', charges: [] },
          location: { county: null, town: null, area: null },
        },
      });
    assert.equal(
      (
        await api.createListingV2(
          {
            ...command,
            listingId: p.listingId,
            operationId: id(9101),
            slug: 'synthetic-collision',
          },
          options,
        )
      ).outcome,
      'refused',
    );
    await assert.rejects(
      () => api.createListingV2(command, options),
      (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain,
    );
    const saved = await api.getListingCreationReceiptV2(command, options);
    assert.equal(saved.outcome, 'created');
    assert.deepEqual(await api.createListingV2(command, options), saved);
    assert.equal(
      (
        await api.createListingV2(
          {
            ...command,
            listingId: id(9002),
            operationId: id(9102),
            slug: 'second-synthetic-created',
          },
          options,
        )
      ).outcome,
      'created',
    );
    assert.equal((await api.listStaffListingsV2({ ...options, limit: 25 })).items.length, 3);
    const path = `/v2/staff/listings/${command.listingId}/creation-operations/${command.operationId}`;
    assert.equal(
      (
        await fetch(p.origin + path, {
          method: 'PUT',
          headers: { authorization: 'Bearer ' + p.bearerToken },
        })
      ).status,
      405,
    );
    assert.equal(
      (
        await fetch(p.origin + path + '?actor=admin', {
          headers: { authorization: 'Bearer ' + p.bearerToken },
        })
      ).status,
      400,
    );
  } finally {
    await p.close();
  }
});
test('synthetic creation reply fault accepts only explicit supported mode', async () => {
  await assert.rejects(() => startStaffPreview({ port: 0, creationReplyFault: 'always-corrupt' }));
});
