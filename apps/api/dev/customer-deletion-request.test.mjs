import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateCustomerDeletionCommand, validateCustomerDeletionRequest } from '@realtor/domain';
import { startCustomerPreview } from './customer-preview.mjs';

const readPath = '/v2/customer/deletion-request';
const writePath = (id) => '/v2/customer/deletion-requests/' + id;
const pushMode = 'synthetic-customer-push-v1';
const deletionMode = 'synthetic-customer-deletion-v1';
const command = (requestId = randomUUID()) => ({
  policy: 'synthetic-customer-deletion-command-v1',
  requestId,
  confirmed: true,
});
const request = (origin, path, token, body) =>
  fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });

test('signed deletion preview is explicitly enabled and requires the push withdrawal dependency', async (t) => {
  const prior = process.env.NODE_ENV;
  t.after(() =>
    prior === undefined ? delete process.env.NODE_ENV : (process.env.NODE_ENV = prior),
  );
  process.env.NODE_ENV = 'development';
  await assert.rejects(() => startCustomerPreview({ deletionMode }));
  await assert.rejects(() =>
    startCustomerPreview({ pushMode, deletionReplyFault: 'lost-first-deletion-result-v1' }),
  );
  const off = await startCustomerPreview({ pushMode });
  t.after(() => off.close());
  const [a] = off.configuration('http://127.0.0.1:3137').users;
  assert.equal((await request(off.origin, readPath, a.bearerToken)).status, 404);
  const value = command();
  assert.equal(
    (await request(off.origin, writePath(value.requestId), a.bearerToken, value)).status,
    404,
  );
});

test('a committed deletion request survives an unavailable HTTP reply and status remains customer scoped', async (t) => {
  const prior = process.env.NODE_ENV;
  t.after(() =>
    prior === undefined ? delete process.env.NODE_ENV : (process.env.NODE_ENV = prior),
  );
  process.env.NODE_ENV = 'development';
  const on = await startCustomerPreview({
    mobileMode: 'synthetic-mobile-customer-v1',
    pushMode,
    deletionMode,
    deletionReplyFault: 'lost-first-deletion-result-v1',
  });
  t.after(() => on.close());
  const [a, b] = on.configuration('http://127.0.0.1:3137').users;
  const staff = await on.viewingStaff();
  const scope = { tenantId: on.tenantId, customerId: a.id };
  const call = (path, token, body) => request(on.origin, path, token, body);
  const payload = validateCustomerDeletionCommand(command());
  const path = writePath(payload.requestId);

  assert.equal((await call(readPath)).status, 401);
  assert.equal((await call(path, staff.admin.bearerToken, payload)).status, 403);
  assert.equal((await call(path, a.bearerToken)).headers.get('allow'), 'POST');
  assert.equal((await call(readPath, a.bearerToken, payload)).headers.get('allow'), 'GET');
  assert.equal((await call(readPath + '?tenantId=other', a.bearerToken)).status, 400);
  assert.equal((await call(path, a.bearerToken, { ...payload, confirmed: false })).status, 400);
  assert.equal((await call(path, a.bearerToken, { ...payload, customerId: b.id })).status, 400);
  assert.equal((await call(path, a.bearerToken, command())).status, 400);
  assert.equal(
    (
      await call(
        path,
        a.bearerToken,
        JSON.stringify(payload).replace('true', 'true,"confirmed":true'),
      )
    ).status,
    400,
  );
  const initial = await call(readPath, a.bearerToken);
  assert.equal(initial.status, 200);
  assert.equal(initial.headers.get('cache-control'), 'no-store');
  assert.equal(await initial.json(), null);

  async function push(expectedVersion, action, enabled, registrationId) {
    const operationId = randomUUID();
    return call('/v2/customer/push-operations/' + operationId, a.bearerToken, {
      policy: 'synthetic-customer-push-command-v1',
      operationId,
      expectedVersion,
      action,
      enabled,
      registrationId,
    });
  }
  assert.equal((await push('0', 'consent', true, null)).status, 200);
  assert.equal(
    (await (await push('1', 'register', null, randomUUID())).json()).preferences.activeDevices,
    1,
  );
  assert.equal((await call(path, a.bearerToken, payload)).status, 503);
  const recovered = await call(readPath, a.bearerToken);
  assert.equal(recovered.status, 200);
  const saved = validateCustomerDeletionRequest(await recovered.json(), scope, payload.requestId);
  assert.equal(saved.status, 'pending_review');
  assert.deepEqual(await (await call(path, a.bearerToken, payload)).json(), saved);
  const duplicate = command();
  assert.equal((await call(writePath(duplicate.requestId), a.bearerToken, duplicate)).status, 409);
  const prefs = await (await call('/v2/customer/push-preferences', a.bearerToken)).json();
  assert.equal(prefs.enabled, false);
  assert.equal(prefs.activeDevices, 0);
  assert.equal((await push(prefs.version, 'consent', true, null)).status, 403);
  assert.equal(await (await call(readPath, b.bearerToken)).json(), null);
  assert.throws(() => validateCustomerDeletionRequest(saved, { ...scope, customerId: b.id }));
  assert.throws(() => validateCustomerDeletionRequest(saved, scope, duplicate.requestId));
  assert.throws(() => validateCustomerDeletionRequest({ ...saved, status: 'deleted' }, scope));
  assert.throws(() =>
    validateCustomerDeletionRequest({ ...saved, requestedAt: '2026-02-30T00:00:00.000Z' }, scope),
  );
  await on.revoke();
  assert.equal((await call(readPath, a.bearerToken)).status, 403);
  assert.equal((await call(path, a.bearerToken, payload)).status, 403);
});
