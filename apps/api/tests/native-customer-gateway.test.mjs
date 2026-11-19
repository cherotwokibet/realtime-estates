import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNativeCustomerGateway,
  readNativeCustomerGatewayEnvironment,
  validateNativeCustomerGatewayConfig,
} from '../dist/native-customer-gateway.js';
import { createCloudRunInvocationTransport } from '../dist/cloud-run-invocation.js';
import { createFirebaseSubjectVerifier } from '../dist/firebase-identity.js';
import { AuthenticationError } from '../dist/auth.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const config = {
  policy: 'native-customer-gateway-v1',
  projectId: 'synthetic-staging',
  tenantId: id(1),
  applicationOrigin: 'https://native.synthetic.invalid',
  apiOrigin: 'https://synthetic-api-123456.us-central1.run.app',
};
const user = 'synthetic.user.signature',
  service = 'synthetic.service.signature';
const subject = () => ({
  subject: { projectId: config.projectId, authTenantId: null, uid: 'synthetic-native-customer' },
  expiresAt: Date.now() + 60000,
});
const account = (patch = {}) => ({
  policy: 'customer-account-v1',
  tenantId: id(1),
  customerId: id(13),
  ...patch,
});
const command = {
  policy: 'customer-favourite-command-v1',
  operationId: id(300),
  listingId: id(200),
  expectedVersion: '1',
  saved: false,
};
const receipt = () => ({
  policy: 'customer-favourite-receipt-v1',
  tenantId: id(1),
  customerId: id(13),
  operationId: command.operationId,
  listingId: command.listingId,
  expectedVersion: '1',
  version: '2',
  requestedSaved: false,
  saved: false,
  outcome: 'applied',
  recordedAt: '2026-11-19T18:00:00.000Z',
});
const json = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const request = (path = '/v2/customer/account', options = {}) =>
  new Request(config.applicationOrigin + path, {
    headers: { Authorization: 'Bearer ' + user, ...options.headers },
    ...options,
    ...(options.headers
      ? { headers: { Authorization: 'Bearer ' + user, ...options.headers } }
      : {}),
  });
const create = (reply = () => json(account()), options = {}) => {
  const calls = [],
    checks = [];
  const gateway = createNativeCustomerGateway(config, {
    timeoutMs: options.timeoutMs ?? 1000,
    verifySubject: async (token) => {
      checks.push(token);
      return options.verify ? options.verify(token) : subject();
    },
    transport: async (url, init) => {
      calls.push({ url, init });
      return reply(url, init);
    },
  });
  return { gateway, calls, checks };
};
test('configuration is explicit staging-only with fixed private invocation and no secret/preview overrides', () => {
  assert.equal(readNativeCustomerGatewayEnvironment({}), null);
  const env = {
    NODE_ENV: 'production',
    APP_ENV: 'staging',
    K_SERVICE: 'synthetic-native',
    GOOGLE_CLOUD_PROJECT: config.projectId,
    NATIVE_CUSTOMER_GATEWAY_CONFIG: JSON.stringify(config),
    HOSTED_API_INVOCATION_CONFIG: JSON.stringify({
      policy: 'cloud-run-invocation-v1',
      audience: config.apiOrigin,
    }),
  };
  assert.deepEqual(readNativeCustomerGatewayEnvironment(env), config);
  for (const patch of [
    { APP_ENV: 'production' },
    { NODE_ENV: 'development' },
    { GOOGLE_CLOUD_PROJECT: 'foreign-project' },
    { K_SERVICE: '' },
    { HOSTED_API_INVOCATION_CONFIG: undefined },
    { GOOGLE_APPLICATION_CREDENTIALS: 'private-key.json' },
    { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    { FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' },
    { WEB_CUSTOMER_PREVIEW_CONFIG: '{}' },
    {
      NATIVE_CUSTOMER_GATEWAY_CONFIG: JSON.stringify({
        ...config,
        apiOrigin: config.applicationOrigin,
      }),
    },
  ])
    assert.throws(() => readNativeCustomerGatewayEnvironment({ ...env, ...patch }));
  let evaluated = false;
  const getter = { ...config };
  Object.defineProperty(getter, 'tenantId', {
    enumerable: true,
    get() {
      evaluated = true;
      return id(1);
    },
  });
  assert.throws(() => validateNativeCustomerGatewayConfig(getter));
  assert.equal(evaluated, false);
  assert.throws(() => validateNativeCustomerGatewayConfig({ ...config, actorId: id(13) }));
});
test('unsupported routes, authority/cookie/workload headers, origins, methods and malformed queries stop before auth/invocation', async () => {
  const f = create();
  const cases = [
    request('/v2/staff/branches'),
    request('/v2/customer/push-preferences'),
    request('/v2/customer/deletion-request'),
    request('/v2/customer/favourites/' + id(200) + '/extra'),
    request('/v2/customer/account?tenant=' + id(2)),
    request('/v2/customer/favourites?limit=20&limit=30'),
    request('/v2/customer/favourites?limit=51'),
    request('/v2/customer/favourites?after=foreign'),
    request('/v2/customer/account', { method: 'DELETE' }),
    request('/v2/customer/account', { method: 'HEAD' }),
    ...[
      'cookie',
      'x-actor-id',
      'x-tenant-id',
      'x-role',
      'x-company-id',
      'x-serverless-authorization',
      'x-forwarded-authorization',
      'x-preview-instance',
      'x-realtor-actor',
    ].map((name) => request(undefined, { headers: { [name]: 'spoof' } })),
    request(undefined, { headers: { Origin: 'https://foreign.invalid' } }),
    request(undefined, { headers: { Host: 'foreign.invalid' } }),
    new Request('https://foreign.invalid/v2/customer/account', {
      headers: { Authorization: 'Bearer ' + user },
    }),
  ];
  for (const r of cases) {
    const response = await f.gateway(r);
    assert.ok([400, 403, 404, 405].includes(response.status));
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(f.checks.length, 0);
  assert.equal(f.calls.length, 0);
});
test('valid subject precedes private IAM acquisition, user and workload tokens remain separate and no upstream headers escape', async () => {
  const order = [];
  const invoke = createCloudRunInvocationTransport(
    { policy: 'cloud-run-invocation-v1', audience: config.apiOrigin },
    {
      client: async () => {
        order.push('iam');
        return {
          getRequestHeaders: async () => new Headers({ Authorization: 'Bearer ' + service }),
        };
      },
      transport: async (outgoing) => {
        order.push('api');
        assert.equal(outgoing.headers.get('authorization'), 'Bearer ' + user);
        assert.equal(outgoing.headers.get('x-serverless-authorization'), 'Bearer ' + service);
        return json(account(), 200, {
          'X-Serverless-Authorization': service,
          'X-Upstream-Diagnostic': service,
        });
      },
    },
  );
  const gateway = createNativeCustomerGateway(config, {
    transport: invoke,
    verifySubject: async () => {
      order.push('subject');
      return subject();
    },
  });
  const r = await gateway(request());
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), account());
  assert.deepEqual(order, ['subject', 'iam', 'api']);
  assert.equal(r.headers.get('x-serverless-authorization'), null);
  assert.equal(r.headers.get('x-upstream-diagnostic'), null);
  assert.equal(r.headers.get('set-cookie'), null);
  const denied = create(
    () => {
      throw Error(service);
    },
    {
      verify: () => {
        throw new AuthenticationError();
      },
    },
  );
  assert.equal((await denied.gateway(request())).status, 401);
  assert.equal(denied.calls.length, 0);
});
test('shared subject verifier retains issuer/email/revocation/recent-auth checks without granting an actor', async () => {
  let checked = 0;
  const decoded = () => {
    const now = Math.floor(Date.now() / 1000);
    return {
      uid: 'synthetic-uid',
      sub: 'synthetic-uid',
      aud: config.projectId,
      iss: 'https://securetoken.google.com/' + config.projectId,
      iat: now,
      auth_time: now,
      exp: now + 3600,
      email_verified: true,
      email: 'synthetic@example.invalid',
      firebase: { sign_in_provider: 'password' },
    };
  };
  const verifier = (patch) =>
    createFirebaseSubjectVerifier(
      { projectId: config.projectId },
      {
        verifier: {
          async verifyIdToken(_, revoked) {
            checked++;
            assert.equal(revoked, true);
            return { ...decoded(), ...patch };
          },
        },
      },
    );
  const verified = await verifier({})(user);
  assert.equal(verified.subject.uid, 'synthetic-uid');
  assert.ok(!('actorId' in verified));
  for (const patch of [
    { aud: 'foreign-project' },
    { email_verified: false },
    { uid: 'different' },
    { firebase: { sign_in_provider: 'anonymous' } },
    { exp: 0 },
  ])
    await assert.rejects(verifier(patch)(user), AuthenticationError);
  const old = decoded();
  await assert.rejects(verifier({ auth_time: old.iat - 301 })(user, true), AuthenticationError);
  assert.ok(checked >= 7);
});
test('reviewed account/list/state/original and command routes validate DTOs and pin request paths', async () => {
  const page = {
    policy: 'customer-favourites-page-v1',
    tenantId: id(1),
    customerId: id(13),
    items: [{ listingId: id(200), version: '1', available: true }],
    hasMore: false,
  };
  const state = {
    policy: 'customer-favourite-state-v1',
    tenantId: id(1),
    customerId: id(13),
    listingId: id(200),
    version: '1',
    saved: true,
  };
  for (const [path, body] of [
    ['/v2/customer/account', account()],
    ['/v2/customer/favourites?limit=1', page],
    ['/v2/customer/favourites/' + id(200), state],
    ['/v2/customer/favourite-operations/' + command.operationId, receipt()],
  ]) {
    const f = create(() => json(body));
    const response = await f.gateway(request(path));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), body);
    assert.equal(f.calls[0].url, config.apiOrigin + path);
  }
  const f = create((_, init) => {
    assert.deepEqual(JSON.parse(init.body), command);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    return json(receipt());
  });
  const r = await f.gateway(
    request('/v2/customer/favourite-operations/' + command.operationId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    }),
  );
  assert.equal(r.status, 200);
  assert.equal(f.calls.length, 1);
});
test('malformed/duplicate/oversized/foreign commands refuse before subject verification or write dispatch', async () => {
  const f = create();
  const path = '/v2/customer/favourite-operations/' + command.operationId;
  for (const body of [
    '{',
    '{"policy":"x","policy":"y"}',
    JSON.stringify({ ...command, role: 'owner' }),
    JSON.stringify({ ...command, operationId: id(301) }),
    ' '.repeat(2049),
  ]) {
    assert.ok(
      [400, 413].includes(
        (
          await f.gateway(
            request(path, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
            }),
          )
        ).status,
      ),
    );
  }
  assert.equal(f.checks.length, 0);
  assert.equal(f.calls.length, 0);
});
test('foreign/extra/malformed/cached/redirected upstream data and cookies never become successful private responses', async () => {
  for (const get of [
    () => json(account({ tenantId: id(2) })),
    () => json({ ...account(), accessToken: service }),
    () => json(null),
    () => json(account(), 200, { 'Cache-Control': 'public' }),
    () => json(account(), 200, { 'Set-Cookie': 'private=' + service }),
    () => json({ private: service }, 302, { Location: 'https://foreign.invalid' }),
    () => {
      const r = json(account());
      Object.defineProperty(r, 'url', { value: 'https://foreign.invalid/data' });
      return r;
    },
  ]) {
    const f = create(get);
    const r = await f.gateway(request());
    assert.equal(r.status, 502);
    assert.ok(!(await r.text()).includes(service));
  }
});
test('status failures preserve protocol status without private diagnostics, and ambiguous POST failure is never retried', async () => {
  for (const status of [401, 403, 404, 409, 429, 500]) {
    const f = create(() => json({ private: service }, status));
    const r = await f.gateway(request());
    assert.equal(r.status, status === 500 ? 502 : status);
    assert.ok(!(await r.text()).includes(service));
    assert.equal(f.calls.length, 1);
  }
  const f = create(() => {
    throw Error(service);
  });
  const r = await f.gateway(
    request('/v2/customer/favourite-operations/' + command.operationId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    }),
  );
  assert.equal(r.status, 502);
  assert.equal(f.calls.length, 1);
  assert.ok(!(await r.text()).includes(service));
});
test('hung verification, transport and response streams are bounded; cancellation does not invoke or replay writes', async () => {
  const auth = create(undefined, { timeoutMs: 25, verify: () => new Promise(() => {}) });
  assert.equal((await auth.gateway(request())).status, 504);
  assert.equal(auth.calls.length, 0);
  const slow = create(() => new Promise(() => {}), { timeoutMs: 25 });
  assert.equal((await slow.gateway(request())).status, 504);
  assert.equal(slow.calls.length, 1);
  let cancelled = false;
  const body = create(
    () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
      ),
    { timeoutMs: 25 },
  );
  assert.equal((await body.gateway(request())).status, 504);
  assert.equal(cancelled, true);
  const controller = new AbortController();
  controller.abort();
  assert.equal((await slow.gateway(request(undefined, { signal: controller.signal }))).status, 408);
  assert.equal(slow.calls.length, 1);
});
