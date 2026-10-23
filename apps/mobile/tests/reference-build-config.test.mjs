import test from 'node:test';
import assert from 'node:assert/strict';
import { getConfig } from '@expo/config';
import { fileURLToPath } from 'node:url';
test('actual Expo config exposes only explicit public development settings and refuses production or orphan flags', () => {
  const keys = [
    'NODE_ENV',
    'TENANT_SLUG',
    'MOBILE_CATALOGUE_MODE',
    'MOBILE_API_ORIGIN',
    'MOBILE_ALLOW_LOOPBACK_API',
  ];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const read = (patch) => {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, { NODE_ENV: 'development', TENANT_SLUG: 'sample-homes' }, patch);
    return getConfig(root, { skipSDKVersionRequirement: true }).exp;
  };
  try {
    assert.equal(read({}).extra.mobileReference, undefined);
    const env = {
      MOBILE_CATALOGUE_MODE: 'synthetic-reference-public-v1',
      MOBILE_API_ORIGIN: 'https://synthetic.invalid',
    };
    const config = read(env);
    assert.equal(config.extra.tenantSlug, 'sample-homes');
    assert.deepEqual(config.extra.mobileReference, {
      mode: 'synthetic-reference-public-v1',
      apiOrigin: 'https://synthetic.invalid',
      allowLoopbackHttp: false,
    });
    for (const patch of [
      { ...env, NODE_ENV: 'production' },
      { ...env, MOBILE_CATALOGUE_MODE: 'live' },
      { ...env, MOBILE_ALLOW_LOOPBACK_API: 'yes' },
      { MOBILE_API_ORIGIN: 'https://synthetic.invalid' },
    ])
      assert.throws(() => read(patch));
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});
