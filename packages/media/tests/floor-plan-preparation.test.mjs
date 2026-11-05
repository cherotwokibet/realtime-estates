import test from 'node:test';
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
test(
  'actual native preparation joins registration/source/claim/seal once and recovery performs no new writes or decoder run',
  { skip: process.platform !== 'win32', timeout: 90000 },
  async (t) => {
    const f = await fixture(t, true),
      p = f.open(),
      result = await p.prepare(f.target, f.source);
    assert.equal(result.state, 'prepared');
    assert.equal(result.prepared.expectedVersion, '2');
    assert.equal(result.prepared.requestId, f.target.requestId);
    for (const key of ['storeId', 'leaseNonce', 'claimId', 'generationId', 'actorId', 'companyId'])
      assert.ok(!JSON.stringify(result).includes(key));
    assert.deepEqual(f.calls, {
      register: 1,
      readRegistration: 0,
      claim: 1,
      readLease: 0,
      source: 1,
      native: 1,
      seal: 1,
    });
    const before = { ...f.calls };
    assert.deepEqual(await p.recover(f.target), result);
    for (const key of ['register', 'claim', 'source', 'native', 'seal'])
      assert.equal(f.calls[key], before[key]);
  },
);
// Remaining cases simulate the trusted processor using actual lossless conversion and isolated SQL.
test('known uncertain register and claim acknowledgements read the exact originals without reissuing commands', async (t) => {
  const f = await fixture(t),
    p = f.open({
      register: async (...args) => {
        await f.config.register(...args);
        throw new FloorPlanPreparationUncertainError();
      },
      claim: async (...args) => {
        await f.config.claim(...args);
        throw new FloorPlanPreparationUncertainError();
      },
    });
  assert.equal((await p.prepare(f.target, f.source)).state, 'prepared');
  assert.equal(f.calls.register, 1);
  assert.equal(f.calls.claim, 1);
  assert.equal(f.calls.readRegistration, 1);
  assert.equal(f.calls.readLease, 1);
  assert.equal(f.calls.native, 1);
});
test('generic register failure and mismatched registration scope never persist source or start processing', async (t) => {
  const f = await fixture(t);
  const failed = f.open({
    register: async () => {
      throw Error('Known unavailable');
    },
  });
  await assert.rejects(() => failed.prepare(f.target, f.source), /Known unavailable/);
  assert.equal(f.calls.readRegistration, 0);
  const different = f.open({
    register: async (...args) => {
      const r = await f.config.register(...args);
      return { ...r, binding: { ...r.binding, actorId: id(2999) } };
    },
  });
  await assert.rejects(() => different.prepare(f.target, f.source), code('INTEGRITY'));
  assert.equal(f.calls.source, 0);
  assert.equal(f.calls.claim, 0);
  assert.equal(f.calls.native, 0);
});
test('source persistence failure retains registration and read-only recovery cannot recreate a missing lease', async (t) => {
  const f = await fixture(t),
    p = f.open({
      sourceAdmission: {
        record: async () => {
          throw Error('Source write uncertain');
        },
      },
    });
  await assert.rejects(() => p.prepare(f.target, f.source), /Source write uncertain/);
  const before = { ...f.calls };
  assert.equal((await p.recover(f.target)).state, 'blocked');
  for (const key of ['register', 'claim', 'source', 'native', 'seal'])
    assert.equal(f.calls[key], before[key]);
});
test('preparation snapshots source/target, rejects concurrent work and drains on close', async (t) => {
  const f = await fixture(t);
  let release, started;
  const held = new Promise((r) => (release = r)),
    entered = new Promise((r) => (started = r));
  const p = f.open({
      register: async (...args) => {
        started();
        await held;
        return f.config.register(...args);
      },
    }),
    input = Buffer.from(f.source),
    target = { ...f.target },
    pending = p.prepare(target, input);
  await entered;
  input.fill(0);
  target.requestId = id(2999);
  await assert.rejects(() => p.prepare(f.target, f.source), code('BUSY'));
  let done = false;
  const closing = p.close().then(() => (done = true));
  await Promise.resolve();
  assert.equal(done, false);
  await assert.rejects(() => p.prepare(f.target, f.source), code('CLOSED'));
  release();
  assert.equal((await pending).prepared.requestId, f.target.requestId);
  await closing;
  assert.equal(done, true);
});
test('a changed claimed original and unavailable recovery never become fresh native authority', async (t) => {
  const f = await fixture(t),
    p = f.open({
      claim: async (...args) => {
        const r = await f.config.claim(...args);
        return { ...r, claimId: id(2999) };
      },
    });
  await assert.rejects(() => p.prepare(f.target, f.source));
  assert.equal(f.calls.native, 0);
  const before = { ...f.calls };
  assert.equal((await p.recover(f.target)).state, 'blocked');
  for (const key of ['register', 'claim', 'source', 'native', 'seal'])
    assert.equal(f.calls[key], before[key]);
});
