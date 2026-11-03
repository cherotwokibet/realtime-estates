import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadMobilePublishedVideo,
  openMobilePublishedVideo,
} from '../dist/tests/src/published-video.js';
import { resolveMobileReferenceConfig } from '../dist/tests/src/reference-catalogue.js';
const id = '00000000-0000-4000-8000-000000000400',
  property = { id, revision: 1, reference: { revisionVersion: '5' } },
  video = { provider: 'youtube', videoId: 'abcdefghijk', title: 'Synthetic tour' },
  config = {
    mode: 'synthetic-reference-public-v1',
    apiOrigin: 'http://127.0.0.1:4101',
    allowLoopbackHttp: true,
    tenantSlug: 'realtime-estates',
    videoMode: 'synthetic-listing-video-publication-v1',
  };
const response = (version = '5') =>
  Response.json(
    {
      policy: 'synthetic-published-listing-video-v1',
      listingId: id,
      revision: 1,
      approvedVersion: version,
      video,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
test('native video is explicit build opt-in, development-only and refuses extra authority', () => {
  const raw = {
    mode: config.mode,
    apiOrigin: config.apiOrigin,
    allowLoopbackHttp: true,
    videoMode: config.videoMode,
  };
  assert.equal(
    resolveMobileReferenceConfig(raw, 'realtime-estates', true).videoMode,
    config.videoMode,
  );
  assert.equal(resolveMobileReferenceConfig(raw, 'realtime-estates', false).mode, 'error');
  for (const altered of [
    { ...raw, videoMode: 'unknown' },
    { ...raw, bearerToken: 'forbidden' },
  ])
    assert.equal(resolveMobileReferenceConfig(altered, 'realtime-estates', true).mode, 'error');
});
test('native metadata loading never opens provider and explicit action opens canonical URL only', async () => {
  let reads = 0,
    opens = 0;
  const result = await loadMobilePublishedVideo(
    config,
    property,
    new AbortController().signal,
    async (url, o) => {
      reads++;
      assert.equal(o.credentials, 'omit');
      assert.equal(new Headers(o.headers).has('authorization'), false);
      return response();
    },
  );
  assert.equal(reads, 1);
  assert.equal(opens, 0);
  assert.equal(
    await openMobilePublishedVideo(result, async (url) => {
      opens++;
      assert.equal(url, 'https://www.youtube.com/watch?v=abcdefghijk');
    }),
    true,
  );
  assert.equal(opens, 1);
  assert.equal(
    await openMobilePublishedVideo({ status: 'unavailable' }, async () => {
      throw Error('Must not open');
    }),
    false,
  );
});
test('default off and pre-cancelled video do no I/O; late cancelled and mismatched-version responses expose no link', async () => {
  let calls = 0;
  const transport = async () => {
    calls++;
    return response();
  };
  assert.equal(
    (
      await loadMobilePublishedVideo(
        { ...config, videoMode: undefined },
        property,
        new AbortController().signal,
        transport,
      )
    ).status,
    'off',
  );
  const abort = new AbortController();
  abort.abort();
  assert.equal(
    (await loadMobilePublishedVideo(config, property, abort.signal, transport)).status,
    'unavailable',
  );
  assert.equal(calls, 0);
  const late = new AbortController();
  assert.equal(
    (
      await loadMobilePublishedVideo(config, property, late.signal, async () => {
        late.abort();
        return response();
      })
    ).status,
    'unavailable',
  );
  assert.equal(
    (
      await loadMobilePublishedVideo(config, property, new AbortController().signal, async () =>
        response('6'),
      )
    ).status,
    'unavailable',
  );
});
