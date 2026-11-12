import assert from 'node:assert/strict';
import test from 'node:test';
import { RealtorApiClient } from '@realtor/api-client';
import { startCustomerPreview } from './customer-preview.mjs';

const path = '/v2/staff/synthetic-push-queue-summary';
const mode = 'synthetic-push-queue-summary-v1';
const fixtureModes = {
  pushMode: 'synthetic-customer-push-v1',
  deletionMode: 'synthetic-customer-deletion-v1',
};

test('signed queue summary uses the server clock and current admin company authority', async (t) => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  t.after(() => {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  });

  const preview = await startCustomerPreview({ ...fixtureModes, pushQueueSummaryMode: mode });
  t.after(() => preview.close());
  const { token, agentToken, revoke } = await preview.pushQueueStaff();
  const [customer] = preview.configuration('http://127.0.0.1:3137').users;
  const options = { bearerToken: token };
  const config = {
    baseUrl: preview.origin,
    allowLoopbackHttp: true,
    privacyNoticeVersion: 'synthetic-preview',
  };
  const api = new RealtorApiClient(config);
  const get = (key) =>
    fetch(preview.origin + path, {
      headers: key ? { authorization: 'Bearer ' + key } : undefined,
    });
  assert.equal((await get()).status, 401);
  assert.equal((await get(customer.bearerToken)).status, 403);
  assert.equal((await get(agentToken)).status, 403);
  const headers = { authorization: 'Bearer ' + token };
  assert.equal((await fetch(preview.origin + path + '?asOf=2090-01-01', { headers })).status, 400);
  assert.equal(
    (
      await fetch(preview.origin + path, {
        headers: { ...headers, 'x-tenant-id': preview.tenantId },
      })
    ).status,
    400,
  );
  const method = await fetch(preview.origin + path, { headers, method: 'POST' });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'GET');
  const raw = await get(token);
  assert.equal(raw.headers.get('cache-control'), 'no-store');

  const before = Date.now();
  const summary = await api.getSyntheticPushQueueSummary(preview.tenantId, options);
  assert.ok(Date.parse(summary.asOf) >= before && Date.parse(summary.asOf) <= Date.now());
  assert.deepEqual(
    { ...summary, asOf: null, oldestDueAgeSeconds: null },
    {
      policy: mode,
      tenantId: preview.tenantId,
      asOf: null,
      due: 1,
      scheduled: 1,
      waitingForRetry: 0,
      captured: 0,
      suppressed: 0,
      oldestDueAgeSeconds: null,
      oldestRetryAgeSeconds: null,
      nextRetryAt: null,
    },
  );
  assert.ok(summary.oldestDueAgeSeconds >= 120 && summary.oldestDueAgeSeconds < 300);

  const other = await startCustomerPreview({
    ...fixtureModes,
    pushQueueSummaryMode: mode,
    tenantSlug: 'sample-homes',
  });
  t.after(() => other.close());
  const otherApi = new RealtorApiClient({ ...config, baseUrl: other.origin });
  const otherStaff = await other.pushQueueStaff();
  const foreign = await otherApi.getSyntheticPushQueueSummary(other.tenantId, {
    bearerToken: otherStaff.token,
  });
  assert.equal(foreign.due, 1);
  assert.equal(foreign.scheduled, 0);
  assert.ok(foreign.oldestDueAgeSeconds >= 300);
  await assert.rejects(() => otherApi.getSyntheticPushQueueSummary(other.tenantId, options), {
    status: 401,
  });
  await assert.rejects(() => api.getSyntheticPushQueueSummary(other.tenantId, options), {
    kind: 'INVALID_RESPONSE',
  });

  const off = await startCustomerPreview(fixtureModes);
  t.after(() => off.close());
  assert.equal((await fetch(off.origin + path)).status, 404);
  await revoke();
  assert.equal((await get(token)).status, 403);
});
