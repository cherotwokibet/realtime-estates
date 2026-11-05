import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createApiService } from '../dist/service.js';
import { RealtorApiClient } from '../../../packages/api-client/dist/index.js';
import {
  fixture,
  createDraft,
  asActor,
  scalar,
  T,
  ADMIN,
  AGENT,
  LISTING,
} from '../../../database/tests/public-media-fixtures.mjs';
import { syntheticPng } from '../../../packages/media/tests/fixtures.mjs';
import { convertSyntheticFloorPlan } from '../../../packages/media/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const path = `/v2/staff/listings/${LISTING}/floor-plan-operations/${id(1800)}`,
  statePath = `/v2/staff/listings/${LISTING}/floor-plan-revisions/1`,
  imagePath = `/v2/staff/listings/${LISTING}/floor-plan-images/1/${id(1800)}`;
const command = {
  policy: 'synthetic-floor-plan-attachment-command-v1',
  operationId: id(1800),
  listingId: LISTING,
  revision: 1,
  expectedVersion: '2',
  requestId: id(1801),
};
const req = (url = path, method = 'GET', body, headers = {}) =>
  new Request('http://synthetic.test' + url, {
    method,
    headers: {
      authorization: 'Bearer synthetic',
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body } : {}),
  });
async function media(db, work) {
  await db.exec('BEGIN; SET LOCAL ROLE media_coordinator');
  try {
    await db.query(
      "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
      [T, AGENT],
    );
    const v = await work();
    await db.exec('COMMIT');
    return v;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}
async function setup(t) {
  const db = await fixture();
  t.after(() => db.close());
  for (const name of ['registration', 'processing', 'output', 'attachment'])
    await db.exec(
      await readFile(
        new URL('../../../database/proposals/floor-plan-' + name + '.sql', import.meta.url),
        'utf8',
      ),
    );
  await createDraft(db);
  const source = syntheticPng(),
    result = await convertSyntheticFloorPlan(source);
  await asActor(db, T, AGENT, () =>
    scalar(db, 'SELECT app_api.register_synthetic_floor_plan($1,1,2,$2,$3,$4,$5)', [
      LISTING,
      command.requestId,
      createHash('sha256').update(source).digest('hex'),
      source.length,
      'png',
    ]),
  );
  const lease = await media(db, () =>
    scalar(db, 'SELECT app_media.claim_synthetic_floor_plan($1,1,$2,$3)', [
      LISTING,
      command.requestId,
      id(1802),
    ]),
  );
  await media(db, () =>
    scalar(db, 'SELECT app_media.seal_synthetic_floor_plan($1,1,$2,$3,$4,$5,$6)', [
      LISTING,
      command.requestId,
      lease.claimId,
      lease.leaseNonce,
      lease.outputObjectId,
      result.manifest,
    ]),
  );
  const contexts = [],
    calls = { database: 0, image: 0 };
  const options = {
    tenantId: T,
    privacyNoticeVersion: 'synthetic',
    floorPlanMode: 'synthetic-private-floor-plan-v1',
    verifyAuthorization: async (request) => ({
      actorId:
        request.headers.get('authorization') === 'Bearer admin'
          ? ADMIN
          : request.headers.get('authorization') === 'Bearer customer'
            ? id(13)
            : AGENT,
    }),
    database: {
      transaction: async (context, fn) => {
        calls.database++;
        contexts.push(context);
        return asActor(db, context.tenantId, context.actorId, () =>
          fn({ query: (s, args) => db.query(s, args) }),
        );
      },
    },
  };
  const image = async (context, listingId, revision) => {
    calls.image++;
    assert.equal(context.tenantId, T);
    return {
      state: 'ready',
      target: { companyId: T, actorId: context.actorId, listingId, revision },
      version: '3',
      operationId: command.operationId,
      manifest: result.manifest,
      data: result.data,
    };
  };
  const open = (changes = {}) => createApiService({ ...options, ...changes });
  const attach = (run) => run(req(path, 'POST', JSON.stringify(command)));
  return { db, result, lease, contexts, calls, options, image, open, attach };
}
test('floor-plan API defaults closed and rejects invalid or production-only composition', async (t) => {
  const f = await setup(t);
  assert.equal((await f.open({ floorPlanMode: undefined })(req())).status, 404);
  assert.throws(() => f.open({ floorPlanMode: 'wrong' }));
  assert.throws(() => f.open({ floorPlanMode: undefined, floorPlanImageRead: f.image }));
  const prior = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => f.open());
  } finally {
    if (prior === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prior;
  }
});
test('real restricted SQL HTTP attach and recovery expose bounded metadata without internal source or lease identities', async (t) => {
  const f = await setup(t),
    run = f.open(),
    r = await f.attach(run);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const data = await r.json();
  assert.equal(data.policy, 'synthetic-floor-plan-attachment-v1');
  assert.equal(data.resultVersion, '3');
  assert.equal(data.actorId, AGENT);
  assert.equal(data.floorPlan.requestId, command.requestId);
  for (const privateKey of [
    'leaseNonce',
    'inputObjectId',
    'jobId',
    'registration',
    'outputObjectId',
    'storeId',
  ])
    assert.ok(!JSON.stringify(data).includes(privateKey));
  assert.deepEqual(await (await run(req())).json(), data);
  assert.deepEqual(await (await f.attach(run)).json(), data);
  const state = await (await run(req(statePath))).json();
  assert.equal(state.version, '3');
  assert.equal(state.floorPlan.sha256, f.result.manifest.sha256);
  assert.equal(f.contexts[0].tenantId, T);
  assert.equal(f.contexts[0].actorId, AGENT);
});
test('spoofed context, unknown/duplicate fields, query and changed command targets reach no database transaction', async (t) => {
  const f = await setup(t),
    run = f.open();
  for (const r of [
    req(path + '?tenant=x'),
    req(path, 'POST', JSON.stringify({ ...command, actorId: ADMIN })),
    req(path, 'POST', JSON.stringify({ ...command, listingId: id(999) })),
    req(path, 'POST', JSON.stringify(command).replace('"revision":1', '"revision":1,"revision":1')),
    req(path, 'GET', undefined, { 'x-actor-id': ADMIN }),
    req(path, 'GET', undefined, { cookie: 'identity=x' }),
    req(path, 'GET', undefined, { range: 'bytes=0-1' }),
  ])
    assert.equal((await run(r)).status, 400);
  assert.equal((await run(new Request('http://synthetic.test' + path))).status, 401);
  assert.equal((await run(req(path, 'DELETE'))).status, 405);
  assert.equal(f.calls.database, 0);
});
test('verified customer identity cannot read staff metadata or invoke the image provider', async (t) => {
  const f = await setup(t),
    run = f.open({ floorPlanImageRead: f.image });
  assert.equal((await f.attach(run)).status, 200);
  assert.equal(
    (await run(req(statePath, 'GET', undefined, { authorization: 'Bearer customer' }))).status,
    403,
  );
  assert.equal(
    (await run(req(imagePath, 'GET', undefined, { authorization: 'Bearer customer' }))).status,
    403,
  );
  assert.equal(f.calls.image, 0);
});
test('private image response is bound to current attachment, actual byte hash and verified agent/admin context', async (t) => {
  const f = await setup(t),
    run = f.open({ floorPlanImageRead: f.image });
  await f.attach(run);
  assert.equal((await f.open()(req(imagePath))).status, 404);
  for (const auth of ['Bearer synthetic', 'Bearer admin']) {
    const r = await run(req(imagePath, 'GET', undefined, { authorization: auth }));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/webp');
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('vary'), 'Authorization');
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), f.result.data);
  }
  assert.equal(f.calls.image, 2);
  assert.equal((await run(req(imagePath.replace(id(1800), id(1999))))).status, 404);
  assert.equal(f.calls.image, 2);
});
test('attachment change during provider IO refuses bytes and malformed provider data cannot be delivered', async (t) => {
  const f = await setup(t);
  const run = f.open({
    floorPlanImageRead: async (...args) => {
      const r = await f.image(...args);
      await asActor(f.db, T, AGENT, () =>
        scalar(f.db, 'SELECT app_api.save_synthetic_floor_plan_attachment($1)', [
          { ...command, operationId: id(1803), expectedVersion: '3', requestId: null },
        ]),
      );
      return r;
    },
  });
  await f.attach(run);
  const corrupt = f.open({
    floorPlanImageRead: async (...args) => ({
      ...(await f.image(...args)),
      data: Buffer.from('not a floor plan'),
    }),
  });
  const invalidImage = await corrupt(req(imagePath));
  assert.equal(invalidImage.status, 503);
  assert.match(invalidImage.headers.get('content-type'), /json/);
  const changed = await run(req(imagePath));
  assert.equal(changed.status, 404);
  assert.match(changed.headers.get('content-type'), /json/);
});
test('SDK uses the same API for stable original recovery and credential-free no-store metadata reads', async (t) => {
  const f = await setup(t),
    run = f.open();
  let seen;
  const client = new RealtorApiClient({
    baseUrl: 'https://synthetic.test',
    privacyNoticeVersion: 'synthetic',
    fetch: async (url, init) => {
      seen = init;
      return run(new Request(url, init));
    },
  });
  const options = { bearerToken: 'synthetic' };
  const saved = await client.saveFloorPlanAttachment(command, options);
  assert.equal(saved.resultVersion, '3');
  assert.equal(seen.credentials, 'omit');
  assert.equal(seen.cache, 'no-store');
  assert.deepEqual(await client.getFloorPlanAttachmentOriginal(command, options), saved);
  assert.equal(
    (await client.getFloorPlan(LISTING, 1, options)).floorPlan.operationId,
    command.operationId,
  );
});

test('SDK marks an invalid committed response uncertain and explicit original recovery issues no second POST', async (t) => {
  const f = await setup(t),
    run = f.open();
  let writes = 0;
  const client = new RealtorApiClient({
    baseUrl: 'https://synthetic.test',
    privacyNoticeVersion: 'synthetic',
    fetch: async (url, init) => {
      const r = await run(new Request(url, init));
      if (init.method === 'POST') {
        writes++;
        const data = await r.json();
        return Response.json(
          { ...data, resultVersion: '99' },
          { headers: { 'cache-control': 'no-store' } },
        );
      }
      return r;
    },
  });
  const input = structuredClone(command),
    pending = client.saveFloorPlanAttachment(input, { bearerToken: 'synthetic' });
  input.requestId = id(1999);
  await assert.rejects(
    () => pending,
    (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain === true,
  );
  assert.equal(writes, 1);
  const original = await client.getFloorPlanAttachmentOriginal(command, {
    bearerToken: 'synthetic',
  });
  assert.equal(original.command.requestId, command.requestId);
  assert.equal(original.resultVersion, '3');
  assert.equal(writes, 1);
});
