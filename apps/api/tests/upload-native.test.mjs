import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createServer,request as httpRequest} from 'node:http';
import {mkdtemp,readdir,lstat,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {createIdentityVerifier} from '../dist/auth.js';
import {PostgresTransactionDatabase} from '../dist/database.js';
import {createDevelopmentServer} from '../dist/http.js';
import {createDevelopmentUploadApi} from '../dist/upload.js';
import {createDurableSyntheticStore,reopenDurableSyntheticStore} from '@realtor/media/durable-store';
import {createSyntheticAttemptJournal} from '@realtor/media/attempt-journal';
import {createSyntheticWorkerAdmission} from '@realtor/media/worker-admission';
import {createSyntheticOneAttemptProcessor} from '@realtor/media/one-attempt';
import {createSyntheticUploadRequests} from '@realtor/media/upload-request';
import {syntheticPng} from '../../../packages/media/tests/fixtures.mjs';
import {environment,WINDOWS_ONLY} from '../../../packages/media/tests/coordinator-fixture.mjs';

async function removeKnownTree(location,parent,files,depth=0){
  assert.equal(path.dirname(location),parent);assert.ok(depth<8);const stat=await lstat(location);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());
  for(const name of await readdir(location)){const target=path.join(location,name),entry=await lstat(target);assert.ok(!entry.isSymbolicLink());
    if(entry.isDirectory()){assert.ok(['objects','quarantine','output','history','slot'].includes(name)||/^[0-9a-f-]{36}$/.test(name));await removeKnownTree(target,location,files,depth+1);}
    else{assert.ok(entry.isFile()&&entry.nlink===1&&files.has(name));await unlink(target);}}
  await rmdir(location);
}
test('signed staff HTTP upload loses its completed reply, then reopens original read-only status without a second decoder',WINDOWS_ONLY,async t=>{
  const e=await environment(t),parent=await mkdtemp(path.join(tmpdir(),'realtor-http-upload-'));
  const stores=[],controllers=[],roots=[];let worker,journal,api,server,keyServer,safe=true,nativeCalls=0,sqlActive=false;
  t.after(async()=>{
    for(const item of [server,keyServer])if(item){item.closeAllConnections();await new Promise(resolve=>item.close(resolve));}
    await api?.close();for(const item of controllers)await item.close();await worker?.close();await journal?.close();for(const item of stores)await item.close();
    if(!safe){t.diagnostic(`Unknown native outcome: retained upload roots at ${parent}`);return;}
    const files=new Set(['store.json','data.bin','receipt.json','worker.json','owner.json','launch.json','completion.json']);
    for(const root of roots)await removeKnownTree(root,parent,files);assert.deepEqual(await readdir(parent),[]);await rmdir(parent);
  });
  async function store(){const item=await createDurableSyntheticStore(parent);stores.push(item);roots.push(item.rootDirectory);return item;}
  const photos=await store(),requests=await store(),journalStore=await store(),transport=await store();
  journal=await createSyntheticAttemptJournal({store:journalStore,attemptParent:e.attemptParent});
  worker=await createSyntheticWorkerAdmission({parentDirectory:parent,journal});roots.push(worker.rootDirectory);
  let ledger=await createSyntheticUploadRequests({store:transport});controllers.push(ledger);
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const entry=fileURLToPath(new URL('../../../packages/media/dist/codec-worker.js',import.meta.url));
  const supervisor={async run(request){assert.equal(sqlActive,false);nativeCalls++;safe=false;const outcome=await e.run(request.workingDirectory);safe=outcome.termination==='job_empty'&&outcome.activeProcesses===0;return outcome;}};
  const createProcessor=()=>createSyntheticOneAttemptProcessor({coordinator:e.coordinator,inputStore:photos,requestStore:requests,worker,journal,supervisor,nodeExecutablePath:process.execPath,codecEntryPath:entry});
  await e.asBootstrap(db=>db.exec('CREATE ROLE synthetic_http_api_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;GRANT api_runtime TO synthetic_http_api_login;'));
  // Serialized test requests only: PGlite shares one session; production concurrency is not proved.
  const database={transaction(context,operation){return e.asBootstrap(async db=>{
    await db.exec('SET SESSION AUTHORIZATION synthetic_http_api_login;RESET ROLE;');sqlActive=true;
    try{return await new PostgresTransactionDatabase({async connect(){return {query:(sql,values)=>db.query(sql,values?[...values]:[]),release(){}};}}).transaction(context,operation);}
    finally{sqlActive=false;}
  });}};
  const keys=await generateKeyPair('RS256'),jwk={...await exportJWK(keys.publicKey),kid:'synthetic-upload',alg:'RS256',use:'sig'};
  keyServer=createServer((incoming,outgoing)=>{outgoing.writeHead(200,{'Content-Type':'application/json'});outgoing.end(JSON.stringify({keys:[jwk]}));});await new Promise(resolve=>keyServer.listen(0,'127.0.0.1',resolve));
  const issuer=`http://127.0.0.1:${keyServer.address().port}`;
  const verifyBearer=createIdentityVerifier({issuer,audience:'synthetic-upload-test',jwksUrl:issuer+'/jwks',allowLoopbackHttpForTests:true});
  const token=await new SignJWT({}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer).setAudience('synthetic-upload-test').setSubject(id(11)).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
  const configuration=()=>({tenant:{tenantId:id(1),slug:'synthetic-upload',hostnames:['127.0.0.1']},database,verifyBearer,requests:ledger,createProcessor});
  api=createDevelopmentUploadApi(configuration());
  let committed,releaseReply,finished;const committedPromise=new Promise(resolve=>{committed=resolve;}),replyGate=new Promise(resolve=>{releaseReply=resolve;}),finishedPromise=new Promise(resolve=>{finished=resolve;});
  let discard=true;
  server=createDevelopmentServer(async()=>new Response('not found',{status:404}),new WeakMap(),async(request,source)=>{
    const result=await api.handle(request,source);
    if(request.method==='PUT'&&discard){assert.equal(result.status,200);committed();await replyGate;finished();}
    return result;
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const uploadId=randomUUID(),url=`http://127.0.0.1:${server.address().port}/v2/staff/listings/${id(100)}/revisions/1/media-jobs/${e.jobId}/uploads/${uploadId}`;
  const pixels=syntheticPng(43,31,(x,y)=>[x*5,y*7,80,255]);
  let client;const lost=new Promise(resolve=>{
    client=httpRequest(url,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream','Transfer-Encoding':'chunked'}},()=>assert.fail('Successful reply must be lost before headers'));
    client.on('error',error=>resolve(error));for(let offset=0;offset<pixels.length;offset+=13)client.write(pixels.subarray(offset,offset+13));client.end();
  });
  await committedPromise;assert.equal(nativeCalls,1);await e.inspectUnchanged(1);
  client.destroy(new Error('Deliberately lost completed HTTP reply'));await lost;discard=false;releaseReply();await finishedPromise;
  await api.close();await ledger.close();
  const reopened=await reopenDurableSyntheticStore(transport.rootDirectory,transport.storeId);stores.push(reopened);ledger=await createSyntheticUploadRequests({store:reopened});controllers.push(ledger);api=createDevelopmentUploadApi(configuration());
  const recovered=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});assert.equal(recovered.status,200);
  assert.deepEqual(await recovered.json(),{uploadId,jobId:e.jobId,listingId:id(100),revision:1,state:'verified'});assert.equal(nativeCalls,1);
  const binding=await ledger.read({jobId:e.jobId,uploadId});assert.equal(binding.input.sha256,createHash('sha256').update(pixels).digest('hex'));
  const processing=await e.coordinator.readProcessing(e.jobId),output=await photos.read({jobId:e.jobId,objectId:processing.verified.outputId,generationId:processing.lease.leaseNonce,kind:'output'});
  assert.equal(output.data.length,processing.verified.manifest.bytes);assert.equal(createHash('sha256').update(output.data).digest('hex'),processing.verified.manifest.sha256);
  const repeated=await fetch(url,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream'},body:pixels});assert.equal(repeated.status,409);assert.equal(nativeCalls,1);
  const foreign=await new SignJWT({}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer).setAudience('synthetic-upload-test').setSubject(id(12)).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
  const denied=await fetch(url,{headers:{Authorization:`Bearer ${foreign}`}});assert.equal(denied.status,404);assert.equal(nativeCalls,1);await e.inspectUnchanged(1);
});
