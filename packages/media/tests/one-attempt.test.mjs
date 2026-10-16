import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createDurableSyntheticStore, reopenDurableSyntheticStore } from '../dist/durable-store.js';
import { createSyntheticAttemptJournal } from '../dist/attempt-journal.js';
import {
  createSyntheticWorkerAdmission,
  reopenSyntheticWorkerAdmission,
} from '../dist/worker-admission.js';
import { createSyntheticOneAttemptProcessor } from '../dist/one-attempt.js';
import { MediaCoordinatorDatabaseError } from '../dist/coordinator-database.js';
import { riffChunk, syntheticPng, webpContainer } from './fixtures.mjs';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const code = (expected) => (error) => error?.code === expected;
const timestamp = (milliseconds) => new Date(milliseconds).toISOString().replace('Z', '000Z');
const clone = (value) => structuredClone(value);
const empty = () => ({
  state: 'exited',
  termination: 'job_empty',
  exitCode: 0,
  activeProcesses: 0,
  safeCode: 'EXITED',
});
const unknown = () => ({
  state: 'containment_unknown',
  termination: 'unconfirmed',
  cleanupAllowed: false,
  safeCode: 'PROTOCOL_INVALID',
});
const entry = fileURLToPath(new URL('../dist/codec-worker.js', import.meta.url));
let sequence = 1;
async function exists(location) {
  try {
    return await lstat(location);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function removeFiles(directory, allowed) {
  const stat = await lstat(directory);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  for (const name of await readdir(directory)) {
    assert.ok(allowed.includes(name), `Unknown fixture entry retained: ${name}`);
    const file = path.join(directory, name),
      s = await lstat(file);
    assert.ok(s.isFile() && !s.isSymbolicLink() && s.nlink === 1);
    await unlink(file);
  }
  await rmdir(directory);
}

// Fixed coordinator doubles and simulated supervisor observations below are not
// SQL/COMMIT/authorization or OS containment evidence. All persistence is real FS.
// The fake child writes independently constructed WebP HEADER bytes only; no
// entropy decoding or native child is claimed. Parent integration tests exercise
// the actual restricted database, Windows supervisor and image codec separately.
async function fixture(t, options = {}) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'realtor-one-attempt-')),
    attemptParent = path.join(parent, 'attempts');
  await mkdir(attemptParent);
  const stores = new Set(),
    journals = new Set(),
    workers = new Set(),
    processors = new Set();
  let inputStore = await createDurableSyntheticStore(parent),
    requestStore = await createDurableSyntheticStore(parent),
    journalStore = await createDurableSyntheticStore(parent);
  for (const store of [inputStore, requestStore, journalStore]) stores.add(store);
  const roots = [inputStore, requestStore, journalStore].map((store) => ({
    root: store.rootDirectory,
    id: store.storeId,
  }));
  const n = sequence++,
    binding = { jobId: id(n), claimId: id(10000 + n), generationId: id(20000 + n) },
    source = syntheticPng(3, 2),
    original = Buffer.from(source);
  const context = {
    jobId: binding.jobId,
    quarantineId: id(30000 + n),
    outputId: id(40000 + n),
    expiresAt: timestamp(Date.now() + 3600000),
    pipeline: 'synthetic-codec-v1',
  };
  const input = {
      generationId: binding.generationId,
      bytes: original.length,
      sha256: hash(original),
    },
    now = timestamp(Date.now());
  const facts = { capture: null, lease: null, verified: null },
    calls = [];
  const lease = () => ({
    jobId: binding.jobId,
    claimId: binding.claimId,
    attempt: 1,
    leaseNonce: id(50000 + n),
    leaseExpiresAt: timestamp(Date.now() + 120000),
    quarantineId: context.quarantineId,
    outputId: context.outputId,
    input: { ...input },
    pipeline: 'synthetic-codec-v1',
  });
  let journal = await createSyntheticAttemptJournal({ store: journalStore, attemptParent });
  journals.add(journal);
  let worker = await createSyntheticWorkerAdmission({ parentDirectory: parent, journal });
  workers.add(worker);
  const workerRoot = worker.rootDirectory,
    workerId = worker.workerId;
  async function preSql() {
    const intentPath = path.join(roots[1].root, 'objects', binding.jobId, 'quarantine', 'data.bin'),
      persisted = JSON.parse(await readFile(intentPath, 'utf8'));
    assert.equal(persisted.jobId, binding.jobId);
    assert.equal(persisted.claimId, binding.claimId);
    assert.equal(persisted.generationId, binding.generationId);
    assert.equal(persisted.workerId, worker.workerId);
    assert.equal(persisted.journalId, journal.journalId);
    assert.deepEqual(persisted.input, input);
    const owner = JSON.parse(await readFile(path.join(workerRoot, 'active', 'owner.json'), 'utf8'));
    assert.equal(owner.reservationId, persisted.reservationId);
    assert.deepEqual(
      await readFile(path.join(roots[0].root, 'objects', binding.jobId, 'quarantine', 'data.bin')),
      original,
    );
  }
  // Prototype methods deliberately exercise the accepted real-adapter shape and
  // its receiver binding, rather than only an own-method object double.
  class Coordinator {
    constructor() {
      this.calls = calls;
    }
    async readUploadContext(jobId) {
      this.calls.push('context');
      assert.equal(jobId, binding.jobId);
      return clone(context);
    }
    async captureInput(jobId, value) {
      this.calls.push('capture');
      assert.equal(jobId, binding.jobId);
      assert.deepEqual(value, input);
      await preSql();
      facts.capture = {
        jobId,
        ...{
          generationId: value.generationId,
          inputBytes: value.bytes,
          inputSha256: value.sha256,
          capturedAt: now,
        },
      };
      if (options.fail === 'capture')
        throw options.error ?? new MediaCoordinatorDatabaseError(true);
      return clone(facts.capture);
    }
    async claimProcessing(jobId, claimId) {
      this.calls.push('claim');
      assert.equal(jobId, binding.jobId);
      assert.equal(claimId, binding.claimId);
      await preSql();
      facts.lease = lease();
      if (options.expiredLease) facts.lease.leaseExpiresAt = '2000-01-01T00:00:00.000000Z';
      if (options.fail === 'claim') throw options.error ?? new MediaCoordinatorDatabaseError(true);
      return clone(facts.lease);
    }
    async sealOutput(jobId, value) {
      this.calls.push('seal');
      assert.equal(jobId, binding.jobId);
      assert.equal(value.attempt, facts.lease.attempt);
      assert.equal(value.leaseNonce, facts.lease.leaseNonce);
      const persisted = JSON.parse(
        await readFile(
          path.join(roots[1].root, 'objects', binding.jobId, 'output', 'data.bin'),
          'utf8',
        ),
      );
      assert.deepEqual(persisted.lease, facts.lease);
      assert.deepEqual(persisted.seal, value);
      facts.verified = {
        jobId,
        attempt: value.attempt,
        leaseNonce: value.leaseNonce,
        outputId: context.outputId,
        // A provided opaque database digest: deliberately not JSON.stringify SHA.
        manifestSha256: '7'.repeat(64),
        manifest: clone(value.manifest),
        verifiedAt: now,
        outcome: 'verified',
      };
      if (options.fail === 'seal') throw options.error ?? new MediaCoordinatorDatabaseError(true);
      return clone(facts.verified);
    }
    async readProcessing(jobId) {
      this.calls.push('read');
      assert.equal(jobId, binding.jobId);
      if (options.readError) throw new Error('Simulated read failure');
      const result = {
        jobId,
        state: facts.verified
          ? 'verified'
          : facts.lease
            ? 'processing'
            : facts.capture
              ? 'captured'
              : 'registered',
        ...clone(facts),
      };
      return options.readMutation ? options.readMutation(result) : result;
    }
  }
  const coordinator = new Coordinator(),
    nativeCalls = [];
  const supervisor = {
    async run(request, runOptions) {
      nativeCalls.push({ request, runOptions });
      assert.equal(request.executablePath, process.execPath);
      assert.deepEqual(request.arguments, [entry]);
      assert.equal(request.timeoutMs, 10000);
      assert.equal(request.maxProcesses, 1);
      assert.equal(request.workingDirectory, path.join(attemptParent, binding.jobId));
      assert.deepEqual(
        await readFile(path.join(request.workingDirectory, 'source.input')),
        original,
      );
      if (options.nativeThrow) throw new Error('Simulated supervisor exception');
      const outcome = options.outcome ?? empty();
      if (
        outcome.state === 'exited' &&
        outcome.exitCode === 0 &&
        outcome.termination === 'job_empty'
      ) {
        const header = Buffer.alloc(5);
        header[0] = 0x2f;
        header.writeUInt32LE(2 | (1 << 14), 1);
        const output = webpContainer([riffChunk('VP8L', header)]);
        const manifest = {
          pipeline: 'synthetic-codec-v1',
          sourceFormat: 'png',
          inputSha256: input.sha256,
          inputBytes: input.bytes,
          format: 'webp',
          mimeType: 'image/webp',
          sha256: hash(output),
          width: 3,
          height: 2,
          bytes: output.length,
          encoder: { sharp: '0.35.5', vips: '8.18.7' },
          operations: [
            'auto-orient',
            'resize-inside-1920-without-enlargement',
            'strip-metadata',
            'webp-quality-82-effort-4',
          ],
        };
        await writeFile(
          path.join(request.workingDirectory, 'converted.webp'),
          options.badOutput ? Buffer.from('bad output') : output,
          { flag: 'wx' },
        );
        await writeFile(
          path.join(request.workingDirectory, 'manifest.json'),
          options.oversizedSidecar
            ? Buffer.alloc(4097, 32)
            : Buffer.from(JSON.stringify(manifest) + '\n'),
          { flag: 'wx' },
        );
      }
      return clone(outcome);
    },
  };
  function configuration() {
    return {
      coordinator,
      inputStore,
      requestStore,
      worker,
      journal,
      supervisor,
      nodeExecutablePath: process.execPath,
      codecEntryPath: entry,
    };
  }
  async function processor() {
    const result = await createSyntheticOneAttemptProcessor(configuration());
    processors.add(result);
    return result;
  }
  t.after(async () => {
    for (const controller of processors) await controller.close();
    for (const gate of workers) await gate.close();
    for (const history of journals) await history.close();
    for (const store of stores) await store.close();
    // Every supervisor above is a fixed mock: even a simulated unknown owns no
    // actual process. Known test paths alone may be removed without OS inference.
    for (const name of await readdir(attemptParent)) assert.equal(name, binding.jobId);
    const attempt = path.join(attemptParent, binding.jobId);
    if (await exists(attempt))
      await removeFiles(attempt, ['source.input', 'converted.webp', 'manifest.json']);
    await rmdir(attemptParent);
    assert.deepEqual((await readdir(workerRoot)).filter((name) => name !== 'active').sort(), [
      'history',
      'worker.json',
    ]);
    const active = path.join(workerRoot, 'active');
    if (await exists(active))
      await removeFiles(active, ['owner.json', 'launch.json', 'completion.json']);
    const history = path.join(workerRoot, 'history');
    for (const reservationId of await readdir(history)) {
      assert.match(reservationId, /^[a-f0-9-]{36}$/);
      const envelope = path.join(history, reservationId);
      assert.deepEqual(await readdir(envelope), ['slot']);
      const slot = path.join(envelope, 'slot'),
        owner = JSON.parse(await readFile(path.join(slot, 'owner.json'), 'utf8'));
      assert.equal(owner.jobId, binding.jobId);
      await removeFiles(slot, ['owner.json', 'launch.json', 'completion.json']);
      await rmdir(envelope);
    }
    await rmdir(history);
    const marker = path.join(workerRoot, 'worker.json'),
      ms = await lstat(marker);
    assert.ok(ms.isFile() && !ms.isSymbolicLink() && ms.nlink === 1);
    await unlink(marker);
    await rmdir(workerRoot);
    for (const { root } of roots) {
      assert.equal(path.dirname(root), parent);
      assert.deepEqual((await readdir(root)).sort(), ['objects', 'store.json']);
      const objects = path.join(root, 'objects');
      for (const jobId of await readdir(objects)) assert.equal(jobId, binding.jobId);
      const job = path.join(objects, binding.jobId);
      if (await exists(job)) {
        for (const kind of await readdir(job)) assert.ok(['quarantine', 'output'].includes(kind));
        for (const kind of ['quarantine', 'output']) {
          const directory = path.join(job, kind);
          if (await exists(directory)) await removeFiles(directory, ['data.bin', 'receipt.json']);
        }
        await rmdir(job);
      }
      await rmdir(objects);
      const file = path.join(root, 'store.json'),
        fs = await lstat(file);
      assert.ok(fs.isFile() && !fs.isSymbolicLink() && fs.nlink === 1);
      await unlink(file);
      await rmdir(root);
    }
    assert.deepEqual(await readdir(parent), []);
    await rmdir(parent);
  });
  return {
    parent,
    binding,
    source,
    original,
    input,
    context,
    facts,
    calls,
    nativeCalls,
    coordinator,
    configuration,
    processor,
    get worker() {
      return worker;
    },
    get journal() {
      return journal;
    },
    get inputStore() {
      return inputStore;
    },
    get requestStore() {
      return requestStore;
    },
    async reopen() {
      await worker.close();
      await journal.close();
      await inputStore.close();
      await requestStore.close();
      inputStore = await reopenDurableSyntheticStore(roots[0].root, roots[0].id);
      requestStore = await reopenDurableSyntheticStore(roots[1].root, roots[1].id);
      journalStore = await reopenDurableSyntheticStore(roots[2].root, roots[2].id);
      for (const store of [inputStore, requestStore, journalStore]) stores.add(store);
      journal = await createSyntheticAttemptJournal({ store: journalStore, attemptParent });
      journals.add(journal);
      worker = await reopenSyntheticWorkerAdmission({
        rootDirectory: workerRoot,
        workerId,
        journal,
      });
      workers.add(worker);
      return processor();
    },
    counts() {
      return Object.fromEntries(
        ['context', 'capture', 'claim', 'seal', 'read'].map((name) => [
          name,
          calls.filter((value) => value === name).length,
        ]),
      );
    },
  };
}

test('one explicit run persists original facts before SQL writes, snapshots bytes and uses each command/native attempt once', async (t) => {
  const f = await fixture(t),
    processor = await f.processor(),
    input = { ...f.binding, input: f.source },
    pending = processor.run(input);
  f.source.fill(0);
  input.claimId = id(99901);
  await assert.rejects(processor.run({ ...f.binding, input: f.original }), code('BUSY'));
  const result = await pending;
  assert.equal(result.state, 'verified');
  assert.deepEqual(result.reconciled, []);
  assert.ok(
    Object.isFrozen(result) &&
      Object.isFrozen(result.request) &&
      Object.isFrozen(result.lease) &&
      Object.isFrozen(result.receipt) &&
      Object.isFrozen(result.reconciled),
  );
  assert.equal(result.request.claimId, f.binding.claimId);
  assert.deepEqual(result.request.input, f.input);
  assert.deepEqual(result.lease, f.facts.lease);
  assert.equal(result.receipt.manifestSha256, '7'.repeat(64));
  assert.equal(result.outputRef.generationId, result.lease.leaseNonce);
  assert.deepEqual(f.counts(), { context: 1, capture: 1, claim: 1, seal: 1, read: 1 });
  assert.equal(f.nativeCalls.length, 1);
  assert.equal((await f.worker.inspect()).state, 'idle');
  await assert.rejects(processor.run({ ...f.binding, input: f.original }), code('BLOCKED'));
  assert.equal(f.nativeCalls.length, 1);
});

test('known uncertain capture, claim or seal acknowledgements reconcile exact original facts without repeating any write', async (t) => {
  for (const stage of ['capture', 'claim', 'seal']) {
    const f = await fixture(t, { fail: stage }),
      processor = await f.processor(),
      result = await processor.run({ ...f.binding, input: f.source });
    assert.equal(result.state, 'verified');
    assert.deepEqual(result.reconciled, [stage]);
    assert.equal(f.nativeCalls.length, 1);
    assert.deepEqual(f.counts(), { context: 1, capture: 1, claim: 1, seal: 1, read: 2 });
    assert.deepEqual(result.lease, f.facts.lease);
    assert.equal((await f.worker.inspect()).state, 'idle');
  }
});

test('missing, conflicting and superseded uncertain original command facts block instead of retrying or adopting another lease', async (t) => {
  const cases = [
    ['capture', (view) => ({ ...view, capture: null, state: 'registered' })],
    ['capture', (view) => ({ ...view, capture: { ...view.capture, generationId: id(99902) } })],
    ['claim', (view) => ({ ...view, lease: null, state: 'captured' })],
    [
      'claim',
      (view) => ({
        ...view,
        lease: { ...view.lease, claimId: id(99903), attempt: 2, leaseNonce: id(99904) },
      }),
    ],
    ['seal', (view) => ({ ...view, verified: null, state: 'processing' })],
    [
      'seal',
      (view) =>
        view.verified
          ? {
              ...view,
              verified: {
                ...view.verified,
                manifest: { ...view.verified.manifest, sha256: 'e'.repeat(64) },
              },
            }
          : view,
    ],
    // The mandatory read before launch detects a superseded original lease even
    // when the configured write fault would otherwise occur only at seal time.
    [
      'seal',
      (view) => ({ ...view, lease: { ...view.lease, claimId: id(99907) } }),
      { writes: 0, native: 0, reads: 1 },
    ],
  ];
  for (const [fail, readMutation, expectation] of cases) {
    const f = await fixture(t, { fail, readMutation }),
      processor = await f.processor();
    await assert.rejects(processor.run({ ...f.binding, input: f.source }), code('BLOCKED'));
    const expected = expectation ?? {
        writes: 1,
        native: fail === 'seal' ? 1 : 0,
        reads: fail === 'seal' ? 2 : 1,
      },
      counts = f.counts();
    assert.equal(counts[fail], expected.writes);
    assert.equal(counts.read, expected.reads);
    assert.ok(['capture', 'claim', 'seal'].every((name) => counts[name] <= 1));
    assert.equal(f.nativeCalls.length, expected.native);
    if (expected.native === 0) assert.equal(counts.seal, 0);
    assert.equal((await f.worker.inspect()).state, 'idle');
    await assert.rejects(processor.run({ ...f.binding, input: f.source }), code('BLOCKED'));
  }
});

test('only the typed uncertain-write error permits readback; generic and confirmed-failure errors never trigger implicit retry', async (t) => {
  for (const error of [
    new Error('Simulated command failure'),
    new MediaCoordinatorDatabaseError(false),
    { commitUncertain: true },
  ]) {
    const f = await fixture(t, { fail: 'capture', error }),
      processor = await f.processor();
    await assert.rejects(processor.run({ ...f.binding, input: f.source }), code('BLOCKED'));
    assert.deepEqual(f.counts(), { context: 1, capture: 1, claim: 0, seal: 0, read: 0 });
    assert.equal(f.nativeCalls.length, 0);
    assert.equal((await f.worker.inspect()).state, 'idle');
  }
});

test('expired exact original leases and failed uncertainty readback never become fresh native launch authority', async (t) => {
  for (const options of [
    { fail: 'claim', expiredLease: true },
    { fail: 'claim', readError: true },
    { expiredLease: true },
  ]) {
    const f = await fixture(t, options),
      processor = await f.processor();
    await assert.rejects(processor.run({ ...f.binding, input: f.source }), code('BLOCKED'));
    assert.equal(f.nativeCalls.length, 0);
    assert.equal(f.counts().claim, 1);
    assert.equal(f.counts().seal, 0);
    assert.equal((await f.worker.inspect()).state, 'idle');
  }
});

test('reopened original request/lease/output facts reconcile read-only and never restart, promote or reconstruct authority', async (t) => {
  const f = await fixture(t),
    processor = await f.processor(),
    result = await processor.run({ ...f.binding, input: f.source });
  await processor.close();
  const reopened = await f.reopen(),
    before = f.counts(),
    historical = await reopened.reconcile(f.binding);
  assert.equal(historical.state, 'verified');
  assert.deepEqual(historical.request, result.request);
  assert.deepEqual(historical.lease, result.lease);
  assert.deepEqual(historical.receipt, result.receipt);
  assert.equal(Object.hasOwn(historical, 'ticket'), false);
  assert.equal(Object.hasOwn(historical, 'permit'), false);
  assert.equal(Object.hasOwn(historical, 'outputRef'), false);
  assert.equal(f.nativeCalls.length, 1);
  assert.deepEqual(f.counts(), { ...before, read: before.read + 1 });
  assert.equal((await f.worker.inspect()).state, 'idle');
  await assert.rejects(reopened.run({ ...f.binding, input: f.source }), code('BLOCKED'));
  assert.equal(f.nativeCalls.length, 1);
  assert.equal(f.counts().capture, 1);
  assert.equal(f.counts().claim, 1);
  assert.equal(f.counts().seal, 1);
});

test('reopened missing or superseded original claims remain unconfirmed without issuing any new command', async (t) => {
  for (const superseded of [false, true]) {
    const options = { fail: 'claim', readError: true },
      f = await fixture(t, options),
      processor = await f.processor();
    await assert.rejects(processor.run({ ...f.binding, input: f.source }), code('BLOCKED'));
    options.readError = false;
    if (superseded)
      f.facts.lease = { ...f.facts.lease, claimId: id(99905), attempt: 2, leaseNonce: id(99906) };
    else f.facts.lease = null;
    await processor.close();
    const reopened = await f.reopen(),
      before = f.counts(),
      result = await reopened.reconcile(f.binding);
    assert.equal(result.state, 'blocked');
    assert.equal(result.reason, 'UNCONFIRMED');
    assert.equal(result.request.claimId, f.binding.claimId);
    assert.deepEqual(f.counts(), { ...before, read: before.read + 1 });
    assert.equal(f.nativeCalls.length, 0);
    assert.equal((await f.worker.inspect()).state, 'idle');
    assert.equal(Object.hasOwn(result, 'ticket'), false);
    assert.equal(Object.hasOwn(result, 'permit'), false);
  }
});

test('partial persisted seal plus SQL processing facts stays unconfirmed across reopen instead of looking ready to continue', async (t) => {
  const options = { fail: 'claim', readError: true },
    f = await fixture(t, options),
    processor = await f.processor();
  await assert.rejects(processor.run({ ...f.binding, input: f.source }), code('BLOCKED'));
  options.readError = false;
  const partial = path.join(f.requestStore.rootDirectory, 'objects', f.binding.jobId, 'output');
  await mkdir(partial);
  await processor.close();
  const reopened = await f.reopen(),
    before = f.counts(),
    result = await reopened.reconcile(f.binding);
  assert.equal(result.state, 'blocked');
  assert.equal(result.reason, 'UNCONFIRMED');
  assert.equal(result.request.claimId, f.binding.claimId);
  assert.deepEqual(f.counts(), { ...before, read: before.read + 1 });
  assert.equal(f.nativeCalls.length, 0);
  assert.deepEqual(await readdir(partial), []);
  assert.equal((await f.worker.inspect()).state, 'idle');
});

test('simulated failed, timed_out and cancelled empty outcomes release capacity without output installation or seal', async (t) => {
  for (const state of ['failed', 'timed_out', 'cancelled']) {
    const outcome = {
        state,
        termination: 'job_empty',
        exitCode: null,
        activeProcesses: 0,
        safeCode: state.toUpperCase(),
      },
      f = await fixture(t, { outcome }),
      processor = await f.processor();
    assert.deepEqual(await processor.run({ ...f.binding, input: f.source }), {
      state: 'native_failed',
      outcome,
    });
    assert.equal(f.nativeCalls.length, 1);
    assert.equal(f.counts().seal, 0);
    assert.equal((await f.worker.inspect()).state, 'idle');
    assert.equal(
      await exists(path.join(f.inputStore.rootDirectory, 'objects', f.binding.jobId, 'output')),
      null,
    );
  }
});

test('simulated unknown, thrown and malformed native outcomes retain the global worker and never read/promote output', async (t) => {
  for (const options of [
    { outcome: unknown() },
    { nativeThrow: true },
    { outcome: { ...empty(), activeProcesses: 1 } },
  ]) {
    const f = await fixture(t, options),
      processor = await f.processor();
    await assert.rejects(processor.run({ ...f.binding, input: f.source }), code('BLOCKED'));
    assert.equal(f.nativeCalls.length, 1);
    assert.equal(f.counts().seal, 0);
    assert.equal((await f.worker.inspect()).state, 'blocked');
    assert.equal(
      await exists(path.join(f.inputStore.rootDirectory, 'objects', f.binding.jobId, 'output')),
      null,
    );
    const binding = {
      jobId: f.binding.jobId,
      claimId: f.binding.claimId,
      attempt: f.facts.lease.attempt,
      leaseNonce: f.facts.lease.leaseNonce,
    };
    assert.equal((await f.journal.inspect(binding)).reason, 'CONTAINMENT_UNKNOWN');
    await processor.close();
    const reopened = await f.reopen();
    assert.equal((await f.worker.inspect()).state, 'blocked');
    await assert.rejects(reopened.run({ ...f.binding, input: f.source }), code('BLOCKED'));
    assert.equal(f.nativeCalls.length, 1);
    assert.equal(f.counts().capture, 1);
    assert.equal(f.counts().claim, 1);
  }
});

test('known empty success still requires bounded independent byte/sidecar readback before output install or seal', async (t) => {
  for (const options of [{ badOutput: true }, { oversizedSidecar: true }]) {
    const f = await fixture(t, options),
      processor = await f.processor();
    await assert.rejects(processor.run({ ...f.binding, input: f.source }), (error) =>
      ['BLOCKED', 'INTEGRITY'].includes(error?.code),
    );
    assert.equal(f.nativeCalls.length, 1);
    assert.equal(f.counts().seal, 0);
    assert.equal((await f.worker.inspect()).state, 'idle');
    assert.equal(
      await exists(path.join(f.inputStore.rootDirectory, 'objects', f.binding.jobId, 'output')),
      null,
    );
    assert.equal(
      await exists(path.join(f.requestStore.rootDirectory, 'objects', f.binding.jobId, 'output')),
      null,
    );
  }
});

test('invalid own-data inputs and pre-aborted signals produce no command work, while close rejects subsequent work', async (t) => {
  const f = await fixture(t),
    processor = await f.processor();
  let getters = 0;
  const input = { ...f.binding, input: f.source },
    accessor = { ...input };
  Object.defineProperty(accessor, 'jobId', {
    enumerable: true,
    get() {
      getters++;
      return f.binding.jobId;
    },
  });
  for (const value of [
    null,
    [],
    { ...input, extra: true },
    { ...input, [Symbol('hidden')]: true },
    accessor,
    { ...input, input: Buffer.alloc(0) },
    { ...input, input: Buffer.alloc(10485761) },
    { ...input, input: Buffer.from(new SharedArrayBuffer(10)) },
  ])
    await assert.rejects(processor.run(value), code('INVALID_INPUT'));
  assert.equal(getters, 0);
  assert.deepEqual(f.counts(), { context: 0, capture: 0, claim: 0, seal: 0, read: 0 });
  assert.equal(f.nativeCalls.length, 0);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(processor.run(input, { signal: abort.signal }), code('BLOCKED'));
  assert.deepEqual(f.counts(), { context: 0, capture: 0, claim: 0, seal: 0, read: 0 });
  assert.equal((await f.worker.inspect()).state, 'idle');
  await processor.close();
  await processor.close();
  await assert.rejects(processor.run(input), code('CLOSED'));
  await assert.rejects(processor.reconcile(f.binding), code('CLOSED'));
});

test('trusted capabilities are snapshotted, accessor signals are rejected early and close drains one admitted run', async (t) => {
  const f = await fixture(t);
  let getters = 0;
  const configuration = f.configuration(),
    accessor = { ...configuration };
  Object.defineProperty(accessor, 'coordinator', {
    enumerable: true,
    get() {
      getters++;
      return f.coordinator;
    },
  });
  await assert.rejects(createSyntheticOneAttemptProcessor(accessor), code('INVALID_CONFIGURATION'));
  assert.equal(getters, 0);
  const processor = await f.processor(),
    input = { ...f.binding, input: f.source },
    badSignal = {};
  Object.defineProperty(badSignal, 'aborted', {
    enumerable: true,
    get() {
      getters++;
      return false;
    },
  });
  await assert.rejects(processor.run(input, { signal: badSignal }), code('INVALID_INPUT'));
  assert.equal(getters, 0);
  assert.deepEqual(f.counts(), { context: 0, capture: 0, claim: 0, seal: 0, read: 0 });
  assert.equal(f.nativeCalls.length, 0);
  f.coordinator.captureInput = async () => {
    throw new Error('Changed capability must not be called');
  };
  configuration.supervisor.run = async () => {
    throw new Error('Changed capability must not be called');
  };
  const running = processor.run(input),
    closing = processor.close();
  await assert.rejects(processor.reconcile(f.binding), code('CLOSED'));
  const result = await running;
  await closing;
  assert.equal(result.state, 'verified');
  assert.equal(f.nativeCalls.length, 1);
  // Dependencies remain caller owned and inspectable after processor.close.
  assert.equal((await f.worker.inspect()).state, 'idle');
  assert.equal(
    (await f.inputStore.read(result.outputRef)).receipt.sha256,
    result.receipt.manifest.sha256,
  );
});
