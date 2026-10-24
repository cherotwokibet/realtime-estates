import test from 'node:test';
import assert from 'node:assert/strict';
import { readRevisionProtocolScreen } from '../dist/tests/lib/revision-protocol-screen.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_PREVIEW_REFERENCE: 'synthetic-reference-draft-v1',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4001',
  STAFF_PREVIEW_TOKEN: 'synthetic.server.secret',
  STAFF_PREVIEW_INSTANCE: id(9),
};
const row = () => ({
  listingId: id(100),
  revision: 1,
  listingVersion: '1',
  revisionVersion: '2',
  state: 'draft',
  editable: true,
  protocol: 'synthetic-reference-v1',
});
test('server protocol loader captures verified scope and bounded target with fixed server credentials', async () => {
  const calls = [];
  const result = await readRevisionProtocolScreen(id(100), '1', env, async (url, init) => {
    calls.push(String(url));
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer synthetic.server.secret');
    assert.equal(init.method, 'GET');
    return Response.json(
      calls.length === 1
        ? { policy: 'synthetic-reference-session-v1', tenantId: id(1), actorId: id(11) }
        : row(),
    );
  });
  assert.deepEqual(calls, [
    'http://127.0.0.1:4001/v3/staff/reference-session',
    `http://127.0.0.1:4001/v3/staff/listings/${id(100)}/revision-protocol/1`,
  ]);
  assert.deepEqual(result, {
    scope: { instanceId: id(9), tenantId: id(1), actorId: id(11) },
    protocol: row(),
  });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.scope));
  assert.ok(!JSON.stringify(result).includes('secret'));
});
test('server protocol loader rejects disabled/unsafe config or malformed target before transport', async () => {
  let calls = 0;
  const fetch = async () => {
    calls++;
    throw Error('unexpected');
  };
  for (const change of [
    { NODE_ENV: 'production' },
    { STAFF_PREVIEW_REFERENCE: undefined },
    { STAFF_PREVIEW_API_ORIGIN: 'https://other.invalid' },
    { STAFF_PREVIEW_TOKEN: '' },
  ])
    await assert.rejects(readRevisionProtocolScreen(id(100), '1', { ...env, ...change }, fetch));
  for (const revision of ['01', '0', '2147483648', '1?x=1'])
    await assert.rejects(readRevisionProtocolScreen(id(100), revision, env, fetch));
  assert.equal(calls, 0);
});
test('server protocol loader never substitutes ordinary routing for denied, forged or absent capability', async () => {
  for (const response of [
    () => Response.json({ error: { code: 'NOT_FOUND', message: 'unavailable' } }, { status: 404 }),
    () => Response.json({ ...row(), listingId: id(999) }),
    () => Response.json({ ...row(), protocol: 'ordinary-default' }),
  ]) {
    let calls = 0;
    await assert.rejects(
      readRevisionProtocolScreen(id(100), '1', env, async () =>
        ++calls === 1
          ? Response.json({
              policy: 'synthetic-reference-session-v1',
              tenantId: id(1),
              actorId: id(11),
            })
          : response(),
      ),
    );
    assert.equal(calls, 2);
  }
});
