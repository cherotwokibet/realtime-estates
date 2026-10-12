import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,readdir,lstat,rmdir,unlink,writeFile} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createNativeMediaPreview,nativeMediaPreviewConfiguration} from './media-preview.mjs';
import {STAFF_PREVIEW_FIXTURES,startStaffPreview} from './staff-preview.mjs';
import {reopenDurableSyntheticStore} from '@realtor/media/durable-store';
import {createSyntheticUploadRequests} from '@realtor/media/upload-request';
import {createSyntheticProcessingRequests} from '@realtor/media/processing-request';
import {createSyntheticAttemptJournal} from '@realtor/media/attempt-journal';
import {syntheticPng} from '../../../packages/media/tests/fixtures.mjs';

const WINDOWS={skip:process.platform!=='win32',timeout:90_000};
const POWER_SHELL=process.env.REALTOR_TEST_POWERSHELL??path.join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','native','powershell','pwsh.exe');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const nativeUploads=rootDirectory=>({mode:'synthetic-native-v1',rootDirectory,powerShellPath:POWER_SHELL});
const fixed={tenant:{tenantId:id(1),slug:'synthetic-preview',hostnames:['127.0.0.1']},database:{transaction:async()=>{throw new Error('Unexpected SQL in lifecycle test');}},coordinator:{finalizeMedia:async()=>{throw new Error('Unexpected finalization in lifecycle test');}},verifyBearer:async()=>{throw new Error('Unexpected identity check in lifecycle test');}};
const FILES=new Set(['preview-owner.json','preview-resources.json','store.json','data.bin','receipt.json','worker.json','owner.json','launch.json','completion.json','source.input','converted.webp','manifest.json','do-not-repair.txt']);
async function removeKnownTree(location,parent,depth=0){
  assert.equal(path.dirname(location),parent);assert.ok(depth<10);
  const current=await lstat(location);assert.ok(current.isDirectory()&&!current.isSymbolicLink());
  for(const name of await readdir(location)){
    const child=path.join(location,name),stat=await lstat(child);assert.ok(!stat.isSymbolicLink());
    if(stat.isDirectory()){
      assert.ok(['attempts','objects','quarantine','output','history','slot'].includes(name)||/^[0-9a-f-]{36}$/.test(name)||/^worker-[0-9a-f-]{36}$/.test(name)||/^realtor-durable-synthetic-[A-Za-z0-9]+$/.test(name));
      await removeKnownTree(child,location,depth+1);
    }else{assert.ok(stat.isFile()&&stat.nlink===1&&FILES.has(name));await unlink(child);}
  }
  await rmdir(location);
}
const call=(preview,route,{method='GET',body,headers={},token=preview.bearerToken}={})=>fetch(preview.origin+route,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{}) ,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function json(response,expected=200){assert.equal(response.status,expected,await response.clone().text());return response.json();}

test('native opt-in captures strict startup data and refuses production, ambiguous options and SQL-only fixture blending',WINDOWS,async()=>{
  let getterCalls=0;const accessor={mode:'synthetic-native-v1',rootDirectory:path.join(tmpdir(),'unused-native-preview')};
  Object.defineProperty(accessor,'powerShellPath',{enumerable:true,get(){getterCalls++;return POWER_SHELL;}});
  const proxy=new Proxy(nativeUploads(path.join(tmpdir(),'unused-native-preview')),{ownKeys(){getterCalls++;throw new Error('trap');}});
  for(const input of [undefined,null,{},accessor,proxy,{...nativeUploads(tmpdir()),mode:'production'},{...nativeUploads(tmpdir()),rootDirectory:'relative'},{...nativeUploads(tmpdir()),powerShellPath:process.execPath},{...nativeUploads(tmpdir()),extra:true}])assert.throws(()=>nativeMediaPreviewConfiguration(input));
  assert.equal(getterCalls,0);
  const options=nativeUploads(tmpdir()),captured=nativeMediaPreviewConfiguration(options);options.rootDirectory='changed';assert.equal(captured.rootDirectory,path.resolve(tmpdir()));assert.equal(Object.isFrozen(captured),true);
  await assert.rejects(()=>startStaffPreview({port:0,nativeUploads:nativeUploads(tmpdir()),seedAcceptedMedia:true}));
  await assert.rejects(()=>startStaffPreview({port:0,nativeUploads:nativeUploads(tmpdir()),seedPendingReviews:true}));
  const prior=process.env.NODE_ENV;process.env.NODE_ENV='production';
  try{assert.throws(()=>nativeMediaPreviewConfiguration(nativeUploads(tmpdir())));await assert.rejects(()=>startStaffPreview({port:0,nativeUploads:nativeUploads(tmpdir())}));}
  finally{if(prior===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=prior;}
});

test('occupied and missing roots are refused without creating, repairing, clearing or rotating them',WINDOWS,async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'realtor-native-preview-'));
  try{
    await writeFile(path.join(root,'do-not-repair.txt'),'synthetic unknown retained root',{flag:'wx'});
    await assert.rejects(()=>createNativeMediaPreview({...fixed,nativeUploads:nativeUploads(root)}));
    assert.deepEqual(await readdir(root),['do-not-repair.txt']);assert.equal(await readFile(path.join(root,'do-not-repair.txt'),'utf8'),'synthetic unknown retained root');
    const missing=path.join(root,'missing');await assert.rejects(()=>createNativeMediaPreview({...fixed,nativeUploads:nativeUploads(missing)}));
    await assert.rejects(()=>lstat(missing),error=>error.code==='ENOENT');
  }finally{await removeKnownTree(root,path.dirname(root));}
});

test('partial startup retains its exclusive owner and stable roots; another startup never fills or rotates them',WINDOWS,async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'realtor-native-preview-'));
  try{
    await assert.rejects(()=>createNativeMediaPreview({...fixed,verifyBearer:undefined,nativeUploads:nativeUploads(root)}));
    const names=(await readdir(root)).sort();assert.ok(names.includes('preview-owner.json'));assert.ok(names.includes('attempts'));assert.equal(names.includes('preview-resources.json'),false);
    assert.deepEqual(await readdir(path.join(root,'attempts')),[]);
    const owner=await readFile(path.join(root,'preview-owner.json'),'utf8');
    await assert.rejects(()=>createNativeMediaPreview({...fixed,nativeUploads:nativeUploads(root)}));
    assert.deepEqual((await readdir(root)).sort(),names);assert.equal(await readFile(path.join(root,'preview-owner.json'),'utf8'),owner);
  }finally{await removeKnownTree(root,path.dirname(root));}
});

test('explicit staff preview composes signed HTTP, restricted API/coordinator roles, actual native bytes and one attachment; close retains roots',WINDOWS,async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'realtor-native-preview-'));let preview,safe=true,completed=false;
  t.after(async()=>{await preview?.close();if(!safe){t.diagnostic(`Unconfirmed native preview roots retained at ${root}`);return;}await removeKnownTree(root,path.dirname(root));});
  preview=await startStaffPreview({port:0,nativeUploads:nativeUploads(root)});
  assert.match(preview.origin,/^http:\/\/127\.0\.0\.1:\d+$/);assert.equal(preview.listingId,STAFF_PREVIEW_FIXTURES.realtimeListingId);assert.equal(preview.nativeUploads,true);assert.equal(preview.acceptedMediaMetadataOnly,false);
  const health=await json(await fetch(preview.origin+'/health'));assert.equal(health.nativeUploads,true);assert.equal(health.retainedSyntheticMedia,true);assert.equal(health.persistentStorage,false);assert.equal(health.productionReady,false);
  assert.equal(JSON.stringify(health).includes(root),false);assert.equal(JSON.stringify(health).includes(preview.bearerToken),false);
  const prefix=`/v2/staff/listings/${preview.listingId}/revisions/1`,workspacePath=prefix+'/workspace';
  const initial=await json(await call(preview,workspacePath));assert.equal(initial.draft.version,'2');assert.deepEqual(initial.photos,[]);
  const resources=JSON.parse(await readFile(path.join(root,'preview-resources.json'),'utf8')),owner=await readFile(path.join(root,'preview-owner.json'),'utf8');
  assert.equal(resources.mode,'synthetic-native-v1');assert.equal(Object.keys(resources.stores).length,4);assert.deepEqual(await readdir(path.join(root,'attempts')),[]);
  const registration=await json(await call(preview,prefix+'/media-registrations',{method:'POST',body:{registrationId:randomUUID(),expectedVersion:2,altText:'Independently generated synthetic color pattern'}}));
  const uploadId=randomUUID(),uploadPath=prefix+`/media-jobs/${registration.jobId}/uploads/${uploadId}`,pixels=syntheticPng(31,23,(x,y)=>[x*7,y*9,120,255]);
  const binary={method:'PUT',headers:{Authorization:`Bearer ${preview.bearerToken}`,'Content-Type':'application/octet-stream'},body:pixels};
  assert.equal((await fetch(preview.origin+uploadPath,{...binary,headers:{'Content-Type':'application/octet-stream'}})).status,401);
  assert.equal((await fetch(preview.origin+uploadPath,{...binary,headers:{...binary.headers,Origin:'https://untrusted.example.invalid'}})).status,403);
  assert.equal((await fetch(preview.origin+uploadPath,{...binary,headers:{...binary.headers,Cookie:'forged=true'}})).status,400);
  assert.equal((await fetch(preview.origin+uploadPath.replace(preview.listingId,STAFF_PREVIEW_FIXTURES.sampleListingId),binary)).status,404);
  assert.deepEqual(await readdir(path.join(root,'attempts')),[]);
  safe=false;
  const uploaded=await json(await fetch(preview.origin+uploadPath,binary));assert.deepEqual(uploaded,{uploadId,jobId:registration.jobId,listingId:preview.listingId,revision:1,state:'verified'});
  const stores=[],closers=[];
  try{
    const reopen=async role=>{const item=resources.stores[role],store=await reopenDurableSyntheticStore(path.join(root,item.root),item.id);stores.push(store);return store;};
    const transport=await reopen('transport'),ledger=await createSyntheticUploadRequests({store:transport});closers.push(ledger);
    const original=await ledger.read({jobId:registration.jobId,uploadId});assert.equal(original.input.sha256,createHash('sha256').update(pixels).digest('hex'));
    const processing=await reopen('processing'),requests=await createSyntheticProcessingRequests({store:processing});closers.push(requests);
    const binding={jobId:original.jobId,claimId:original.claimId,generationId:original.generationId},seal=await requests.readSeal(binding);assert.ok(seal);
    const journalStore=await reopen('journal'),journal=await createSyntheticAttemptJournal({store:journalStore,attemptParent:path.join(root,'attempts')});closers.push(journal);
    const terminal=await journal.inspect({jobId:original.jobId,claimId:original.claimId,attempt:seal.lease.attempt,leaseNonce:seal.lease.leaseNonce});
    assert.equal(terminal.state,'termination_recorded');assert.equal(terminal.terminal.outcome.termination,'job_empty');assert.equal(terminal.terminal.outcome.activeProcesses,0);safe=true;
    const photos=await reopen('photos'),output=await photos.read({jobId:original.jobId,objectId:seal.output.objectId,generationId:seal.output.generationId,kind:'output'});
    assert.equal(output.data.length,seal.seal.manifest.bytes);assert.equal(createHash('sha256').update(output.data).digest('hex'),seal.seal.manifest.sha256);
    assert.equal(output.data.toString('ascii',0,4),'RIFF');assert.equal(output.data.toString('ascii',8,12),'WEBP');
  }finally{for(const closer of closers)await closer.close();for(const store of stores)await store.close();}
  const attempts=await readdir(path.join(root,'attempts'));assert.equal(attempts.length,1);
  assert.deepEqual(await json(await call(preview,uploadPath)),uploaded);
  assert.equal((await fetch(preview.origin+uploadPath,binary)).status,409);assert.deepEqual(await readdir(path.join(root,'attempts')),attempts);
  assert.deepEqual(await json(await call(preview,workspacePath)),initial,'Upload and recovery do not change draft content/version/photos.');
  const operationId=randomUUID(),intentPath=prefix+'/media-attach-intents/'+operationId;
  const ready=await json(await call(preview,prefix+'/media-attach-intents',{method:'POST',body:{operationId,jobId:registration.jobId,expectedVersion:2}}));assert.equal(ready.status,'ready');assert.equal(ready.receipt,null);
  assert.equal((await json(await call(preview,intentPath))).status,'ready');assert.deepEqual(await json(await call(preview,workspacePath)),initial,'GET intent cannot finalize.');
  assert.equal((await call(preview,intentPath+'/finalize')).status,405);
  const applied=await json(await call(preview,intentPath+'/finalize',{method:'POST'}));assert.equal(applied.status,'applied');assert.equal(applied.receipt.expectedVersion,'2');assert.equal(applied.receipt.version,'3');
  assert.deepEqual(await json(await call(preview,intentPath)),applied);assert.deepEqual(await json(await call(preview,intentPath+'/finalize',{method:'POST'})),applied);
  const attached=await json(await call(preview,workspacePath));assert.equal(attached.draft.version,'3');assert.equal(attached.photos.length,1);assert.equal(attached.photos[0].accepted,true);assert.equal(attached.photos[0].provenance,'sealed');assert.equal(attached.photos[0].id,applied.receipt.mediaId);
  assert.deepEqual(await readdir(path.join(root,'attempts')),attempts);assert.equal(await readFile(path.join(root,'preview-owner.json'),'utf8'),owner);
  const names=(await readdir(root)).sort();await preview.close();await preview.close();completed=true;
  assert.deepEqual((await readdir(root)).sort(),names);assert.equal(await readFile(path.join(root,'preview-owner.json'),'utf8'),owner);await assert.rejects(()=>fetch(preview.origin+'/health'));
  await assert.rejects(()=>startStaffPreview({port:0,nativeUploads:nativeUploads(root)}));assert.deepEqual((await readdir(root)).sort(),names);
  assert.equal(completed,true);
});

test('signed customer cannot enter native admission or finalization and leaves the fixed worker roots idle',WINDOWS,async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'realtor-native-preview-'));let preview;
  try{
    preview=await startStaffPreview({port:0,actor:'customer',nativeUploads:nativeUploads(root)});
    const prefix=`/v2/staff/listings/${preview.listingId}/revisions/1`,upload=prefix+`/media-jobs/${randomUUID()}/uploads/${randomUUID()}`;
    assert.equal((await fetch(preview.origin+upload,{method:'PUT',headers:{Authorization:`Bearer ${preview.bearerToken}`,'Content-Type':'application/octet-stream'},body:Buffer.from([1])})).status,404);
    assert.equal((await call(preview,prefix+`/media-attach-intents/${randomUUID()}/finalize`,{method:'POST'})).status,404);
    assert.deepEqual(await readdir(path.join(root,'attempts')),[]);
  }finally{await preview?.close();await removeKnownTree(root,path.dirname(root));}
});
