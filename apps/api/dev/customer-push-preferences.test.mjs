import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  validateCustomerPushCommand,
  validateCustomerPushPreferences,
  validateCustomerPushReceipt,
} from '@realtor/domain';
import { startCustomerPreview } from './customer-preview.mjs';

const consent = (expectedVersion, enabled) => ({
  policy: 'synthetic-customer-push-command-v1',
  operationId: randomUUID(),
  expectedVersion,
  action: 'consent',
  enabled,
  registrationId: null,
});
test('signed customer preferences retain the original receipt and keep peer and staff scopes private', async () => {
  const originalEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  let off, on;
  try {
    off = await startCustomerPreview();
    assert.equal((await fetch(off.origin + '/v2/customer/push-preferences')).status, 404);
    await off.close();
    off = undefined;
    on = await startCustomerPreview({
      mobileMode: 'synthetic-mobile-customer-v1',
      pushMode: 'synthetic-customer-push-v1',
    });
    const fixture = on.configuration('http://127.0.0.1:3137');
    const [a, b] = fixture.users;
    const staff = await on.viewingStaff();
    const scope = { tenantId: on.tenantId, customerId: a.id };
    const prefs = '/v2/customer/push-preferences';
    const call = (path, token, init = {}) =>
      fetch(on.origin + path, {
        ...init,
        headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...init.headers },
      });
    const operation = (command) => '/v2/customer/push-operations/' + command.operationId;
    const submit = (command, path = operation(command)) =>
      call(path, a.bearerToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });

    assert.equal((await call(prefs)).status, 401);
    assert.equal((await call(prefs, staff.admin.bearerToken)).status, 403);
    const initial = await call(prefs, a.bearerToken);
    assert.equal(initial.headers.get('cache-control'), 'no-store');
    assert.equal(validateCustomerPushPreferences(await initial.json(), scope).enabled, false);

    const first = validateCustomerPushCommand(consent('0', true));
    assert.equal((await submit(first, operation(consent('0', true)))).status, 400);
    assert.equal((await submit({ ...first, tenantId: on.tenantId })).status, 400);
    const applied = await submit(first);
    assert.equal(applied.status, 200);
    await applied.body.cancel();
    const recovered = await call(operation(first), a.bearerToken);
    const receipt = validateCustomerPushReceipt(
      await recovered.json(),
      scope,
      first.operationId,
      first,
    );
    assert.equal(receipt.preferences.version, '1');
    assert.equal(receipt.preferences.enabled, true);
    assert.equal((await call(operation(first), b.bearerToken)).status, 404);
    assert.equal((await submit({ ...first, enabled: false })).status, 409);

    const device = validateCustomerPushCommand({
      ...consent('1', true),
      action: 'register',
      enabled: null,
      registrationId: randomUUID(),
    });
    const registration = await submit(device);
    assert.equal(registration.status, 200);
    assert.equal(
      validateCustomerPushReceipt(await registration.json(), scope, device.operationId, device)
        .preferences.activeDevices,
      1,
    );
    const disabled = await submit(consent('2', false));
    assert.equal(disabled.status, 200);
    const optedOut = (await disabled.json()).preferences;
    assert.equal(optedOut.enabled, false);
    assert.equal(optedOut.activeDevices, 0);
    assert.deepEqual(await (await submit(first)).json(), receipt);
    assert.equal(
      validateCustomerPushPreferences(await (await call(prefs, a.bearerToken)).json(), scope)
        .enabled,
      false,
    );
    assert.throws(() =>
      validateCustomerPushReceipt(receipt, scope, first.operationId, { ...first, enabled: false }),
    );
    assert.throws(() =>
      validateCustomerPushPreferences({ ...receipt.preferences, activeDevices: 11 }, scope),
    );
    await on.revoke();
    assert.equal((await call(operation(first), a.bearerToken)).status, 403);
  } finally {
    await off?.close();
    await on?.close();
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
  }
});
