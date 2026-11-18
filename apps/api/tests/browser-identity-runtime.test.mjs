import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readBrowserIdentityEnvironment,
  configuredBrowserIdentityRoutes,
} from '../dist/browser-identity-runtime.js';
const valid = () => ({
  APP_ENV: 'staging',
  BROWSER_IDENTITY_CONFIG: JSON.stringify({
    issuer: 'https://identity.example',
    authorizationEndpoint: 'https://identity.example/authorize',
    tokenEndpoint: 'https://identity.example/token',
    jwksUrl: 'https://identity.example/jwks',
    clientId: 'test-client',
    clientSecret: 'sensitive-client-secret',
    apiAudience: 'realtor-api',
    applicationOrigin: 'https://web.example',
    tenantId: '00000000-0000-4000-8000-000000000001',
  }),
  BROWSER_IDENTITY_DATABASE_URL:
    'postgresql://identity_runtime:sensitive-db-secret@db.example/identity?sslmode=verify-full',
  BROWSER_IDENTITY_STORAGE_KEY: '01'.repeat(32),
});
test('hosted routes stay unavailable by default and do not disclose credentials on configuration failures', async () => {
  assert.equal(readBrowserIdentityEnvironment({}), null);
  for (const env of [
    {},
    { ...valid(), APP_ENV: 'development' },
    { ...valid(), BROWSER_IDENTITY_DATABASE_URL: 'postgresql://user:secret@db.example/identity' },
    { ...valid(), BROWSER_IDENTITY_STORAGE_KEY: 'bad' },
    { ...valid(), BROWSER_IDENTITY_CONFIG: '{secret invalid json' },
  ]) {
    const r = await configuredBrowserIdentityRoutes(() => env)(
      new Request('https://web.example/auth/session'),
    );
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await r.json(), { error: 'SIGN_IN_UNAVAILABLE' });
  }
});
test('hosted configuration requires separate TLS database credentials and excludes preview configuration or test exceptions', () => {
  const env = valid();
  assert.equal(readBrowserIdentityEnvironment(env).config.clientId, 'test-client');
  for (const url of [
    'postgresql://user:secret@db.example/identity?sslmode=require',
    'postgresql://user:secret@db.example/identity?sslmode=verify-full&sslmode=disable',
    'postgresql://user:secret@db.example/identity?sslmode=verify-full&sslcert=untrusted',
    'https://user:secret@db.example/identity?sslmode=verify-full',
  ])
    assert.throws(() =>
      readBrowserIdentityEnvironment({ ...env, BROWSER_IDENTITY_DATABASE_URL: url }),
    );
  assert.throws(() =>
    readBrowserIdentityEnvironment({ ...env, WEB_CUSTOMER_PREVIEW_CONFIG: 'preview' }),
  );
  const c = JSON.parse(env.BROWSER_IDENTITY_CONFIG);
  c.allowLoopbackHttpForTests = true;
  assert.throws(() =>
    readBrowserIdentityEnvironment({ ...env, BROWSER_IDENTITY_CONFIG: JSON.stringify(c) }),
  );
});
