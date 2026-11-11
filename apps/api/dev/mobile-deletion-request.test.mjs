import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CustomerFavouritesClient, RealtorApiClient } from '@realtor/api-client';
import { startCustomerPreview } from './customer-preview.mjs';
import { createMobileCustomerSession } from '../../mobile/src/customer-session.ts';
import { requestSyntheticCustomerGrant } from '../../mobile/src/synthetic-customer-sign-in.ts';

const pushMode = 'synthetic-customer-push-v1';
const deletionMode = 'synthetic-customer-deletion-v1';
const command = () => ({
  policy: 'synthetic-customer-deletion-command-v1',
  requestId: randomUUID(),
  confirmed: true,
});

async function setup(t, fault, replyFault, progressMode) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  t.after(() => {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  });
  const preview = await startCustomerPreview({
    mobileMode: 'synthetic-mobile-customer-v1',
    pushMode,
    deletionMode,
    deletionReplyFault: replyFault,
    ...(progressMode
      ? {
          deletionReviewMode: 'synthetic-admin-deletion-review-v1',
          deletionFollowUpMode: progressMode,
        }
      : {}),
  });
  t.after(() => preview.close());
  const grant = (who) =>
    requestSyntheticCustomerGrant(
      preview.origin,
      preview.tenantId,
      who,
      new AbortController().signal,
      fetch,
    );
  const a = await grant('a');
  const b = await grant('b');
  assert(a && b);
  const config = {
    mode: 'runtime-customer-v1',
    tenantId: preview.tenantId,
    apiOrigin: preview.origin,
    allowLoopbackHttp: true,
    pushMode,
    deletionMode,
    deletionFollowUpMode: progressMode,
  };
  const calls = [];
  const session = createMobileCustomerSession(config, async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method, body: init.body });
    if (fault?.(path, init)) throw Error('Synthetic offline interruption');
    return fetch(url, init);
  });
  t.after(() => session.clear());
  const client = new CustomerFavouritesClient({
    baseUrl: preview.origin,
    allowLoopbackHttp: true,
    scope: { tenantId: preview.tenantId, customerId: a.customerId },
  });
  assert.equal(await session.activate(a), true);
  return { a, b, client, session, calls, config, preview };
}

test('mobile recovers a committed confirmed request and reloads current consent across account switches', async (t) => {
  const { a, b, client, session, calls, config } = await setup(
    t,
    null,
    'lost-first-deletion-result-v1',
  );
  assert.throws(() => createMobileCustomerSession({ ...config, pushMode: undefined }));
  const submit = command();
  const auth = { bearerToken: a.bearerToken };
  assert.equal(await session.requestAccountDeletion(submit), false);
  assert.equal(await session.checkDeletionRequest(), true);
  assert.equal(await session.requestAccountDeletion({ ...submit, confirmed: false }), false);
  const initial = {
    policy: 'synthetic-customer-push-command-v1',
    operationId: randomUUID(),
    expectedVersion: '0',
    action: 'consent',
    enabled: true,
    registrationId: null,
  };
  await client.changePushPreferences(initial, auth);
  await client.changePushPreferences(
    {
      ...initial,
      operationId: randomUUID(),
      expectedVersion: '1',
      action: 'register',
      enabled: null,
      registrationId: randomUUID(),
    },
    auth,
  );
  await session.loadPushPreferences();
  assert.equal(session.snapshot().push.preferences.activeDevices, 1);
  assert.equal(await session.requestAccountDeletion(submit), false);
  assert.equal(session.snapshot().deletion.phase, 'uncertain');
  assert.equal(session.snapshot().push.preferences, null);
  assert.equal(await session.retryAccountDeletion(), false);
  assert.equal(await session.changePushPreferences(initial), false);
  assert.equal(await session.checkDeletionRequest(), true);
  assert.equal(session.snapshot().deletion.receipt.requestId, submit.requestId);
  assert.equal(session.snapshot().push.preferences.enabled, false);
  assert.equal(session.snapshot().push.preferences.activeDevices, 0);
  assert.equal(calls.filter((x) => x.method === 'POST').length, 1);
  assert.equal(await session.activate(b), true);
  assert.equal(await session.checkDeletionRequest(), true);
  assert.equal(session.snapshot().deletion.receipt, null);
  assert.equal(await session.activate(a), true);
  assert.equal(await session.checkDeletionRequest(), true);
  assert.equal(session.snapshot().deletion.receipt.requestId, submit.requestId);
});

test('mobile retries only the original command after a null status and distinguishes a competing request', async (t) => {
  let blockNext = true;
  const { a, client, session, calls } = await setup(t, (path, init) => {
    if (path.startsWith('/v2/customer/deletion-requests/') && init.method === 'POST' && blockNext) {
      blockNext = false;
      return true;
    }
    return false;
  });
  await session.checkDeletionRequest();
  const submit = command();
  assert.equal(await session.requestAccountDeletion(submit), false);
  assert.equal(await session.checkDeletionRequest(), false);
  assert.equal(session.snapshot().deletion.phase, 'missing');
  assert.equal(await session.requestAccountDeletion(command()), false);
  const other = command();
  await client.requestAccountDeletion(other, { bearerToken: a.bearerToken });
  assert.equal(await session.retryAccountDeletion(), false);
  const writes = calls.filter((x) => x.method === 'POST');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1], writes[0]);
  assert.equal(await session.checkDeletionRequest(), false);
  assert.equal(session.snapshot().deletion.phase, 'recorded');
  assert.equal(session.snapshot().deletion.alreadyPending, true);
  assert.equal(session.snapshot().deletion.receipt.requestId, other.requestId);
  assert.equal(await session.retryAccountDeletion(), false);
});

test('mobile refreshes current progress without replay and clears it on account switch', async (t) => {
  const mode = 'synthetic-customer-deletion-follow-up-v1';
  let interrupt = false;
  const { a, b, session, preview, calls } = await setup(
    t,
    (path) => interrupt && path.endsWith('/deletion-progress'),
    undefined,
    mode,
  );
  assert.equal(await session.checkDeletionRequest(), true);
  const submit = command();
  assert.equal(await session.requestAccountDeletion(submit), true);
  assert.equal(session.snapshot().deletion.progress.status, 'pending_review');
  const reviewer = await preview.deletionReviewStaff();
  const staff = new RealtorApiClient({
    baseUrl: preview.origin,
    allowLoopbackHttp: true,
    privacyNoticeVersion: 'test',
  });
  await staff.reviewCustomerDeletion(
    {
      policy: 'synthetic-customer-deletion-review-command-v1',
      customerId: a.customerId,
      requestId: submit.requestId,
      operationId: randomUUID(),
      disposition: 'needs_information',
    },
    { tenantId: preview.tenantId, reviewerId: reviewer.reviewerId },
    { bearerToken: reviewer.token },
  );
  assert.equal(await session.refreshDeletionProgress(), true);
  assert.equal(session.snapshot().deletion.progress.status, 'staff_follow_up_pending');
  assert.equal(session.snapshot().deletion.receipt.status, 'pending_review');
  interrupt = true;
  assert.equal(await session.refreshDeletionProgress(), false);
  assert.deepEqual(session.snapshot().deletion.progress, { phase: 'unavailable' });
  interrupt = false;
  assert.equal(await session.activate(b), true);
  assert.equal(await session.checkDeletionRequest(), true);
  assert.deepEqual(session.snapshot().deletion.progress, { phase: 'idle' });
  assert.equal(calls.filter((entry) => entry.method === 'POST').length, 1);
});
