import test from 'node:test';
import assert from 'node:assert/strict';
import { publicIntakeConfig, authorizePublicIntake } from '../dist/tests/lib/intake-config.js';
import { handleSyntheticEnquiry } from '@realtor/api-client';
const id = '00000000-0000-4000-8000-000000000919';
const env = {
  NODE_ENV: 'development',
  WEB_ENQUIRY_PREVIEW_MODE: 'synthetic-v1',
  WEB_ENQUIRY_API_ORIGIN: 'http://127.0.0.1:4101',
  WEB_ENQUIRY_INSTANCE: id,
  TENANT_SLUG: 'realtime-estates',
};
test('property mode is explicit and bound to the same synthetic connected catalogue', () => {
  const propertyEnv = {
    ...env,
    WEB_ENQUIRY_PROPERTY_MODE: 'synthetic-v1',
    WEB_CATALOGUE_MODE: 'connected',
    WEB_CATALOGUE_DATA: 'synthetic',
    API_ORIGIN: 'http://127.0.0.1:4101',
  };
  assert.equal(publicIntakeConfig(env).allowProperty, false);
  assert.equal(publicIntakeConfig(propertyEnv).allowProperty, true);
  for (const overrides of [
    { WEB_CATALOGUE_MODE: 'demo' },
    { WEB_CATALOGUE_DATA: 'unspecified' },
    { API_ORIGIN: 'http://127.0.0.1:4102' },
    { WEB_ENQUIRY_PROPERTY_MODE: 'invalid' },
  ])
    assert.throws(() => publicIntakeConfig({ ...propertyEnv, ...overrides }));
});
test('shared property boundary forwards untrusted UUID selection only when enabled and keeps replay key', async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return Response.json({ id }, { status: 201 });
  };
  try {
    const body = { ...JSON.parse(await request().text()), listingId: id };
    const scope = publicIntakeConfig(env);
    const run = (allowProperty) =>
      handleSyntheticEnquiry(request({}, JSON.stringify(body)), {
        ...scope,
        allowProperty,
        authorize: (r) => authorizePublicIntake(r, id),
      });
    assert.equal((await run(false)).status, 400);
    assert.equal(calls.length, 0);
    assert.equal((await run(true)).status, 201);
    assert.equal(JSON.parse(calls[0].init.body).listingId, id);
    assert.equal(calls[0].init.headers['Idempotency-Key'], id);
    assert.equal((await run(true)).status, 201);
    assert.equal(calls[0].init.body, calls[1].init.body);
  } finally {
    globalThis.fetch = original;
  }
});
const request = (headers = {}, body) =>
  new Request('http://127.0.0.1:3002/api/enquiry-intake', {
    method: 'POST',
    body:
      body ??
      JSON.stringify({
        listingId: null,
        name: 'Fictional guest',
        email: 'guest@example.invalid',
        phone: null,
        message: 'Synthetic public website enquiry',
        origin: 'web',
        noticeVersion: 'synthetic-staff-notice-v1',
        noticeAcknowledged: true,
      }),
    headers: {
      host: '127.0.0.1:3002',
      origin: 'http://127.0.0.1:3002',
      'x-preview-instance': id,
      'content-type': 'application/json',
      'idempotency-key': id,
      ...headers,
    },
  });
test('public capture needs explicit development deployment configuration without staff tokens', () => {
  assert.equal(publicIntakeConfig(env).tenantSlug, 'realtime-estates');
  assert.ok(Object.isFrozen(publicIntakeConfig(env)));
  for (const overrides of [
    { NODE_ENV: 'production' },
    { WEB_ENQUIRY_PREVIEW_MODE: undefined },
    { WEB_ENQUIRY_API_ORIGIN: 'https://other.invalid' },
    { WEB_ENQUIRY_API_ORIGIN: 'http://127.0.0.1:4101/?tenant=other' },
    { WEB_ENQUIRY_INSTANCE: 'bad' },
    { TENANT_SLUG: 'unknown' },
  ])
    assert.throws(() => publicIntakeConfig({ ...env, ...overrides }));
});
test('public authorization refuses foreign origin, host, identity and stale instance', () => {
  authorizePublicIntake(request(), id);
  for (const headers of [
    { origin: 'https://other.invalid' },
    { host: 'localhost:3002' },
    { authorization: 'Bearer secret' },
    { 'x-preview-instance': 'stale' },
    { 'sec-fetch-site': 'cross-site' },
  ])
    assert.throws(() => authorizePublicIntake(request(headers), id));
});
test('public form boundary saves guest-only to fixed upstream and denies caller tenant/property/cookie', async () => {
  const scope = publicIntakeConfig(env),
    original = globalThis.fetch;
  let calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return Response.json({ id }, { status: 201 });
  };
  const run = (r) =>
    handleSyntheticEnquiry(r, {
      ...scope,
      authorize: (r) => authorizePublicIntake(r, scope.instanceId),
    });
  try {
    assert.equal((await run(request())).status, 201);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:4101/v1/enquiries');
    assert.equal(calls[0].init.headers.Authorization, undefined);
    for (const headers of [{ cookie: 'session=secret' }, { 'x-tenant-id': id }])
      assert.equal((await run(request(headers))).status, 400);
    for (const change of [
      { tenantId: id },
      { listingId: id },
      { noticeVersion: 'catalogue-read-only' },
      { noticeAcknowledged: false },
    ]) {
      const body = { ...JSON.parse(await request().text()), ...change };
      assert.equal((await run(request({}, JSON.stringify(body)))).status, 400);
    }
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});
