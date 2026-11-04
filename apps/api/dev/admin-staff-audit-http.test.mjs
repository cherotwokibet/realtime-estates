import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RealtorApiClient } from '@realtor/api-client';
import { T, ADMIN, AGENT } from '../../../database/tests/public-media-fixtures.mjs';
import { startAdminCommandFixture } from './admin-command-fixtures.mjs';

test('signed staff commands audit only applied changes with original request attribution', async () => {
  const fixture = await startAdminCommandFixture({ staff: true });
  try {
    let requestId;
    const [api, foreignApi] = fixture.origins.map(
      (baseUrl) =>
        new RealtorApiClient({
          baseUrl,
          privacyNoticeVersion: 'settings-audit323',
          allowLoopbackHttp: true,
          fetch: async (url, init) => {
            const response = await fetch(url, init);
            requestId = response.headers.get('x-request-id');
            assert.ok(requestId);
            return response;
          },
        }),
    );
    const admin = { bearerToken: await fixture.token(ADMIN) };
    const foreign = { bearerToken: await fixture.token('00000000-0000-4000-8000-000000000020') };
    const branch = {
      policy: 'staff-branch-command-v1',
      operationId: randomUUID(),
      branchId: randomUUID(),
      expectedVersion: '0',
      name: 'Synthetic branch',
      active: true,
      reason: 'Synthetic creation.',
    };
    const membership = {
      policy: 'staff-membership-command-v1',
      operationId: randomUUID(),
      memberId: AGENT,
      expectedVersion: '1',
      requestedRole: 'agent',
      active: false,
      reason: 'Synthetic access revocation.',
    };
    const invite = {
      policy: 'staff-invitation-intent-v1',
      operationId: randomUUID(),
      recipientEmail: 'synthetic@example.invalid',
      requestedRole: 'agent',
      branchId: null,
      expiresAfterHours: 72,
    };
    const revoke = {
      policy: 'staff-invitation-revocation-command-v1',
      operationId: randomUUID(),
      invitationId: invite.operationId,
      expectedVersion: '1',
      reason: 'Synthetic cancellation.',
    };
    const expected = [];
    for (const [method, command, action, type, object, version, summary] of [
      ['saveStaffBranch', branch, 'branch_saved', 'staff_branch', branch.branchId, '1', {}],
      [
        'saveStaffMembership',
        membership,
        'membership_saved',
        'staff_membership',
        AGENT,
        '2',
        { operationId: membership.operationId, role: 'agent', active: false },
      ],
      [
        'recordStaffInvitationRequest',
        invite,
        'invitation_request_recorded',
        'staff_invitation',
        invite.operationId,
        '1',
        {},
      ],
      [
        'revokeStaffInvitationRequest',
        revoke,
        'invitation_request_revoked',
        'staff_invitation',
        invite.operationId,
        '2',
        {},
      ],
    ]) {
      const result = await api[method](command, admin);
      expected.push({
        tenant_id: T,
        actor_id: ADMIN,
        action: 'staff.' + action,
        object_type: type,
        object_id: object,
        object_version: version,
        correlation_id: requestId,
        summary,
      });
      assert.deepEqual(await api[method](command, admin), result);
      if (command === branch || command === membership) {
        assert.equal(result.outcome, 'applied');
        const retry = { ...command, operationId: randomUUID() };
        assert.equal((await api[method](retry, admin)).outcome, 'conflict');
        assert.equal(
          (
            await api[method](
              { ...retry, operationId: randomUUID(), expectedVersion: version },
              admin,
            )
          ).outcome,
          'unchanged',
        );
      }
    }
    await assert.rejects(
      () =>
        foreignApi.revokeStaffInvitationRequest({ ...revoke, operationId: randomUUID() }, foreign),
      (error) => error.status === 404,
    );
    const { rows } = await fixture.db.query(
      "SELECT tenant_id,actor_id,action,object_type,object_id,object_version::text,correlation_id,summary FROM app_private.audit_events WHERE action LIKE 'staff.%' ORDER BY id",
    );
    assert.deepEqual(rows, expected);
  } finally {
    await fixture.close();
  }
});
