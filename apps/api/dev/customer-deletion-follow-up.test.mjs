import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CustomerFavouritesClient, RealtorApiClient } from '@realtor/api-client';
import {
  validateCustomerDeletionFollowUp,
  validateCustomerDeletionProgress,
} from '@realtor/domain';
import { startCustomerPreview } from './customer-preview.mjs';

const modes = {
  pushMode: 'synthetic-customer-push-v1',
  deletionMode: 'synthetic-customer-deletion-v1',
  deletionReviewMode: 'synthetic-admin-deletion-review-v1',
};
const followUp = 'synthetic-customer-deletion-follow-up-v1';
const staffPath = '/v2/staff/customer-deletion-follow-up';
const customerPath = '/v2/customer/deletion-progress';
const ready = 'ready_for_privacy_review';
const info = 'needs_information';
const status = (code) => (error) => error.status === code;

test('signed follow-up reads are off until the independent preview flag is enabled', async (t) => {
  const original = process.env.NODE_ENV;
  t.after(() => {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  });
  process.env.NODE_ENV = 'development';
  await assert.rejects(() => startCustomerPreview({ deletionFollowUpMode: followUp }));
  const preview = await startCustomerPreview(modes);
  t.after(() => preview.close());
  for (const path of [staffPath, customerPath])
    assert.equal((await fetch(preview.origin + path)).status, 404);
});

test('staff follow-up and customer progress use their own scopes and preserve intake receipts', async (t) => {
  const original = process.env.NODE_ENV;
  t.after(() => {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  });
  process.env.NODE_ENV = 'development';
  const preview = await startCustomerPreview({ ...modes, deletionFollowUpMode: followUp });
  t.after(() => preview.close());
  const reviewer = await preview.deletionReviewStaff();
  const [a, b] = preview.configuration('http://127.0.0.1:3137').users;
  const tenantId = preview.tenantId;
  const staff = new RealtorApiClient({
    baseUrl: preview.origin,
    allowLoopbackHttp: true,
    privacyNoticeVersion: 'test',
  });
  const aAuth = { bearerToken: a.bearerToken };
  const bAuth = { bearerToken: b.bearerToken };
  const reviewerAuth = { bearerToken: reviewer.token };
  const reviewerScope = { tenantId, reviewerId: reviewer.reviewerId };
  const customer = (id) =>
    new CustomerFavouritesClient({
      baseUrl: preview.origin,
      allowLoopbackHttp: true,
      scope: { tenantId, customerId: id },
    });
  const first = customer(a.id),
    second = customer(b.id);
  await assert.rejects(
    () => staff.listCustomerDeletionFollowUp(ready, {}, tenantId, aAuth),
    status(403),
  );
  await assert.rejects(() => first.getDeletionProgress(reviewerAuth), status(403));
  assert.equal(await first.getDeletionProgress(aAuth), null);
  const requestId = randomUUID();
  const command = { policy: 'synthetic-customer-deletion-command-v1', requestId, confirmed: true };
  const originalReceipt = await first.requestAccountDeletion(command, aAuth);
  assert.equal((await first.getDeletionProgress(aAuth)).status, 'pending_review');
  assert.equal(await second.getDeletionProgress(bAuth), null);
  await second.requestAccountDeletion(command, bAuth);
  for (const [user, disposition] of [
    [a, ready],
    [b, info],
  ]) {
    await staff.reviewCustomerDeletion(
      {
        policy: 'synthetic-customer-deletion-review-command-v1',
        customerId: user.id,
        requestId,
        operationId: randomUUID(),
        disposition,
      },
      reviewerScope,
      reviewerAuth,
    );
  }
  const page = await staff.listCustomerDeletionFollowUp(
    ready,
    { limit: 1 },
    tenantId,
    reviewerAuth,
  );
  assert.deepEqual(
    page.items.map((item) => item.customerId),
    [a.id],
  );
  assert.deepEqual(
    (
      await staff.listCustomerDeletionFollowUp(info, { limit: 1 }, tenantId, reviewerAuth)
    ).items.map((item) => item.customerId),
    [b.id],
  );
  assert.deepEqual(
    (await staff.listCustomerDeletionFollowUp(ready, { after: a.id }, tenantId, reviewerAuth))
      .items,
    [],
  );
  await assert.rejects(
    () => staff.listCustomerDeletionFollowUp(ready, {}, randomUUID(), reviewerAuth),
    (error) => error.kind === 'INVALID_RESPONSE',
  );
  assert.throws(() => validateCustomerDeletionFollowUp(page, 1, null, tenantId, info));
  assert.throws(() => validateCustomerDeletionFollowUp(page, 1, a.id, tenantId, ready));
  const progress = await first.getDeletionProgress(aAuth);
  assert.deepEqual(progress, {
    policy: 'synthetic-customer-deletion-progress-v1',
    tenantId,
    customerId: a.id,
    requestId,
    status: 'privacy_review_pending',
  });
  assert.equal((await second.getDeletionProgress(bAuth)).status, 'staff_follow_up_pending');
  assert.deepEqual(await first.getDeletionRequest(aAuth), originalReceipt);
  assert.throws(() =>
    validateCustomerDeletionProgress(
      { ...progress, reviewerId: reviewer.reviewerId },
      { tenantId, customerId: a.id },
    ),
  );
  assert.throws(() => validateCustomerDeletionProgress(progress, { tenantId, customerId: b.id }));
  for (const path of [staffPath + '?disposition=' + ready + '&disposition=' + info, staffPath]) {
    const malformed = await fetch(preview.origin + path, {
      headers: { authorization: 'Bearer ' + reviewer.token },
    });
    assert.equal(malformed.status, 400);
  }
  const write = await fetch(preview.origin + customerPath, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + a.bearerToken },
  });
  assert.equal(write.status, 405);
  await reviewer.revoke();
  await assert.rejects(
    () => staff.listCustomerDeletionFollowUp(ready, {}, tenantId, reviewerAuth),
    status(403),
  );
  await preview.revoke();
  await assert.rejects(() => first.getDeletionProgress(aAuth), status(403));
});
