import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Video from '../dist/tests/components/ReviewListingVideo.js';
const state = {
  policy: 'synthetic-listing-video-state-v1',
  listingId: '00000000-0000-4000-8000-000000000400',
  revision: 1,
  version: '4',
  video: { provider: 'youtube', videoId: 'abcdefghijk', title: 'Synthetic & tour' },
};
test('reviewer sees escaped saved metadata and publication meaning without provider fetch elements', () => {
  const html = renderToStaticMarkup(React.createElement(Video, { state }));
  assert.match(html, /Synthetic &amp; tour/);
  assert.match(html, /Approval publishes/);
  assert.match(html, /abcdefghijk/);
  assert.doesNotMatch(html, /<iframe|<img|<video|<a |preconnect|youtube.com/);
});
test('explicit empty video selection never invents an embed or default', () => {
  const html = renderToStaticMarkup(
    React.createElement(Video, { state: { ...state, video: null } }),
  );
  assert.match(html, /No video selected/);
  assert.doesNotMatch(html, /abcdefghijk|<iframe/);
});
