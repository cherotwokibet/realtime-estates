import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  publicPhotoPath,
  publicPhotosEnabled,
  handlePublicPhoto,
} from '../dist/tests/lib/public-photos.js';
import { PublicPhotoGallery } from '../dist/tests/components/PublicPhotoGallery.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const env = {
  NODE_ENV: 'test',
  TENANT_SLUG: 'realtime-estates',
  WEB_CATALOGUE_MODE: 'connected',
  WEB_CATALOGUE_DATA: 'synthetic',
  API_ORIGIN: 'http://127.0.0.1:4321',
  ALLOW_LOOPBACK_API: 'true',
  WEB_PUBLIC_MEDIA_MODE: 'synthetic-native-v1',
};
const target = { listing: id(100), revision: '1', job: id(200), output: id(300) };
const key = `synthetic/${id(1)}/${target.job}/${target.output}.webp`;
const url = 'http://127.0.0.1:3118' + publicPhotoPath(target.listing, 1, key);
function bytes() {
  const b = Buffer.alloc(24);
  b.write('RIFF');
  b.writeUInt32LE(16, 4);
  b.write('WEBP', 8);
  b.write('VP8L', 12);
  return b;
}
const reply = (data = bytes(), headers = {}) =>
  new Response(data, {
    headers: { 'Content-Type': 'image/webp', 'Content-Length': String(data.length), ...headers },
  });

test('public gallery mode requires explicit connected synthetic local configuration and canonical media keys', () => {
  assert.equal(publicPhotosEnabled(env), true);
  for (const change of [
    { NODE_ENV: 'production' },
    { WEB_PUBLIC_MEDIA_MODE: undefined },
    { WEB_CATALOGUE_MODE: 'demo' },
    { WEB_CATALOGUE_DATA: 'unspecified' },
    { ALLOW_LOOPBACK_API: 'false' },
    { API_ORIGIN: 'https://foreign.invalid' },
  ])
    assert.equal(publicPhotosEnabled({ ...env, ...change }), false);
  assert.equal(publicPhotoPath(target.listing, 1, key), url.slice(url.indexOf('/api/')));
  for (const bad of [
    'https://foreign.invalid/a.webp',
    '../secret',
    'synthetic/' + id(1) + '/../private.webp',
    key + '?token=secret',
    key.toUpperCase(),
  ])
    assert.equal(publicPhotoPath(target.listing, 1, bad), null);
  for (const n of [null, 0, 1.5, 2147483648])
    assert.equal(publicPhotoPath(target.listing, n, key), null);
});
test('public proxy forwards a fixed anonymous GET only and emits bounded WebP without upstream identity headers', async () => {
  let calls = 0;
  const fetchImage = async (to, options) => {
    calls++;
    assert.equal(
      to,
      `${env.API_ORIGIN}/v2/public/listings/${target.listing}/revisions/1/photos/${target.job}/${target.output}.webp`,
    );
    assert.deepEqual(options.headers, { Accept: 'image/webp' });
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    return reply(bytes(), { 'Set-Cookie': 'PRIVATE=never-forward', 'X-Private': 'never-forward' });
  };
  const r = await handlePublicPhoto(
    new Request(url, {
      headers: {
        cookie: 'not-forwarded=anything',
        'x-tenant-id': id(999),
        'x-forwarded-host': 'foreign.invalid',
      },
    }),
    target,
    env,
    fetchImage,
  );
  assert.equal(r.status, 200);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes());
  assert.equal(calls, 1);
  assert.equal(r.headers.get('set-cookie'), null);
  assert.equal(r.headers.get('x-private'), null);
  assert.match(r.headers.get('cache-control'), /no-store/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});
test('invalid proxy routes, credential/range/query requests and disabled mode cause no upstream read', async () => {
  let calls = 0;
  const f = async () => {
    calls++;
    return reply();
  };
  for (const input of [
    { target: { ...target, revision: '01' } },
    { target: { ...target, output: '../secret' } },
    { request: new Request(url + '?origin=https://foreign.invalid') },
    { request: new Request(url, { headers: { Authorization: 'Bearer private' } }) },
    { request: new Request(url, { headers: { Range: 'bytes=1-2' } }) },
    { request: new Request(url, { method: 'POST', body: 'private' }) },
    { env: { ...env, NODE_ENV: 'production' } },
  ]) {
    const r = await handlePublicPhoto(
      input.request ?? new Request(url),
      input.target ?? target,
      input.env ?? env,
      f,
    );
    assert.notEqual(r.status, 200);
  }
  assert.equal(calls, 0);
});
test('upstream denial, redirect, missing/oversized/truncated bytes and bad WebP stay unavailable with no retry', async () => {
  const cases = [
    () => new Response('PRIVATE SQL ERROR', { status: 404 }),
    () => reply(bytes(), { 'Content-Type': 'text/html' }),
    () => reply(bytes(), { 'Content-Encoding': 'gzip' }),
    () => reply(bytes(), { 'Content-Length': '10485761' }),
    () => reply(bytes(), { 'Content-Length': '25' }),
    () => reply(Buffer.alloc(24)),
    () => new Response(null, { status: 302, headers: { Location: 'https://foreign.invalid' } }),
  ];
  for (const make of cases) {
    let calls = 0;
    const r = await handlePublicPhoto(new Request(url), target, env, async () => {
      calls++;
      return make();
    });
    assert.notEqual(r.status, 200);
    assert.equal(calls, 1);
    assert.equal((await r.text()).includes('PRIVATE'), false);
  }
});
test('aborted public reads and a late response after abort never return image bytes', async () => {
  const before = new AbortController();
  before.abort();
  let calls = 0;
  assert.equal(
    (
      await handlePublicPhoto(
        new Request(url, { signal: before.signal }),
        target,
        env,
        async () => {
          calls++;
          return reply();
        },
      )
    ).status,
    503,
  );
  assert.equal(calls, 0);
  const during = new AbortController();
  const r = await handlePublicPhoto(
    new Request(url, { signal: during.signal }),
    target,
    env,
    async () => {
      during.abort();
      return reply();
    },
  );
  assert.equal(r.status, 503);
});
test('gallery uses a native keyboard-operable details control, distinct alt captions and escaped supplied text', () => {
  const photos = [1, 2, 3, 4].map((n) => ({
    src: '/api/public-photos/' + n,
    alt: '<script>fictional ' + n + '</script>',
  }));
  const html = renderToStaticMarkup(React.createElement(PublicPhotoGallery, { photos }));
  assert.match(
    html,
    /<details class="gallery-more"><summary>Show 1 more property photos<\/summary>/,
  );
  assert.equal((html.match(/<figure/g) || []).length, 4);
  assert.match(html, /&lt;script&gt;fictional 1&lt;\/script&gt;/);
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /referrerPolicy="no-referrer"/i);
  assert.match(html, /Fictional test images/);
});
