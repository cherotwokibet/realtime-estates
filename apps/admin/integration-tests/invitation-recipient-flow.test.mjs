import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RealtorApiClient } from '@realtor/api-client';
import { startStaffPreview } from '../../api/dev/staff-preview.mjs';
import {
  invitationRecipientBoundary,
  loadInvitationRecipientContext,
} from '../dist/tests/lib/invitation-recipient-server.js';
import { staffDirectoryBoundary } from '../dist/tests/lib/staff-directory-server.js';
import { createStaffDirectoryClient } from '../dist/tests/lib/staff-directory-client.js';
import { createStaffWriteController } from '../dist/tests/lib/staff-write-controller.js';
const mode = {
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
  STAFF_INVITATION_RECIPIENT_PREVIEW_MODE: 'synthetic-verified-recipient-v1',
  STAFF_INVITATION_RECIPIENT_TOKEN: p.invitationRecipient.bearerToken,
  STAFF_PREVIEW_API_ORIGIN: p.origin,
  STAFF_PREVIEW_INSTANCE: randomUUID(),
});
const memory = () => {
  const values = new Map();
  return {
    values,
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
};
function browser(settings, methods) {
  return createStaffDirectoryClient(
    { instanceId: settings.STAFF_PREVIEW_INSTANCE },
    async (path, init) => {
      methods.push(init.method);
      const match = /^\/api\/invitation-acceptance\/([^/]+)\/operations\/([^/]+)$/.exec(path),
        target = match ? { invitationId: match[1], operationId: match[2] } : null;
      const request = new Request('http://localhost:3120' + path, {
        ...init,
        headers: {
          ...init.headers,
          host: '127.0.0.1:3120',
          ...(init.method === 'POST' ? { origin: 'http://127.0.0.1:3120' } : {}),
        },
      });
      return invitationRecipientBoundary(request, target, settings);
    },
  );
}
async function issue(p, email = p.invitationRecipient.recipientEmail) {
  const api = new RealtorApiClient({
      baseUrl: p.origin,
      allowLoopbackHttp: true,
      privacyNoticeVersion: 'synthetic-v1',
    }),
    auth = { bearerToken: p.bearerToken },
    invitationId = randomUUID();
  await api.recordStaffInvitationRequest(
    {
      policy: 'staff-invitation-intent-v1',
      operationId: invitationId,
      recipientEmail: email,
      requestedRole: 'agent',
      branchId: null,
      expiresAfterHours: 24,
    },
    auth,
  );
  const issued = await api.issueStaffInvitation(
    { policy: 'staff-invitation-issue-command-v1', operationId: randomUUID(), invitationId },
    auth,
  );
  return {
    api,
    auth,
    secret: issued.secret,
    command: {
      policy: 'staff-invitation-redemption-command-v1',
      invitationId,
      operationId: randomUUID(),
    },
  };
}

test('separate signed recipient BFF/controller grants only the captured role and no admin bearer is available to staff proxies', async () => {
  const p = await startStaffPreview(mode);
  try {
    assert.equal(JSON.stringify(p).includes(p.invitationRecipient.bearerToken), false);
    assert.notEqual(p.invitationRecipient.bearerToken, p.bearerToken);
    const settings = env(p),
      data = await loadInvitationRecipientContext(settings),
      { api, auth, secret, command } = await issue(p),
      methods = [],
      storage = memory(),
      client = browser(settings, methods),
      scope = {
        instanceId: data.instanceId,
        tenantId: data.session.tenantId,
        actorId: data.session.actorId,
      };
    assert.equal(data.session.authority, 'identity_only');
    const before = await api.listStaffMemberships({ limit: 20, after: null }, auth);
    assert.ok(!before.items.some((m) => m.memberId === scope.actorId));
    const c = createStaffWriteController({ scope, store: storage, client });
    c.prepare('acceptance', command);
    await c.submit(secret);
    assert.equal(c.snapshot().attempt.receipt.memberId, scope.actorId);
    assert.equal(c.snapshot().attempt.receipt.requestedRole, 'agent');
    assert.ok(![...storage.values.values()].join('').includes(secret));
    const staff = await api.getCurrentStaffSessionV2({
      bearerToken: p.invitationRecipient.bearerToken,
    });
    assert.equal(staff.actorId, scope.actorId);
    assert.equal((await api.getStaffMembership(scope.actorId, auth)).role, 'agent');
    assert.deepEqual(methods, ['POST']);
    const request = new Request('http://localhost:3120/api/staff-directory/branches?limit=10', {
      headers: { host: '127.0.0.1:3120', 'x-preview-instance': settings.STAFF_PREVIEW_INSTANCE },
    });
    assert.equal((await staffDirectoryBoundary(request, 'branches', settings)).status, 403);
  } finally {
    await p.close();
  }
});

test('lost committed grant recovers the same retained original after reload and replay cannot reactivate revoked membership', async () => {
  const p = await startStaffPreview({
    ...mode,
    invitationRedemptionReplyFault: 'invalid-first-redemption-result-v1',
  });
  try {
    const settings = env(p),
      data = await loadInvitationRecipientContext(settings),
      { api, auth, secret, command } = await issue(p),
      methods = [],
      storage = memory(),
      client = browser(settings, methods),
      scope = {
        instanceId: data.instanceId,
        tenantId: data.session.tenantId,
        actorId: data.session.actorId,
      };
    const first = createStaffWriteController({ scope, store: storage, client });
    first.prepare('acceptance', command);
    await assert.rejects(() => first.submit(secret));
    assert.equal(first.snapshot().attempt.phase, 'uncertain');
    first.close();
    const resumed = createStaffWriteController({ scope, store: storage, client });
    assert.equal(resumed.snapshot().attempt.command.operationId, command.operationId);
    await resumed.recover();
    assert.deepEqual(methods, ['POST', 'GET']);
    const member = await api.getStaffMembership(scope.actorId, auth);
    assert.equal(member.active, true);
    await api.saveStaffMembership(
      {
        policy: 'staff-membership-command-v1',
        operationId: randomUUID(),
        memberId: scope.actorId,
        expectedVersion: member.version,
        requestedRole: 'agent',
        active: false,
        reason: 'Synthetic post-acceptance removal.',
      },
      auth,
    );
    const replay = await client.acceptInvitation(command, secret);
    assert.equal(replay.memberId, scope.actorId);
    assert.equal((await api.getStaffMembership(scope.actorId, auth)).active, false);
    assert.equal((await api.getStaffInvitationState(command.invitationId, auth)).state, 'used');
  } finally {
    await p.close();
  }
});

test('verified but wrong recipient cannot accept another address and a known refusal can be acknowledged safely', async () => {
  const p = await startStaffPreview(mode);
  try {
    const settings = env(p),
      data = await loadInvitationRecipientContext(settings),
      { api, auth, secret, command } = await issue(p, 'another@example.invalid'),
      methods = [],
      client = browser(settings, methods),
      scope = {
        instanceId: data.instanceId,
        tenantId: data.session.tenantId,
        actorId: data.session.actorId,
      },
      c = createStaffWriteController({ scope, store: memory(), client });
    c.prepare('acceptance', command);
    await assert.rejects(() => c.submit(secret));
    assert.equal(c.snapshot().attempt.phase, 'refused');
    c.clear();
    assert.ok(
      !(await api.listStaffMemberships({ limit: 20, after: null }, auth)).items.some(
        (m) => m.memberId === scope.actorId,
      ),
    );
    assert.deepEqual(methods, ['POST']);
  } finally {
    await p.close();
  }
});
