import test from 'node:test';
import assert from 'node:assert/strict';
import { startStaffPreview } from './staff-preview.mjs';
import { RealtorApiClient } from '../../../packages/api-client/dist/index.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
test('disposable preview forwards explicit original resolution through its host guard, signed SDK/API and current SQL authority', async () => {
  const preview = await startStaffPreview({ port: 0, actor: 'admin' });
  try {
    const api = new RealtorApiClient({
        baseUrl: preview.origin,
        allowLoopbackHttp: true,
        privacyNoticeVersion: 'synthetic-staff-notice-v1',
      }),
      original = {
        policy: 'listing-report-decision-command-v1',
        operationId: id(9900),
        reportId: id(9901),
        expectedVersion: '1',
        decision: 'reviewed',
        reason: 'Synthetic retirement',
      };
    const first = await api.resolvePrivateOperation('report', original, {
      bearerToken: preview.bearerToken,
    });
    assert.equal(first.outcome, 'cancelled');
    assert.deepEqual(first.request, original);
    assert.deepEqual(
      await api.resolvePrivateOperation('report', original, { bearerToken: preview.bearerToken }),
      first,
    );
  } finally {
    await preview.close();
  }
});
