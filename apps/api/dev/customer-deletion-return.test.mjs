import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RealtorApiClient, CustomerFavouritesClient } from '@realtor/api-client';
import { startCustomerPreview } from './customer-preview.mjs';

const modes = {
  pushMode: 'synthetic-customer-push-v1',
  deletionMode: 'synthetic-customer-deletion-v1',
  deletionReviewMode: 'synthetic-admin-deletion-review-v1',
};
const base = '/v2/staff/customer-deletion-follow-up';
const status = (wanted) => (error) => error.status === wanted;

test('signed return moves the request and recovers the original after a lost committed reply', async (t) => {
  const prior = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  t.after(() => {
    if (prior === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prior;
  });
  const off = await startCustomerPreview(modes);
  try {
    assert.equal(
      (
        await fetch(
          off.origin +
            base +
            '/' +
            randomUUID() +
            '/requests/' +
            randomUUID() +
            '/returns/' +
            randomUUID(),
        )
      ).status,
      404,
    );
  } finally {
    await off.close();
  }
  const preview = await startCustomerPreview({
    ...modes,
    deletionFollowUpMode: 'synthetic-customer-deletion-follow-up-v1',
    deletionReturnReplyFault: 'lost-first-deletion-return-v1',
  });
  t.after(() => preview.close());
  const reviewer = await preview.deletionReviewStaff();
  const [customer] = preview.configuration('http://127.0.0.1:3137').users;
  const staff = new RealtorApiClient({
    baseUrl: preview.origin,
    allowLoopbackHttp: true,
    privacyNoticeVersion: 'test',
  });
  const client = new CustomerFavouritesClient({
    baseUrl: preview.origin,
    allowLoopbackHttp: true,
    scope: { tenantId: preview.tenantId, customerId: customer.id },
  });
  const auth = { bearerToken: reviewer.token };
  const customerAuth = { bearerToken: customer.bearerToken };
  const scope = { tenantId: preview.tenantId, reviewerId: reviewer.reviewerId };
  const target = { customerId: customer.id, requestId: randomUUID(), operationId: randomUUID() };
  const endpoint =
    base +
    '/' +
    target.customerId +
    '/requests/' +
    target.requestId +
    '/returns/' +
    target.operationId;
  const receipt = await client.requestAccountDeletion(
    {
      policy: 'synthetic-customer-deletion-command-v1',
      requestId: target.requestId,
      confirmed: true,
    },
    customerAuth,
  );
  await assert.rejects(
    () => staff.returnCustomerDeletionToReview(target, scope, customerAuth),
    status(403),
  );
  await assert.rejects(
    () => staff.returnCustomerDeletionToReview(target, scope, auth),
    status(422),
  );
  const triage = { ...target, operationId: randomUUID() };
  const decision = await staff.reviewCustomerDeletion(
    {
      policy: 'synthetic-customer-deletion-review-command-v1',
      ...triage,
      disposition: 'needs_information',
    },
    scope,
    auth,
  );
  const rejected = await fetch(preview.origin + endpoint, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + reviewer.token, 'content-type': 'application/json' },
    body: JSON.stringify({ ...target, operationId: randomUUID() }),
  });
  assert.equal(rejected.status, 400);
  await assert.rejects(
    () => staff.returnCustomerDeletionToReview(target, scope, auth),
    (error) => error.status === 503 && error.submissionUncertain,
  );
  const recovered = await staff.getCustomerDeletionReviewReturn(target, scope, auth);
  assert.equal(recovered.operationId, target.operationId);
  assert.equal(recovered.reviewerId, scope.reviewerId);
  assert.deepEqual(await staff.returnCustomerDeletionToReview(target, scope, auth), recovered);
  await assert.rejects(
    () => staff.getCustomerDeletionReviewReturn(target, scope, { bearerToken: reviewer.peerToken }),
    status(404),
  );
  await assert.rejects(
    () =>
      staff.returnCustomerDeletionToReview({ ...target, operationId: randomUUID() }, scope, auth),
    status(409),
  );
  assert.deepEqual(await staff.getCustomerDeletionReview(triage, scope, auth), decision);
  assert.deepEqual(await client.getDeletionRequest(customerAuth), receipt);
  assert.equal((await client.getDeletionProgress(customerAuth)).status, 'privacy_review_pending');
  assert.equal(
    (await staff.listCustomerDeletionFollowUp('needs_information', {}, scope.tenantId, auth)).items
      .length,
    0,
  );
  assert.equal(
    (await staff.listCustomerDeletionFollowUp('ready_for_privacy_review', {}, scope.tenantId, auth))
      .items[0].requestId,
    target.requestId,
  );
  await reviewer.revoke();
  await assert.rejects(
    () => staff.getCustomerDeletionReviewReturn(target, scope, auth),
    status(403),
  );
});
