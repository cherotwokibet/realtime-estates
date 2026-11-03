import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { readPublicVideo } from '../dist/tests/lib/public-video.js';
import Component from '../dist/tests/components/PublicListingVideo.js';
const id = '00000000-0000-4000-8000-000000000400',
  property = { id, revision: 1, reference: { revisionVersion: '5' } },
  video = { provider: 'youtube', videoId: 'abcdefghijk', title: 'Synthetic & approved tour' };
const env = {
  NODE_ENV: 'test',
  WEB_CATALOGUE_MODE: 'connected',
  WEB_CATALOGUE_DATA: 'synthetic',
  WEB_CATALOGUE_VIDEO: 'synthetic-listing-video-publication-v1',
  API_ORIGIN: 'http://127.0.0.1:4101',
  ALLOW_LOOPBACK_API: 'true',
};
test('public detail loads only anonymous approved video and binds version before rendering', async () => {
  let count = 0;
  const result = await readPublicVideo(property, env, async (url, o) => {
    count++;
    assert.equal(new Headers(o.headers).has('authorization'), false);
    assert.equal(o.credentials, 'omit');
    assert.equal(o.redirect, 'error');
    return Response.json(
      {
        policy: 'synthetic-published-listing-video-v1',
        listingId: id,
        revision: 1,
        approvedVersion: '5',
        video,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  });
  assert.equal(count, 1);
  assert.equal(result.status, 'ready');
  const html = render(React.createElement(Component, { result }));
  assert.match(html, /Synthetic &amp; approved/);
  assert.match(html, /href="https:\/\/www.youtube.com\/watch\?v=abcdefghijk"/);
  assert.match(html, /referrerPolicy="no-referrer"/i);
  assert.match(html, /noopener noreferrer/);
  assert.doesNotMatch(html, /<iframe|<img|<video|preconnect|prefetch/);
});
test('default off, invalid mode and production never fetch; stale or denied reads expose no video', async () => {
  let calls = 0;
  const transport = async () => {
    calls++;
    return Response.json(
      {
        policy: 'synthetic-published-listing-video-v1',
        listingId: id,
        revision: 1,
        approvedVersion: '6',
        video,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  };
  assert.equal(
    (await readPublicVideo(property, { ...env, WEB_CATALOGUE_VIDEO: undefined }, transport)).status,
    'off',
  );
  for (const e of [
    { ...env, NODE_ENV: 'production' },
    { ...env, WEB_CATALOGUE_VIDEO: 'other' },
  ])
    assert.equal((await readPublicVideo(property, e, transport)).status, 'unavailable');
  assert.equal(calls, 0);
  assert.equal((await readPublicVideo(property, env, transport)).status, 'unavailable');
  const html = render(React.createElement(Component, { result: { status: 'unavailable' } }));
  assert.doesNotMatch(html, /abcdefghijk|youtube.com/);
});
