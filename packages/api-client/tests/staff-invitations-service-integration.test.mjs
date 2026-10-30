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

test('committed invitation and revocation recover by GET alone after corrupt signed HTTP replies', async () => {
  const p = await startStaffPreview({
    port: 0,
    actor: 'admin',
    seedAcceptedMedia: false,
    staffInvitationMode: 'synthetic-capture-only-v1',
    invitationReplyFault: 'invalid-first-invitation-results-v1',
  });
  try {
    const calls = [];
    const api = new RealtorApiClient({
      baseUrl: p.origin,
      privacyNoticeVersion: 'synthetic-staff-notice-v1',
      allowLoopbackHttp: true,
      fetch: async (input, init) => {
        calls.push(init?.method ?? 'GET');
        return fetch(input, init);
      },
    });
    const auth = { bearerToken: p.bearerToken },
      command = intent();
    await assert.rejects(
      () => api.recordStaffInvitationRequest(command, auth),
      (e) => e.submissionUncertain === true,
    );
    assert.deepEqual(calls, ['POST']);
    const saved = await api.getStaffInvitationRequest(command.operationId, auth);
    assert.equal(saved.membershipGranted, false);
    assert.equal(saved.delivery, 'not_attempted');
    assert.deepEqual(calls, ['POST', 'GET']);
    const revoke = {
      policy: 'staff-invitation-revocation-command-v1',
      operationId: randomUUID(),
      invitationId: command.operationId,
      expectedVersion: '1',
      reason: 'Synthetic uncertain reply recovery.',
    };
    await assert.rejects(
      () => api.revokeStaffInvitationRequest(revoke, auth),
      (e) => e.submissionUncertain === true,
    );
    assert.deepEqual(calls, ['POST', 'GET', 'POST']);
    const receipt = await api.getStaffInvitationRevocation(
      command.operationId,
      revoke.operationId,
      auth,
    );
    assert.equal(receipt.outcome, 'revoked');
    assert.equal(receipt.version, '2');
    assert.equal((await api.getStaffInvitationState(command.operationId, auth)).state, 'revoked');
    assert.deepEqual(await api.getStaffInvitationRequest(command.operationId, auth), saved);
    assert.deepEqual(calls, ['POST', 'GET', 'POST', 'GET', 'GET', 'GET']);
  } finally {
    await p.close();
  }
});

test('signed invitation HTTP rejects query and caller-selected authority without creating a request', async () => {
  const p = await startStaffPreview({
    port: 0,
    actor: 'admin',
    seedAcceptedMedia: false,
    staffInvitationMode: 'synthetic-capture-only-v1',
  });
  try {
    const command = intent(),
      url = p.origin + '/v2/staff/invitation-requests/operations/' + command.operationId;
    for (const extra of [
      { 'x-tenant-id': randomUUID() },
      { 'x-actor-id': randomUUID() },
      { 'idempotency-key': randomUUID() },
      { cookie: 'session=synthetic' },
      { 'if-match': '1' },
    ]) {
      const result = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + p.bearerToken,
          'Content-Type': 'application/json',
          ...extra,
        },
        body: JSON.stringify(command),
      });
      assert.equal(result.status, 400);
    }
    assert.equal(
      (
        await fetch(url + '?tenantId=' + randomUUID(), {
          headers: { Authorization: 'Bearer ' + p.bearerToken },
        })
      ).status,
      400,
    );
    await assert.rejects(
      () =>
        client(p).getStaffInvitationRequest(command.operationId, { bearerToken: p.bearerToken }),
      (e) => e.status === 404,
    );
  } finally {
    await p.close();
  }
});

test('actual signed private directory pages retain current invitation states and enforce exact query bounds', async () => {
  const p = await startStaffPreview({
    port: 0,
    actor: 'admin',
    seedAcceptedMedia: false,
    staffInvitationMode: 'synthetic-capture-only-v1',
  });
  try {
    const api = client(p),
      auth = { bearerToken: p.bearerToken };
    const commands = [intent(), intent(), intent()].sort((a, b) =>
      a.operationId.localeCompare(b.operationId),
    );
    for (const command of commands) await api.recordStaffInvitationRequest(command, auth);
    const read = async (path) =>
      fetch(p.origin + path, { headers: { Authorization: 'Bearer ' + p.bearerToken } });
    let r = await read('/v2/staff/invitation-requests?limit=2');
    assert.equal(r.status, 200);
    const first = await r.json();
    assert.deepEqual(
      first.items.map((x) => x.operationId),
      commands.slice(0, 2).map((x) => x.operationId),
    );
    assert.equal(first.nextAfter, commands[1].operationId);
    r = await read('/v2/staff/invitation-requests?limit=2&after=' + first.nextAfter);
    const last = await r.json();
    assert.deepEqual(
      last.items.map((x) => x.operationId),
      [commands[2].operationId],
    );
    assert.equal(last.nextAfter, null);
    r = await read('/v2/staff/branches?limit=20');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      policy: 'staff-branch-page-v1',
      items: [],
      nextAfter: null,
    });
    for (const path of [
      '/v2/staff/branches?limit=21',
      '/v2/staff/invitation-requests?limit=2&tenantId=bad',
      '/v2/staff/branches?limit=2&limit=2',
    ])
      assert.equal((await read(path)).status, 400);
  } finally {
    await p.close();
  }
});
test('actual signed agent and foreign-company actor cannot list either private directory', async () => {
  for (const actor of ['agent', 'other-company-admin']) {
    const p = await startStaffPreview({
      port: 0,
      actor,
      seedAcceptedMedia: false,
      staffInvitationMode: 'synthetic-capture-only-v1',
    });
    try {
      for (const path of ['/v2/staff/branches?limit=2', '/v2/staff/invitation-requests?limit=2'])
        assert.equal(
          (await fetch(p.origin + path, { headers: { Authorization: 'Bearer ' + p.bearerToken } }))
            .status,
          403,
        );
    } finally {
      await p.close();
    }
  }
});
