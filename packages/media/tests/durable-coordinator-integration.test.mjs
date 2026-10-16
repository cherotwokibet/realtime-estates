import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, lstat, unlink, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDurableSyntheticStore,
  reopenDurableSyntheticStore,
} from '@realtor/media/durable-store';
import { createSyntheticAttemptJournal } from '@realtor/media/attempt-journal';
import {
  createSyntheticWorkerAdmission,
  reopenSyntheticWorkerAdmission,
} from '@realtor/media/worker-admission';
import { verifySyntheticProcessReadback } from '@realtor/media/process-readback';
import { syntheticPng } from './fixtures.mjs';
import { environment, boundedRead, WINDOWS_ONLY } from './coordinator-fixture.mjs';

// Narrow process-to-storage integration. Private SQL object IDs come from the
// reviewed fixed command under the isolated coordinator login, never public API.
test(
  'persistent worker admission and reopened history/bytes reconcile actual supervised output with restricted SQL facts',
  WINDOWS_ONLY,
  async (t) => {
    const e = await environment(t),
      parent = await mkdtemp(path.join(tmpdir(), 'realtor durable SQL '));
    let store,
      root,
      storeId,
      journal,
      journalStore,
      journalRoot,
      journalId,
      worker,
      workerRoot,
      workerId,
      safeToClean = true;
    t.after(async () => {
      if (!safeToClean || !store || !root) {
        t.diagnostic(`Durable synthetic objects retained: ${parent}`);
        return;
      }
      await worker?.close();
      await journal?.close();
      await store.close();
      if (workerRoot) {
        assert.equal(path.dirname(workerRoot), parent);
        assert.deepEqual((await readdir(workerRoot)).sort(), ['history', 'worker.json']);
        const history = path.join(workerRoot, 'history');
        for (const name of await readdir(history)) {
          assert.match(name, /^[0-9a-f-]{36}$/);
          const envelope = path.join(history, name);
          assert.deepEqual(await readdir(envelope), ['slot']);
          const slot = path.join(envelope, 'slot');
          const files = await readdir(slot);
          assert.ok(files.includes('owner.json') && files.includes('completion.json'));
          for (const file of files) {
            assert.ok(['owner.json', 'launch.json', 'completion.json'].includes(file));
            const target = path.join(slot, file),
              s = await lstat(target);
            assert.ok(s.isFile() && !s.isSymbolicLink() && s.nlink === 1);
            await unlink(target);
          }
          await rmdir(slot);
          await rmdir(envelope);
        }
        await rmdir(history);
        const marker = path.join(workerRoot, 'worker.json'),
          s = await lstat(marker);
        assert.ok(s.isFile() && !s.isSymbolicLink() && s.nlink === 1);
        await unlink(marker);
        await rmdir(workerRoot);
      }
      // Explicit owned fixture cleanup only; never a retained-object sweep.
      for (const ownedRoot of [root, journalRoot].filter(Boolean)) {
        assert.equal(path.dirname(ownedRoot), parent);
        assert.deepEqual((await readdir(ownedRoot)).sort(), ['objects', 'store.json']);
        const objects = path.join(ownedRoot, 'objects');
        assert.deepEqual(await readdir(objects), [e.jobId]);
        const job = path.join(objects, e.jobId);
        for (const kind of await readdir(job)) {
          assert.ok(['quarantine', 'output'].includes(kind));
          const directory = path.join(job, kind);
          const stat = await lstat(directory);
          assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
          for (const name of await readdir(directory)) {
            assert.ok(['data.bin', 'receipt.json'].includes(name));
            const file = path.join(directory, name),
              s = await lstat(file);
            assert.ok(s.isFile() && !s.isSymbolicLink() && s.nlink === 1);
            await unlink(file);
          }
          await rmdir(directory);
        }
        await rmdir(job);
        await rmdir(objects);
        const marker = path.join(ownedRoot, 'store.json'),
          markerStat = await lstat(marker);
        assert.ok(markerStat.isFile() && !markerStat.isSymbolicLink() && markerStat.nlink === 1);
        await unlink(marker);
        await rmdir(ownedRoot);
      }
      await rmdir(parent);
    });
    store = await createDurableSyntheticStore(parent);
    root = store.rootDirectory;
    storeId = store.storeId;
    journalStore = await createDurableSyntheticStore(parent);
    journalRoot = journalStore.rootDirectory;
    journalId = journalStore.storeId;
    journal = await createSyntheticAttemptJournal({
      store: journalStore,
      attemptParent: e.attemptParent,
    });
    worker = await createSyntheticWorkerAdmission({ parentDirectory: parent, journal });
    workerRoot = worker.rootDirectory;
    workerId = worker.workerId;
    const claimId = randomUUID(),
      slot = await worker.reserve({ jobId: e.jobId, claimId });
    const input = syntheticPng(41, 29, (x, y) => [x * 5, y * 8, 60, 255]);
    const inputRef = {
      jobId: e.jobId,
      objectId: e.storageIds.quarantineId,
      generationId: randomUUID(),
      kind: 'quarantine',
    };
    const captured = await store.install(inputRef, input);
    await e.coordinator.captureInput(e.jobId, {
      generationId: captured.generationId,
      bytes: captured.bytes,
      sha256: captured.sha256,
    });
    await store.close();
    store = await reopenDurableSyntheticStore(root, storeId);
    const recoveredInput = await store.read(inputRef),
      before = await e.coordinator.readProcessing(e.jobId);
    assert.deepEqual(recoveredInput.receipt, captured);
    assert.deepEqual(recoveredInput.data, input);
    assert.equal(before.capture.generationId, captured.generationId);
    assert.equal(before.capture.inputBytes, captured.bytes);
    assert.equal(before.capture.inputSha256, captured.sha256);
    const lease = await e.coordinator.claimProcessing(e.jobId, claimId);
    assert.equal(lease.quarantineId, inputRef.objectId);
    assert.equal(lease.outputId, e.storageIds.outputId);
    const binding = {
      jobId: e.jobId,
      claimId: lease.claimId,
      attempt: lease.attempt,
      leaseNonce: lease.leaseNonce,
    };
    const reservation = await journal.reserve(binding);
    assert.equal((await journal.inspect(binding)).state, 'blocked');
    const attemptDirectory = reservation.intent.attemptDirectory;
    await writeFile(path.join(attemptDirectory, 'source.input'), recoveredInput.data, {
      flag: 'wx',
      mode: 0o600,
    });
    await worker.arm(slot.permit, reservation);
    assert.equal((await worker.inspect()).state, 'blocked');
    safeToClean = false;
    const outcome = await e.run(attemptDirectory);
    safeToClean = outcome.termination === 'job_empty' && outcome.activeProcesses === 0;
    assert.equal(outcome.exitCode, 0);
    const completion = await worker.confirmTermination(slot.permit, outcome);
    assert.equal(completion.state, 'job_empty');
    const terminal = completion.terminal;
    assert.deepEqual(terminal.outcome, outcome);
    assert.equal((await worker.inspect()).state, 'idle');
    await worker.close();
    await journal.close();
    journalStore = await reopenDurableSyntheticStore(journalRoot, journalId);
    journal = await createSyntheticAttemptJournal({
      store: journalStore,
      attemptParent: e.attemptParent,
    });
    worker = await reopenSyntheticWorkerAdmission({ rootDirectory: workerRoot, workerId, journal });
    assert.equal((await worker.inspect()).state, 'idle');
    await assert.rejects(
      () => worker.releaseBeforeLaunch(slot.permit),
      (error) => error.code === 'INVALID_PERMIT',
    );
    const next = await worker.reserve({ jobId: randomUUID(), claimId: randomUUID() });
    assert.equal((await worker.releaseBeforeLaunch(next.permit)).state, 'not_launched');
    const recorded = await journal.inspect(binding);
    assert.equal(recorded.state, 'termination_recorded');
    assert.deepEqual(recorded.terminal, terminal);
    await assert.rejects(
      () => journal.reserve(binding),
      (error) => error.code === 'BLOCKED',
    );
    const output = await boundedRead(attemptDirectory, 'converted.webp', 10 * 1024 * 1024),
      sidecar = await boundedRead(attemptDirectory, 'manifest.json', 4096);
    const verified = verifySyntheticProcessReadback(recoveredInput.data, output, sidecar);
    const outputRef = {
      jobId: e.jobId,
      objectId: lease.outputId,
      generationId: lease.leaseNonce,
      kind: 'output',
    };
    const installed = await store.install(outputRef, verified.data);
    assert.equal(installed.bytes, verified.manifest.bytes);
    assert.equal(installed.sha256, verified.manifest.sha256);
    await store.close();
    store = await reopenDurableSyntheticStore(root, storeId);
    const recoveredOutput = await store.read(outputRef);
    assert.deepEqual(recoveredOutput.receipt, installed);
    assert.deepEqual(recoveredOutput.data, output);
    const seal = {
      attempt: lease.attempt,
      leaseNonce: lease.leaseNonce,
      manifest: verified.manifest,
    };
    const sealed = await e.coordinator.sealOutput(e.jobId, seal);
    await store.close();
    store = await reopenDurableSyntheticStore(root, storeId);
    const final = await e.coordinator.readProcessing(e.jobId),
      finalInput = await store.read(inputRef),
      finalOutput = await store.read(outputRef);
    assert.equal(final.state, 'verified');
    assert.deepEqual(final.verified, sealed);
    assert.equal(finalInput.receipt.sha256, sealed.manifest.inputSha256);
    assert.equal(finalInput.receipt.bytes, sealed.manifest.inputBytes);
    assert.equal(finalOutput.receipt.sha256, sealed.manifest.sha256);
    assert.equal(finalOutput.receipt.bytes, sealed.manifest.bytes);
    assert.deepEqual(await store.install(outputRef, output), installed);
    await assert.rejects(
      () => store.install({ ...outputRef, generationId: randomUUID() }, output),
      (error) => error.code === 'CONFLICT',
    );
    assert.deepEqual(await e.coordinator.sealOutput(e.jobId, seal), sealed);
    await e.inspectUnchanged(1);
    // No decoder relaunch occurs on reopen. A recorded observation confers no
    // output/cleanup authority: actual native accounting plus independent readback
    // above are still required. PGlite stays alive; no DB crash/restore is proved.
  },
);
