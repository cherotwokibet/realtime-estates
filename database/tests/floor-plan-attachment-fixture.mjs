import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  fixture,
  createDraft,
  asActor,
  scalar,
  T,
  OTHER,
  ADMIN,
  AGENT,
  LISTING,
} from './public-media-fixtures.mjs';
import { syntheticPng } from '../../packages/media/tests/fixtures.mjs';
import { convertSyntheticFloorPlan } from '../../packages/media/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SECOND = id(101);
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
  assert.equal(
    await scalar(db, "SELECT to_regclass('app_private.synthetic_floor_plan_attachments')"),
    null,
  );
  for (const n of ['registration', 'processing', 'output', 'attachment'])
    await db.exec(
      await readFile(new URL('../proposals/floor-plan-' + n + '.sql', import.meta.url), 'utf8'),
    );
  await createDraft(db);
  const source = syntheticPng(),
    manifest = (await convertSyntheticFloorPlan(source)).manifest;
  const prepare = async (request = id(1100), version = 2, sealed = true) => {
    await asActor(db, T, AGENT, () =>
      scalar(db, 'SELECT app_api.register_synthetic_floor_plan($1,1,$2,$3,$4,$5,$6)', [
        LISTING,
        version,
        request,
        createHash('sha256').update(source).digest('hex'),
        source.length,
        'png',
      ]),
    );
    const lease = await media(db, () =>
      scalar(db, 'SELECT app_media.claim_synthetic_floor_plan($1,1,$2,$3)', [
        LISTING,
        request,
        id(Number(request.slice(-4)) + 100),
      ]),
    );
    if (sealed)
      await media(db, () =>
        scalar(db, 'SELECT app_media.seal_synthetic_floor_plan($1,1,$2,$3,$4,$5,$6)', [
          LISTING,
          request,
          lease.claimId,
          lease.leaseNonce,
          lease.outputObjectId,
          manifest,
        ]),
      );
    return request;
  };
  const request = await prepare();
  const command = (changes = {}) => ({
    policy: 'synthetic-floor-plan-attachment-command-v1',
    operationId: id(1300),
    listingId: LISTING,
    revision: 1,
    expectedVersion: '2',
    requestId: request,
    ...changes,
  });
  const save = (cmd = command(), actor = AGENT, tenant = T) =>
    asActor(db, tenant, actor, () =>
      scalar(db, 'SELECT app_api.save_synthetic_floor_plan_attachment($1)', [cmd]),
    );
  const gallery = (actor = AGENT, tenant = T, listing = LISTING) =>
    asActor(db, tenant, actor, () =>
      scalar(db, 'SELECT app_api.read_synthetic_floor_plan_gallery($1,1)', [listing]),
    );
  const original = (operation = id(1300), actor = AGENT) =>
    asActor(db, T, actor, () =>
      scalar(db, 'SELECT app_api.read_synthetic_floor_plan_attachment_original($1,$2)', [
        LISTING,
        operation,
      ]),
    );
  return { db, source, manifest, request, prepare, command, save, gallery, original };
}

export { setup, id };
