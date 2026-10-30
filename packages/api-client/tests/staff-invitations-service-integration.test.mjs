import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RealtorApiClient } from '../dist/index.js';
import { startStaffPreview } from '../../../apps/api/dev/staff-preview.mjs';
const intent = () => ({
  policy: 'staff-invitation-intent-v1',
  operationId: randomUUID(),
  recipientEmail: 'synthetic@example.invalid',
  requestedRole: 'agent',
  branchId: null,
  expiresAfterHours: 72,
});
const client = (p) =>
  new RealtorApiClient({
    baseUrl: p.origin,
    privacyNoticeVersion: 'synthetic-staff-notice-v1',
    allowLoopbackHttp: true,
  });
test('signed HTTP invitation capture, original and revocation preserve exact historical receipts', async () => {
  const p = await startStaffPreview({
    port: 0,
    actor: 'admin',
    seedAcceptedMedia: false,
    staffInvitationMode: 'synthetic-capture-only-v1',
  });
  try {
    const api = client(p),
      auth = { bearerToken: p.bearerToken },
      command = intent();
    const saved = await api.recordStaffInvitationRequest(command, auth);
    assert.equal(saved.membershipGranted, false);
    assert.equal(saved.delivery, 'not_attempted');
    assert.deepEqual(await api.getStaffInvitationRequest(command.operationId, auth), saved);
    assert.deepEqual(await api.recordStaffInvitationRequest(command, auth), saved);
    assert.equal((await api.getStaffInvitationState(command.operationId, auth)).state, 'pending');
    const revoke = {
      policy: 'staff-invitation-revocation-command-v1',
      operationId: randomUUID(),
      invitationId: command.operationId,
      expectedVersion: '1',
      reason: 'Synthetic cancellation.',
    };
    const receipt = await api.revokeStaffInvitationRequest(revoke, auth);
    assert.equal(receipt.outcome, 'revoked');
    assert.deepEqual(
      await api.getStaffInvitationRevocation(command.operationId, revoke.operationId, auth),
      receipt,
    );
    assert.equal((await api.getStaffInvitationState(command.operationId, auth)).state, 'revoked');
    assert.deepEqual(await api.getStaffInvitationRequest(command.operationId, auth), saved);
    await assert.rejects(
      () =>
        api.getStaffInvitationRequest(command.operationId, { bearerToken: p.bearerToken + 'x' }),
      (e) => e.status === 401,
    );
  } finally {
    await p.close();
  }
});
for (const actor of ['agent', 'other-company-admin'])
  test(`signed ${actor} cannot capture an invitation`, async () => {
    const p = await startStaffPreview({
      port: 0,
      actor,
      seedAcceptedMedia: false,
      staffInvitationMode: 'synthetic-capture-only-v1',
    });
    try {
      await assert.rejects(
        () => client(p).recordStaffInvitationRequest(intent(), { bearerToken: p.bearerToken }),
        (e) => e.status === 403,
      );
    } finally {
      await p.close();
    }
  });

test('invitation preview stays default-off and rejects unknown fixture modes', async () => {
  await assert.rejects(
    () => startStaffPreview({ port: 0, staffInvitationMode: 'enable' }),
    /Unsupported synthetic staff invitation mode/,
  );
  const p = await startStaffPreview({ port: 0, actor: 'admin', seedAcceptedMedia: false });
  try {
    const response = await fetch(
      p.origin + '/v2/staff/invitation-requests/operations/' + randomUUID(),
      { headers: { Authorization: 'Bearer ' + p.bearerToken } },
    );
    assert.equal(response.status, 404);
  } finally {
    await p.close();
  }
});
