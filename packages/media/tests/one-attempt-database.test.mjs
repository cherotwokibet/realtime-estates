import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, lstat, readdir, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MediaCoordinatorDatabase, MediaCoordinatorDatabaseError } from '@realtor/media/coordinator-database';
import { createDurableSyntheticStore } from '@realtor/media/durable-store';
import { createSyntheticAttemptJournal } from '@realtor/media/attempt-journal';
import { createSyntheticWorkerAdmission } from '@realtor/media/worker-admission';
import { createSyntheticProcessingRequests } from '@realtor/media/processing-request';
import { createSyntheticOneAttemptProcessor } from '@realtor/media/one-attempt';
import { syntheticPng } from './fixtures.mjs';
import { environment, boundedRead, WINDOWS_ONLY } from './coordinator-fixture.mjs';

const ENTRY = fileURLToPath(new URL('../dist/codec-worker.js', import.meta.url));
const WRITES = ['capture_input', 'claim_processing', 'seal_output'];
const canonical = value => JSON.stringify(value) + '\n';
const copy = value => JSON.parse(JSON.stringify(value));
const uncertain = error => error instanceof MediaCoordinatorDatabaseError && error.commitUncertain === true;

// Each fault forwards COMMIT to the real disposable database and waits for its
// success, then withholds only that acknowledgement from the adapter. The same
// PGlite database stays alive; this is neither a connection/DB crash nor restore.
function committedAcknowledgementLoss(db, names = []) {
  const pending = new Set(names), commands = [], dropped = [], releases = [];
  let tail = Promise.resolve();
  const pool = {
    async connect() {
      let unlock;
      const next = new Promise(resolve => { unlock = resolve; });
      const previous = tail; tail = next; await previous;
      let command, receipt;
      return {
        async query(sql, values) {
          const match = /^SELECT app_media\.([a-z_]+)\(/.exec(sql);
          if (match) {
            command = match[1];
            commands.push({ name: command, values: values ? copy(values) : [] });
          }
          const result = await db.query(sql, values ? [...values] : []);
          if (match) receipt = copy(result.rows[0].receipt);
          if (sql === 'COMMIT' && pending.delete(command)) {
            dropped.push({ name: command, receipt });
            throw new Error('Deliberately withheld successful COMMIT acknowledgement.');
          }
          return result;
        },
        // Logical checkout destruction is observable. The test-owned PGlite
        // backend remains available for a fresh guarded checkout and readback.
        release(destroy) { releases.push(destroy); unlock(); },
      };
    },
  };
  return {
    coordinator: new MediaCoordinatorDatabase(pool), commands, dropped, releases,
    counts() { return Object.fromEntries(WRITES.map(name => [name, commands.filter(x => x.name === name).length])); },
  };
}

async function exists(location) {
  try { return await lstat(location); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function directDirectory(location) {
  const stat = await lstat(location); assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
}
async function removeKnownFiles(directory, names) {
  await directDirectory(directory);
  const present = await readdir(directory);
  for (const name of present) assert.ok(names.includes(name), `Unexpected fixture file retained: ${name}`);
  for (const name of present) {
    const file = path.join(directory, name), stat = await lstat(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1); await unlink(file);
  }
  await rmdir(directory);
}
async function removeOwnedStore(parent, store, jobId) {
  const root = store.rootDirectory;
  assert.equal(path.dirname(root), parent); assert.ok(path.basename(root).startsWith('realtor-durable-synthetic-'));
  await directDirectory(root); assert.deepEqual((await readdir(root)).sort(), ['objects', 'store.json']);
  const objects = path.join(root, 'objects'); await directDirectory(objects);
  for (const name of await readdir(objects)) {
    assert.equal(name, jobId); const job = path.join(objects, name); await directDirectory(job);
    for (const kind of await readdir(job)) {
      assert.ok(['quarantine', 'output'].includes(kind));
      await removeKnownFiles(path.join(job, kind), ['data.bin', 'receipt.json']);
    }
    await rmdir(job);
  }
  await rmdir(objects); await removeKnownFiles(root, ['store.json']);
}
async function removeOwnedWorker(parent, worker) {
  const root = worker.rootDirectory;
  assert.equal(path.dirname(root), parent); assert.equal(path.basename(root), 'worker-' + worker.workerId);
  await directDirectory(root);
  for (const name of await readdir(root)) assert.ok(['worker.json', 'history', 'active'].includes(name));
  const active = path.join(root, 'active');
  if (await exists(active)) await removeKnownFiles(active, ['owner.json', 'launch.json', 'completion.json']);
  const history = path.join(root, 'history'); await directDirectory(history);
  for (const reservationId of await readdir(history)) {
    assert.match(reservationId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const envelope = path.join(history, reservationId); await directDirectory(envelope);
    assert.deepEqual(await readdir(envelope), ['slot']);
    await removeKnownFiles(path.join(envelope, 'slot'), ['owner.json', 'launch.json', 'completion.json']); await rmdir(envelope);
  }
  await rmdir(history); await removeKnownFiles(root, ['worker.json']);
}

async function fixture(t, lost = []) {
  // Existing fixture initializes Windows containment even for read-only cases.
  // Only the first test below launches a child; the other cases are SQL fixtures.
  const e = await environment(t), parent = await mkdtemp(path.join(tmpdir(), 'realtor-one-attempt-database-'));
  const stores = []; let journal, worker, processor, requests, safeToClean = true, launches = 0, nativeOutcome;
  t.after(async () => {
    if (!safeToClean) { t.diagnostic(`Unconfirmed native attempt and all stores retained: ${parent}`); return; }
    await processor?.close(); await requests?.close(); await worker?.close(); await journal?.close();
    for (const store of stores) await store.close();
    // These roots and every contained job are owned by this fixture. No sweep,
    // recursive delete, unknown-child cleanup or historical recovery is used.
    if (worker) await removeOwnedWorker(parent, worker);
    for (const store of stores) await removeOwnedStore(parent, store, e.jobId);
    assert.deepEqual(await readdir(parent), []); await rmdir(parent);
  });
  async function store() { const result = await createDurableSyntheticStore(parent); stores.push(result); return result; }
  const inputStore = await store(), requestStore = await store(), journalStore = await store();
  journal = await createSyntheticAttemptJournal({ store: journalStore, attemptParent: e.attemptParent });
  worker = await createSyntheticWorkerAdmission({ parentDirectory: parent, journal });
  requests = await createSyntheticProcessingRequests({ store: requestStore });
  const fault = committedAcknowledgementLoss(e.db, lost);
  processor = await createSyntheticOneAttemptProcessor({
    coordinator: fault.coordinator, inputStore, requestStore, worker, journal,
    supervisor: {
      async run(request) {
        assert.equal(request.executablePath, process.execPath); assert.deepEqual(request.arguments, [ENTRY]);
        assert.equal(request.workingDirectory, path.join(e.attemptParent, e.jobId));
        launches++; safeToClean = false;
        const outcome = await e.run(request.workingDirectory);
        nativeOutcome = outcome; safeToClean = outcome.termination === 'job_empty' && outcome.activeProcesses === 0;
        return outcome;
      },
    },
    nodeExecutablePath: process.execPath, codecEntryPath: ENTRY,
  });
  return { e, inputStore, requestStore, journal, worker, requests, processor, fault,
    get launches() { return launches; }, get nativeOutcome() { return nativeOutcome; } };
}

async function originalRequest(f) {
  const binding = { jobId: f.e.jobId, claimId: randomUUID(), generationId: randomUUID() };
  const slot = await f.worker.reserve({ jobId: binding.jobId, claimId: binding.claimId });
  const bytes = syntheticPng(9, 7, (x, y) => [x * 20, y * 25, 80, 255]);
  const installed = await f.inputStore.install({ jobId: binding.jobId, objectId: f.e.storageIds.quarantineId,
    generationId: binding.generationId, kind: 'quarantine' }, bytes);
  const input = { generationId: binding.generationId, bytes: installed.bytes, sha256: installed.sha256 };
  const reserved = await f.requests.reserve({ ...binding, workerId: f.worker.workerId, journalId: f.journal.journalId,
    reservationId: slot.owner.reservationId, inputStoreId: f.inputStore.storeId, context: f.e.storageIds, input });
  f.requests.consume(reserved.ticket);
  return { binding, slot, input, request: reserved.request };
}
function blocked(result) { assert.equal(result.state, 'blocked'); assert.equal(result.reason, 'UNCONFIRMED'); }

test('one actual attempt reconciles real capture, claim and seal commits after all three acknowledgements are withheld', WINDOWS_ONLY, async t => {
  const f = await fixture(t, WRITES), binding = { jobId: f.e.jobId, claimId: randomUUID(), generationId: randomUUID() };
  const input = syntheticPng(41, 29, (x, y) => [x * 5, y * 8, 60, 255]);
  const result = await f.processor.run({ ...binding, input });
  assert.equal(result.state, 'verified'); assert.deepEqual(result.reconciled, ['capture', 'claim', 'seal']);
  assert.equal(f.launches, 1); assert.equal(f.nativeOutcome.exitCode, 0); assert.equal(f.nativeOutcome.termination, 'job_empty');
  assert.deepEqual(f.fault.counts(), { capture_input: 1, claim_processing: 1, seal_output: 1 });
  assert.deepEqual(f.fault.dropped.map(x => x.name), WRITES); assert.equal(f.fault.releases.filter(x => x === true).length, 3);
  const committed = Object.fromEntries(f.fault.dropped.map(x => [x.name, x.receipt]));
  assert.equal(committed.capture_input.generationId, binding.generationId);
  assert.equal(committed.capture_input.inputBytes, result.request.input.bytes);
  assert.equal(committed.capture_input.inputSha256, result.request.input.sha256);
  assert.deepEqual(result.lease, committed.claim_processing); assert.deepEqual(result.receipt, committed.seal_output);
  assert.equal(result.lease.claimId, binding.claimId); assert.equal(result.lease.attempt, 1);
  assert.deepEqual(result.outputRef, { jobId: binding.jobId, objectId: f.e.storageIds.outputId,
    generationId: result.lease.leaseNonce, kind: 'output' });
  const current = await f.fault.coordinator.readProcessing(binding.jobId);
  assert.deepEqual(current.capture, committed.capture_input); assert.deepEqual(current.lease, result.lease);
  assert.deepEqual(current.verified, result.receipt); assert.equal((await f.worker.inspect()).state, 'idle');

  // Direct actual-integration archive assertions retain the original request,
  // lease and observed native outcome rather than inferring them from idle.
  const owner = { version: 1, workerId: f.worker.workerId, journalId: f.journal.journalId,
    jobId: binding.jobId, claimId: binding.claimId, reservationId: result.request.reservationId };
  const intent = { version: 1, journalId: f.journal.journalId, jobId: binding.jobId, claimId: binding.claimId,
    attempt: result.lease.attempt, leaseNonce: result.lease.leaseNonce, attemptDirectory: path.join(f.e.attemptParent, binding.jobId) };
  const terminal = { ...intent, outcome: f.nativeOutcome }, archived = path.join(f.worker.rootDirectory, 'history', owner.reservationId, 'slot');
  assert.equal((await boundedRead(archived, 'owner.json', 4096)).toString('utf8'), canonical(owner));
  assert.equal((await boundedRead(archived, 'launch.json', 4096)).toString('utf8'), canonical({ owner, intent }));
  assert.equal((await boundedRead(archived, 'completion.json', 4096)).toString('utf8'), canonical({ owner, state: 'job_empty', terminal }));
  await f.e.inspectUnchanged(1);

  // Privileged state/version fixture tests historical read-only reconciliation.
  // It claims neither a submitted media gate nor successful operator submission.
  await f.e.asBootstrap(db => db.query(`UPDATE app_private.listing_revisions r SET version=r.version+1,
    state='pending',submitted_at=clock_timestamp(),submitted_by=j.requester_id
    FROM app_private.media_jobs j WHERE j.id=$1 AND r.tenant_id=j.tenant_id
      AND r.listing_id=j.listing_id AND r.revision_no=j.revision_no`, [binding.jobId]));
  const writes = f.fault.counts(), contexts = f.fault.commands.filter(x => x.name === 'read_upload_context').length;
  const recovered = await f.processor.reconcile(binding);
  assert.equal(recovered.state, 'verified'); assert.deepEqual(recovered.request, result.request);
  assert.deepEqual(recovered.lease, result.lease); assert.deepEqual(recovered.receipt, result.receipt);
  assert.deepEqual(f.fault.counts(), writes); assert.equal(f.launches, 1);
  assert.equal(f.fault.commands.filter(x => x.name === 'read_upload_context').length, contexts);
  await f.e.asBootstrap(async db => {
    const row = (await db.query(`SELECT j.expected_version::text AS original,r.version::text AS current,r.state,
      (SELECT count(*)::integer FROM app_private.revision_media) AS photos
      FROM app_private.media_jobs j JOIN app_private.listing_revisions r ON r.tenant_id=j.tenant_id
        AND r.listing_id=j.listing_id AND r.revision_no=j.revision_no WHERE j.id=$1`, [binding.jobId])).rows[0];
    assert.deepEqual(row, { original: '2', current: '3', state: 'pending', photos: 0 });
  });
});

test('original request reconciliation blocks missing or mismatched claims and current authorization denial without new SQL writes', WINDOWS_ONLY, async t => {
  const f = await fixture(t, ['capture_input', 'claim_processing']), original = await originalRequest(f);
  blocked(await f.processor.reconcile(original.binding));
  assert.deepEqual(f.fault.counts(), { capture_input: 0, claim_processing: 0, seal_output: 0 });
  await assert.rejects(() => f.fault.coordinator.captureInput(f.e.jobId, original.input), uncertain);
  const captureOnly = await f.processor.reconcile(original.binding);
  // A descriptive captured result is permitted; it is not confirmation of the
  // original claim or authority to allocate one. Conservative blocked is valid too.
  assert.ok(['captured', 'blocked'].includes(captureOnly.state));
  if (captureOnly.state === 'captured') assert.deepEqual(captureOnly.request, original.request);
  else blocked(captureOnly);
  assert.deepEqual(f.fault.counts(), { capture_input: 1, claim_processing: 0, seal_output: 0 });
  await assert.rejects(() => f.fault.coordinator.claimProcessing(f.e.jobId, original.binding.claimId), uncertain);
  const committedLease = f.fault.dropped.find(x => x.name === 'claim_processing').receipt;
  const recovered = await f.processor.reconcile(original.binding);
  assert.equal(recovered.state, 'processing'); assert.deepEqual(recovered.request, original.request);
  assert.deepEqual(recovered.lease, committedLease); assert.equal(recovered.lease.claimId, original.binding.claimId);
  blocked(await f.processor.reconcile({ ...original.binding, claimId: randomUUID() }));
  blocked(await f.processor.reconcile({ ...original.binding, generationId: randomUUID() }));
  await f.e.asBootstrap(db => db.query(`UPDATE app_private.memberships m SET active=false,revoked_at=clock_timestamp()
    FROM app_private.media_jobs j WHERE j.id=$1 AND m.tenant_id=j.tenant_id AND m.user_id=j.requester_id`, [f.e.jobId]));
  blocked(await f.processor.reconcile(original.binding));
  await f.e.asBootstrap(db => db.query(`UPDATE app_private.memberships m SET active=true,revoked_at=NULL
    FROM app_private.media_jobs j WHERE j.id=$1 AND m.tenant_id=j.tenant_id AND m.user_id=j.requester_id`, [f.e.jobId]));
  assert.deepEqual(f.fault.counts(), { capture_input: 1, claim_processing: 1, seal_output: 0 });
  assert.equal(f.launches, 0); assert.equal(f.fault.dropped.length, 2);
  assert.equal((await f.worker.inspect()).state, 'blocked');
  assert.equal((await f.worker.releaseBeforeLaunch(original.slot.permit)).state, 'not_launched');
  await f.e.inspectUnchanged(0);
});

test('a manually seeded expired original lease followed by a real successor claim stays superseded during explicit reconciliation', WINDOWS_ONLY, async t => {
  const f = await fixture(t), original = await originalRequest(f), oldNonce = randomUUID();
  await f.fault.coordinator.captureInput(f.e.jobId, original.input);
  // This privileged expired metadata fixture avoids a sleep or immutable-row
  // update. It proves latest-lease selection, not elapsed time or an old worker.
  await f.e.asBootstrap(db => db.query(`WITH facts AS (SELECT clock_timestamp() AS current_time)
    INSERT INTO app_private.media_processing_leases(tenant_id,job_id,attempt,claim_id,lease_nonce,claimed_at,lease_expires_at,job_expires_at)
    SELECT tenant_id,id,1,$2,$3,facts.current_time-interval '200 seconds',
      least(facts.current_time-interval '20 seconds',expires_at),expires_at
    FROM app_private.media_jobs CROSS JOIN facts WHERE id=$1`, [f.e.jobId, original.binding.claimId, oldNonce]));
  const latest = await f.fault.coordinator.claimProcessing(f.e.jobId, randomUUID());
  assert.equal(latest.attempt, 2); assert.notEqual(latest.claimId, original.binding.claimId); assert.notEqual(latest.leaseNonce, oldNonce);
  const writes = f.fault.counts(); blocked(await f.processor.reconcile(original.binding));
  assert.deepEqual(f.fault.counts(), writes); assert.equal(f.launches, 0);
  assert.deepEqual((await f.fault.coordinator.readProcessing(f.e.jobId)).lease, latest);
  assert.deepEqual(f.fault.counts(), { capture_input: 1, claim_processing: 1, seal_output: 0 });
  assert.equal((await f.worker.releaseBeforeLaunch(original.slot.permit)).state, 'not_launched');
  await f.e.inspectUnchanged(0);
});
