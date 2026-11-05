import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { floorPlanImageRequest } from '../dist/tests/lib/floor-plan-image-server.js';
import { loadFloorPlanImage } from '../dist/tests/lib/floor-plan-image.js';
import { syntheticPng } from '../../../packages/media/tests/fixtures.mjs';
import { convertSyntheticFloorPlan } from '../../../packages/media/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const converted = await convertSyntheticFloorPlan(syntheticPng());
const scope = {
  instanceId: id(9),
  tenantId: id(1),
  actorId: id(11),
  listingId: id(100),
  revision: 1,
};
const meta = {
  operationId: id(2201),
  requestId: id(2100),
  width: converted.manifest.width,
  height: converted.manifest.height,
  bytes: converted.data.length,
  sha256: createHash('sha256').update(converted.data).digest('hex'),
};
const state = {
  policy: 'synthetic-floor-plan-state-v1',
  listingId: scope.listingId,
  revision: 1,
  version: '3',
  state: 'draft',
  floorPlan: meta,
};
const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_PREVIEW_REFERENCE: 'synthetic-reference-draft-v1',
  STAFF_PREVIEW_FLOOR_PLAN: 'synthetic-private-floor-plan-v1',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4001',
  STAFF_PREVIEW_TOKEN: 'synthetic.server.secret',
  STAFF_PREVIEW_INSTANCE: scope.instanceId,
};
const path = `/api/staff/listings/${scope.listingId}/floor-plan-images/1/3/${meta.operationId}`;
const req = (changes = {}, url = path) =>
  new Request('http://127.0.0.1:3132' + url, {
    headers: {
      Host: '127.0.0.1:3132',
      Origin: 'http://127.0.0.1:3132',
      'X-Preview-Instance': scope.instanceId,
      'X-Reference-Actor': scope.actorId,
      'X-Reference-Tenant': scope.tenantId,
      ...changes,
    },
  });
const image = (data = converted.data, headers = {}) =>
  new Response(data, {
    headers: {
      'content-type': 'image/webp',
      'content-length': String(meta.bytes),
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
function harness(options = {}) {
  const seen = [];
  let read = false;
  const transport = async (url, init) => {
    seen.push({ url: String(url), init });
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer synthetic.server.secret');
    const p = new URL(url).pathname,
      after = read && options.change;
    if (p.includes('/floor-plan-images/')) {
      read = true;
      if (options.denied) return Response.json({ error: {} }, { status: 403 });
      return options.response ? options.response() : image();
    }
    if (p === '/v3/staff/reference-session')
      return Response.json({
        policy: 'synthetic-reference-session-v1',
        tenantId: scope.tenantId,
        actorId: after === 'actor' ? id(12) : scope.actorId,
      });
    if (p.includes('/revision-protocol/'))
      return Response.json({
        listingId: scope.listingId,
        revision: 1,
        listingVersion: '1',
        revisionVersion: after === 'version' ? '4' : (options.version ?? '3'),
        state: 'draft',
        editable: true,
        protocol: 'synthetic-reference-v1',
      });
    if (p.includes('/floor-plan-revisions/'))
      return Response.json(
        {
          ...state,
          version: after === 'version' ? '4' : (options.version ?? '3'),
          floorPlan: after === 'remove' ? null : meta,
        },
        { headers: { 'cache-control': 'no-store' } },
      );
    throw Error('Unexpected ' + p);
  };
  return { transport, seen };
}
test('image BFF verifies actual byte hash and saved attachment across both metadata reads', async () => {
  const f = harness(),
    r = await floorPlanImageRequest(req(), env, f.transport);
  assert.equal(r.status, 200);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), converted.data);
  assert.equal(r.headers.get('content-type'), 'image/webp');
  assert.equal(r.headers.get('content-disposition'), 'inline; filename="floor-plan.webp"');
  assert.equal(r.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(f.seen.filter((x) => x.url.includes('/floor-plan-images/')).length, 1);
  assert.ok(![...r.headers.values()].join('').includes('secret'));
});
test('disabled mode, spoofed scope/framing and foreign target never request private bytes', async () => {
  const f = harness();
  assert.equal((await floorPlanImageRequest(req(), {}, f.transport)).status, 403);
  for (const [headers, url, status] of [
    [{ cookie: 'x=y' }, path, 400],
    [{ 'x-owner': id(11) }, path, 400],
    [{ 'x-reference-actor': id(12) }, path, 409],
    [{}, path.replace('/1/3/', '/1/2/'), 409],
    [{}, path + '?raw=1', 400],
  ])
    assert.equal((await floorPlanImageRequest(req(headers, url), env, f.transport)).status, status);
  assert.equal(f.seen.filter((x) => x.url.includes('/floor-plan-images/')).length, 0);
});
test('changed actor/version/attachment during byte IO refuses the completed image', async () => {
  for (const change of ['actor', 'version', 'remove'])
    assert.equal(
      (await floorPlanImageRequest(req(), env, harness({ change }).transport)).status,
      409,
    );
});
test('wrong cache/type/hash/length and current access denial never become image responses', async () => {
  for (const response of [
    () => image(converted.data, { 'cache-control': 'public' }),
    () => image(converted.data, { 'content-type': 'image/png' }),
    () => image(Buffer.alloc(meta.bytes)),
    () => image(converted.data.subarray(0, -1)),
    () => image(converted.data, { 'content-length': '10485761' }),
  ])
    assert.equal(
      (await floorPlanImageRequest(req(), env, harness({ response }).transport)).status,
      502,
    );
  assert.equal(
    (await floorPlanImageRequest(req(), env, harness({ denied: true }).transport)).status,
    403,
  );
});
test('browser reader uses only same-origin tuple/stamps and returns verified WebP Blob', async () => {
  let seen;
  const blob = await loadFloorPlanImage(
    scope,
    state,
    new AbortController().signal,
    async (url, init) => {
      seen = { url, init };
      return image();
    },
  );
  assert.equal(seen.url, path);
  assert.equal(new Headers(seen.init.headers).has('authorization'), false);
  assert.equal(seen.init.credentials, 'omit');
  assert.equal(seen.init.redirect, 'error');
  assert.equal(seen.init.cache, 'no-store');
  assert.equal(blob.type, 'image/webp');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), converted.data);
});
test('browser reader refuses corrupted/cached/oversize/truncated payloads without retry', async () => {
  for (const response of [
    () => image(Buffer.alloc(meta.bytes)),
    () => image(converted.data, { 'cache-control': 'public' }),
    () => image(Buffer.alloc(meta.bytes + 1)),
    () => image(converted.data.subarray(0, -1)),
  ]) {
    let n = 0;
    await assert.rejects(
      loadFloorPlanImage(scope, state, new AbortController().signal, async () => {
        n++;
        return response();
      }),
    );
    assert.equal(n, 1);
  }
});
test(
  'browser reader cancels a stalled body and pre-cancelled requests never dispatch',
  { timeout: 2000 },
  async () => {
    let n = 0,
      cancelled = 0;
    const stopped = new AbortController();
    stopped.abort();
    await assert.rejects(
      loadFloorPlanImage(scope, state, stopped.signal, async () => {
        n++;
        return image();
      }),
    );
    assert.equal(n, 0);
    const controller = new AbortController(),
      body = new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array([1]));
        },
        cancel() {
          cancelled++;
        },
      });
    const pending = loadFloorPlanImage(scope, state, controller.signal, async () => image(body));
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(pending);
    assert.equal(cancelled, 1);
  },
);

test('read-only image tuple accepts the largest safe version without inheriting write-increment limits', async () => {
  const f = harness({ version: '9007199254740991' });
  assert.equal(
    (
      await floorPlanImageRequest(
        req({}, path.replace('/1/3/', '/1/9007199254740991/')),
        env,
        f.transport,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await floorPlanImageRequest(
        req({}, path.replace('/1/3/', '/1/9007199254740992/')),
        env,
        f.transport,
      )
    ).status,
    400,
  );
});
