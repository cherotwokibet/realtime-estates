import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RealtorApiClient } from '@realtor/api-client';
import { startStaffPreview } from '../../api/dev/staff-preview.mjs';
import { createStaffDirectoryClient } from '../dist/tests/lib/staff-directory-client.js';
import { createStaffWriteController } from '../dist/tests/lib/staff-write-controller.js';
import { staffInvitationIssueBoundary } from '../dist/tests/lib/staff-invitation-issue-server.js';
import { loadStaffDirectoryWorkspace } from '../dist/tests/lib/staff-directory-server.js';
const options = {
  port: 0,
  actor: 'admin',
  seedAcceptedMedia: false,
  staffInvitationMode: 'synthetic-capture-only-v1',
  staffMembershipMode: 'synthetic-existing-members-v1',
  staffInvitationRedemptionMode: 'synthetic-single-use-invitations-v1',
};
const env = (p) => ({
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_DIRECTORY_PREVIEW_MODE: 'synthetic-v1',
  STAFF_INVITATION_ISSUE_PREVIEW_MODE: 'synthetic-single-use-invitations-v1',
  STAFF_PREVIEW_API_ORIGIN: p.origin,
  STAFF_PREVIEW_TOKEN: p.bearerToken,
  STAFF_PREVIEW_INSTANCE: randomUUID(),
});
const api = (p) =>
  new RealtorApiClient({
    baseUrl: p.origin,
    privacyNoticeVersion: 'synthetic-v1',
    allowLoopbackHttp: true,
  });
const intent = () => ({
  policy: 'staff-invitation-intent-v1',
  operationId: randomUUID(),
  recipientEmail: 'synthetic-issue@example.invalid',
  requestedRole: 'agent',
  branchId: null,
  expiresAfterHours: 24,
});
function uiClient(settings, methods) {
  return createStaffDirectoryClient(
    { instanceId: settings.STAFF_PREVIEW_INSTANCE },
    async (path, init) => {
      methods.push(init.method);
      const match =
        /^\/api\/staff-directory\/invitation-issues\/([^/]+)\/operations\/([^/]+)(\/state)?$/.exec(
          path,
        );
      assert.ok(match);
      const request = new Request('http://localhost:3120' + path, {
        ...init,
        headers: {
          ...init.headers,
          host: '127.0.0.1:3120',
          ...(init.method === 'POST' ? { origin: 'http://127.0.0.1:3120' } : {}),
        },
      });
      return staffInvitationIssueBoundary(request, match[1], match[2], !!match[3], settings);
    },
  );
}
const memory = () => {
  const values = new Map();
  return {
    values,
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
};

test('retained admin issuance connects BFF and SDK to signed HTTP/SQL, and current directory no longer labels issued requests pending', async () => {
  const p = await startStaffPreview(options);
  try {
    const settings = env(p),
      auth = { bearerToken: p.bearerToken },
      service = api(p),
      capture = intent();
    await service.recordStaffInvitationRequest(capture, auth);
    const data = await loadStaffDirectoryWorkspace(settings);
    assert.equal(data.issuanceEnabled, true);
    assert.equal(data.invitations.items[0].state, 'pending');
    const methods = [],
      storage = memory(),
      client = uiClient(settings, methods),
      c = createStaffWriteController({ scope: data.scope, store: storage, client });
    const command = {
      policy: 'staff-invitation-issue-command-v1',
      operationId: randomUUID(),
      invitationId: capture.operationId,
    };
    c.prepare('issuance', command);
    await c.submit();
    assert.equal(c.snapshot().secretAvailable, true);
    const secret = c.takeSecretOnce();
    assert.equal(secret.length, 43);
    assert.ok(![...storage.values.values()].join('').includes(secret));
    assert.throws(() => c.takeSecretOnce());
    const refused = createStaffWriteController({ scope: data.scope, store: memory(), client });
    refused.prepare('issuance', { ...command, operationId: randomUUID() });
    await assert.rejects(() => refused.submit());
    assert.equal(refused.snapshot().attempt.phase, 'refused');
    assert.equal(refused.snapshot().secretAvailable, false);
    refused.clear();
    assert.equal(
      (await service.getStaffInvitationState(capture.operationId, auth)).state,
      'issued',
    );
    assert.equal(
      (await service.listStaffInvitationRequests({ limit: 10, after: null }, auth)).items[0].state,
      'issued',
    );
    assert.equal((await client.getIssuedInvitationState(command)).state, 'issued');
    await service.revokeStaffInvitationRequest(
      {
        policy: 'staff-invitation-revocation-command-v1',
        operationId: randomUUID(),
        invitationId: capture.operationId,
        expectedVersion: '1',
        reason: 'Synthetic lost code replacement.',
      },
      auth,
    );
    assert.equal((await client.getIssuedInvitationState(command)).state, 'revoked');
    assert.equal(
      (await service.getStaffInvitationState(capture.operationId, auth)).state,
      'revoked',
    );
    const recovered = await service.getStaffInvitationIssue(command, auth);
    assert.equal(recovered.membershipGranted, false);
    assert.deepEqual(methods, ['POST', 'POST', 'GET', 'GET']);
  } finally {
    await p.close();
  }
});

test('committed corrupt issuance response survives controller reload and recovers by GET with no secret regeneration', async () => {
  const p = await startStaffPreview({
    ...options,
    invitationReplyFault: 'invalid-first-invitation-results-v1',
  });
  try {
    const settings = env(p),
      auth = { bearerToken: p.bearerToken },
      service = api(p),
      capture = intent();
    await assert.rejects(() => service.recordStaffInvitationRequest(capture, auth));
    await service.getStaffInvitationRequest(capture.operationId, auth);
    const data = await loadStaffDirectoryWorkspace(settings),
      storage = memory(),
      methods = [],
      client = uiClient(settings, methods),
      first = createStaffWriteController({ scope: data.scope, store: storage, client });
    const command = {
      policy: 'staff-invitation-issue-command-v1',
      operationId: randomUUID(),
      invitationId: capture.operationId,
    };
    first.prepare('issuance', command);
    await assert.rejects(() => first.submit());
    assert.equal(first.snapshot().attempt.phase, 'uncertain');
    first.close();
    const resumed = createStaffWriteController({ scope: data.scope, store: storage, client });
    assert.equal(resumed.snapshot().attempt.command.operationId, command.operationId);
    await resumed.recover();
    assert.deepEqual(methods, ['POST', 'GET']);
    assert.equal(resumed.snapshot().secretAvailable, false);
    assert.equal(resumed.snapshot().attempt.phase, 'resolved');
    assert.throws(() => resumed.takeSecretOnce());
    const replay = await service.issueStaffInvitation(command, auth);
    assert.equal(replay.secret, null);
    assert.equal(
      (await service.getStaffInvitationState(capture.operationId, auth)).state,
      'issued',
    );
  } finally {
    await p.close();
  }
});
