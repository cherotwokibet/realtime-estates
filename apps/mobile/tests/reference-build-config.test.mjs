import test from 'node:test';
import assert from 'node:assert/strict';
import { getConfig } from '@expo/config';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
test('actual Expo config exposes only explicit public development settings and refuses production or orphan flags', () => {
  const keys = [
    'NODE_ENV',
    'TENANT_SLUG',
    'MOBILE_CATALOGUE_MODE',
    'MOBILE_API_ORIGIN',
    'MOBILE_ALLOW_LOOPBACK_API',
    'MOBILE_CATALOGUE_VIDEO',
    'MOBILE_CATALOGUE_FLOOR_PLAN',
    'MOBILE_CATALOGUE_PHOTOS',
    'MOBILE_CUSTOMER_MODE',
    'MOBILE_PUSH_MODE',
    'MOBILE_DELETION_MODE',
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
    const floor = read({
      ...env,
      MOBILE_CATALOGUE_FLOOR_PLAN: 'synthetic-floor-plan-publication-v1',
    });
    assert.equal(floor.extra.mobileReference.floorPlanMode, 'synthetic-floor-plan-publication-v1');
    assert.throws(() =>
      read({ MOBILE_CATALOGUE_FLOOR_PLAN: 'synthetic-floor-plan-publication-v1' }),
    );
    assert.throws(() => read({ ...env, MOBILE_CATALOGUE_FLOOR_PLAN: 'live' }));
    assert.equal(
      read({ ...env, MOBILE_CATALOGUE_PHOTOS: 'synthetic-native-v1' }).extra.mobileReference
        .photoMode,
      'synthetic-native-v1',
    );
    assert.throws(() => read({ MOBILE_CATALOGUE_PHOTOS: 'synthetic-native-v1' }));
    assert.throws(() => read({ ...env, MOBILE_CATALOGUE_PHOTOS: 'live' }));
    const customer = {
      ...env,
      MOBILE_API_ORIGIN: 'http://127.0.0.1:3137',
      MOBILE_ALLOW_LOOPBACK_API: 'true',
      MOBILE_CUSTOMER_MODE: 'synthetic-mobile-customer-v1',
    };
    assert.equal(read(customer).extra.mobileReference.customerMode, customer.MOBILE_CUSTOMER_MODE);
    assert.throws(() => read({ ...customer, NODE_ENV: 'production' }));
    assert.throws(() => read({ ...customer, MOBILE_API_ORIGIN: 'https://synthetic.invalid' }));
    assert.throws(() => read({ MOBILE_CUSTOMER_MODE: customer.MOBILE_CUSTOMER_MODE }));
    const push = { ...customer, MOBILE_PUSH_MODE: 'synthetic-customer-push-v1' };
    assert.equal(read(push).extra.mobileReference.pushMode, push.MOBILE_PUSH_MODE);
    assert.throws(() => read({ ...push, NODE_ENV: 'production' }));
    assert.throws(() =>
      read({
        ...env,
        MOBILE_API_ORIGIN: customer.MOBILE_API_ORIGIN,
        MOBILE_ALLOW_LOOPBACK_API: 'true',
        MOBILE_PUSH_MODE: push.MOBILE_PUSH_MODE,
      }),
    );
    assert.throws(() => read({ ...push, MOBILE_PUSH_MODE: 'live' }));
    const deletion = { ...push, MOBILE_DELETION_MODE: 'synthetic-customer-deletion-v1' };
    assert.equal(read(deletion).extra.mobileReference.deletionMode, deletion.MOBILE_DELETION_MODE);
    assert.throws(() => read({ ...deletion, NODE_ENV: 'production' }));
    assert.throws(() => read({ ...customer, MOBILE_DELETION_MODE: deletion.MOBILE_DELETION_MODE }));
    assert.throws(() => read({ MOBILE_DELETION_MODE: deletion.MOBILE_DELETION_MODE }));
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

    const realtime = read({ TENANT_SLUG: 'realtime-estates' });
    const sample = read({ TENANT_SLUG: 'sample-homes' });
    assert.equal(realtime.android.package, 'com.boniface.realtor.preview.realtime.estates');
    assert.equal(realtime.ios.bundleIdentifier, realtime.android.package);
    assert.equal(sample.android.package, 'com.boniface.realtor.preview.sample.homes');
    assert.notEqual(sample.android.package, realtime.android.package);
    for (const [tenant, color] of [
      ['realtime-estates', '#5e0202'],
      ['sample-homes', '#10465b'],
    ]) {
      const built = read({ TENANT_SLUG: tenant });
      assert.match(built.name, /Preview$/);
      assert.match(built.slug, /-preview$/);
      assert.equal(built.scheme, `${tenant}-preview`);
      for (const iconName of [`${tenant}.png`, `${tenant}-foreground.png`]) {
        const iconPath = new URL(`../assets/icons/${iconName}`, import.meta.url);
        assert.ok(existsSync(iconPath));
        const icon = readFileSync(iconPath);
        assert.deepEqual(
          [...icon.subarray(0, 8)],
          [137, 80, 78, 71, 13, 10, 26, 10],
          `${iconName} must be a PNG`,
        );
        assert.equal(icon.readUInt32BE(16), 1024);
        assert.equal(icon.readUInt32BE(20), 1024);
      }
      assert.ok(existsSync(new URL(`../assets/icons/${tenant}.svg`, import.meta.url)));
      assert.ok(existsSync(new URL(`../assets/icons/${tenant}-foreground.svg`, import.meta.url)));
      assert.equal(built.android.adaptiveIcon.backgroundColor, color);
    }

    const eas = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));
    assert.equal(eas.build.development.credentialsSource, 'remote');
    assert.equal(eas.build.preview.credentialsSource, 'remote');
    assert.equal(eas.build['sample-preview'].extends, 'preview');
    assert.equal(eas.build['sample-preview'].env.TENANT_SLUG, 'sample-homes');
    assert.equal(
      Object.values(eas.build).some((profile) =>
        /(?:TOKEN|SECRET|PASSWORD|KEY)/i.test(JSON.stringify(profile)),
      ),
      false,
    );
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});
