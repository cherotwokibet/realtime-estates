import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, lstat, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createDurableSyntheticStore, reopenDurableSyntheticStore } from '../dist/durable-store.js';
import {
  createFloorPlanRequests,
  createFloorPlanSourceAdmission,
} from '../dist/floor-plan-request.js';
import { createSyntheticAttemptJournal } from '../dist/attempt-journal.js';
import { createSyntheticWorkerAdmission } from '../dist/worker-admission.js';
import { createFloorPlanWorkerAdmission } from '../dist/floor-plan-admission.js';
import { syntheticPng } from './fixtures.mjs';
import * as sql from '../../../database/tests/public-media-fixtures.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const code = (c) => (e) => e?.code === c;
async function media(db, query, args) {
  await db.exec('BEGIN; SET LOCAL ROLE media_coordinator');
  try {
    await db.query(
      "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
      [sql.T, sql.AGENT],
    );
    const value = await sql.scalar(db, query, args);
    await db.exec('COMMIT');
    return value;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}
async function setup(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'realtor-floor-admission-'));
  const resources = [];
  // No process is started in this fixture. Remove only verified descendants of this exact temporary root.
  t.after(async () => {
    for (const r of resources.reverse()) await r.close();
    async function clean(dir) {
      assert.ok(path.resolve(dir) === parent || path.resolve(dir).startsWith(parent + path.sep));
      assert.ok(!(await lstat(dir)).isSymbolicLink());
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name),
          s = await lstat(p);
        assert.ok(!s.isSymbolicLink());
        if (s.isDirectory()) await clean(p);
        else {
          assert.ok(s.isFile() && s.nlink === 1);
          await unlink(p);
        }
      }
      await rmdir(dir);
    }
    await clean(parent);
  });
  const db = await sql.fixture();
  resources.push(db);
  for (const name of ['registration', 'processing'])
    await db.exec(
      await readFile(
        new URL('../../../database/proposals/floor-plan-' + name + '.sql', import.meta.url),
        'utf8',
      ),
    );
  await sql.createDraft(db);
  const source = syntheticPng(),
    hash = createHash('sha256').update(source).digest('hex');
  const registration = await sql.asActor(db, sql.T, sql.AGENT, () =>
    sql.scalar(db, 'SELECT app_api.register_synthetic_floor_plan($1,1,2,$2,$3,$4,$5)', [
      sql.LISTING,
      id(900),
      hash,
      source.length,
      'png',
    ]),
  );
  const inputStore = await createDurableSyntheticStore(parent),
    requestStore = await createDurableSyntheticStore(parent),
    journalStore = await createDurableSyntheticStore(parent);
  resources.push(inputStore, requestStore, journalStore);
  const requests = createFloorPlanRequests({ inputStore, requestStore });
  resources.push(requests);
  const b = registration.binding,
    sourceTarget = {
      companyId: b.companyId,
      actorId: b.actorId,
      listingId: b.listingId,
      revision: b.revision,
      requestId: b.requestId,
    };
  await createFloorPlanSourceAdmission({
    requests,
    preflight: () =>
      sql.asActor(db, sql.T, sql.AGENT, () =>
        sql.scalar(db, 'SELECT app_api.preflight_synthetic_floor_plan($1,1,$2)', [
          sql.LISTING,
          b.requestId,
        ]),
      ),
  }).record(sourceTarget, source);
  const lease = await media(db, 'SELECT app_media.claim_synthetic_floor_plan($1,1,$2,$3)', [
    sql.LISTING,
    b.requestId,
    id(901),
  ]);
  const attemptParent = path.join(parent, 'attempts'),
    workerParent = path.join(parent, 'workers');
  await mkdir(attemptParent);
  await mkdir(workerParent);
  const journal = await createSyntheticAttemptJournal({ store: journalStore, attemptParent });
  resources.push(journal);
  const worker = await createSyntheticWorkerAdmission({ parentDirectory: workerParent, journal });
  resources.push(worker);
  const target = { ...b, claimId: lease.claimId, leaseNonce: lease.leaseNonce };
  const preflight = () =>
    media(db, 'SELECT app_media.preflight_synthetic_floor_plan_worker($1,1,$2,$3,$4)', [
      sql.LISTING,
      b.requestId,
      lease.claimId,
      lease.leaseNonce,
    ]);
  const config = { requests, journal, worker, preflight };
  return { db, source, requests, journalStore, journal, worker, target, lease, preflight, config };
}
test('actual SQL lease binds durable source, worker slot and one-use journal ticket; reopening cannot recreate admission', async (t) => {
  const f = await setup(t),
    admission = createFloorPlanWorkerAdmission(f.config),
    prepared = await admission.prepare(f.target);
  assert.deepEqual(prepared.source, f.source);
  assert.equal(prepared.lease.outputObjectId, f.lease.outputObjectId);
  assert.equal(prepared.attempt.intent.attempt, 1);
  assert.equal((await f.worker.inspect()).state, 'blocked');
  await admission.arm(prepared);
  assert.throws(
    () => f.journal.consumeLaunchTicket(prepared.attempt.ticket),
    code('INVALID_TICKET'),
  );
  await assert.rejects(() => admission.arm(prepared), code('BLOCKED'));
  await assert.rejects(() => admission.prepare(f.target), code('BLOCKED'));
  const b = {
    jobId: f.target.jobId,
    claimId: f.target.claimId,
    attempt: 1,
    leaseNonce: f.target.leaseNonce,
  };
  await f.journal.close();
  await f.journalStore.close();
  const store = await reopenDurableSyntheticStore(
    f.journalStore.rootDirectory,
    f.journalStore.storeId,
  );
  const reopened = await createSyntheticAttemptJournal({
    store,
    attemptParent: f.journal.attemptParent,
  });
  try {
    assert.equal((await reopened.inspect(b)).reason, 'UNCONFIRMED');
    await assert.rejects(() => reopened.reserve(b), code('BLOCKED'));
  } finally {
    await reopened.close();
    await store.close();
  }
});
test('draft change during source IO is checked again before reserving a worker or journal', async (t) => {
  const f = await setup(t);
  let calls = 0;
  const admission = createFloorPlanWorkerAdmission({
    ...f.config,
    requests: {
      ...f.requests,
      async read(b) {
        const value = await f.requests.read(b);
        await f.db.query(
          "UPDATE app_private.listing_revisions SET title='changed during source read' WHERE listing_id=$1",
          [sql.LISTING],
        );
        return value;
      },
    },
    preflight: () => {
      calls++;
      return f.preflight();
    },
  });
  await assert.rejects(() => admission.prepare(f.target), code('40001'));
  assert.equal(calls, 2);
  assert.equal((await f.worker.inspect()).state, 'idle');
  assert.equal(
    (
      await f.journal.inspect({
        jobId: f.target.jobId,
        claimId: f.target.claimId,
        leaseNonce: f.target.leaseNonce,
        attempt: 1,
      })
    ).intent,
    null,
  );
});
test('fresh access loss before arming releases only the unlaunched slot and retains the immutable attempt', async (t) => {
  const f = await setup(t),
    admission = createFloorPlanWorkerAdmission(f.config),
    p = await admission.prepare(f.target);
  await f.db.query(
    "UPDATE app_private.listing_revisions SET title='later edit' WHERE listing_id=$1",
    [sql.LISTING],
  );
  await assert.rejects(() => admission.arm(p), code('40001'));
  assert.equal((await f.worker.inspect()).state, 'idle');
  assert.equal(
    (
      await f.journal.inspect({
        jobId: f.target.jobId,
        claimId: f.target.claimId,
        leaseNonce: f.target.leaseNonce,
        attempt: 1,
      })
    ).reason,
    'UNCONFIRMED',
  );
  await assert.rejects(() => admission.arm(p), code('BLOCKED'));
});
test('changed output identity and wrong role receipts cannot reserve or arm actual worker state', async (t) => {
  const f = await setup(t);
  let calls = 0;
  const wrong = createFloorPlanWorkerAdmission({
    ...f.config,
    preflight: async () => {
      const r = await f.preflight();
      return { ...r, registration: { ...r.registration, role: 'photo' } };
    },
  });
  await assert.rejects(() => wrong.prepare(f.target), code('INTEGRITY'));
  assert.equal((await f.worker.inspect()).state, 'idle');
  const changed = createFloorPlanWorkerAdmission({
    ...f.config,
    preflight: async () => {
      const r = await f.preflight();
      return ++calls === 2 ? { ...r, outputObjectId: id(999) } : r;
    },
  });
  await assert.rejects(() => changed.prepare(f.target), code('INTEGRITY'));
  assert.equal((await f.worker.inspect()).state, 'idle');
  const admission = createFloorPlanWorkerAdmission(f.config),
    p = await admission.prepare(f.target);
  p.source.fill(0);
  await assert.rejects(() => admission.arm(p), code('INTEGRITY'));
  assert.equal((await f.worker.inspect()).state, 'idle');
});
test('target snapshots, busy fencing and closed admissions cannot create replacement attempts', async (t) => {
  const f = await setup(t);
  let release, entered;
  const gate = new Promise((r) => (release = r)),
    started = new Promise((r) => (entered = r));
  let calls = 0;
  const admission = createFloorPlanWorkerAdmission({
    ...f.config,
    preflight: async (selected) => {
      assert.equal(selected.jobId, f.target.jobId);
      if (++calls === 1) {
        entered();
        await gate;
      }
      return f.preflight();
    },
  });
  const mutable = { ...f.target },
    pending = admission.prepare(mutable);
  await started;
  mutable.jobId = id(999);
  await assert.rejects(() => admission.prepare(f.target), code('BUSY'));
  release();
  const p = await pending;
  assert.equal(p.attempt.intent.jobId, f.target.jobId);
  admission.close();
  await assert.rejects(() => admission.arm(p), code('CLOSED'));
});

test('malformed, expired, wrong-scope and accessor receipts never reserve worker state', async (t) => {
  const f = await setup(t);
  let getters = 0;
  for (const change of [
    (r) => ({ ...r, leaseNonce: id(999) }),
    (r) => ({
      ...r,
      registration: { ...r.registration, binding: { ...r.registration.binding, actorId: id(999) } },
    }),
    (r) => ({ ...r, expiresAt: r.claimedAt }),
    (r) => ({ ...r, unexpected: true }),
    (r) =>
      Object.defineProperty({ ...r }, 'registration', {
        enumerable: true,
        get() {
          getters++;
          return r.registration;
        },
      }),
  ]) {
    const admission = createFloorPlanWorkerAdmission({
      ...f.config,
      preflight: async () => change(await f.preflight()),
    });
    await assert.rejects(() => admission.prepare(f.target));
    assert.equal((await f.worker.inspect()).state, 'idle');
  }
  assert.equal(getters, 0);
});
test('explicit cancellation releases an unarmed slot but never deletes or retries its journal intent', async (t) => {
  const f = await setup(t),
    admission = createFloorPlanWorkerAdmission(f.config),
    p = await admission.prepare(f.target);
  await admission.cancel(p);
  assert.equal((await f.worker.inspect()).state, 'idle');
  await assert.rejects(() => admission.cancel(p), code('BLOCKED'));
  await assert.rejects(() => admission.arm(p), code('BLOCKED'));
  await assert.rejects(() => admission.prepare(f.target), code('BLOCKED'));
  assert.equal((await f.worker.inspect()).state, 'idle');
});
