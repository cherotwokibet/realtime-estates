import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../dist/service.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
test('terminal resolution is default-off and production cannot opt into the synthetic rollout mode', async () => {
  let calls = 0;
  const options = {
    tenantId: id(1),
    privacyNoticeVersion: 'synthetic-v1',
    verifyAuthorization: async () => ({ actorId: id(10), expiresAt: Date.now() + 30000 }),
    database: {
      transaction: async () => {
        calls++;
        throw Error('Must not reach SQL');
      },
    },
  };
  const response = await createApiService(options)(
    new Request(
      'https://synthetic.invalid/v2/staff/private-operations/settings/' + id(20) + '/resolve',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer synthetic.token.signature',
          'content-type': 'application/json',
        },
        body: '{}',
      },
    ),
  );
  assert.equal(response.status, 404);
  assert.equal(calls, 0);
  assert.throws(() => createApiService({ ...options, privateOperationResolutionMode: 'unknown' }));
  const before = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() =>
      createApiService({
        ...options,
        privateOperationResolutionMode: 'synthetic-serialized-original-v1',
      }),
    );
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
});
