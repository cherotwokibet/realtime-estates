import test from 'node:test';
import assert from 'node:assert/strict';
import { staffBranchBoundary as boundary } from '../dist/tests/lib/staff-branch-server.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_DIRECTORY_PREVIEW_MODE: 'synthetic-v1',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
  STAFF_PREVIEW_TOKEN: 'synthetic.bearer.signature',
  STAFF_PREVIEW_INSTANCE: id(1),
};
const command = {
  policy: 'staff-branch-command-v1',
  operationId: id(2),
  branchId: id(3),
  expectedVersion: '0',
  name: 'Synthetic',
  active: true,
  reason: 'Synthetic creation.',
};
const req = (body, headers = {}) =>
  new Request('http://localhost:3120/api/staff-directory/branches/operations/' + id(2), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      host: '127.0.0.1:3120',
      'x-preview-instance': id(1),
      ...(body === undefined
        ? {}
        : { origin: 'http://127.0.0.1:3120', 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
test('branch BFF refuses invalid original facts, duplicate JSON, framing and caller authority before upstream', async () => {
  let calls = 0;
  const transport = async () => {
    calls++;
    throw Error();
  };
  for (const body of [
    { ...command, actorId: id(4) },
    { ...command, operationId: id(4) },
    '{"policy":"bad","policy":"staff-branch-command-v1"}',
    ' '.repeat(8193),
  ])
    assert.equal((await boundary(req(body), 'operation', id(2), env, transport)).status, 400);
  assert.equal(
    (await boundary(req(command, { 'content-length': '2' }), 'operation', id(2), env, transport))
      .status,
    400,
  );
  assert.equal(
    (await boundary(req(undefined, { 'x-tenant-id': id(4) }), 'operation', id(2), env, transport))
      .status,
    403,
  );
  assert.equal(calls, 0);
});
test('branch BFF uses server-held identity and sanitizes unknown committed replies as uncertain', async () => {
  const r = await boundary(req(command), 'operation', id(2), env, async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:4101/v2/staff/branches/operations/' + id(2));
    assert.equal(
      new Headers(init.headers).get('authorization'),
      'Bearer synthetic.bearer.signature',
    );
    assert.deepEqual(JSON.parse(init.body), command);
    throw Error('synthetic.bearer.signature private');
  });
  assert.ok(r.status >= 400);
  assert.deepEqual(await r.json(), {
    error: 'STAFF_BRANCH_UNAVAILABLE',
    submissionUncertain: true,
  });
});
