import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {lstat,mkdir,mkdtemp,readFile,readdir,rmdir,unlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createDurableSyntheticStore,reopenDurableSyntheticStore} from '../dist/durable-store.js';
import {createSyntheticUploadRequests} from '../dist/upload-request.js';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const code=expected=>error=>error?.code===expected;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value)+'\n');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let sequence=1;
async function exists(location){try{return await lstat(location);}catch(error){if(error.code==='ENOENT')return null;throw error;}}

// Actual filesystem and byte snapshots below prove request admission only.
// No auth, HTTP ingress, SQL capture, native processing or media acceptance runs.
async function fixture(t){
 const parent=await mkdtemp(path.join(os.tmpdir(),'realtor-upload-request-')),store=await createDurableSyntheticStore(parent),stores=new Set([store]),controllers=new Set(),jobs=new Set();
 t.after(async()=>{
  for(const controller of controllers)await controller.close();for(const opened of stores)await opened.close();
  const root=store.rootDirectory;assert.equal(path.dirname(root),parent);assert.deepEqual((await readdir(root)).sort(),['objects','store.json']);
  const objects=path.join(root,'objects'),objectStat=await lstat(objects);assert.ok(objectStat.isDirectory()&&!objectStat.isSymbolicLink());
  for(const jobId of await readdir(objects))assert.ok(jobs.has(jobId),`Unknown upload job retained: ${jobId}`);
  for(const jobId of jobs){const job=path.join(objects,jobId);if(!await exists(job))continue;const stat=await lstat(job);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());
   for(const kind of await readdir(job))assert.equal(kind,'quarantine');const quarantine=path.join(job,'quarantine');if(await exists(quarantine)){const qs=await lstat(quarantine);assert.ok(qs.isDirectory()&&!qs.isSymbolicLink());
    for(const name of await readdir(quarantine)){assert.ok(['data.bin','receipt.json'].includes(name));const file=path.join(quarantine,name),fs=await lstat(file);assert.ok(fs.isFile()&&!fs.isSymbolicLink()&&fs.nlink===1);await unlink(file);}await rmdir(quarantine);
   }await rmdir(job);
  }
  await rmdir(objects);const marker=path.join(root,'store.json'),ms=await lstat(marker);assert.ok(ms.isFile()&&!ms.isSymbolicLink()&&ms.nlink===1);await unlink(marker);await rmdir(root);assert.deepEqual(await readdir(parent),[]);await rmdir(parent);
 });
 function input(){const n=sequence++,jobId=id(n);jobs.add(jobId);return {uploadId:id(10000+n),tenantId:id(20000+n),actorId:id(30000+n),listingId:id(40000+n),revision:1,jobId,input:Buffer.from('synthetic upload admission bytes '+n)};}
 async function open(supplied){const opened=supplied??await reopenDurableSyntheticStore(store.rootDirectory,store.storeId);stores.add(opened);const controller=await createSyntheticUploadRequests({store:opened});controllers.add(controller);return controller;}
 const binding=value=>({jobId:value.jobId,uploadId:value.uploadId});
 const reference=value=>({jobId:value.jobId,objectId:value.uploadId,generationId:value.uploadId,kind:'quarantine'});
 function record(value){const {input:bytes,...resource}=value;return {version:1,requestStoreId:store.storeId,...resource,claimId:id(50000+sequence++),generationId:id(60000+sequence++),input:{bytes:bytes.length,sha256:hash(bytes)}};}
 const file=value=>path.join(store.rootDirectory,'objects',value.jobId,'quarantine','data.bin');
 return {parent,store,stores,jobs,input,open,binding,reference,record,file};
}

test('upload admission persists exact principal/resource and server-generated bindings before issuing a one-use ticket',async t=>{
 const f=await fixture(t),controller=await f.open(),input=f.input(),reserved=await controller.reserve(input),{claimId,generationId}=reserved.request;
 for(const value of [reserved,reserved.ticket,reserved.request,reserved.request.input])assert.ok(Object.isFrozen(value));assert.deepEqual(reserved.ticket,{kind:'synthetic_upload'});
 assert.match(claimId,UUID);assert.match(generationId,UUID);assert.notEqual(claimId,generationId);assert.notEqual(claimId,input.uploadId);assert.notEqual(generationId,input.jobId);
 const {input:bytes,...resource}=input;assert.deepEqual(reserved.request,{version:1,requestStoreId:f.store.storeId,...resource,claimId,generationId,input:{bytes:bytes.length,sha256:hash(bytes)}});
 assert.deepEqual(await readFile(f.file(input)),json(reserved.request));assert.deepEqual(await controller.read(f.binding(input)),reserved.request);assert.equal(Object.hasOwn(reserved.request,'ticket'),false);
 assert.equal(controller.consume(reserved.ticket),reserved.request);assert.throws(()=>controller.consume(reserved.ticket),code('BLOCKED'));
 await assert.rejects(controller.reserve(input),code('BLOCKED'));assert.deepEqual(await readFile(f.file(input)),json(reserved.request));
});

test('input bytes and descriptor values are snapshotted synchronously before admission I/O',async t=>{
 const f=await fixture(t),controller=await f.open(),input=f.input(),original={...input,input:Buffer.from(input.input)},pending=controller.reserve(input);
 input.input.fill(0);input.uploadId=id(99901);input.actorId=id(99902);input.revision=2;
 await assert.rejects(controller.read(f.binding(original)),code('BUSY'));const result=await pending;assert.equal(result.request.input.sha256,hash(original.input));assert.equal(result.request.input.bytes,original.input.length);assert.equal(result.request.uploadId,original.uploadId);assert.equal(result.request.actorId,original.actorId);assert.equal(result.request.revision,1);
 assert.equal((await readFile(f.file(original))).includes(original.input),false);assert.equal(Object.hasOwn(result.request.input,'data'),false);
});

test('reopened read-only history never reconstructs same-instance authority or accepts a changed upload binding',async t=>{
 const f=await fixture(t),first=await f.open(),input=f.input(),reserved=await first.reserve(input);await first.close();
 const reopened=await f.open(),historical=await reopened.read(f.binding(input));assert.deepEqual(historical,reserved.request);assert.equal(Object.hasOwn(historical,'ticket'),false);
 for(const ticket of [reserved.ticket,{...reserved.ticket},Object.freeze({...reserved.ticket}),Object.create(reserved.ticket),null])assert.throws(()=>reopened.consume(ticket),code('INVALID_TICKET'));
 await assert.rejects(reopened.reserve(input),code('BLOCKED'));await assert.rejects(reopened.reserve({...input,uploadId:id(99903),actorId:id(99904),input:Buffer.from('different synthetic input')}),code('BLOCKED'));
 await assert.rejects(reopened.read({jobId:input.jobId,uploadId:id(99903)}),code('BLOCKED'));assert.deepEqual(await reopened.read(f.binding(input)),reserved.request);
 assert.throws(()=>first.consume(reserved.ticket),code('CLOSED'));
});

test('independent controllers admit one permanent job once while different jobs receive independent random bindings',async t=>{
 const f=await fixture(t),one=await f.open(),two=await f.open(),input=f.input(),results=await Promise.allSettled([one.reserve(input),two.reserve({...input,uploadId:id(99905)})]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.find(result=>result.status==='rejected').reason?.code,'BLOCKED');
 const winner=results.find(result=>result.status==='fulfilled').value,another=await one.reserve(f.input());assert.notEqual(another.request.claimId,winner.request.claimId);assert.notEqual(another.request.generationId,winner.request.generationId);
 const owner=results[0].status==='fulfilled'?one:two,other=owner===one?two:one;assert.throws(()=>other.consume(winner.ticket),code('INVALID_TICKET'));assert.deepEqual(owner.consume(winner.ticket),winner.request);
});

test('empty and incomplete permanent reservations stay blocked and untouched after reopening',async t=>{
 const f=await fixture(t),controller=await f.open();
 for(const phase of ['empty-job','empty-quarantine','partial-data']){const input=f.input(),job=path.join(f.store.rootDirectory,'objects',input.jobId);await mkdir(job);
  if(phase!=='empty-job'){await mkdir(path.join(job,'quarantine'));if(phase==='partial-data')await writeFile(f.file(input),Buffer.from('unfinished synthetic request'));}
  const before=await readdir(job);await assert.rejects(controller.reserve(input),code('BLOCKED'));await assert.rejects(controller.read(f.binding(input)),code('BLOCKED'));assert.deepEqual(await readdir(job),before);
  const reopened=await f.open();await assert.rejects(reopened.reserve(input),code('BLOCKED'));if(phase==='partial-data')assert.deepEqual(await readFile(f.file(input)),Buffer.from('unfinished synthetic request'));
 }
});

test('lost persistence acknowledgements retain facts but never issue replacement upload authority',async t=>{
 const f=await fixture(t),real=await reopenDurableSyntheticStore(f.store.rootDirectory,f.store.storeId);let attempts=0;
 const wrapped={...real,async install(reference,bytes){attempts++;await real.install(reference,bytes);throw new Error('PRIVATE simulated lost durable acknowledgment');}};
 const controller=await f.open(wrapped),input=f.input();await assert.rejects(controller.reserve(input),error=>error.code==='PERSISTENCE_FAILED'&&!error.message.includes('PRIVATE'));assert.equal(attempts,1);
 const historical=await controller.read(f.binding(input));assert.equal(historical.input.sha256,hash(input.input));assert.equal(Object.hasOwn(historical,'ticket'),false);await assert.rejects(controller.reserve(input),code('BLOCKED'));assert.equal(attempts,1);
 await controller.close();const reopened=await f.open();assert.deepEqual(await reopened.read(f.binding(input)),historical);await assert.rejects(reopened.reserve(input),code('BLOCKED'));assert.throws(()=>reopened.consume({kind:'synthetic_upload'}),code('INVALID_TICKET'));
});

test('installation failure after exclusive reservation blocks that job without repairing or deleting it',async t=>{
 const f=await fixture(t),real=await reopenDurableSyntheticStore(f.store.rootDirectory,f.store.storeId);let installs=0;const controller=await f.open({...real,async install(){installs++;throw new Error('PRIVATE simulated prewrite failure');}}),input=f.input();
 await assert.rejects(controller.reserve(input),code('PERSISTENCE_FAILED'));const job=path.join(f.store.rootDirectory,'objects',input.jobId);assert.deepEqual(await readdir(job),[]);await assert.rejects(controller.reserve(input),code('BLOCKED'));assert.equal(installs,1);
 const reopened=await f.open();await assert.rejects(reopened.reserve(input),code('BLOCKED'));assert.deepEqual(await readdir(job),[]);
});

test('strict own descriptors, exact fields and Buffer/shared-memory bounds fail before any job reservation',async t=>{
 const f=await fixture(t),controller=await f.open(),input=f.input();let getters=0;const accessor={...input};Object.defineProperty(accessor,'input',{enumerable:true,get(){getters++;return input.input;}});
 const inherited=Object.assign(Object.create({actorId:input.actorId}),input);delete inherited.actorId;
 const hidden={...input};Object.defineProperty(hidden,'actorId',{value:input.actorId,enumerable:false});
 const values=[null,[],{...input,claimId:id(99906)},{...input,generationId:id(99907)},{...input,[Symbol('hidden')]:true},accessor,inherited,hidden,{...input,tenantId:'../outside'},{...input,actorId:null},{...input,listingId:'bad'},{...input,revision:0},{...input,revision:1.5},{...input,revision:2147483648},{...input,input:new Uint8Array([1])},{...input,input:Buffer.alloc(0)},{...input,input:Buffer.alloc(10485761)},{...input,input:Buffer.from(new SharedArrayBuffer(4))}];
 for(const value of values)await assert.rejects(controller.reserve(value),code('INVALID_INPUT'));assert.equal(getters,0);assert.deepEqual(await readdir(path.join(f.store.rootDirectory,'objects')),[]);
 for(const value of [{jobId:input.jobId},{jobId:input.jobId,uploadId:input.uploadId,actorId:input.actorId},{jobId:'bad',uploadId:input.uploadId}])await assert.rejects(controller.read(value),code('INVALID_INPUT'));
});

test('native Buffer views cannot hide shared memory or invoke substituted length/buffer accessors',async t=>{
 const f=await fixture(t),controller=await f.open(),input=f.input(),shared=Buffer.from(new SharedArrayBuffer(4));let touched=0;
 Object.defineProperty(shared,'buffer',{get(){touched++;return new ArrayBuffer(4);}});await assert.rejects(controller.reserve({...input,input:shared}),code('INVALID_INPUT'));assert.equal(touched,0);
 const backing=Buffer.from('synthetic bounded subarray source'),slice=backing.subarray(10,18),expected=Buffer.from(slice);Object.defineProperty(slice,'buffer',{get(){touched++;throw new Error('PRIVATE getter');}});Object.defineProperty(slice,'length',{get(){touched++;throw new Error('PRIVATE length');}});
 const result=await controller.reserve({...input,input:slice});assert.equal(touched,0);assert.deepEqual(result.request.input,{bytes:expected.length,sha256:hash(expected)});
});

test('one-byte and exact ten-MiB snapshots are supported with no caller-selected hash or generation',async t=>{
 const f=await fixture(t),controller=await f.open();for(const source of [Buffer.from([1]),Buffer.alloc(10485760,7)]){const input=f.input(),reserved=await controller.reserve({...input,input:source});assert.deepEqual(reserved.request.input,{bytes:source.length,sha256:hash(source)});}
});

test('canonical records and exact resource bindings are checked beyond generic valid storage receipts',async t=>{
 const f=await fixture(t),cases=[];
 for(const mutate of [record=>({...record,version:2}),record=>({...record,requestStoreId:id(99908)}),record=>({...record,jobId:id(99909)}),record=>({...record,uploadId:id(99910)}),record=>({...record,actorId:'bad'}),record=>({...record,revision:0}),record=>({...record,input:{...record.input,bytes:10485761}}),record=>({...record,input:{...record.input,sha256:'bad'}}),record=>({...record,claimId:record.generationId}),record=>({...record,storageKey:'PRIVATE'}),record=>({...record,input:{...record.input,data:'PRIVATE'}})]){const input=f.input(),bytes=json(mutate(f.record(input)));await f.store.install(f.reference(input),bytes);cases.push({input,bytes});}
 for(const mutate of [bytes=>Buffer.from(' '+bytes.toString('utf8')),bytes=>Buffer.from(bytes.toString('utf8').trimEnd()),bytes=>Buffer.from(bytes.toString('utf8').replace('"version":1','"version":1,"version":1')),bytes=>Buffer.from(bytes.toString('utf8').replace('"revision":1','"revision":1.00000000000000001'))]){const input=f.input(),bytes=mutate(json(f.record(input)));await f.store.install(f.reference(input),bytes);cases.push({input,bytes});}
 const controller=await f.open();for(const {input,bytes} of cases){assert.deepEqual((await f.store.read(f.reference(input))).data,bytes);await assert.rejects(controller.read(f.binding(input)),code('INTEGRITY'));await assert.rejects(controller.reserve(input),code('BLOCKED'));assert.deepEqual((await f.store.read(f.reference(input))).data,bytes);}
});

test('actual record-byte corruption remains retained and never yields fresh authority',async t=>{
 const f=await fixture(t),controller=await f.open(),input=f.input();await controller.reserve(input);const file=f.file(input),bytes=await readFile(file);bytes[0]=0;await writeFile(file,bytes);
 await assert.rejects(controller.read(f.binding(input)),code('INTEGRITY'));await assert.rejects(controller.reserve(input),code('BLOCKED'));assert.deepEqual(await readFile(file),bytes);await controller.close();const reopened=await f.open();await assert.rejects(reopened.read(f.binding(input)),code('INTEGRITY'));await assert.rejects(reopened.reserve(input),code('BLOCKED'));
});

test('single admission rejects concurrent same-instance work and close drains it without issuing usable later authority',async t=>{
 const f=await fixture(t),controller=await f.open(),input=f.input(),pending=controller.reserve(input);await assert.rejects(controller.reserve(f.input()),code('BUSY'));await assert.rejects(controller.read(f.binding(input)),code('BUSY'));const closing=controller.close();assert.equal(controller.close(),closing);
 await assert.rejects(controller.reserve(f.input()),code('CLOSED'));await assert.rejects(controller.read(f.binding(input)),code('CLOSED'));const reserved=await pending;await closing;assert.throws(()=>controller.consume(reserved.ticket),code('CLOSED'));const reopened=await f.open();assert.deepEqual(await reopened.read(f.binding(input)),reserved.request);await assert.rejects(reopened.reserve(input),code('BLOCKED'));
});

test('configuration requires a dedicated exact store shape and never calls accessor traps',async t=>{
 const f=await fixture(t);let touched=0;const trap={...f.store};Object.defineProperty(trap,'install',{enumerable:true,get(){touched++;return f.store.install;}});
 for(const config of [null,{}, {store:f.store,extra:true},{store:{...f.store,extra:true}},{store:{...f.store,storeId:'bad'}},{store:{...f.store,rootDirectory:'relative'}},{store:trap}])await assert.rejects(createSyntheticUploadRequests(config),code('INVALID_CONFIGURATION'));assert.equal(touched,0);
});
