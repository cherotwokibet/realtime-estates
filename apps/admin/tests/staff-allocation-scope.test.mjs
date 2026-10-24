import test from 'node:test';
import assert from 'node:assert/strict';
import { readStaffAllocationScope } from '../dist/tests/lib/staff-allocation-scope.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4001',
  STAFF_PREVIEW_TOKEN: 'synthetic.server.secret',
  STAFF_PREVIEW_INSTANCE: id(9),
};
test('allocation scope reads verified current identity using server-only fixed bearer', async () => {
  let calls = 0;
  const scope = await readStaffAllocationScope(env, async (url, init) => {
    calls++;
    assert.equal(String(url), 'http://127.0.0.1:4001/v2/staff/session');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer synthetic.server.secret');
    assert.equal(init.method, 'GET');
    return Response.json({ policy: 'current-staff-session-v2', tenantId: id(1), actorId: id(10) });
  });
  assert.equal(calls, 1);
  assert.deepEqual(scope, { instanceId: id(9), tenantId: id(1), actorId: id(10) });
  assert.ok(Object.isFrozen(scope));
  assert.ok(!JSON.stringify(scope).includes('secret'));
});
test('production, missing credentials and non-loopback configuration fail before network', async () => {
  let calls = 0;
  for (const change of [
    { NODE_ENV: 'production' },
    { STAFF_PREVIEW_TOKEN: '' },
    { STAFF_PREVIEW_API_ORIGIN: 'https://example.com' },
  ])
    await assert.rejects(
      readStaffAllocationScope({ ...env, ...change }, async () => {
        calls++;
        throw Error('unexpected');
      }),
    );
  assert.equal(calls, 0);
});
test('malformed current identity never becomes a scope', async () => {
  await assert.rejects(
    readStaffAllocationScope(env, async () =>
      Response.json({ policy: 'current-staff-session-v2', tenantId: id(1), actorId: 'forged' }),
    ),
  );
});
