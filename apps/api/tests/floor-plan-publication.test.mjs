import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setup, id } from './floor-plan-api-fixture.mjs';
import {
  asActor,
  scalar,
  seedMedia,
  T,
  AGENT,
  ADMIN,
  LISTING,
} from '../../../database/tests/public-media-fixtures.mjs';
import { RealtorApiClient } from '../../../packages/api-client/dist/index.js';
const path = `/v3/properties/${LISTING}/revisions/1/floor-plan`;
const request = (p = path, headers = {}, method = 'GET') =>
  new Request('http://synthetic.test' + p, { method, headers });
async function ready(t) {
  const f = await setup(t);
  await f.db.exec(
    await readFile(
      new URL('../../../database/proposals/floor-plan-publication.sql', import.meta.url),
      'utf8',
    ),
  );
  const run = f.open({ floorPlanPublicationMode: 'synthetic-floor-plan-publication-v1' });
  assert.equal((await f.attach(run)).status, 200);
  await seedMedia(f.db);
  const pending = await asActor(f.db, T, AGENT, async () => {
    await scalar(f.db, "SELECT app_api.confirm_availability($1,1,'available')", [LISTING]);
    return scalar(f.db, 'SELECT app_api.submit_revision($1,1,3)', [LISTING]);
  });
  return {
    ...f,
    run,
    pending: String(pending),
    review(v = String(pending), token = 'admin') {
      return request(`/v2/staff/reviews/${LISTING}/1/floor-plan/${v}`, {
        authorization: 'Bearer ' + token,
      });
    },
  };
}
test('metadata publication default-off and production gates fail closed before SQL', async (t) => {
  const f = await setup(t),
    before = f.calls.database;
  assert.equal((await f.open()(request())).status, 404);
  assert.equal(f.calls.database, before);
  assert.throws(() => f.open({ floorPlanPublicationMode: 'wrong' }));
  const prior = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() =>
      f.open({ floorPlanPublicationMode: 'synthetic-floor-plan-publication-v1' }),
    );
  } finally {
    if (prior === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prior;
  }
});
test('review and anonymous SDK reads join restricted SQL approval, current authority and sanitized projections', async (t) => {
  const f = await ready(t);
  assert.equal((await f.run(request())).status, 404);
  const pending = await f.run(f.review());
  assert.equal(pending.status, 200);
  const facts = await pending.json();
  assert.equal(facts.state, 'pending');
  assert.equal(facts.floorPlan.requestId, id(1801));
  assert.equal((await f.run(f.review(f.pending, 'agent'))).status, 403);
  assert.equal((await f.run(f.review(f.pending, 'customer'))).status, 403);
  assert.equal((await f.run(f.review('1'))).status, 409);
  await asActor(f.db, T, ADMIN, () =>
    scalar(f.db, 'SELECT app_api.decide_revision($1,1,$2,true)', [LISTING, f.pending]),
  );
  const c = new RealtorApiClient({
    baseUrl: 'https://synthetic.test',
    privacyNoticeVersion: 'synthetic',
    fetch: async (u, o) => f.run(new Request(u, o)),
  });
  const pub = await c.getPublishedFloorPlan(LISTING, 1);
  assert.equal(pub.floorPlan.sha256, f.result.manifest.sha256);
  assert.deepEqual(
    Object.keys(pub.floorPlan).sort(),
    ['width', 'height', 'bytes', 'sha256'].sort(),
  );
  assert.equal(
    (await c.getReviewFloorPlan(LISTING, 1, pub.approvedVersion, { bearerToken: 'admin' })).state,
    'approved',
  );
  await f.db.query("UPDATE app_private.listings SET publication_status='paused' WHERE id=$1", [
    LISTING,
  ]);
  await assert.rejects(() => c.getPublishedFloorPlan(LISTING, 1));
});
test('noncanonical paths and authority/framing headers cannot enter the metadata database read', async (t) => {
  const f = await ready(t),
    before = f.calls.database;
  for (const p of [
    path + '/',
    path + '/image',
    path.replace('/1/', '/01/'),
    path.replace('/1/', '/2147483648/'),
  ])
    assert.notEqual((await f.run(request(p))).status, 200);
  for (const h of [
    { authorization: 'Bearer admin' },
    { cookie: 'a=b' },
    { range: 'bytes=0-1' },
    { 'if-none-match': 'anything' },
    { 'content-length': '0' },
    { 'x-company-id': T },
    { 'transfer-encoding': 'chunked' },
    { expect: '100-continue' },
  ])
    assert.equal((await f.run(request(path, h))).status, 400);
  assert.equal((await f.run(request(path + '?'))).status, 400);
  assert.equal((await f.run(request(path, {}, 'POST'))).status, 405);
  assert.equal(f.calls.database, before);
});

async function approvedImage(t) {
  const f = await ready(t);
  await asActor(f.db, T, ADMIN, () =>
    scalar(f.db, 'SELECT app_api.decide_revision($1,1,$2,true)', [LISTING, f.pending]),
  );
  const facts = await (await f.run(request())).json(),
    imagePath = `/v3/properties/${LISTING}/revisions/1/floor-plan-image/${facts.approvedVersion}`;
  let reads = 0;
  const image = async (context, listingId, revision, version) => {
    reads++;
    assert.equal(context.actorId, null);
    assert.equal(context.tenantId, T);
    assert.equal(version, facts.approvedVersion);
    return {
      state: 'ready',
      target: { companyId: T, actorId: null, listingId, revision },
      version,
      operationId: id(1800),
      manifest: f.result.manifest,
      data: f.result.data,
    };
  };
  const open = (changes) =>
    f.open({
      floorPlanPublicationMode: 'synthetic-floor-plan-publication-v1',
      publishedFloorPlanImageRead: image,
      ...changes,
    });
  return { ...f, facts, imagePath, image, open, reads: () => reads };
}

test('approved image route is default-off, separately composed and returns only verified WebP bytes with private no-store', async (t) => {
  const f = await approvedImage(t);
  assert.equal(
    (await f.open({ publishedFloorPlanImageRead: undefined })(request(f.imagePath))).status,
    404,
  );
  assert.throws(() => f.open({ floorPlanPublicationMode: undefined }));
  assert.throws(() => f.open({ publishedFloorPlanImageRead: 'not a function' }));
  const run = f.open();
  const result = await run(request(f.imagePath));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(result.headers.get('content-type'), 'image/webp');
  assert.equal(result.headers.get('content-disposition'), 'inline; filename="floor-plan.webp"');
  assert.equal(result.headers.get('content-length'), String(f.result.data.length));
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), f.result.data);
  assert.equal(f.reads(), 1);
  const before = f.reads();
  assert.equal((await run(request(f.imagePath.replace(f.facts.approvedVersion, '1')))).status, 404);
  assert.equal(f.reads(), before);
  await f.db.query("UPDATE app_private.listings SET publication_status='paused' WHERE id=$1", [
    LISTING,
  ]);
  assert.equal((await run(request(f.imagePath))).status, 404);
  assert.equal(f.reads(), before);
});

test('anonymous image framing, identity, query and noncanonical targets never enter SQL or provider', async (t) => {
  const f = await approvedImage(t),
    run = f.open(),
    before = f.calls.database;
  for (const h of [
    { authorization: 'Bearer admin' },
    { cookie: 'a=b' },
    { range: 'bytes=0-1' },
    { 'if-match': 'x' },
    { 'content-type': 'image/png' },
    { 'content-length': '0' },
    { 'content-encoding': 'gzip' },
    { 'transfer-encoding': 'chunked' },
    { expect: '100-continue' },
    { 'x-actor-id': ADMIN },
  ])
    assert.equal((await run(request(f.imagePath, h))).status, 400);
  for (const suffix of ['?', '?anything=1', '#fragment'])
    assert.equal((await run(request(f.imagePath + suffix))).status, 400);
  for (const p of [
    f.imagePath + '/',
    f.imagePath + '/more',
    f.imagePath.replace('/1/', '/01/'),
    f.imagePath.replace('/1/', '/2147483648/'),
  ])
    assert.notEqual((await run(request(p))).status, 200);
  assert.equal((await run(request(f.imagePath, {}, 'POST'))).status, 405);
  assert.equal(f.calls.database, before);
  assert.equal(f.reads(), 0);
});

test('approved provider output must match company, anonymous audience, approved version, role and exact bytes', async (t) => {
  const f = await approvedImage(t);
  for (const alter of [
    (r) => ({ ...r, target: { ...r.target, actorId: AGENT } }),
    (r) => ({ ...r, target: { ...r.target, companyId: id(2) } }),
    (r) => ({ ...r, version: '1' }),
    (r) => ({ ...r, manifest: { ...r.manifest, role: 'photo' } }),
    (r) => ({ ...r, manifest: { ...r.manifest, bytes: r.data.length + 1 } }),
    (r) => ({ ...r, data: Buffer.alloc(r.data.length) }),
    (r) => ({ ...r, data: new Uint8Array(r.data) }),
    (r) => ({ ...r, operationId: 'wrong' }),
    (r) => ({ ...r, providerUrl: 'https://private.invalid' }),
  ]) {
    const run = f.open({
      publishedFloorPlanImageRead: async (...args) => alter(await f.image(...args)),
    });
    const r = await run(request(f.imagePath));
    assert.notEqual(r.status, 200);
    assert.match(r.headers.get('content-type'), /json/);
    assert.ok(!JSON.stringify(await r.json()).includes('private.invalid'));
  }
});

test('publication changes or company disablement during provider IO withhold approved bytes', async (t) => {
  const f = await approvedImage(t);
  const run = f.open({
    publishedFloorPlanImageRead: async (...args) => {
      const r = await f.image(...args);
      await f.db.query("UPDATE app_private.listings SET publication_status='paused' WHERE id=$1", [
        LISTING,
      ]);
      return r;
    },
  });
  assert.equal((await run(request(f.imagePath))).status, 404);
  assert.equal(f.reads(), 1);
  await f.db.query("UPDATE app_private.listings SET publication_status='published' WHERE id=$1", [
    LISTING,
  ]);
  const disabled = f.open({
    publishedFloorPlanImageRead: async (...args) => {
      const r = await f.image(...args);
      await f.db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
      return r;
    },
  });
  assert.equal((await disabled(request(f.imagePath))).status, 404);
  assert.equal(f.reads(), 2);
});

test('review image requires separate capability and current exact admin pending/approved authority', async (t) => {
  const f = await ready(t);
  let reads = 0;
  const provider = async (ctx, listingId, revision, version) => {
    reads++;
    return {
      state: 'ready',
      target: { companyId: T, actorId: ctx.actorId, listingId, revision },
      version,
      operationId: id(1800),
      manifest: f.result.manifest,
      data: f.result.data,
    };
  };
  const run = f.open({
    floorPlanPublicationMode: 'synthetic-floor-plan-publication-v1',
    reviewFloorPlanImageRead: provider,
  });
  const url = (v) => `/v2/staff/reviews/${LISTING}/1/floor-plan-image/${v}`;
  assert.equal(
    (await f.run(request(url(f.pending), { authorization: 'Bearer admin' }))).status,
    404,
  );
  for (const token of ['synthetic', 'customer'])
    assert.equal(
      (await run(request(url(f.pending), { authorization: 'Bearer ' + token }))).status,
      403,
    );
  assert.equal(reads, 0);
  assert.equal((await run(request(url('1'), { authorization: 'Bearer admin' }))).status, 409);
  assert.equal(reads, 0);
  const response = await run(request(url(f.pending), { authorization: 'Bearer admin' }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('vary'), 'Authorization');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.result.data);
  await asActor(f.db, T, ADMIN, () =>
    scalar(f.db, 'SELECT app_api.decide_revision($1,1,$2,true)', [LISTING, f.pending]),
  );
  const approved = await (await f.run(request())).json();
  assert.equal(
    (await run(request(url(approved.approvedVersion), { authorization: 'Bearer admin' }))).status,
    200,
  );
  assert.throws(() => f.open({ reviewFloorPlanImageRead: provider }));
});

test('review image rejects framing/identity overrides before SQL and withholds malformed provider targets', async (t) => {
  const f = await ready(t);
  let reads = 0;
  const url = `/v2/staff/reviews/${LISTING}/1/floor-plan-image/${f.pending}`;
  const run = f.open({
    floorPlanPublicationMode: 'synthetic-floor-plan-publication-v1',
    reviewFloorPlanImageRead: async (ctx, listingId, revision, version) => {
      reads++;
      return {
        state: 'ready',
        target: { companyId: T, actorId: AGENT, listingId, revision },
        version,
        operationId: id(1800),
        manifest: f.result.manifest,
        data: f.result.data,
      };
    },
  });
  const before = f.calls.database;
  for (const h of [
    { 'x-actor-id': ADMIN },
    { range: 'bytes=0-1' },
    { 'content-length': '0' },
    { 'if-match': 'x' },
  ])
    assert.equal((await run(request(url, { authorization: 'Bearer admin', ...h }))).status, 400);
  assert.equal((await run(request(url + '?x=1', { authorization: 'Bearer admin' }))).status, 400);
  assert.equal(f.calls.database, before);
  assert.equal(reads, 0);
  assert.notEqual((await run(request(url, { authorization: 'Bearer admin' }))).status, 200);
  assert.equal(reads, 1);
});
