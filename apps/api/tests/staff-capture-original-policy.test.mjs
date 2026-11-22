import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../dist/service.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const path = 'https://synthetic.invalid/v2/staff/capture-originals/' + id(20);
const options = {
  tenantId: id(1),
  privacyNoticeVersion: 'synthetic-staff-notice-v1',
  verifyAuthorization: async () => ({ actorId: id(10), expiresAt: Date.now() + 30000 }),
  database: { transaction: async () => assert.fail('Invalid request must not reach SQL') },
};
test('staff capture originals default closed, require the fixed notice and cannot activate in production', async () => {
  for (const method of ['GET', 'POST'])
    assert.equal(
      (
        await createApiService(options)(
          new Request(path, {
            method,
            headers: {
              authorization: 'Bearer synthetic.token.signature',
              ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
            },
            ...(method === 'POST' ? { body: '{}' } : {}),
          }),
        )
      ).status,
      404,
    );
  assert.throws(() => createApiService({ ...options, staffCaptureOriginalMode: 'unknown' }));
  assert.throws(() =>
    createApiService({
      ...options,
      privacyNoticeVersion: 'other',
      staffCaptureOriginalMode: 'synthetic-staff-capture-original-v1',
    }),
  );
  const prior = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() =>
      createApiService({
        ...options,
        staffCaptureOriginalMode: 'synthetic-staff-capture-original-v1',
      }),
    );
  } finally {
    if (prior === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prior;
  }
});
test('staff capture originals reject duplicate facts, route mismatch, query, body framing and caller authority before SQL', async () => {
  const service = createApiService({
    ...options,
    staffCaptureOriginalMode: 'synthetic-staff-capture-original-v1',
  });
  for (const headers of [
    { cookie: 'x' },
    { 'x-role': 'admin' },
    { range: 'bytes=0-1' },
    { 'content-type': 'application/json' },
  ])
    assert.equal(
      (
        await service(
          new Request(path, {
            headers: { authorization: 'Bearer synthetic.token.signature', ...headers },
          }),
        )
      ).status,
      400,
    );
  assert.equal(
    (
      await service(
        new Request(path + '?', { headers: { authorization: 'Bearer synthetic.token.signature' } }),
      )
    ).status,
    400,
  );
  const command = {
    policy: 'staff-capture-command-v1',
    role: 'admin',
    operationId: id(20),
    input: {
      listingId: null,
      name: 'Synthetic',
      phone: null,
      email: 'synthetic@example.test',
      message: 'Synthetic',
      noticeVersion: 'synthetic-staff-notice-v1',
      noticeAcknowledged: true,
    },
  };
  for (const body of [
    JSON.stringify({ ...command, operationId: id(21) }),
    JSON.stringify(command).replace('"role":', '"role":"admin","role":'),
  ])
    assert.equal(
      (
        await service(
          new Request(path, {
            method: 'POST',
            headers: {
              authorization: 'Bearer synthetic.token.signature',
              'content-type': 'application/json',
            },
            body,
          }),
        )
      ).status,
      400,
    );
});
