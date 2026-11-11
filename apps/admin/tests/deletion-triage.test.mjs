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

test('privacy boundary requires explicit reviewer configuration and forwards only its separate signed identity', async () => {
  const privacyScope = {
    ...scope,
    STAFF_DELETION_PRIVACY_MODE: 'synthetic-v1',
    STAFF_DELETION_PRIVACY_REVIEWER: reviewer,
    STAFF_DELETION_PRIVACY_TOKEN: 'synthetic.privacy.test',
  };
  const route = '/api/deletion-privacy';
  const path = route + '/' + customer + '/' + instance + '/' + reviewer;
  const forbid = () => assert.fail('Unexpected upstream request');
  const call = (req, operation, env, fetcher) =>
    deletionTriageBoundary(req, operation, env, fetcher, 'privacy');
  for (const env of [
    scope,
    { ...privacyScope, STAFF_DELETION_PRIVACY_TOKEN: '' },
    { ...privacyScope, NODE_ENV: 'production' },
  ]) {
    assert.equal((await call(request(route), undefined, env, forbid)).status, 403);
  }
  assert.equal(
    (
      await call(
        request(route, { headers: { authorization: 'Bearer caller' } }),
        undefined,
        privacyScope,
        forbid,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        request(route + '?disposition=ready_for_privacy_review'),
        undefined,
        privacyScope,
        forbid,
      )
    ).status,
    400,
  );
  const submit = (input) =>
    request(path, {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json', origin },
    });
  assert.equal(
    (
      await call(
        submit({ ...target, decision: 'hold', reviewerId: reviewer }),
        target,
        privacyScope,
        forbid,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        submit({ ...target, decision: 'hold', operationId: instance }),
        target,
        privacyScope,
        forbid,
      )
    ).status,
    400,
  );

  const apiRoute = '/v2/staff/customer-deletion-privacy';
  const apiPath = apiRoute + '/' + customer + '/requests/' + instance + '/decisions/' + reviewer;
  const decision = { ...target, decision: 'hold' };
  let receiptReviewer = reviewer;
  const upstream = async (url, init) => {
    const parsed = new URL(url);
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer synthetic.privacy.test');
    if (parsed.pathname === apiRoute) {
      assert.equal(parsed.searchParams.get('limit'), '1');
      return Response.json({
        policy: 'synthetic-deletion-privacy-queue-v1',
        tenantId: tenant,
        reviewerId: reviewer,
        items: [],
        hasMore: false,
      });
    }
    assert.equal(parsed.pathname, apiPath);
    if (init.method === 'POST') assert.deepEqual(JSON.parse(init.body), decision);
    else assert.equal(init.method, 'GET');
    return Response.json({
      policy: 'synthetic-deletion-privacy-decision-v1',
      retentionProfile: 'synthetic-retention-review-v1',
      tenantId: tenant,
      reviewerId: receiptReviewer,
      ...decision,
      decidedAt: '2026-11-11T18:00:00.000Z',
    });
  };
  assert.equal(
    (await call(request(route + '?limit=1'), undefined, privacyScope, upstream)).status,
    200,
  );
  const recorded = await call(submit(decision), target, privacyScope, upstream);
  const recovered = await call(request(path), target, privacyScope, upstream);
  assert.equal(recorded.status, 200);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await recorded.json(), await recovered.json());
  receiptReviewer = customer;
  assert.equal((await call(request(path), target, privacyScope, upstream)).status, 502);
});

test('processing plan boundary is opt-in, read-only and bound to the signed reviewer and original request', async () => {
  const privacyScope = {
    ...scope,
    STAFF_DELETION_PRIVACY_MODE: 'synthetic-v1',
    STAFF_DELETION_PRIVACY_REVIEWER: reviewer,
    STAFF_DELETION_PRIVACY_TOKEN: 'synthetic.privacy.test',
  };
  const enabled = { ...privacyScope, STAFF_DELETION_PROCESSING_PLAN: 'synthetic-v1' };
  const path =
    '/api/deletion-privacy/' + customer + '/' + instance + '/' + reviewer + '/processing-plan';
  const forbid = () => assert.fail('Unexpected upstream request');
  const call = (req, env, fetcher) =>
    deletionTriageBoundary(req, target, env, fetcher, 'processing-plan');
  assert.equal((await call(request(path), privacyScope, forbid)).status, 404);
  assert.equal((await call(request(path + '?limit=1'), enabled, forbid)).status, 400);
  assert.equal(
    (await call(request(path, { headers: { 'x-actor-id': reviewer } }), enabled, forbid)).status,
    403,
  );
  const write = request(path, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal((await call(write, enabled, forbid)).status, 405);
  const payload = {
    policy: 'synthetic-deletion-processing-plan-v1',
    decision: {
      policy: 'synthetic-deletion-privacy-decision-v1',
      retentionProfile: 'synthetic-retention-review-v1',
      tenantId: tenant,
      reviewerId: reviewer,
      ...target,
      decision: 'plan_review',
      decidedAt: '2026-11-11T18:00:00.000Z',
    },
    inventory: {
      favouriteStates: 1,
      favouriteReceipts: 1,
      pushPreferences: 1,
      pushRegistrations: 2,
      activePushRegistrations: 0,
      pushReceipts: 1,
      linkedEnquiries: 2,
      linkedViewings: 1,
      returnReceipts: 0,
    },
    requirements: {
      accountScope: 'verify_identity_and_linked_memberships',
      operationalHistory: 'review_retention_reason_and_expiry',
      privacyEvidence: 'review_minimum_audit_and_receipt_evidence',
      unlinkedEnquiries: 'manual_identity_review_required',
      holds: 'verify_no_applicable_hold',
      providers: 'verify_provider_control_and_disposition',
      backups: 'verify_expiry_custody_and_restore_reapplication',
    },
  };
  const upstream = async (url, init) => {
    assert.equal(
      new URL(url).pathname,
      '/v2/staff/customer-deletion-privacy/' +
        customer +
        '/requests/' +
        instance +
        '/decisions/' +
        reviewer +
        '/processing-plan',
    );
    assert.equal(init.method, 'GET');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer synthetic.privacy.test');
    assert.equal(init.body, undefined);
    return Response.json(payload);
  };
  const result = await call(request(path), enabled, upstream);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await result.json(), payload);
  payload.decision.requestId = reviewer;
  assert.equal((await call(request(path), enabled, upstream)).status, 502);
});
