import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setup } from './floor-plan-fixture.mjs';
import {
  createFloorPlanPreparation,
  FloorPlanPreparationUncertainError,
} from '../dist/floor-plan-preparation.js';
import { createFloorPlanSourceAdmission } from '../dist/floor-plan-request.js';
import { createFloorPlanProcessor } from '../dist/floor-plan-processing.js';
import { createFloorPlanOutputDelivery } from '../dist/floor-plan-output.js';
import { createDurableSyntheticStore } from '../dist/durable-store.js';
import { validateFloorPlanWorkerLease } from '../dist/floor-plan-admission.js';
import {
  createWindowsSyntheticSupervisor,
  retireWindowsSyntheticSupervisor,
} from '../dist/windows-supervisor.js';
import { convertSyntheticFloorPlan } from '../dist/index.js';
import * as sql from '../../../database/tests/public-media-fixtures.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const code = (c) => (e) => e?.code === c;
async function media(db, t, query, args) {
  await db.exec('BEGIN; SET LOCAL ROLE media_coordinator');
  try {
    await db.query(
      "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
      [t.companyId, t.actorId],
    );
    const r = await sql.scalar(db, query, args);
    await db.exec('COMMIT');
    return r;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}
async function fixture(t, native = false) {
  let supervisor;
  const f = await setup(t, {
    allowCleanup: async () =>
      !supervisor || Boolean(await retireWindowsSyntheticSupervisor(supervisor)),
  });
  await f.db.exec(
    await readFile(
      new URL('../../../database/proposals/floor-plan-output.sql', import.meta.url),
      'utf8',
    ),
  );
  const target = {
    companyId: sql.T,
    actorId: sql.AGENT,
    listingId: sql.LISTING,
    revision: 1,
    requestId: id(2100),
    expectedVersion: 2,
  };
  const calls = {
    register: 0,
    readRegistration: 0,
    claim: 0,
    readLease: 0,
    source: 0,
    native: 0,
    seal: 0,
  };
  const preflight = (t) =>
    media(f.db, t, 'SELECT app_media.preflight_synthetic_floor_plan_worker($1,$2,$3,$4,$5)', [
      t.listingId,
      t.revision,
      t.requestId,
      t.claimId,
      t.leaseNonce,
    ]);
  const sourceAdmission = createFloorPlanSourceAdmission({
    requests: f.requests,
    preflight: (t) =>
      sql.asActor(f.db, t.companyId, t.actorId, () =>
        sql.scalar(f.db, 'SELECT app_api.preflight_synthetic_floor_plan($1,$2,$3)', [
          t.listingId,
          t.revision,
          t.requestId,
        ]),
      ),
  });
  const output = await createDurableSyntheticStore(f.parent),
    metadata = await createDurableSyntheticStore(f.parent);
  f.resources.push(output, metadata);
  let processor;
  if (native) {
    supervisor = await createWindowsSyntheticSupervisor({
      powerShellPath:
        process.env.REALTOR_TEST_POWERSHELL ??
        path.join(
          os.homedir(),
          '.cache',
          'codex-runtimes',
          'codex-primary-runtime',
          'dependencies',
          'native',
          'powershell',
          'pwsh.exe',
        ),
      attemptParent: f.journal.attemptParent,
    });
    processor = await createFloorPlanProcessor({ ...f.config, preflight, supervisor });
    f.resources.push(processor);
  } else
    processor = {
      run: async (t) => ({
        state: 'readback_verified',
        lease: validateFloorPlanWorkerLease(await preflight(t), t, f.source),
        result: await convertSyntheticFloorPlan(f.source),
      }),
    };
  const delivery = createFloorPlanOutputDelivery({
    processor: {
      run: async (t) => {
        calls.native++;
        return processor.run(t);
      },
    },
    requests: f.requests,
    outputStore: output,
    metadataStore: metadata,
    preflight,
    seal: (t, outputId, manifest) => {
      calls.seal++;
      return media(f.db, t, 'SELECT app_media.seal_synthetic_floor_plan($1,$2,$3,$4,$5,$6,$7)', [
        t.listingId,
        t.revision,
        t.requestId,
        t.claimId,
        t.leaseNonce,
        outputId,
        manifest,
      ]);
    },
    readSeal: (t) =>
      media(f.db, t, 'SELECT app_media.read_synthetic_floor_plan_output($1,$2,$3)', [
        t.listingId,
        t.revision,
        t.requestId,
      ]),
  });
  f.resources.push(delivery);
  const config = {
    requests: f.requests,
    sourceAdmission: {
      record: (...args) => {
        calls.source++;
        return sourceAdmission.record(...args);
      },
    },
    delivery,
    register: (t, s) => {
      calls.register++;
      return sql.asActor(f.db, t.companyId, t.actorId, () =>
        sql.scalar(f.db, 'SELECT app_api.register_synthetic_floor_plan($1,$2,$3,$4,$5,$6,$7)', [
          t.listingId,
          t.revision,
          t.expectedVersion,
          t.requestId,
          s.sha256,
          s.bytes,
          s.format,
        ]),
      );
    },
    readRegistration: (t) => {
      calls.readRegistration++;
      return sql.asActor(f.db, t.companyId, t.actorId, () =>
        sql.scalar(f.db, 'SELECT app_api.read_synthetic_floor_plan_registration($1,$2)', [
          t.listingId,
          t.requestId,
        ]),
      );
    },
    claim: (t, claim) => {
      calls.claim++;
      assert.equal(claim, t.requestId);
      return media(f.db, t, 'SELECT app_media.claim_synthetic_floor_plan($1,$2,$3,$4)', [
        t.listingId,
        t.revision,
        t.requestId,
        claim,
      ]);
    },
    readLease: (t) => {
      calls.readLease++;
      return media(f.db, t, 'SELECT app_media.read_synthetic_floor_plan_lease($1,$2,$3)', [
        t.listingId,
        t.revision,
        t.requestId,
      ]);
    },
  };
  const open = (changes = {}) => {
    const p = createFloorPlanPreparation({ ...config, ...changes });
    f.resources.push(p);
    return p;
  };
  return { ...f, target, calls, config, open };
}

export { fixture };
