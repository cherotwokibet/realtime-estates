import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, lstat, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDurableSyntheticStore,
  reopenDurableSyntheticStore,
} from '@realtor/media/durable-store';
import { createSyntheticAttemptJournal } from '@realtor/media/attempt-journal';
import {
  createSyntheticWorkerAdmission,
  reopenSyntheticWorkerAdmission,
} from '@realtor/media/worker-admission';
import { createSyntheticOneAttemptProcessor } from '@realtor/media/one-attempt';
import { syntheticPng } from './fixtures.mjs';
import { environment, boundedRead, WINDOWS_ONLY } from './coordinator-fixture.mjs';

// Explicit owned fixture cleanup; no recursive deletion or production sweeper.
async function removeStore(root, parent, jobId) {
  assert.equal(path.dirname(root), parent);
  assert.deepEqual((await readdir(root)).sort(), ['objects', 'store.json']);
  const objects = path.join(root, 'objects');
  assert.deepEqual(await readdir(objects), [jobId]);
  const job = path.join(objects, jobId);
  for (const kind of await readdir(job)) {
    assert.ok(['quarantine', 'output'].includes(kind));
    const directory = path.join(job, kind);
    assert.ok((await lstat(directory)).isDirectory());
    for (const name of await readdir(directory)) {
      assert.ok(['data.bin', 'receipt.json'].includes(name));
      const target = path.join(directory, name),
        stat = await lstat(target);
      assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
      await unlink(target);
    }
    await rmdir(directory);
  }
  await rmdir(job);
  await rmdir(objects);
  await unlink(path.join(root, 'store.json'));
  await rmdir(root);
}

test(
  'one explicit workflow persists request before SQL and joins real Windows codec, immutable history and restricted SQL',
  WINDOWS_ONLY,
  async (t) => {
    const e = await environment(t),
      parent = await mkdtemp(path.join(tmpdir(), 'realtor one attempt '));
    let photos,
      requests,
      journalStore,
      journal,
      worker,
      processor,
      safeToClean = true;
    const roots = [];
    let workerRoot;
    t.after(async () => {
      await processor?.close();
      await worker?.close();
      await journal?.close();
      await photos?.close();
      await requests?.close();
      if (!safeToClean) {
        t.diagnostic(`Unknown native outcome retained with workflow roots: ${parent}`);
        return;
      }
      if (workerRoot) {
        assert.equal(path.dirname(workerRoot), parent);
        assert.deepEqual((await readdir(workerRoot)).sort(), ['history', 'worker.json']);
        const history = path.join(workerRoot, 'history');
        for (const name of await readdir(history)) {
          assert.match(name, /^[0-9a-f-]{36}$/);
          const envelope = path.join(history, name);
          assert.deepEqual(await readdir(envelope), ['slot']);
          const slot = path.join(envelope, 'slot'),
            completion = JSON.parse(
              (await boundedRead(slot, 'completion.json', 4096)).toString('utf8'),
            );
          assert.ok(['job_empty', 'not_launched'].includes(completion.state));
          assert.deepEqual(
            (await readdir(slot)).sort(),
            completion.state === 'job_empty'
              ? ['completion.json', 'launch.json', 'owner.json']
              : ['completion.json', 'owner.json'],
          );
          for (const file of await readdir(slot)) {
            const target = path.join(slot, file),
              stat = await lstat(target);
            assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
            await unlink(target);
          }
          await rmdir(slot);
          await rmdir(envelope);
        }
        await rmdir(history);
        await unlink(path.join(workerRoot, 'worker.json'));
        await rmdir(workerRoot);
      }
      for (const root of roots) await removeStore(root, parent, e.jobId);
      await rmdir(parent);
    });
    photos = await createDurableSyntheticStore(parent);
    roots.push(photos.rootDirectory);
    requests = await createDurableSyntheticStore(parent);
    roots.push(requests.rootDirectory);
    journalStore = await createDurableSyntheticStore(parent);
    roots.push(journalStore.rootDirectory);
    const photoId = photos.storeId,
      requestId = requests.storeId,
      journalId = journalStore.storeId;
    journal = await createSyntheticAttemptJournal({
      store: journalStore,
      attemptParent: e.attemptParent,
    });
    worker = await createSyntheticWorkerAdmission({ parentDirectory: parent, journal });
    workerRoot = worker.rootDirectory;
    const workerId = worker.workerId;
    const claimId = randomUUID(),
      generationId = randomUUID(),
      input = syntheticPng(43, 31, (x, y) => [x * 5, y * 7, 80, 255]);
    const counts = { capture: 0, claim: 0, seal: 0, native: 0 };
    let nativeOutcome;
    const coordinator = {
      readUploadContext: e.coordinator.readUploadContext.bind(e.coordinator),
      readProcessing: e.coordinator.readProcessing.bind(e.coordinator),
      async captureInput(jobId, captured) {
        counts.capture++;
        const stored = await requests.read({
          jobId,
          objectId: claimId,
          generationId,
          kind: 'quarantine',
        });
        const original = JSON.parse(stored.data.toString('utf8'));
        assert.equal(original.jobId, jobId);
        assert.equal(original.claimId, claimId);
        assert.deepEqual(original.input, captured);
        return e.coordinator.captureInput(jobId, captured);
      },
      async claimProcessing(...args) {
        counts.claim++;
        return e.coordinator.claimProcessing(...args);
      },
      async sealOutput(...args) {
        counts.seal++;
        return e.coordinator.sealOutput(...args);
      },
    };
    const entry = fileURLToPath(new URL('../dist/codec-worker.js', import.meta.url));
    const supervisor = {
      async run(request) {
        counts.native++;
        assert.equal(request.executablePath, process.execPath);
        assert.deepEqual(request.arguments, [entry]);
        assert.equal(request.maxProcesses, 1);
        assert.equal(path.dirname(request.workingDirectory), e.attemptParent);
        safeToClean = false;
        const outcome = await e.run(request.workingDirectory);
        safeToClean = outcome.termination === 'job_empty' && outcome.activeProcesses === 0;
        nativeOutcome = outcome;
        return outcome;
      },
    };
    const config = () => ({
      coordinator,
      inputStore: photos,
      requestStore: requests,
      worker,
      journal,
      supervisor,
      nodeExecutablePath: process.execPath,
      codecEntryPath: entry,
    });
    processor = await createSyntheticOneAttemptProcessor(config());
    const result = await processor.run({ jobId: e.jobId, claimId, generationId, input });
    assert.equal(result.state, 'verified');
    assert.deepEqual(counts, { capture: 1, claim: 1, seal: 1, native: 1 });
    const final = await e.coordinator.readProcessing(e.jobId);
    assert.equal(final.state, 'verified');
    assert.equal(final.lease.claimId, claimId);
    assert.equal(final.lease.attempt, 1);
    assert.equal(final.capture.generationId, generationId);
    assert.equal(final.verified.leaseNonce, final.lease.leaseNonce);
    const output = await photos.read({
      jobId: e.jobId,
      objectId: final.verified.outputId,
      generationId: final.lease.leaseNonce,
      kind: 'output',
    });
    assert.equal(output.receipt.sha256, final.verified.manifest.sha256);
    assert.equal(output.receipt.bytes, final.verified.manifest.bytes);
    assert.equal((await worker.inspect()).state, 'idle');
    const owner = {
      version: 1,
      workerId,
      journalId,
      jobId: e.jobId,
      claimId,
      reservationId: result.request.reservationId,
    };
    const binding = {
      jobId: e.jobId,
      claimId,
      attempt: final.lease.attempt,
      leaseNonce: final.lease.leaseNonce,
    };
    const recorded = await journal.inspect(binding);
    assert.equal(recorded.state, 'termination_recorded');
    assert.deepEqual(recorded.terminal.outcome, nativeOutcome);
    const archived = path.join(workerRoot, 'history', owner.reservationId, 'slot');
    for (const [filename, expected] of Object.entries({
      'owner.json': owner,
      'launch.json': { owner, intent: recorded.intent },
      'completion.json': { owner, state: 'job_empty', terminal: recorded.terminal },
    })) {
      const bytes = await boundedRead(archived, filename, 4096);
      assert.equal(bytes.toString('utf8'), JSON.stringify(expected) + '\n');
    }
    await assert.rejects(() => processor.run({ jobId: e.jobId, claimId, generationId, input }));
    await processor.close();
    await worker.close();
    await journal.close();
    await photos.close();
    await requests.close();
    photos = await reopenDurableSyntheticStore(roots[0], photoId);
    requests = await reopenDurableSyntheticStore(roots[1], requestId);
    journalStore = await reopenDurableSyntheticStore(roots[2], journalId);
    journal = await createSyntheticAttemptJournal({
      store: journalStore,
      attemptParent: e.attemptParent,
    });
    worker = await reopenSyntheticWorkerAdmission({ rootDirectory: workerRoot, workerId, journal });
    processor = await createSyntheticOneAttemptProcessor(config());
    const historical = await processor.reconcile({ jobId: e.jobId, claimId, generationId });
    assert.equal(historical.state, 'verified');
    assert.deepEqual(counts, { capture: 1, claim: 1, seal: 1, native: 1 });
    await assert.rejects(() => processor.run({ jobId: e.jobId, claimId, generationId, input }));
    assert.deepEqual(counts, { capture: 1, claim: 1, seal: 1, native: 1 });
    assert.equal((await worker.inspect()).state, 'idle');
    const histories = await readdir(path.join(workerRoot, 'history'));
    assert.equal(histories.length, 2);
    const blockedReplay = histories.find((id) => id !== owner.reservationId);
    assert.ok(blockedReplay);
    const notLaunched = JSON.parse(
      (
        await boundedRead(
          path.join(workerRoot, 'history', blockedReplay, 'slot'),
          'completion.json',
          4096,
        )
      ).toString('utf8'),
    );
    assert.equal(notLaunched.state, 'not_launched');
    assert.equal(notLaunched.owner.jobId, e.jobId);
    assert.equal(notLaunched.owner.claimId, claimId);
    await e.inspectUnchanged(1);
    // PGlite remains alive throughout. Reopening yields facts, never a launch permit.
  },
);
