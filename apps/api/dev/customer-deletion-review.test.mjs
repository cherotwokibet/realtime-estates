import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RealtorApiClient, CustomerFavouritesClient } from '@realtor/api-client';
import { startCustomerPreview } from './customer-preview.mjs';

const route = '/v2/staff/customer-deletion-triage';
const modes = {
  pushMode: 'synthetic-customer-push-v1',
  deletionMode: 'synthetic-customer-deletion-v1',
  deletionReviewMode: 'synthetic-admin-deletion-review-v1',
};
const disposition = 'ready_for_privacy_review';
const status = (wanted) => (error) => error.status === wanted;

test('signed admin triage is optional and recovers a committed decision only for its reviewer', async (t) => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  t.after(() => {
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  });
  await assert.rejects(() =>
    startCustomerPreview({ deletionReviewMode: modes.deletionReviewMode }),
  );
  const off = await startCustomerPreview();
  assert.equal((await fetch(off.origin + route)).status, 404);
  await off.close();
  const preview = await startCustomerPreview({
    ...modes,
    deletionReviewReplyFault: 'lost-first-deletion-review-v1',
  });
  t.after(() => preview.close());
  const reviewer = await preview.deletionReviewStaff();
  const [a, b] = preview.configuration('http://127.0.0.1:3137').users;
  const staff = new RealtorApiClient({
    baseUrl: preview.origin,
    allowLoopbackHttp: true,
    privacyNoticeVersion: 'test',
  });
  const auth = { bearerToken: reviewer.token };
  const peerAuth = { bearerToken: reviewer.peerToken };
  const scope = { tenantId: preview.tenantId, reviewerId: reviewer.reviewerId };
  assert.equal((await fetch(preview.origin + route)).status, 401);
  await assert.rejects(
    () => staff.listCustomerDeletionTriage({}, scope.tenantId, { bearerToken: a.bearerToken }),
    status(403),
  );
  assert.equal((await staff.listCustomerDeletionTriage({}, scope.tenantId, auth)).items.length, 0);
  await assert.rejects(
    () => staff.listCustomerDeletionTriage({}, randomUUID(), auth),
    (e) => e.kind === 'INVALID_RESPONSE',
  );
  const requestId = randomUUID();
  for (const user of [a, b]) {
    const client = new CustomerFavouritesClient({
      baseUrl: preview.origin,
      allowLoopbackHttp: true,
      scope: { tenantId: scope.tenantId, customerId: user.id },
    });
    await client.requestAccountDeletion(
      { policy: 'synthetic-customer-deletion-command-v1', requestId, confirmed: true },
      { bearerToken: user.bearerToken },
    );
  }
  const queue = await staff.listCustomerDeletionTriage({ limit: 1 }, scope.tenantId, auth);
  assert.equal(queue.hasMore, true);
  assert.equal(queue.items[0].customerId, a.id);
  const next = await staff.listCustomerDeletionTriage(
    { limit: 1, after: a.id },
    scope.tenantId,
    auth,
  );
  assert.equal(next.items[0].customerId, b.id);
  const target = { customerId: a.id, requestId, operationId: randomUUID() };
  const command = {
    policy: 'synthetic-customer-deletion-review-command-v1',
    ...target,
    disposition,
  };
  const endpoint =
    route +
    '/' +
    target.customerId +
    '/requests/' +
    requestId +
    '/operations/' +
    target.operationId;
  const malformed = await fetch(preview.origin + endpoint, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + reviewer.token, 'content-type': 'application/json' },
    body: JSON.stringify({ ...command, customerId: b.id }),
  });
  assert.equal(malformed.status, 400);
  await assert.rejects(
    () => staff.reviewCustomerDeletion(command, scope, auth),
    (error) => error.status === 503 && error.submissionUncertain,
  );
  const original = await staff.getCustomerDeletionReview(target, scope, auth);
  assert.equal(original.disposition, disposition);
  assert.equal(original.reviewerId, scope.reviewerId);
  await assert.rejects(() => staff.getCustomerDeletionReview(target, scope, peerAuth), status(404));
  await assert.rejects(
    () => staff.getCustomerDeletionReview(target, { ...scope, reviewerId: randomUUID() }, auth),
    (e) => e.kind === 'INVALID_RESPONSE',
  );
  assert.deepEqual(await staff.reviewCustomerDeletion(command, scope, auth), original);
  assert.deepEqual(
    (await staff.listCustomerDeletionTriage({}, scope.tenantId, auth)).items.map(
      (item) => item.customerId,
    ),
    [b.id],
  );
  await assert.rejects(
    () =>
      staff.reviewCustomerDeletion({ ...command, disposition: 'needs_information' }, scope, auth),
    status(409),
  );
  await reviewer.revoke();
  await assert.rejects(() => staff.getCustomerDeletionReview(target, scope, auth), status(403));
  await assert.rejects(
    () => staff.listCustomerDeletionTriage({}, scope.tenantId, auth),
    status(403),
  );
});
