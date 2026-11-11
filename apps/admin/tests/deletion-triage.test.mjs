import test from 'node:test';
import assert from 'node:assert/strict';
import { deletionTriageBoundary } from '../lib/deletion-triage-server.ts';

const tenant = '00000000-0000-4000-8000-000000000001';
const reviewer = '00000000-0000-4000-8000-000000000010';
const customer = '00000000-0000-4000-8000-000000000013';
const instance = '00000000-0000-4000-8000-000000000099';
const scope = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:3138',
  STAFF_PREVIEW_TOKEN: 'synthetic.staff.test',
  STAFF_PREVIEW_INSTANCE: instance,
  STAFF_DELETION_TRIAGE_MODE: 'synthetic-v1',
  STAFF_DELETION_TRIAGE_TENANT: tenant,
  STAFF_DELETION_TRIAGE_REVIEWER: reviewer,
};
const origin = 'http://127.0.0.1:3139';
const target = { customerId: customer, requestId: instance, operationId: reviewer };
const route = '/api/deletion-triage';
const operationPath = route + '/' + customer + '/' + instance + '/' + reviewer;
const command = {
  policy: 'synthetic-customer-deletion-review-command-v1',
  ...target,
  disposition: 'needs_information',
};
function request(path, { method = 'GET', body, headers = {} } = {}) {
  return new Request(origin + path, {
    method,
    headers: { host: '127.0.0.1:3139', 'x-preview-instance': instance, ...headers },
    body,
  });
}

test('deletion triage refuses default-off and caller authority without contacting upstream', async () => {
  const forbidden = () => assert.fail('Unexpected upstream request');
  for (const patch of [{ STAFF_DELETION_TRIAGE_MODE: undefined }, { NODE_ENV: 'production' }]) {
    assert.equal(
      (await deletionTriageBoundary(request(route), undefined, { ...scope, ...patch }, forbidden))
        .status,
      403,
    );
  }
  for (const headers of [
    { authorization: 'Bearer caller' },
    { 'x-tenant-id': tenant },
    { 'x-actor-id': reviewer },
    { 'x-preview-instance': reviewer },
  ]) {
    assert.equal(
      (await deletionTriageBoundary(request(route, { headers }), undefined, scope, forbidden))
        .status,
      403,
    );
  }
  assert.equal(
    (await deletionTriageBoundary(request(route + '?limit=1&limit=2'), undefined, scope, forbidden))
      .status,
    400,
  );
  const wrongOrigin = request(operationPath, {
    method: 'POST',
    body: JSON.stringify(command),
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3140' },
  });
  assert.equal((await deletionTriageBoundary(wrongOrigin, target, scope, forbidden)).status, 403);
  const mismatch = request(operationPath, {
    method: 'POST',
    body: JSON.stringify({ ...command, customerId: reviewer }),
    headers: { 'content-type': 'application/json', origin },
  });
  assert.equal((await deletionTriageBoundary(mismatch, target, scope, forbidden)).status, 400);
});

test('deletion review forwards only server authority and refuses a receipt from another reviewer', async () => {
  const apiPath =
    '/v2/staff/customer-deletion-triage/' +
    customer +
    '/requests/' +
    instance +
    '/operations/' +
    reviewer;
  let receiptReviewer = reviewer;
  const fetcher = async (url, init) => {
    assert.equal(url, scope.STAFF_PREVIEW_API_ORIGIN + apiPath);
    assert.equal(init.method, 'GET');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), 'Bearer ' + scope.STAFF_PREVIEW_TOKEN);
    assert.equal(headers.has('x-preview-instance'), false);
    return Response.json(
      {
        policy: 'synthetic-customer-deletion-review-v1',
        ...target,
        tenantId: tenant,
        reviewerId: receiptReviewer,
        disposition: 'needs_information',
        reviewedAt: '2026-11-11T00:00:00.000Z',
      },
      {
        headers: {
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'x-request-id': instance,
        },
      },
    );
  };
  const original = await deletionTriageBoundary(request(operationPath), target, scope, fetcher);
  assert.equal(original.status, 200);
  assert.equal(original.headers.get('cache-control'), 'no-store');
  assert.equal((await original.json()).reviewerId, reviewer);
  receiptReviewer = customer;
  assert.equal(
    (await deletionTriageBoundary(request(operationPath), target, scope, fetcher)).status,
    502,
  );
});
