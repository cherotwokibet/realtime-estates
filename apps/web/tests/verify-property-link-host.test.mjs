import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPropertyLinkHost } from '../scripts/verify-property-link-host.mjs';
import { readPropertyAssociation } from '../dist/tests/lib/property-app-link-associations.js';

const env = {
  WEB_APP_LINKS_MODE: 'synthetic-v1',
  TENANT_SLUG: 'sample-homes',
  WEB_PUBLIC_ORIGIN: 'https://catalogue.synthetic.invalid',
  WEB_APP_LINKS_TEST_LISTING_ID: '00000000-0000-4000-8000-000000000123',
  WEB_APP_LINKS_ANDROID_SHA256: Array(32).fill('1F').join(':'),
  WEB_APP_LINKS_IOS_TEAM_ID: 'SYNTHETIC1',
};
const android = '/.well-known/assetlinks.json';
const ios = '/.well-known/apple-app-site-association';
const listing = '/properties/' + env.WEB_APP_LINKS_TEST_LISTING_ID;
const fallback = (canonical = env.WEB_PUBLIC_ORIGIN + listing) =>
  new Response('<html><head><link href="' + canonical + '" rel="canonical"/></head></html>', {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

function host(serve = {}) {
  const paths = [];
  return {
    paths,
    fetch: async (url, init) => {
      const target = new URL(url);
      assert.equal(target.origin, env.WEB_PUBLIC_ORIGIN);
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'manual');
      paths.push(target.pathname);
      if (Object.hasOwn(serve, target.pathname)) return serve[target.pathname]();
      if (target.pathname === android || target.pathname === ios)
        return readPropertyAssociation(target.pathname === android ? 'android' : 'ios', env);
      assert.equal(target.pathname, listing);
      return fallback();
    },
  };
}

test('host preflight checks configured association files and the canonical HTML listing anonymously', async () => {
  const full = host();
  const result = await verifyPropertyLinkHost(env, full.fetch);
  assert.deepEqual(full.paths, [android, ios, listing]);
  assert.deepEqual(result.checked, [android, ios]);
  assert.equal(result.appId, 'com.boniface.realtor.preview.sample.homes');
  assert.equal(result.listingUrl, env.WEB_PUBLIC_ORIGIN + listing);
  const androidOnly = host();
  await verifyPropertyLinkHost({ ...env, WEB_APP_LINKS_IOS_TEAM_ID: undefined }, androidOnly.fetch);
  assert.deepEqual(androidOnly.paths, [android, listing]);
});

test('preflight rejects a redirect, an auth wall, wrong signing scope or a missing listing', async () => {
  for (const [override, expected] of [
    [{ [android]: () => Response.redirect(env.WEB_PUBLIC_ORIGIN + '/sign-in') }, /direct 200/],
    [
      { [ios]: () => new Response('Sign in', { headers: { 'content-type': 'text/html' } }) },
      /application\/json/,
    ],
    [
      {
        [android]: () =>
          readPropertyAssociation('android', {
            ...env,
            WEB_APP_LINKS_ANDROID_SHA256: Array(32).fill('20').join(':'),
          }),
      },
      /signer and route scope/,
    ],
    [
      {
        [ios]: () =>
          Response.json({
            applinks: {
              details: [
                {
                  appIDs: ['SYNTHETIC1.com.boniface.realtor.preview.sample.homes'],
                  components: [{ '/': '/*' }],
                },
              ],
            },
          }),
      },
      /signer and route scope/,
    ],
    [{ [listing]: () => fallback(env.WEB_PUBLIC_ORIGIN + '/account') }, /canonical listing/],
    [{ [listing]: () => new Response(null, { status: 404 }) }, /HTTP 404/],
  ])
    await assert.rejects(() => verifyPropertyLinkHost(env, host(override).fetch), expected);
});

test('invalid preflight configuration does not make requests', async () => {
  const offline = host();
  for (const changes of [
    { WEB_PUBLIC_ORIGIN: 'http://catalogue.synthetic.invalid' },
    { WEB_APP_LINKS_TEST_LISTING_ID: 'demo-ruaka-1' },
    { TENANT_SLUG: 'unknown' },
    { WEB_APP_LINKS_IOS_TEAM_ID: 'invalid' },
    { WEB_APP_LINKS_ANDROID_SHA256: undefined, WEB_APP_LINKS_IOS_TEAM_ID: undefined },
  ])
    await assert.rejects(() => verifyPropertyLinkHost({ ...env, ...changes }, offline.fetch));
  assert.deepEqual(offline.paths, []);
});
