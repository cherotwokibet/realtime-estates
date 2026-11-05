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
