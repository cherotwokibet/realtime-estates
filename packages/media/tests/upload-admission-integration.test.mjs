import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readdir,lstat,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDurableSyntheticStore,reopenDurableSyntheticStore} from '@realtor/media/durable-store';
import {createSyntheticAttemptJournal} from '@realtor/media/attempt-journal';
import {createSyntheticWorkerAdmission} from '@realtor/media/worker-admission';
import {createSyntheticOneAttemptProcessor} from '@realtor/media/one-attempt';
import {createSyntheticUploadRequests} from '@realtor/media/upload-request';
import {readSyntheticUploadBody} from '../dist/upload-body.js';
import {syntheticPng} from './fixtures.mjs';
import {environment,WINDOWS_ONLY} from './coordinator-fixture.mjs';

// Enumerated owned fixture cleanup only. An unknown process outcome retains all roots.
async function removeKnownTree(location,parent,files,depth=0){
 assert.equal(path.dirname(location),parent);assert.ok(depth<8);
 const stat=await lstat(location);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());
 for(const name of await readdir(location)){
  const target=path.join(location,name),entry=await lstat(target);
  assert.ok(!entry.isSymbolicLink());
  if(entry.isDirectory()){
   assert.ok(['objects','quarantine','output','history','slot'].includes(name)||/^[0-9a-f-]{36}$/.test(name));
   await removeKnownTree(target,location,files,depth+1);
  }else{assert.ok(entry.isFile()&&entry.nlink===1&&files.has(name));await unlink(target);}
 }
 await rmdir(location);
}

test('original upload binding survives a lost successful local result and reopening without another native run',WINDOWS_ONLY,async t=>{
 const e=await environment(t),parent=await mkdtemp(path.join(tmpdir(),'realtor-upload-admission-'));
 const stores=[],controllers=[],roots=[];let worker,journal,processor,ledger,safe=true,nativeCalls=0;
 t.after(async()=>{
  for(const item of controllers)await item.close();await worker?.close();await journal?.close();for(const item of stores)await item.close();
  if(!safe){t.diagnostic(`Unknown native outcome: retained upload roots at ${parent}`);return;}
  const files=new Set(['store.json','data.bin','receipt.json','worker.json','owner.json','launch.json','completion.json']);
  for(const root of roots)await removeKnownTree(root,parent,files);
  assert.deepEqual(await readdir(parent),[]);await rmdir(parent);
 });
 async function store(){const item=await createDurableSyntheticStore(parent);stores.push(item);roots.push(item.rootDirectory);return item;}
 const photos=await store(),requests=await store(),journalStore=await store(),transport=await store();
 journal=await createSyntheticAttemptJournal({store:journalStore,attemptParent:e.attemptParent});
 worker=await createSyntheticWorkerAdmission({parentDirectory:parent,journal});roots.push(worker.rootDirectory);
 ledger=await createSyntheticUploadRequests({store:transport});controllers.push(ledger);
 const source=syntheticPng(43,31,(x,y)=>[x*5,y*7,80,255]);
 async function* chunks(){for(let n=0;n<source.length;n+=13)yield source.subarray(n,n+13);}
 const bytes=await readSyntheticUploadBody(chunks(),{declaredBytes:source.length});
 const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const original={uploadId:randomUUID(),tenantId:id(1),actorId:id(11),listingId:id(100),revision:1,jobId:e.jobId,input:bytes};
 const admission=await ledger.reserve(original),persisted=await ledger.read({jobId:e.jobId,uploadId:original.uploadId});
 assert.deepEqual(persisted,admission.request);assert.equal(persisted.input.bytes,source.length);
 assert.equal(persisted.input.sha256,createHash('sha256').update(source).digest('hex'));
 const binding=ledger.consume(admission.ticket);assert.equal(binding.jobId,e.jobId);
 const entry=fileURLToPath(new URL('../dist/codec-worker.js',import.meta.url));
 const supervisor={async run(request){nativeCalls++;safe=false;const outcome=await e.run(request.workingDirectory);safe=outcome.termination==='job_empty'&&outcome.activeProcesses===0;return outcome;}};
 const configuration=()=>({coordinator:e.coordinator,inputStore:photos,requestStore:requests,worker,journal,supervisor,nodeExecutablePath:process.execPath,codecEntryPath:entry});
 processor=await createSyntheticOneAttemptProcessor(configuration());controllers.push(processor);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),binding.input.sha256);
 const outcome=await processor.run({jobId:binding.jobId,claimId:binding.claimId,generationId:binding.generationId,input:bytes});
 assert.equal(outcome.request.input.sha256,binding.input.sha256);assert.equal(outcome.request.input.bytes,binding.input.bytes);
 assert.equal(outcome.state,'verified');assert.equal(nativeCalls,1);await e.inspectUnchanged(1);
 // Deliberately discard the successful response. History is descriptive, never fresh authority.
 await processor.close();await ledger.close();
 const reopenedStore=await reopenDurableSyntheticStore(transport.rootDirectory,transport.storeId);stores.push(reopenedStore);
 const reopened=await createSyntheticUploadRequests({store:reopenedStore});controllers.push(reopened);
 const saved=await reopened.read({jobId:e.jobId,uploadId:original.uploadId});assert.deepEqual(saved,persisted);
 for(const key of ['tenantId','actorId','listingId','revision','jobId','uploadId'])assert.equal(saved[key],original[key]);
 assert.throws(()=>reopened.consume(saved),error=>error.code==='INVALID_TICKET');
 await assert.rejects(reopened.reserve(original),error=>error.code==='BLOCKED');
 await assert.rejects(reopened.reserve({...original,uploadId:randomUUID()}),error=>error.code==='BLOCKED');
 const reader=await createSyntheticOneAttemptProcessor(configuration());controllers.push(reader);
 const recovered=await reader.reconcile({jobId:saved.jobId,claimId:saved.claimId,generationId:saved.generationId});
 assert.equal(recovered.state,'verified');assert.equal(nativeCalls,1);
 const output=await photos.read({jobId:e.jobId,objectId:recovered.receipt.outputId,generationId:recovered.lease.leaseNonce,kind:'output'});
 assert.equal(output.receipt.sha256,recovered.receipt.manifest.sha256);assert.equal(output.receipt.bytes,recovered.receipt.manifest.bytes);
 assert.equal(output.data.length,recovered.receipt.manifest.bytes);assert.equal(createHash('sha256').update(output.data).digest('hex'),recovered.receipt.manifest.sha256);
 await e.inspectUnchanged(1);
});
