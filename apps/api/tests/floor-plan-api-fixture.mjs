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

export { setup, id };
