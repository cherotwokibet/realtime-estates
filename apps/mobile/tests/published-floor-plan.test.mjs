import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadMobilePublishedFloorPlan } from '../dist/tests/src/published-floor-plan.js';
import { resolveMobileReferenceConfig } from '../dist/tests/src/reference-catalogue.js';
import { convertSyntheticFloorPlan } from '../../../packages/media/dist/index.js';
import { syntheticPng } from '../../../packages/media/tests/fixtures.mjs';
const output = await convertSyntheticFloorPlan(syntheticPng());
const id = '00000000-0000-4000-8000-000000000400',
  property = { id, revision: 1, reference: { revisionVersion: '6' } };
const config = {
  mode: 'synthetic-reference-public-v1',
  apiOrigin: 'https://synthetic.invalid',
  allowLoopbackHttp: false,
  tenantSlug: 'realtime-estates',
  floorPlanMode: 'synthetic-floor-plan-publication-v1',
};
const saved = {
  policy: 'synthetic-published-floor-plan-v1',
  listingId: id,
  revision: 1,
  approvedVersion: '6',
  floorPlan: {
    width: output.manifest.width,
    height: output.manifest.height,
    bytes: output.data.length,
    sha256: createHash('sha256').update(output.data).digest('hex'),
  },
};
const metadata = (value = saved) =>
  Response.json(value, { headers: { 'cache-control': 'no-store' } });
const image = (data = output.data) =>
  new Response(data, {
    headers: {
      'content-type': 'image/webp',
      'content-length': String(output.data.length),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
const signal = () => new AbortController().signal;
const sha = async (data) => {
  const b = createHash('sha256').update(data).digest();
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
test('mobile floor-plan build mode is default-off/development-only and rejects identity, accessors and unsupported flags', () => {
  const raw = {
    mode: config.mode,
    apiOrigin: config.apiOrigin,
    allowLoopbackHttp: false,
    floorPlanMode: config.floorPlanMode,
  };
  assert.equal(
    resolveMobileReferenceConfig(raw, 'realtime-estates', true).floorPlanMode,
    config.floorPlanMode,
  );
  assert.equal(resolveMobileReferenceConfig(raw, 'realtime-estates', false).mode, 'error');
  for (const x of [
    { ...raw, floorPlanMode: 'live' },
    { ...raw, token: 'forbidden' },
    {
      ...raw,
      get floorPlanMode() {
        throw Error('must not invoke');
      },
    },
  ])
    assert.equal(resolveMobileReferenceConfig(x, 'realtime-estates', true).mode, 'error');
});
test('mobile renders only verified anonymous bytes as exact in-memory data URI using injected native SHA256', async () => {
  const seen = [];
  let digests = 0;
  const result = await loadMobilePublishedFloorPlan(config, property, signal(), {
    digest: async (data) => {
      digests++;
      return sha(data);
    },
    fetch: async (u, o) => {
      seen.push(String(u));
      assert.equal(o.credentials, 'omit');
      assert.equal(o.redirect, 'error');
      assert.equal(o.cache, 'no-store');
      assert.equal(new Headers(o.headers).has('authorization'), false);
      return String(u).includes('floor-plan-image') ? image() : metadata();
    },
  });
  assert.equal(result.status, 'ready');
  assert.equal(digests, 1);
  assert.equal(seen.length, 4);
  assert.equal(result.image.uri, 'data:image/webp;base64,' + output.data.toString('base64'));
  assert.equal(result.image.width, saved.floorPlan.width);
  assert.equal(result.image.height, saved.floorPlan.height);
  assert.equal(JSON.stringify(result).includes('synthetic.invalid'), false);
});
test('mobile off/pre-cancelled do zero I/O and explicit absence never requests image', async () => {
  let reads = 0;
  const platform = {
    digest: sha,
    fetch: async () => {
      reads++;
      return metadata({ ...saved, floorPlan: null });
    },
  };
  assert.equal(
    (
      await loadMobilePublishedFloorPlan(
        { ...config, floorPlanMode: undefined },
        property,
        signal(),
        platform,
      )
    ).status,
    'off',
  );
  const c = new AbortController();
  c.abort();
  assert.equal(
    (await loadMobilePublishedFloorPlan(config, property, c.signal, platform)).status,
    'unavailable',
  );
  assert.equal(reads, 0);
  assert.deepEqual(await loadMobilePublishedFloorPlan(config, property, signal(), platform), {
    status: 'ready',
    image: null,
  });
  assert.equal(reads, 1);
});
test('mobile changed version, altered bytes, interrupted digest and stale completion expose no image or retry', async () => {
  for (const fault of ['version', 'hash', 'cancel', 'after']) {
    let calls = 0;
    const c = new AbortController();
    const result = await loadMobilePublishedFloorPlan(config, property, c.signal, {
      digest: async (data) => {
        if (fault === 'cancel') c.abort();
        return sha(data);
      },
      fetch: async (u) => {
        calls++;
        if (String(u).includes('floor-plan-image')) {
          const b = Buffer.from(output.data);
          if (fault === 'hash') b[b.length - 1] ^= 1;
          return image(b);
        }
        if (fault === 'version' || (fault === 'after' && calls === 4))
          return metadata({ ...saved, approvedVersion: '7' });
        return metadata();
      },
    });
    assert.equal(result.status, 'unavailable', fault);
    assert.equal('image' in result, false);
    assert.ok(calls <= 4);
  }
});
