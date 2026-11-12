import test from 'node:test';
import assert from 'node:assert/strict';
import { readPropertyAssociation } from '../dist/tests/lib/property-app-link-associations.js';

const fingerprint = Array(32).fill('A1').join(':');
const base = {
  WEB_APP_LINKS_MODE: 'synthetic-v1',
  WEB_PUBLIC_ORIGIN: 'https://catalogue.synthetic.invalid',
  TENANT_SLUG: 'sample-homes',
  WEB_APP_LINKS_ANDROID_SHA256: fingerprint,
  WEB_APP_LINKS_IOS_TEAM_ID: 'SYNTHETIC1',
};

test('Android publishes the configured signer and only the chosen preview application', async () => {
  const response = readPropertyAssociation('android', base);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.boniface.realtor.preview.sample.homes',
        sha256_cert_fingerprints: [fingerprint],
      },
    },
  ]);
});

test('iOS scopes the selected preview association to property paths', async () => {
  const response = readPropertyAssociation('ios', { ...base, TENANT_SLUG: 'realtime-estates' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    applinks: {
      details: [
        {
          appIDs: ['SYNTHETIC1.com.boniface.realtor.preview.realtime.estates'],
          components: [{ '/': '/properties/*' }],
        },
      ],
    },
  });
});

test('missing opt-in, unknown tenant and noncanonical origins expose no association', async () => {
  const cases = [
    { WEB_APP_LINKS_MODE: undefined },
    { TENANT_SLUG: undefined },
    { TENANT_SLUG: 'unknown-company' },
    ...[
      'http://catalogue.synthetic.invalid',
      'https://127.0.0.1',
      'https://[::1]',
      'https://preview.localhost',
      'https://user@catalogue.synthetic.invalid',
      'https://catalogue.synthetic.invalid/path',
      'https://catalogue.synthetic.invalid?',
    ].map((WEB_PUBLIC_ORIGIN) => ({ WEB_PUBLIC_ORIGIN })),
  ];
  for (const overrides of cases) {
    for (const platform of ['ios', 'android']) {
      const result = readPropertyAssociation(platform, { ...base, ...overrides });
      assert.equal(result.status, 404, JSON.stringify(overrides));
      assert.equal(await result.text(), '');
    }
  }
});

test('each platform requires its own well-formed signing identity', () => {
  const android = { ...base, WEB_APP_LINKS_IOS_TEAM_ID: undefined };
  assert.equal(readPropertyAssociation('android', android).status, 200);
  assert.equal(readPropertyAssociation('ios', android).status, 404);
  const ios = { ...base, WEB_APP_LINKS_ANDROID_SHA256: 'A1:A1' };
  assert.equal(readPropertyAssociation('ios', ios).status, 200);
  assert.equal(readPropertyAssociation('android', ios).status, 404);
  assert.equal(
    readPropertyAssociation('ios', { ...base, WEB_APP_LINKS_IOS_TEAM_ID: 'short' }).status,
    404,
  );
});
