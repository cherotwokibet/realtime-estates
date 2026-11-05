import test from 'node:test';
import assert from 'node:assert/strict';
import { createFloorPlanWorkerAdmission } from '../dist/floor-plan-admission.js';
import { reopenDurableSyntheticStore } from '../dist/durable-store.js';
import { createSyntheticAttemptJournal } from '../dist/attempt-journal.js';
import * as sql from '../../../database/tests/public-media-fixtures.mjs';
import { setup } from './floor-plan-fixture.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const code = (c) => (e) => e?.code === c;
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
