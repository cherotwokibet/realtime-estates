import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, lstat, unlink, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDurableSyntheticStore, reopenDurableSyntheticStore } from '@realtor/media/durable-store';
import { verifySyntheticProcessReadback } from '@realtor/media/process-readback';
import { syntheticPng } from './fixtures.mjs';
import { environment, boundedRead, WINDOWS_ONLY } from './coordinator-fixture.mjs';

// Narrow process-to-storage integration. Private SQL object IDs below come from
// trusted migration-owner fixture setup, not a new runtime/public lookup grant.
test('restart-readable stored identities reconcile actual supervised output and historical restricted SQL facts',WINDOWS_ONLY,async t=>{
  const e=await environment(t),parent=await mkdtemp(path.join(tmpdir(),'realtor durable SQL '));
  let store,root,storeId,safeToClean=true;
  t.after(async()=>{
    if(!safeToClean||!store||!root){t.diagnostic(`Durable synthetic objects retained: ${parent}`);return;}
    await store.close();
    assert.equal(path.dirname(root),parent);
    // Explicit owned fixture cleanup only; never a retained-object sweep.
    assert.deepEqual((await readdir(root)).sort(),['objects','store.json']);
    const objects=path.join(root,'objects');assert.deepEqual(await readdir(objects),[e.jobId]);
    const job=path.join(objects,e.jobId);
    for(const kind of await readdir(job)){
      assert.ok(['quarantine','output'].includes(kind));const directory=path.join(job,kind);
      const stat=await lstat(directory);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());
      for(const name of await readdir(directory)){
        assert.ok(['data.bin','receipt.json'].includes(name));const file=path.join(directory,name),s=await lstat(file);
        assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1);await unlink(file);
      }
      await rmdir(directory);
    }
    await rmdir(job);await rmdir(objects);
    const marker=path.join(root,'store.json'),markerStat=await lstat(marker);assert.ok(markerStat.isFile()&&!markerStat.isSymbolicLink()&&markerStat.nlink===1);await unlink(marker);
    await rmdir(root);await rmdir(parent);
  });
  store=await createDurableSyntheticStore(parent);root=store.rootDirectory;storeId=store.storeId;
  const input=syntheticPng(41,29,(x,y)=>[x*5,y*8,60,255]);
  const inputRef={jobId:e.jobId,objectId:e.storageIds.quarantineId,generationId:randomUUID(),kind:'quarantine'};
  const captured=await store.install(inputRef,input);
  await e.coordinator.captureInput(e.jobId,{generationId:captured.generationId,bytes:captured.bytes,sha256:captured.sha256});
  await store.close();
  store=await reopenDurableSyntheticStore(root,storeId);
  const recoveredInput=await store.read(inputRef),before=await e.coordinator.readProcessing(e.jobId);
  assert.deepEqual(recoveredInput.receipt,captured);assert.deepEqual(recoveredInput.data,input);
  assert.equal(before.capture.generationId,captured.generationId);assert.equal(before.capture.inputBytes,captured.bytes);assert.equal(before.capture.inputSha256,captured.sha256);
  const claimId=randomUUID(),lease=await e.coordinator.claimProcessing(e.jobId,claimId);
  assert.equal(lease.quarantineId,inputRef.objectId);assert.equal(lease.outputId,e.storageIds.outputId);
  await writeFile(path.join(e.attempt,'source.input'),recoveredInput.data,{flag:'wx',mode:0o600});
  safeToClean=false;
  const outcome=await e.run();safeToClean=outcome.termination==='job_empty'&&outcome.activeProcesses===0;
  assert.equal(outcome.exitCode,0);
  const output=await boundedRead(e.attempt,'converted.webp',10*1024*1024),sidecar=await boundedRead(e.attempt,'manifest.json',4096);
  const verified=verifySyntheticProcessReadback(recoveredInput.data,output,sidecar);
  const outputRef={jobId:e.jobId,objectId:lease.outputId,generationId:lease.leaseNonce,kind:'output'};
  const installed=await store.install(outputRef,verified.data);
  assert.equal(installed.bytes,verified.manifest.bytes);assert.equal(installed.sha256,verified.manifest.sha256);
  await store.close();store=await reopenDurableSyntheticStore(root,storeId);
  const recoveredOutput=await store.read(outputRef);
  assert.deepEqual(recoveredOutput.receipt,installed);assert.deepEqual(recoveredOutput.data,output);
  const seal={attempt:lease.attempt,leaseNonce:lease.leaseNonce,manifest:verified.manifest};
  const sealed=await e.coordinator.sealOutput(e.jobId,seal);
  await store.close();store=await reopenDurableSyntheticStore(root,storeId);
  const final=await e.coordinator.readProcessing(e.jobId),finalInput=await store.read(inputRef),finalOutput=await store.read(outputRef);
  assert.equal(final.state,'verified');assert.deepEqual(final.verified,sealed);
  assert.equal(finalInput.receipt.sha256,sealed.manifest.inputSha256);assert.equal(finalInput.receipt.bytes,sealed.manifest.inputBytes);
  assert.equal(finalOutput.receipt.sha256,sealed.manifest.sha256);assert.equal(finalOutput.receipt.bytes,sealed.manifest.bytes);
  assert.deepEqual(await store.install(outputRef,output),installed);
  await assert.rejects(()=>store.install({...outputRef,generationId:randomUUID()},output),error=>error.code==='CONFLICT');
  assert.deepEqual(await e.coordinator.sealOutput(e.jobId,seal),sealed);
  await e.inspectUnchanged(1);
  // No decoder relaunch or inferred termination occurs on reopen. This test
  // keeps PGlite alive; it does not prove database crash/restore or worker recovery.
});
