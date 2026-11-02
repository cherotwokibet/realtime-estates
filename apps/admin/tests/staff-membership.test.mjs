import test from 'node:test';
import assert from 'node:assert/strict';
import {
  staffMembershipDirectoryBoundary as directory,
  staffMembershipOperationBoundary as operation,
  staffMembershipCurrentBoundary as current,
} from '../dist/tests/lib/staff-membership-server.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_DIRECTORY_PREVIEW_MODE: 'synthetic-v1',
  STAFF_MEMBERSHIP_PREVIEW_MODE: 'synthetic-existing-members-v1',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
  STAFF_PREVIEW_TOKEN: 'synthetic.bearer.signature',
  STAFF_PREVIEW_INSTANCE: id(1),
};
const command = {
  policy: 'staff-membership-command-v1',
  operationId: id(2),
  memberId: id(3),
  expectedVersion: '1',
  requestedRole: 'agent',
  active: false,
  reason: 'Synthetic staff access revocation.',
};
const receipt = {
  ...command,
  policy: 'staff-membership-record-v1',
  actorId: id(4),
  version: '2',
  outcome: 'applied',
  recordedAt: '2026-11-02T10:00:00.000Z',
};
const member = {
  policy: 'staff-membership-current-v1',
  memberId: id(3),
  role: 'agent',
  active: false,
  version: '2',
  revokedAt: '2026-11-02T10:00:00.000Z',
};
const prefix = '/api/staff-directory/memberships';
const opPath = prefix + '/operations/' + id(2);
const request = (
  path,
  { body, method = body === undefined ? 'GET' : 'POST', headers = {}, signal } = {},
) =>
  new Request('http://localhost:3120' + path, {
    method,
    headers: {
      host: '127.0.0.1:3120',
      'x-preview-instance': id(1),
      ...(method === 'GET'
        ? {}
        : { origin: 'http://127.0.0.1:3120', 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });
test('membership BFF requires its separate server flag plus current loopback scope before all upstream reads/writes', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw Error('Unexpected upstream.');
  };
  for (const config of [
    { ...env, STAFF_MEMBERSHIP_PREVIEW_MODE: undefined },
    { ...env, STAFF_MEMBERSHIP_PREVIEW_MODE: 'synthetic-v1' },
    { ...env, STAFF_DIRECTORY_PREVIEW_MODE: undefined },
    { ...env, NODE_ENV: 'production' },
  ]) {
    assert.equal((await directory(request(prefix + '?limit=2'), config, fetcher)).status, 403);
    assert.equal(
      (await operation(request(opPath, { body: command }), id(2), config, fetcher)).status,
      403,
    );
    assert.equal(
      (await current(request(prefix + '/' + id(3)), id(3), config, fetcher)).status,
      403,
    );
  }
  for (const headers of [
    { 'x-preview-instance': id(8) },
    { host: 'foreign.invalid' },
    { authorization: 'Bearer caller' },
    { cookie: 'session=synthetic' },
    { 'x-actor-id': id(4) },
    { 'x-tenant-id': id(5) },
    { 'x-forwarded-host': 'foreign.invalid' },
    { origin: 'https://foreign.invalid' },
    { 'sec-fetch-site': 'cross-site' },
    { 'idempotency-key': id(5) },
  ])
    assert.equal(
      (await directory(request(prefix + '?limit=2', { headers }), env, fetcher)).status,
      403,
    );
  assert.equal(calls, 0);
});
test('membership directory BFF validates exact bounded query/body-free framing and typed private pages', async () => {
  let calls = 0;
  const fetcher = async (url, init) => {
    calls++;
    assert.equal(url, 'http://127.0.0.1:4101/v2/staff/memberships?limit=2&after=' + id(1));
    assert.equal(init.method, 'GET');
    assert.equal(
      new Headers(init.headers).get('authorization'),
      'Bearer synthetic.bearer.signature',
    );
    assert.equal(new Headers(init.headers).has('x-preview-instance'), false);
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json({ policy: 'staff-membership-page-v1', items: [member], nextAfter: null });
  };
  for (const query of [
    '',
    '?limit=0',
    '?limit=21',
    '?limit=02',
    '?limit=2&limit=2',
    '?limit=2&after=bad',
    '?after=' + id(1) + '&limit=2',
    '?%6cimit=2',
    '?limit=2&tenantId=' + id(5),
    '?limit=2#fragment',
  ])
    assert.equal((await directory(request(prefix + query), env, fetcher)).status, 400);
  for (const headers of [{ 'content-type': 'application/json' }, { 'content-length': '0' }])
    assert.equal(
      (await directory(request(prefix + '?limit=2', { headers }), env, fetcher)).status,
      400,
    );
  assert.equal(
    (await directory(request(prefix + '?limit=2', { body: command }), env, fetcher)).status,
    405,
  );
  assert.equal(calls, 0);
  const result = await directory(request(prefix + '?limit=2&after=' + id(1)), env, fetcher);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(await result.json(), {
    page: { policy: 'staff-membership-page-v1', items: [member], nextAfter: null },
  });
  assert.equal(calls, 1);
});
test('membership operation BFF binds body to route and rejects malformed/duplicate/oversized/framed authority before IO', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw Error('Unexpected upstream.');
  };
  for (const body of [
    { ...command, operationId: id(8) },
    { ...command, actorId: id(4) },
    { ...command, tenantId: id(5) },
    { ...command, requestedRole: 'customer' },
    { ...command, expectedVersion: 1 },
    '{"policy":"bad","policy":"staff-membership-command-v1"}',
    ' '.repeat(8193),
  ])
    assert.equal((await operation(request(opPath, { body }), id(2), env, fetcher)).status, 400);
  assert.equal(
    (
      await operation(
        request(opPath, { body: command, headers: { 'content-length': '2' } }),
        id(2),
        env,
        fetcher,
      )
    ).status,
    400,
  );
  for (const headers of [{ 'content-type': 'application/json' }, { 'content-length': '0' }])
    assert.equal((await operation(request(opPath, { headers }), id(2), env, fetcher)).status, 400);
  for (const path of [
    opPath + '?',
    opPath + '?tenant=bad',
    opPath + '#fragment',
    prefix + '/operations/' + id(8),
  ])
    assert.equal((await operation(request(path), id(2), env, fetcher)).status, 400);
  assert.equal((await operation(request(opPath), 'BAD', env, fetcher)).status, 400);
  assert.equal(
    (await current(request(prefix + '/' + id(3), { body: command }), id(3), env, fetcher)).status,
    405,
  );
  assert.equal(calls, 0);
});
test('membership BFF uses server-held identity for exact command/original/current endpoints with no-store envelopes', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, method: init.method });
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), 'Bearer synthetic.bearer.signature');
    assert.equal(headers.has('x-preview-instance'), false);
    assert.equal(headers.has('x-tenant-id'), false);
    assert.ok(init.signal instanceof AbortSignal);
    if (init.method === 'POST') assert.deepEqual(JSON.parse(init.body), command);
    return Response.json(url.endsWith('/operations/' + id(2)) ? receipt : member);
  };
  const saved = await operation(request(opPath, { body: command }), id(2), env, fetcher);
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { receipt });
  const original = await operation(request(opPath), id(2), env, fetcher);
  assert.equal(original.status, 200);
  assert.deepEqual(await original.json(), { receipt });
  const state = await current(request(prefix + '/' + id(3)), id(3), env, fetcher);
  assert.equal(state.status, 200);
  assert.deepEqual(await state.json(), { member });
  for (const response of [saved, original, state]) {
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  assert.deepEqual(calls, [
    { url: 'http://127.0.0.1:4101/v2/staff/memberships/operations/' + id(2), method: 'POST' },
    { url: 'http://127.0.0.1:4101/v2/staff/memberships/operations/' + id(2), method: 'GET' },
    { url: 'http://127.0.0.1:4101/v2/staff/memberships/' + id(3), method: 'GET' },
  ]);
});
test('unknown committed membership replies stay uncertain and private upstream errors are sanitized without retry', async () => {
  for (const fetcher of [
    async () => {
      throw Error('synthetic.bearer.signature private');
    },
    async () => Response.json({ corrupt: 'synthetic.bearer.signature private' }),
    async () => Response.json({ ...receipt, memberId: id(8) }),
  ]) {
    let calls = 0;
    const result = await operation(
      request(opPath, { body: command }),
      id(2),
      env,
      async (...args) => {
        calls++;
        return fetcher(...args);
      },
    );
    assert.ok(result.status >= 400);
    assert.deepEqual(await result.json(), {
      error: 'STAFF_MEMBERSHIP_UNAVAILABLE',
      submissionUncertain: true,
    });
    assert.equal(calls, 1);
  }
  const denied = async () =>
    Response.json(
      {
        error: { code: 'FORBIDDEN', message: 'synthetic.bearer.signature private' },
        requestId: id(44),
      },
      { status: 403, headers: { 'x-request-id': id(44) } },
    );
  const write = await operation(request(opPath, { body: command }), id(2), env, denied);
  assert.equal(write.status, 403);
  assert.deepEqual(await write.json(), {
    error: 'STAFF_MEMBERSHIP_UNAVAILABLE',
    submissionUncertain: false,
  });
  for (const fetcher of [
    denied,
    async () => Response.json({ policy: 'staff-membership-page-v1', items: [], nextAfter: id(3) }),
  ]) {
    const result = await directory(request(prefix + '?limit=2'), env, fetcher);
    assert.ok(result.status >= 400);
    assert.deepEqual(await result.json(), { error: 'STAFF_MEMBERSHIP_UNAVAILABLE' });
  }
  const badCurrent = await current(request(prefix + '/' + id(3)), id(3), env, async () =>
    Response.json({ ...member, memberId: id(8) }),
  );
  assert.ok(badCurrent.status >= 400);
  assert.deepEqual(await badCurrent.json(), {
    error: 'STAFF_MEMBERSHIP_UNAVAILABLE',
    submissionUncertain: false,
  });
});
