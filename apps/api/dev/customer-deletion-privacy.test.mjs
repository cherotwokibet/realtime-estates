import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RealtorApiClient, CustomerFavouritesClient } from '@realtor/api-client';
import { startCustomerPreview } from './customer-preview.mjs';

const modes = {
  pushMode: 'synthetic-customer-push-v1',
  deletionMode: 'synthetic-customer-deletion-v1',
  deletionReviewMode: 'synthetic-admin-deletion-review-v1',
  deletionFollowUpMode: 'synthetic-customer-deletion-follow-up-v1',
};
const mode = 'synthetic-deletion-privacy-v1';
const planMode = 'synthetic-deletion-processing-plan-v1';
const base = '/v2/staff/customer-deletion-privacy';
const status = (wanted) => (error) => error.status === wanted;

test('designated reviewer sees independent requests and recovers their exact privacy decision', async (t) => {
  const prior = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  t.after(() => {
    if (prior === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prior;
  });
  await assert.rejects(() => startCustomerPreview({ deletionPrivacyMode: mode }));
  await assert.rejects(() =>
    startCustomerPreview({ ...modes, deletionProcessingPlanMode: planMode }),
  );
  const off = await startCustomerPreview(modes);
  try {
    assert.equal((await fetch(off.origin + base)).status, 404);
  } finally {
    await off.close();
  }
  const preview = await startCustomerPreview({
    ...modes,
    deletionPrivacyMode: mode,
    deletionProcessingPlanMode: planMode,
    deletionPrivacyReplyFault: 'lost-first-deletion-privacy-v1',
  });
  t.after(() => preview.close());
  const triager = await preview.deletionReviewStaff();
  const reviewer = await preview.deletionPrivacyStaff();
  const [a, b] = preview.configuration('http://127.0.0.1:3137').users;
  const api = new RealtorApiClient({
    baseUrl: preview.origin,
    allowLoopbackHttp: true,
    privacyNoticeVersion: 'test',
  });
  const auth = { bearerToken: reviewer.token };
  const triageAuth = { bearerToken: triager.token };
  const scope = { tenantId: preview.tenantId, reviewerId: reviewer.reviewerId };
  const triageScope = { ...scope, reviewerId: triager.reviewerId };
  const targets = [];
  for (const person of [a, b]) {
    const customer = new CustomerFavouritesClient({
      baseUrl: preview.origin,
      allowLoopbackHttp: true,
      scope: { tenantId: preview.tenantId, customerId: person.id },
    });
    const requestId = randomUUID();
    await customer.requestAccountDeletion(
      { policy: 'synthetic-customer-deletion-command-v1', requestId, confirmed: true },
      { bearerToken: person.bearerToken },
    );
    await api.reviewCustomerDeletion(
      {
        policy: 'synthetic-customer-deletion-review-command-v1',
        customerId: person.id,
        requestId,
        operationId: randomUUID(),
        disposition: 'ready_for_privacy_review',
      },
      triageScope,
      triageAuth,
    );
    targets.push({ customerId: person.id, requestId, operationId: randomUUID() });
  }
  await assert.rejects(
    () => api.listDeletionPrivacyQueue({}, scope, { bearerToken: a.bearerToken }),
    status(403),
  );
  assert.deepEqual((await api.listDeletionPrivacyQueue({}, triageScope, triageAuth)).items, []);
  const first = await api.listDeletionPrivacyQueue({ limit: 1 }, scope, auth);
  assert.equal(first.hasMore, true);
  assert.equal(first.items[0].requestId, targets[0].requestId);
  const next = await api.listDeletionPrivacyQueue({ limit: 1, after: a.id }, scope, auth);
  assert.equal(next.hasMore, false);
  assert.equal(next.items[0].requestId, targets[1].requestId);
  await assert.rejects(
    () => api.listDeletionPrivacyQueue({}, triageScope, auth),
    (error) => error.kind === 'INVALID_RESPONSE',
  );
  const target = targets[0];
  const command = { ...target, decision: 'plan_review' };
  const endpoint =
    base +
    '/' +
    target.customerId +
    '/requests/' +
    target.requestId +
    '/decisions/' +
    target.operationId;
  const planEndpoint = endpoint + '/processing-plan';
  await assert.rejects(() => api.getDeletionProcessingPlan(target, scope, auth), status(404));
  const mismatchedPlanMethod = await fetch(preview.origin + planEndpoint, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + reviewer.token },
  });
  assert.equal(mismatchedPlanMethod.status, 405);
  assert.equal(mismatchedPlanMethod.headers.get('allow'), 'GET');
  for (const path of [planEndpoint + '?limit=1', planEndpoint + '?']) {
    const malformed = await fetch(preview.origin + path, {
      headers: { authorization: 'Bearer ' + reviewer.token },
    });
    assert.equal(malformed.status, 400);
  }
  const mismatch = await fetch(preview.origin + endpoint, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + reviewer.token, 'content-type': 'application/json' },
    body: JSON.stringify({ ...command, requestId: randomUUID() }),
  });
  assert.equal(mismatch.status, 400);
  await assert.rejects(
    () => api.recordDeletionPrivacyDecision(command, triageScope, triageAuth),
    status(403),
  );
  await assert.rejects(
    () => api.recordDeletionPrivacyDecision(command, scope, auth),
    (error) => error.status === 503 && error.submissionUncertain,
  );
  const receipt = await api.getDeletionPrivacyDecision(target, scope, auth);
  assert.equal(receipt.decision, 'plan_review');
  assert.equal(receipt.retentionProfile, 'synthetic-retention-review-v1');
  const plan = await api.getDeletionProcessingPlan(target, scope, auth);
  assert.equal(plan.policy, planMode);
  assert.deepEqual(plan.decision, receipt);
  assert.equal(plan.inventory.activePushRegistrations, 0);
  assert.equal(plan.requirements.backups, 'verify_expiry_custody_and_restore_reapplication');
  assert.equal(plan.requirements.holds, 'verify_no_applicable_hold');
  await assert.rejects(
    () => api.getDeletionProcessingPlan(target, scope, { bearerToken: a.bearerToken }),
    status(403),
  );
  await assert.rejects(
    () => api.getDeletionProcessingPlan(target, triageScope, triageAuth),
    status(404),
  );
  for (const invalid of [
    { ...plan, inventory: { ...plan.inventory, pushPreferences: 2 } },
    { ...plan, inventory: { ...plan.inventory, linkedEnquiries: '1' } },
    { ...plan, inventory: { ...plan.inventory, contact: 'synthetic@example.invalid' } },
    { ...plan, decision: { ...plan.decision, decision: 'hold' } },
    { ...plan, decision: { ...plan.decision, requestId: randomUUID() } },
    { ...plan, requirements: { ...plan.requirements, holds: 'clear' } },
  ]) {
    const malformedApi = new RealtorApiClient({
      baseUrl: preview.origin,
      allowLoopbackHttp: true,
      privacyNoticeVersion: 'test',
      fetch: async () => Response.json(invalid),
    });
    await assert.rejects(
      () => malformedApi.getDeletionProcessingPlan(target, scope, auth),
      (error) => error.kind === 'INVALID_RESPONSE',
    );
  }

  assert.deepEqual(await api.recordDeletionPrivacyDecision(command, scope, auth), receipt);
  await assert.rejects(
    () => api.getDeletionPrivacyDecision(target, triageScope, triageAuth),
    status(404),
  );
  await assert.rejects(
    () => api.recordDeletionPrivacyDecision({ ...command, decision: 'hold' }, scope, auth),
    status(409),
  );
  assert.deepEqual(
    (await api.listDeletionPrivacyQueue({}, scope, auth)).items.map((item) => item.requestId),
    [targets[1].requestId],
  );
  await api.recordDeletionPrivacyDecision({ ...targets[1], decision: 'hold' }, scope, auth);
  await assert.rejects(() => api.getDeletionProcessingPlan(targets[1], scope, auth), status(404));
  const privacyOnly = await startCustomerPreview({ ...modes, deletionPrivacyMode: mode });
  try {
    assert.equal((await fetch(privacyOnly.origin + planEndpoint)).status, 404);
  } finally {
    await privacyOnly.close();
  }
  await reviewer.revoke();
  await assert.rejects(() => api.getDeletionProcessingPlan(target, scope, auth), status(403));
  await assert.rejects(() => api.listDeletionPrivacyQueue({}, scope, auth), status(403));
  await assert.rejects(() => api.getDeletionPrivacyDecision(target, scope, auth), status(403));
});
