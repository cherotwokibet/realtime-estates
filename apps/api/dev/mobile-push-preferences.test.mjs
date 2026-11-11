import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CustomerFavouritesClient } from '@realtor/api-client';
import { startCustomerPreview } from './customer-preview.mjs';
import { createMobileCustomerSession } from '../../mobile/src/customer-session.ts';
import { requestSyntheticCustomerGrant } from '../../mobile/src/synthetic-customer-sign-in.ts';

const consent = (expectedVersion, enabled) => ({
  policy: 'synthetic-customer-push-command-v1',
  operationId: randomUUID(),
  expectedVersion,
  action: 'consent',
  enabled,
  registrationId: null,
});
test('mobile notification settings recover originals and reload current consent before displaying it', async () => {
  const environment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  let preview, session;
  try {
    preview = await startCustomerPreview({
      mobileMode: 'synthetic-mobile-customer-v1',
      pushMode: 'synthetic-customer-push-v1',
    });
    const config = {
      mode: 'runtime-customer-v1',
      tenantId: preview.tenantId,
      apiOrigin: preview.origin,
      allowLoopbackHttp: true,
      pushMode: 'synthetic-customer-push-v1',
    };
    const calls = [];
    let lose = null;
    session = createMobileCustomerSession(config, async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ method: init.method, path, body: init.body });
      if (init.method === 'POST' && path.includes('/push-operations/') && lose) {
        const fault = lose;
        lose = null;
        if (fault === 'committed') {
          const response = await fetch(url, init);
          assert.equal(response.status, 200);
          await response.body.cancel();
        }
        throw Error('Synthetic response interruption.');
      }
      return fetch(url, init);
    });
    const grant = (persona) =>
      requestSyntheticCustomerGrant(
        preview.origin,
        preview.tenantId,
        persona,
        new AbortController().signal,
        fetch,
      );
    const a = await grant('a');
    assert(a);
    const otherClient = new CustomerFavouritesClient({
      baseUrl: preview.origin,
      allowLoopbackHttp: true,
      scope: { tenantId: preview.tenantId, customerId: a.customerId },
    });
    const auth = { bearerToken: a.bearerToken };
    assert.equal(await session.activate(a), true);
    assert.equal(await session.loadPushPreferences(), true);
    assert.equal(session.snapshot().push.preferences.enabled, false);

    lose = 'committed';
    const enable = consent('0', true);
    assert.equal(await session.changePushPreferences(enable), false);
    assert.deepEqual(session.snapshot().push, { phase: 'uncertain', preferences: null });
    assert.equal(await session.loadPushPreferences(), false);
    assert.equal(await session.changePushPreferences(consent('0', false)), false);
    assert.equal(await session.retryPushPreferences(), false);
    assert.equal(
      (await otherClient.changePushPreferences(consent('1', false), auth)).preferences.enabled,
      false,
    );
    assert.equal(await session.recoverPushPreferences(), true);
    const recovered = session.snapshot().push.preferences;
    assert.equal(recovered.version, '2');
    assert.equal(recovered.enabled, false);
    assert.deepEqual(
      calls.filter(({ path }) => path.endsWith(enable.operationId)).map(({ method }) => method),
      ['POST', 'GET'],
    );
    assert.equal(calls.at(-1).path, '/v2/customer/push-preferences');

    lose = 'before';
    const missing = consent('2', true);
    assert.equal(await session.changePushPreferences(missing), false);
    assert.equal(await session.recoverPushPreferences(), false);
    assert.equal(session.snapshot().push.phase, 'missing');
    assert.equal(await session.retryPushPreferences(), true);
    const retries = calls.filter(({ path }) => path.endsWith(missing.operationId));
    assert.deepEqual(
      retries.map(({ method }) => method),
      ['POST', 'GET', 'POST'],
    );
    assert.equal(retries[0].body, retries[2].body);
    const register = {
      ...consent('3', true),
      action: 'register',
      enabled: null,
      registrationId: randomUUID(),
    };
    assert.equal(await session.changePushPreferences(register), true);
    assert.equal(session.snapshot().push.preferences.activeDevices, 1);

    await otherClient.changePushPreferences(consent('4', false), auth);
    assert.equal(await session.changePushPreferences(consent('4', false)), false);
    const conflict = session.snapshot().push;
    assert.equal(conflict.conflict, true);
    assert.equal(conflict.preferences.version, '5');
    assert.equal(conflict.preferences.enabled, false);
    assert.equal(conflict.preferences.activeDevices, 0);

    assert.equal(await session.activate(await grant('b')), true);
    assert.deepEqual(session.snapshot().push, { phase: 'idle', preferences: null });
    assert.equal(await session.loadPushPreferences(), true);
    assert.equal(session.snapshot().push.preferences.activeDevices, 0);
    assert.equal(session.snapshot().push.preferences.enabled, false);
    session.clear();
    assert.equal(session.snapshot().status, 'signed_out');
  } finally {
    session?.clear();
    await preview?.close();
    if (environment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = environment;
  }
});
