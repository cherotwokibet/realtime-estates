import test from 'node:test';
import assert from 'node:assert/strict';
import { staffInvitationBoundary as boundary } from '../dist/tests/lib/staff-invitation-server.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_DIRECTORY_PREVIEW_MODE: 'synthetic-v1',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
  STAFF_PREVIEW_TOKEN: 'synthetic.bearer.signature',
  STAFF_PREVIEW_INSTANCE: id(1),
};
const intent = {
  policy: 'staff-invitation-intent-v1',
  operationId: id(2),
  recipientEmail: 'synthetic@example.invalid',
  requestedRole: 'agent',
  branchId: null,
  expiresAfterHours: 24,
};
const req = (body) =>
  new Request('http://localhost:3120/api/staff-directory/invitations/operations/' + id(2), {
    method: 'POST',
    headers: {
      host: '127.0.0.1:3120',
      'x-preview-instance': id(1),
      origin: 'http://127.0.0.1:3120',
      'content-type': 'application/json',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
test('invitation BFF rejects mismatched/extra authority/duplicate/oversized intent before upstream', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw Error();
  };
  for (const body of [
    { ...intent, operationId: id(3) },
    { ...intent, actorId: id(3) },
    { ...intent, membershipGranted: true },
    '{"policy":"bad","policy":"staff-invitation-intent-v1"}',
    ' '.repeat(8193),
  ])
    assert.equal(
      (await boundary(req(body), 'capture', id(2), undefined, env, fetcher)).status,
      400,
    );
  assert.equal(calls, 0);
});
test('invitation BFF sanitizes upstream uncertainty, production/default-off never dispatch', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw Error('synthetic.bearer.signature private');
  };
  for (const config of [
    { ...env, NODE_ENV: 'production' },
    { ...env, STAFF_DIRECTORY_PREVIEW_MODE: undefined },
  ])
    assert.equal(
      (await boundary(req(intent), 'capture', id(2), undefined, config, fetcher)).status,
      403,
    );
  assert.equal(calls, 0);
  const response = await boundary(req(intent), 'capture', id(2), undefined, env, fetcher);
  assert.deepEqual(await response.json(), {
    error: 'STAFF_INVITATION_UNAVAILABLE',
    submissionUncertain: true,
  });
  assert.equal(calls, 1);
});
