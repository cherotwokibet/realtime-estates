import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CustomerFavouritesClient, RealtorApiClient } from '@realtor/api-client';
import { startCustomerPreview } from '../../api/dev/customer-preview.mjs';
import { privateRecoveryRequest } from '../dist/tests/lib/private-recovery-server.js';
import { privateWorkspaceLeaseRequest } from '../dist/tests/lib/private-workspace-lease-server.js';
import { deletionTriageBoundary } from '../dist/tests/lib/deletion-triage-server.js';
import { recoveryReceipt } from '../dist/tests/lib/private-recovery-contract.js';
test('signed SQL-backed reviewer recovery survives three lost write replies and refuses privacy designation removal', async (t) => {
  const prior = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  t.after(() => {
    if (prior === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prior;
  });
  const preview = await startCustomerPreview({
    pushMode: 'synthetic-customer-push-v1',
    deletionMode: 'synthetic-customer-deletion-v1',
    deletionReviewMode: 'synthetic-admin-deletion-review-v1',
    deletionFollowUpMode: 'synthetic-customer-deletion-follow-up-v1',
    deletionPrivacyMode: 'synthetic-deletion-privacy-v1',
    deletionReviewReplyFault: 'lost-first-deletion-review-v1',
    deletionReturnReplyFault: 'lost-first-deletion-return-v1',
    deletionPrivacyReplyFault: 'lost-first-deletion-privacy-v1',
  });
  t.after(() => preview.close());
  const triager = await preview.deletionReviewStaff(),
    reviewer = await preview.deletionPrivacyStaff();
  const instanceId = randomUUID(),
    origin = 'http://127.0.0.1:49101';
  const env = {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_API_ORIGIN: preview.origin,
    STAFF_PREVIEW_INSTANCE: instanceId,
    STAFF_PREVIEW_TOKEN: triager.token,
    STAFF_DELETION_TRIAGE_MODE: 'synthetic-v1',
    STAFF_DELETION_TRIAGE_TENANT: preview.tenantId,
    STAFF_DELETION_TRIAGE_REVIEWER: triager.reviewerId,
    STAFF_DELETION_FOLLOW_UP: 'synthetic-v1',
    STAFF_DELETION_PRIVACY_MODE: 'synthetic-v1',
    STAFF_DELETION_PRIVACY_TOKEN: reviewer.token,
    STAFF_DELETION_PRIVACY_REVIEWER: reviewer.reviewerId,
    PRIVATE_RECOVERY_MODE: 'synthetic-sealed-original-v1',
    PRIVATE_RECOVERY_STORAGE_KEY: 'ea'.repeat(32),
  };
  const req = (path, body) =>
    new Request(origin + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        host: '127.0.0.1:49101',
        origin,
        'x-preview-instance': instanceId,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const user = preview.configuration(origin).users[0],
    requestId = randomUUID();
  const customer = new CustomerFavouritesClient({
    baseUrl: preview.origin,
    allowLoopbackHttp: true,
    scope: { tenantId: preview.tenantId, customerId: user.id },
  });
  await customer.requestAccountDeletion(
    { policy: 'synthetic-customer-deletion-command-v1', requestId, confirmed: true },
    { bearerToken: user.bearerToken },
  );
  let privacyEnvelope;
  for (const variant of ['triage', 'return', 'privacy']) {
    const kind = variant === 'privacy' ? 'deletion-privacy' : 'deletion-triage',
      scope = {
        instanceId,
        tenantId: preview.tenantId,
        actorId: variant === 'privacy' ? reviewer.reviewerId : triager.reviewerId,
      };
    const target = { customerId: user.id, requestId, operationId: randomUUID() };
    const command =
      variant === 'privacy'
        ? { ...target, decision: 'hold' }
        : variant === 'return'
          ? target
          : {
              policy: 'synthetic-customer-deletion-review-command-v1',
              ...target,
              disposition: 'needs_information',
            };
    const path =
      '/api/' +
      kind +
      '/' +
      target.customerId +
      '/' +
      target.requestId +
      '/' +
      target.operationId +
      (variant === 'return' ? '/return' : '');
    const action = variant === 'privacy' ? 'privacy' : variant === 'return' ? 'return' : 'triage';
    const lease = await privateWorkspaceLeaseRequest(
      req('/api/private-workspace/lease/' + kind),
      kind,
      env,
    );
    assert.equal(lease.status, 200);
    assert.equal((await lease.json()).actorId, scope.actorId);
    const sealed = await privateRecoveryRequest(
      req('/api/private-workspace/recovery/' + kind + '/seal', { scope, command }),
      kind,
      'seal',
      env,
    );
    assert.equal(sealed.status, 200);
    const envelope = await sealed.json();
    const sent = await deletionTriageBoundary(req(path, command), target, env, undefined, action);
    assert.ok(sent.status >= 500, 'fault must lose committed write reply');
    const opened = await privateRecoveryRequest(
      req('/api/private-workspace/recovery/' + kind + '/open', { scope, envelope }),
      kind,
      'open',
      env,
    );
    assert.equal(opened.status, 200);
    assert.deepEqual(await opened.json(), command);
    const read = await deletionTriageBoundary(req(path), target, env, undefined, action);
    assert.equal(read.status, 200);
    const receipt = await read.json();
    recoveryReceipt(scope, kind, command, receipt);
    if (variant === 'privacy') privacyEnvelope = { scope, envelope };
  }
  await reviewer.revoke();
  const api = new RealtorApiClient({
    baseUrl: preview.origin,
    allowLoopbackHttp: true,
    privacyNoticeVersion: 'test',
  });
  assert.equal(
    (await api.getCurrentStaffAccessLeaseV2({ bearerToken: reviewer.token })).role,
    'admin',
    'designation removal deliberately leaves ordinary admin membership',
  );
  assert.equal(
    (
      await privateWorkspaceLeaseRequest(
        req('/api/private-workspace/lease/deletion-privacy'),
        'deletion-privacy',
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await privateRecoveryRequest(
        req('/api/private-workspace/recovery/deletion-privacy/open', privacyEnvelope),
        'deletion-privacy',
        'open',
        env,
      )
    ).status,
    403,
  );
});
