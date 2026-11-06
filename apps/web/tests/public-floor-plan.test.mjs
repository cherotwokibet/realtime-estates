import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readPublicFloorPlan, handlePublicFloorPlan } from '../dist/tests/lib/public-floor-plan.js';
import PublicFloorPlan from '../dist/tests/components/PublicFloorPlan.js';
import { convertSyntheticFloorPlan } from '../../../packages/media/dist/index.js';
import { syntheticPng } from '../../../packages/media/tests/fixtures.mjs';
const out = await convertSyntheticFloorPlan(syntheticPng()),
  id = '00000000-0000-4000-8000-000000000100';
const saved = {
  policy: 'synthetic-published-floor-plan-v1',
  listingId: id,
  revision: 1,
  approvedVersion: '6',
  floorPlan: {
    width: out.manifest.width,
    height: out.manifest.height,
    bytes: out.data.length,
    sha256: createHash('sha256').update(out.data).digest('hex'),
  },
};
const env = {
  NODE_ENV: 'test',
  WEB_CATALOGUE_MODE: 'connected',
  WEB_CATALOGUE_DATA: 'synthetic',
  API_ORIGIN: 'http://127.0.0.1:4001',
  ALLOW_LOOPBACK_API: 'true',
  WEB_CATALOGUE_FLOOR_PLAN: 'synthetic-floor-plan-publication-v1',
};
const path = `http://localhost:3000/api/public-floor-plans/${id}/1/6`;
function transport(seen) {
  return async (url, o) => {
    seen.push(String(url));
    assert.equal(o.credentials, 'omit');
    assert.equal(o.cache, 'no-store');
    assert.equal(o.redirect, 'error');
    assert.equal(new Headers(o.headers).has('authorization'), false);
    return String(url).includes('floor-plan-image')
      ? new Response(out.data, {
          headers: {
            'content-type': 'image/webp',
            'content-length': String(out.data.length),
            'cache-control': 'private, no-store',
            'x-content-type-options': 'nosniff',
          },
        })
      : Response.json(saved, { headers: { 'cache-control': 'no-store' } });
  };
}
test('public loader is default-off, nonproduction and exact approved reference version only', async () => {
  const property = { id, revision: 1, reference: { revisionVersion: '6' } },
    seen = [];
  assert.equal((await readPublicFloorPlan(property, {}, transport(seen))).status, 'off');
  assert.equal(seen.length, 0);
  for (const e of [
    { ...env, NODE_ENV: 'production' },
    { ...env, WEB_CATALOGUE_MODE: 'demo' },
    { ...env, API_ORIGIN: 'https://remote.invalid' },
    { ...env, WEB_CATALOGUE_FLOOR_PLAN: 'wrong' },
  ])
    assert.equal((await readPublicFloorPlan(property, e, transport(seen))).status, 'unavailable');
  assert.equal(seen.length, 0);
  assert.equal((await readPublicFloorPlan(property, env, transport(seen))).status, 'ready');
  assert.equal(
    (
      await readPublicFloorPlan(
        { ...property, reference: { revisionVersion: '7' } },
        env,
        transport(seen),
      )
    ).status,
    'unavailable',
  );
});
test('public BFF returns verified bytes with no secret/private-identifier response and denies caller context before IO', async () => {
  const seen = [];
  const r = await handlePublicFloorPlan(new Request(path), env, transport(seen));
  assert.equal(r.status, 200);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), out.data);
  assert.equal(r.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(seen.length, 3);
  for (const headers of [
    { authorization: 'Bearer x' },
    { cookie: 'x=y' },
    { range: 'bytes=0-1' },
    { 'x-company-id': id },
    { 'content-length': '0' },
  ])
    assert.equal(
      (await handlePublicFloorPlan(new Request(path, { headers }), env, transport(seen))).status,
      400,
    );
  assert.equal(seen.length, 3);
  assert.equal(
    (await handlePublicFloorPlan(new Request(path + '?company=x'), env, transport(seen))).status,
    400,
  );
  assert.equal(seen.length, 3);
});
test('public floor-plan component has explicit off/absent/unavailable/loading states without a provider URL', () => {
  assert.equal(
    renderToStaticMarkup(React.createElement(PublicFloorPlan, { result: { status: 'off' } })),
    '',
  );
  assert.match(
    renderToStaticMarkup(
      React.createElement(PublicFloorPlan, {
        result: { status: 'ready', saved: { ...saved, floorPlan: null } },
      }),
    ),
    /No floor plan supplied/,
  );
  const html = renderToStaticMarkup(
    React.createElement(PublicFloorPlan, { result: { status: 'ready', saved } }),
  );
  assert.match(html, /Loading floor plan/);
  assert.doesNotMatch(html, /<img|Bearer|storage|requestId|operationId/);
  assert.match(
    renderToStaticMarkup(
      React.createElement(PublicFloorPlan, { result: { status: 'unavailable' } }),
    ),
    /Floor plan unavailable/,
  );
});
