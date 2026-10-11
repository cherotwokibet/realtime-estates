import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {constants,type BigIntStats} from 'node:fs';
import {lstat,open,opendir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {isSharedArrayBuffer} from 'node:util/types';
import type {SyntheticAttemptJournal} from './attempt-journal.js';
import {MediaCoordinatorDatabaseError,type MediaCaptureReceipt,type MediaCoordinatorDatabase,type MediaProcessingLease,type MediaProcessingView,type MediaVerifiedReceipt} from './coordinator-database.js';
import {DurableStoreError,type DurableSyntheticReference,type DurableSyntheticStore} from './durable-store.js';
import {createSyntheticProcessingRequests,processingBinding,processingBytes,processingContext,processingData,processingEqual,processingLease,processingLeaseMatches,processingManifest,processingUuid,SyntheticProcessingRequestError,type SyntheticProcessingBinding,type SyntheticProcessingRequest,type SyntheticProcessingRequests,type SyntheticProcessingSealRequest} from './processing-request.js';
import type {SyntheticWorkerAdmission,SyntheticWorkerPermit} from './worker-admission.js';
import {verifySyntheticProcessReadback} from './process-readback.js';
import type {WindowsSyntheticOutcome,WindowsSyntheticSupervisor} from './windows-supervisor.js';

export type SyntheticOneAttemptCoordinator=Pick<MediaCoordinatorDatabase,'readUploadContext'|'captureInput'|'claimProcessing'|'readProcessing'|'sealOutput'>;
export interface SyntheticOneAttemptConfiguration {
  readonly coordinator:SyntheticOneAttemptCoordinator;readonly inputStore:DurableSyntheticStore;readonly requestStore:DurableSyntheticStore;
  readonly worker:SyntheticWorkerAdmission;readonly journal:SyntheticAttemptJournal;readonly supervisor:WindowsSyntheticSupervisor;
  readonly nodeExecutablePath:string;readonly codecEntryPath:string;
}
export interface SyntheticOneAttemptInput extends SyntheticProcessingBinding {readonly input:Buffer}
export type SyntheticOneAttemptStage='capture'|'claim'|'seal';
export type SyntheticOneAttemptResult=
  | Readonly<{state:'verified';request:SyntheticProcessingRequest;lease:MediaProcessingLease;receipt:MediaVerifiedReceipt;outputRef:DurableSyntheticReference;reconciled:readonly SyntheticOneAttemptStage[]}>
  | Readonly<{state:'native_failed';outcome:WindowsSyntheticOutcome}>;
export type SyntheticOneAttemptReconciliation=
  | Readonly<{state:'blocked';reason:'UNCONFIRMED';request:SyntheticProcessingRequest|null}>
  | Readonly<{state:'processing';request:SyntheticProcessingRequest;lease:MediaProcessingLease}>
  | Readonly<{state:'verified';request:SyntheticProcessingRequest;lease:MediaProcessingLease;receipt:MediaVerifiedReceipt}>;
export interface SyntheticOneAttemptProcessor {
  run(input:SyntheticOneAttemptInput,options?:Readonly<{signal?:AbortSignal}>):Promise<SyntheticOneAttemptResult>;
  reconcile(binding:SyntheticProcessingBinding):Promise<SyntheticOneAttemptReconciliation>;
  close():Promise<void>;
}
export type SyntheticOneAttemptErrorCode='INVALID_CONFIGURATION'|'INVALID_INPUT'|'BUSY'|'CLOSED'|'BLOCKED'|'INTEGRITY'|'PERSISTENCE_FAILED';
export class SyntheticOneAttemptError extends Error {
  override readonly name='SyntheticOneAttemptError';
  constructor(readonly code:SyntheticOneAttemptErrorCode){super(`Synthetic one-attempt processor: ${code}.`);}
}

const now=Date.now.bind(Date),MAX_BYTES=10485760;
const nativeAborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')!.get!;
const READ_FLAGS=constants.O_RDONLY|(constants.O_NOFOLLOW??0),WRITE_FLAGS=constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0);
interface Identity {readonly location:string;readonly dev:bigint;readonly ino:bigint;readonly birthtimeNs:bigint;readonly directory:boolean;readonly size:bigint;readonly mtimeNs:bigint}
function fail(code:SyntheticOneAttemptErrorCode='BLOCKED'):never{throw new SyntheticOneAttemptError(code);}
function mapped(error:unknown):SyntheticOneAttemptError{
  if(error instanceof SyntheticOneAttemptError)return error;
  if(error instanceof SyntheticProcessingRequestError||error instanceof DurableStoreError){
    if(error.code==='INTEGRITY')return new SyntheticOneAttemptError('INTEGRITY');
    if(error.code==='PERSISTENCE_FAILED'||error.code==='IO_FAILURE')return new SyntheticOneAttemptError('PERSISTENCE_FAILED');
  }
  return new SyntheticOneAttemptError('BLOCKED');
}
function absolute(value:unknown):string{
  if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0')||(process.platform==='win32'&&path.parse(value).root.startsWith('\\\\')))fail('INVALID_CONFIGURATION');return path.resolve(value);
}
function overlap(parent:string,child:string):boolean{const relative=path.relative(parent,child);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));}
function same(a:BigIntStats,b:Identity):boolean{return a.dev===b.dev&&a.ino===b.ino&&a.birthtimeNs===b.birthtimeNs;}
async function checked(location:string,directory:boolean,expected?:Identity):Promise<Identity>{
  const stat=await lstat(location,{bigint:true}),resolved=path.resolve(await realpath(location));
  if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile()||stat.nlink!==1n)||(expected&&(!same(stat,expected)||(!directory&&(stat.size!==expected.size||stat.mtimeNs!==expected.mtimeNs))))||(process.platform==='win32'?resolved.toLowerCase()!==location.toLowerCase():resolved!==location))fail('INTEGRITY');
  return {location,dev:stat.dev,ino:stat.ino,birthtimeNs:stat.birthtimeNs,directory,size:stat.size,mtimeNs:stat.mtimeNs};
}
async function ancestry(location:string):Promise<Identity[]>{const result:Identity[]=[];for(;;){result.push(await checked(location,true));const parent=path.dirname(location);if(parent===location)return result;location=parent;}}
async function guards(values:readonly Identity[]):Promise<void>{for(const item of values)await checked(item.location,item.directory,item);}
function method(value:unknown,name:string):(...args:never[])=>unknown{
  if(!value||typeof value!=='object')fail('INVALID_CONFIGURATION');
  for(let current:object|null=value;current;current=Object.getPrototypeOf(current)){
    const descriptor=Object.getOwnPropertyDescriptor(current,name);if(!descriptor)continue;
    if(!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='function')fail('INVALID_CONFIGURATION');return Function.prototype.bind.call(descriptor.value,value) as (...args:never[])=>unknown;
  }return fail('INVALID_CONFIGURATION');
}
function storeSnapshot(value:unknown):DurableSyntheticStore{
  const row=processingData(value,['storeId','rootDirectory','install','read','close'],'INVALID_CONFIGURATION');
  return Object.freeze({storeId:processingUuid(row.storeId,'INVALID_CONFIGURATION'),rootDirectory:absolute(row.rootDirectory),install:method(value,'install') as DurableSyntheticStore['install'],read:method(value,'read') as DurableSyntheticStore['read'],close:method(value,'close') as DurableSyntheticStore['close']});
}
function outcome(value:unknown):WindowsSyntheticOutcome{
  const descriptor=value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,'state'):undefined;if(!descriptor||!Object.hasOwn(descriptor,'value'))fail();
  const unknown=descriptor.value==='containment_unknown',row=processingData(value,unknown?['state','termination','cleanupAllowed','safeCode']:['state','termination','exitCode','activeProcesses','safeCode']);
  if(typeof row.safeCode!=='string'||!/^[A-Z_]{1,64}$/.test(row.safeCode))fail();
  if(unknown){if(row.termination!=='unconfirmed'||row.cleanupAllowed!==false)fail();return Object.freeze({state:'containment_unknown',termination:'unconfirmed',cleanupAllowed:false,safeCode:row.safeCode});}
  const exit=typeof row.exitCode==='number'&&Number.isInteger(row.exitCode)&&row.exitCode>=0&&row.exitCode<=0xffffffff;
  if(!['exited','failed','timed_out','cancelled'].includes(row.state as string)||row.termination!=='job_empty'||row.activeProcesses!==0||(row.exitCode!==null&&!exit)||(row.state==='exited'&&!exit))fail();
  return Object.freeze({state:row.state as 'exited'|'failed'|'timed_out'|'cancelled',termination:'job_empty',exitCode:row.exitCode as number|null,activeProcesses:0,safeCode:row.safeCode});
}
function captureReceipt(value:unknown):MediaCaptureReceipt{
  const row=processingData(value,['jobId','generationId','inputBytes','inputSha256','capturedAt'],'INTEGRITY');
  if(typeof row.inputBytes!=='number'||!Number.isSafeInteger(row.inputBytes)||row.inputBytes<1||row.inputBytes>MAX_BYTES||typeof row.inputSha256!=='string'||!/^[a-f0-9]{64}$/.test(row.inputSha256)||!timestamp(row.capturedAt))fail();
  return Object.freeze({jobId:processingUuid(row.jobId,'INTEGRITY'),generationId:processingUuid(row.generationId,'INTEGRITY'),inputBytes:row.inputBytes,inputSha256:row.inputSha256,capturedAt:row.capturedAt});
}
function verifiedReceipt(value:unknown):MediaVerifiedReceipt{
  const row=processingData(value,['jobId','attempt','leaseNonce','outputId','manifestSha256','manifest','verifiedAt','outcome'],'INTEGRITY');
  if(typeof row.attempt!=='number'||!Number.isSafeInteger(row.attempt)||row.attempt<1||row.attempt>3||typeof row.manifestSha256!=='string'||!/^[a-f0-9]{64}$/.test(row.manifestSha256)||!timestamp(row.verifiedAt)||row.outcome!=='verified')fail();
  return Object.freeze({jobId:processingUuid(row.jobId,'INTEGRITY'),attempt:row.attempt,leaseNonce:processingUuid(row.leaseNonce,'INTEGRITY'),outputId:processingUuid(row.outputId,'INTEGRITY'),manifestSha256:row.manifestSha256,manifest:processingManifest(row.manifest,'INTEGRITY'),verifiedAt:row.verifiedAt,outcome:'verified'});
}
function timestamp(value:unknown):value is string{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value.slice(0,23)+'Z';}
function view(value:unknown):MediaProcessingView{
  const row=processingData(value,['jobId','state','capture','lease','verified'],'INTEGRITY');if(!['registered','captured','processing','verified','expired'].includes(row.state as string))fail();
  return Object.freeze({jobId:processingUuid(row.jobId,'INTEGRITY'),state:row.state as MediaProcessingView['state'],capture:row.capture===null?null:captureReceipt(row.capture),lease:row.lease===null?null:processingLease(row.lease,'INTEGRITY'),verified:row.verified===null?null:verifiedReceipt(row.verified)});
}
function captureMatches(request:SyntheticProcessingRequest,value:MediaCaptureReceipt|null):boolean{return !!value&&value.jobId===request.jobId&&value.generationId===request.generationId&&value.inputBytes===request.input.bytes&&value.inputSha256===request.input.sha256;}
function leaseMatches(request:SyntheticProcessingRequest,current:MediaProcessingView,expected?:MediaProcessingLease):boolean{return current.jobId===request.jobId&&captureMatches(request,current.capture)&&!!current.lease&&processingLeaseMatches(request,current.lease)&&(!expected||processingEqual(current.lease,expected));}
function sealMatches(request:SyntheticProcessingRequest,original:SyntheticProcessingSealRequest,current:MediaProcessingView):boolean{
  const receipt=current.verified;return current.state==='verified'&&leaseMatches(request,current,original.lease)&&!!receipt&&receipt.jobId===request.jobId&&receipt.attempt===original.seal.attempt&&receipt.leaseNonce===original.seal.leaseNonce&&receipt.outputId===original.output.objectId&&processingEqual(receipt.manifest,original.seal.manifest);
}
function inputRef(request:SyntheticProcessingRequest):DurableSyntheticReference{return Object.freeze({jobId:request.jobId,objectId:request.context.quarantineId,generationId:request.generationId,kind:'quarantine'});}
function outputRef(request:SyntheticProcessingRequest,lease:MediaProcessingLease):DurableSyntheticReference{return Object.freeze({jobId:request.jobId,objectId:request.context.outputId,generationId:lease.leaseNonce,kind:'output'});}
async function boundedFile(directory:Identity,name:string,maximum:number):Promise<Buffer>{
  await checked(directory.location,true,directory);const location=path.join(directory.location,name),initial=await checked(location,false);if(initial.size<1n||initial.size>BigInt(maximum))fail('INTEGRITY');
  const file=await open(location,READ_FLAGS);let result:Buffer;
  try{
    const before=await file.stat({bigint:true});if(!same(before,initial)||!before.isFile()||before.nlink!==1n||before.size!==initial.size||before.mtimeNs!==initial.mtimeNs)fail('INTEGRITY');
    const bytes=Buffer.alloc(Number(before.size)+1);let offset=0;while(offset<bytes.length){const read=await file.read(bytes,offset,bytes.length-offset,null);if(!read.bytesRead)break;offset+=read.bytesRead;}
    const after=await file.stat({bigint:true});if(!same(after,initial)||!after.isFile()||after.nlink!==1n||after.size!==before.size||after.mtimeNs!==before.mtimeNs||offset!==Number(before.size))fail('INTEGRITY');result=Buffer.from(bytes.subarray(0,offset));
  }finally{await file.close();}await checked(location,false,initial);await checked(directory.location,true,directory);return result;
}
async function writeSource(directory:Identity,bytes:Buffer):Promise<void>{
  await checked(directory.location,true,directory);const location=path.join(directory.location,'source.input'),file=await open(location,WRITE_FLAGS,0o600);
  try{const before=await file.stat({bigint:true});if(!before.isFile()||before.nlink!==1n)fail('INTEGRITY');let offset=0;while(offset<bytes.length){const write=await file.write(bytes,offset,bytes.length-offset,null);if(write.bytesWritten<1)fail('PERSISTENCE_FAILED');offset+=write.bytesWritten;}await file.sync();const after=await file.stat({bigint:true});if(!after.isFile()||after.nlink!==1n||after.dev!==before.dev||after.ino!==before.ino||after.size!==BigInt(bytes.length))fail('INTEGRITY');}finally{await file.close();}
  if(!(await boundedFile(directory,'source.input',MAX_BYTES)).equals(bytes))fail('INTEGRITY');
}
async function expectedFiles(directory:Identity):Promise<void>{
  await checked(directory.location,true,directory);const handle=await opendir(directory.location),seen:string[]=[];
  try{for(;;){const item=await handle.read();if(!item)break;if(seen.length>=3||!['source.input','converted.webp','manifest.json'].includes(item.name)||seen.includes(item.name)||item.isSymbolicLink()||!item.isFile())fail('INTEGRITY');seen.push(item.name);}}
  finally{await handle.close();}if(seen.length!==3)fail('INTEGRITY');await checked(directory.location,true,directory);
}

/** One fresh explicit local attempt; reconciliation returns facts and never recreates authority. */
export async function createSyntheticOneAttemptProcessor(value:SyntheticOneAttemptConfiguration):Promise<SyntheticOneAttemptProcessor>{
  let coordinator:SyntheticOneAttemptCoordinator,inputStore:DurableSyntheticStore,requestStore:DurableSyntheticStore,worker:SyntheticWorkerAdmission,journal:SyntheticAttemptJournal,supervisor:WindowsSyntheticSupervisor,nodeExecutablePath:string,codecEntryPath:string,paths:Identity[],requests:SyntheticProcessingRequests;
  try{
    const row=processingData(value,['coordinator','inputStore','requestStore','worker','journal','supervisor','nodeExecutablePath','codecEntryPath'],'INVALID_CONFIGURATION');
    coordinator=Object.freeze({readUploadContext:method(row.coordinator,'readUploadContext') as SyntheticOneAttemptCoordinator['readUploadContext'],captureInput:method(row.coordinator,'captureInput') as SyntheticOneAttemptCoordinator['captureInput'],claimProcessing:method(row.coordinator,'claimProcessing') as SyntheticOneAttemptCoordinator['claimProcessing'],readProcessing:method(row.coordinator,'readProcessing') as SyntheticOneAttemptCoordinator['readProcessing'],sealOutput:method(row.coordinator,'sealOutput') as SyntheticOneAttemptCoordinator['sealOutput']});
    inputStore=storeSnapshot(row.inputStore);requestStore=storeSnapshot(row.requestStore);
    const w=processingData(row.worker,['rootDirectory','workerId','journalId','reserve','arm','releaseBeforeLaunch','confirmTermination','inspect','close'],'INVALID_CONFIGURATION');
    worker=Object.freeze({rootDirectory:absolute(w.rootDirectory),workerId:processingUuid(w.workerId,'INVALID_CONFIGURATION'),journalId:processingUuid(w.journalId,'INVALID_CONFIGURATION'),reserve:method(row.worker,'reserve') as SyntheticWorkerAdmission['reserve'],arm:method(row.worker,'arm') as SyntheticWorkerAdmission['arm'],releaseBeforeLaunch:method(row.worker,'releaseBeforeLaunch') as SyntheticWorkerAdmission['releaseBeforeLaunch'],confirmTermination:method(row.worker,'confirmTermination') as SyntheticWorkerAdmission['confirmTermination'],inspect:method(row.worker,'inspect') as SyntheticWorkerAdmission['inspect'],close:method(row.worker,'close') as SyntheticWorkerAdmission['close']});
    const j=processingData(row.journal,['journalId','rootDirectory','attemptParent','reserve','consumeLaunchTicket','recordTermination','inspect','close'],'INVALID_CONFIGURATION');
    journal=Object.freeze({journalId:processingUuid(j.journalId,'INVALID_CONFIGURATION'),rootDirectory:absolute(j.rootDirectory),attemptParent:absolute(j.attemptParent),reserve:method(row.journal,'reserve') as SyntheticAttemptJournal['reserve'],consumeLaunchTicket:method(row.journal,'consumeLaunchTicket') as SyntheticAttemptJournal['consumeLaunchTicket'],recordTermination:method(row.journal,'recordTermination') as SyntheticAttemptJournal['recordTermination'],inspect:method(row.journal,'inspect') as SyntheticAttemptJournal['inspect'],close:method(row.journal,'close') as SyntheticAttemptJournal['close']});
    processingData(row.supervisor,['run'],'INVALID_CONFIGURATION');supervisor=Object.freeze({run:method(row.supervisor,'run') as WindowsSyntheticSupervisor['run']});nodeExecutablePath=absolute(row.nodeExecutablePath);codecEntryPath=absolute(row.codecEntryPath);
    if(worker.journalId!==journal.journalId||inputStore.storeId===requestStore.storeId||inputStore.storeId===journal.journalId||requestStore.storeId===journal.journalId||!/^node(?:\.exe)?$/i.test(path.basename(nodeExecutablePath))||! /\.(?:js|mjs)$/i.test(codecEntryPath))fail('INVALID_CONFIGURATION');
    const roots=[inputStore.rootDirectory,requestStore.rootDirectory,worker.rootDirectory,journal.rootDirectory,journal.attemptParent];for(let i=0;i<roots.length;i++)for(let k=i+1;k<roots.length;k++)if(overlap(roots[i]!,roots[k]!)||overlap(roots[k]!,roots[i]!))fail('INVALID_CONFIGURATION');
    paths=[...await ancestry(journal.attemptParent),await checked(nodeExecutablePath,false),await checked(codecEntryPath,false)];await guards(paths);requests=await createSyntheticProcessingRequests({store:requestStore});
  }catch{return fail('INVALID_CONFIGURATION');}
  let busy=false,used=false,closing=false,tail:Promise<void>=Promise.resolve(),closed:Promise<void>|undefined;
  function admitted<T>(operation:()=>Promise<T>,isRun=false,prepare?:()=>void):Promise<T>{
    if(closing)return Promise.reject(new SyntheticOneAttemptError('CLOSED'));if(busy)return Promise.reject(new SyntheticOneAttemptError('BUSY'));if(isRun&&used)return Promise.reject(new SyntheticOneAttemptError('BLOCKED'));busy=true;if(isRun)used=true;
    try{prepare?.();}catch(error){busy=false;return Promise.reject(mapped(error));}
    const work=(async()=>{try{return await operation();}catch(error){throw mapped(error);}finally{busy=false;}})();tail=work.then(()=>undefined,()=>undefined);return work;
  }
  async function actualInput(request:SyntheticProcessingRequest):Promise<Buffer>{
    if(request.inputStoreId!==inputStore.storeId)fail();const read=await inputStore.read(inputRef(request));if(read.receipt.storeId!==request.inputStoreId||read.receipt.bytes!==request.input.bytes||read.receipt.sha256!==request.input.sha256)fail();return read.data;
  }
  async function actualOutput(request:SyntheticProcessingRequest,seal:SyntheticProcessingSealRequest):Promise<void>{
    if(seal.outputStoreId!==inputStore.storeId)fail();const read=await inputStore.read(outputRef(request,seal.lease));if(read.receipt.bytes!==seal.output.bytes||read.receipt.sha256!==seal.output.sha256)fail();
  }
  async function sql<T>(jobId:string,stage:SyntheticOneAttemptStage,write:()=>Promise<T>,recover:(current:MediaProcessingView)=>T,reconciled:SyntheticOneAttemptStage[]):Promise<T>{
    try{return await write();}catch(error){if(!(error instanceof MediaCoordinatorDatabaseError)||!error.commitUncertain)throw error;const result=recover(view(await coordinator.readProcessing(jobId)));reconciled.push(stage);return result;}
  }
  function run(value:SyntheticOneAttemptInput,options:Readonly<{signal?:AbortSignal}>={}):Promise<SyntheticOneAttemptResult>{
    let binding:SyntheticProcessingBinding,source:Buffer,original:Buffer,signal:AbortSignal|undefined;
    try{
      const row=processingData(value,['jobId','claimId','generationId','input']),fields=Reflect.ownKeys(options);if(fields.some(key=>key!=='signal')||fields.length>1)fail('INVALID_INPUT');
      const option=processingData(options,fields.length?['signal']:[]);signal=option.signal as AbortSignal|undefined;
      if(signal!==undefined){const aborted=nativeAborted.call(signal);if(typeof aborted!=='boolean')fail('INVALID_INPUT');if(aborted)fail();}
      binding=processingBinding({jobId:row.jobId,claimId:row.claimId,generationId:row.generationId});if(!Buffer.isBuffer(row.input)||isSharedArrayBuffer(row.input.buffer)||row.input.length<1||row.input.length>MAX_BYTES)fail('INVALID_INPUT');original=row.input;
    }catch(error){return Promise.reject(error instanceof SyntheticOneAttemptError?error:new SyntheticOneAttemptError('INVALID_INPUT'));}
    return admitted(async()=>{
      let permit:SyntheticWorkerPermit|undefined,armed=false;const reconciled:SyntheticOneAttemptStage[]=[];
      try{
        await guards(paths);const slot=await worker.reserve({jobId:binding.jobId,claimId:binding.claimId});permit=slot.permit;
        const context=processingContext(await coordinator.readUploadContext(binding.jobId),'INTEGRITY');if(context.jobId!==binding.jobId||Date.parse(context.expiresAt)<=now())fail();
        const ref=Object.freeze({jobId:binding.jobId,objectId:context.quarantineId,generationId:binding.generationId,kind:'quarantine' as const});const installed=await inputStore.install(ref,source);
        const original=await requests.reserve({...binding,workerId:worker.workerId,journalId:journal.journalId,reservationId:slot.owner.reservationId,inputStoreId:inputStore.storeId,context,input:{generationId:binding.generationId,bytes:installed.bytes,sha256:installed.sha256}}),request=requests.consume(original.ticket);
        const capturedInput=await actualInput(request);if(!capturedInput.equals(source)||installed.bytes!==source.length||installed.sha256!==createHash('sha256').update(source).digest('hex'))fail('INTEGRITY');
        const captured=await sql(request.jobId,'capture',()=>coordinator.captureInput(request.jobId,request.input),current=>{if(current.jobId!==request.jobId||!captureMatches(request,current.capture))fail();return current.capture!;},reconciled);if(!captureMatches(request,captureReceipt(captured)))fail();
        const claimed=await sql(request.jobId,'claim',()=>coordinator.claimProcessing(request.jobId,request.claimId),current=>{if(!leaseMatches(request,current)||!current.lease)fail();return current.lease;},reconciled),lease=processingLease(claimed,'INTEGRITY');if(!processingLeaseMatches(request,lease))fail();
        const before=view(await coordinator.readProcessing(request.jobId));if(before.state!=='processing'||before.verified||!leaseMatches(request,before,lease)||Date.parse(lease.leaseExpiresAt)<=now()||Date.parse(context.expiresAt)<=now())fail();
        const attempt=await journal.reserve({jobId:request.jobId,claimId:request.claimId,attempt:lease.attempt,leaseNonce:lease.leaseNonce});
        if(attempt.intent.attemptDirectory!==path.join(journal.attemptParent,request.jobId))fail('INTEGRITY');const directory=await checked(attempt.intent.attemptDirectory,true);await writeSource(directory,capturedInput);await guards(paths);
        armed=true;await worker.arm(permit,attempt);await guards(paths);await checked(directory.location,true,directory);if(Date.parse(lease.leaseExpiresAt)<=now()||Date.parse(context.expiresAt)<=now())fail();
        let observed:WindowsSyntheticOutcome;try{observed=outcome(await supervisor.run({executablePath:nodeExecutablePath,arguments:[codecEntryPath],workingDirectory:directory.location,timeoutMs:10000,maxProcesses:1},signal===undefined?{}:{signal}));}catch{observed=Object.freeze({state:'containment_unknown',termination:'unconfirmed',cleanupAllowed:false,safeCode:'UNCONFIRMED_NATIVE_OUTCOME'});}
        const completion=await worker.confirmTermination(permit,observed);if(observed.termination!=='job_empty'||completion.state!=='job_empty')fail();
        if(observed.state!=='exited'||observed.exitCode!==0)return Object.freeze({state:'native_failed',outcome:observed});
        await guards(paths);await expectedFiles(directory);const output=await boundedFile(directory,'converted.webp',MAX_BYTES),sidecar=await boundedFile(directory,'manifest.json',4096);
        if(!(await boundedFile(directory,'source.input',MAX_BYTES)).equals(capturedInput))fail('INTEGRITY');const verified=verifySyntheticProcessReadback(capturedInput,output,sidecar);await guards(paths);await checked(directory.location,true,directory);
        const reference=outputRef(request,lease),stored=await inputStore.install(reference,verified.data);if(stored.bytes!==verified.manifest.bytes||stored.sha256!==verified.manifest.sha256)fail('INTEGRITY');
        const seal=await requests.recordSeal(original.ticket,{lease,outputStoreId:inputStore.storeId,output:{objectId:lease.outputId,generationId:lease.leaseNonce,bytes:stored.bytes,sha256:stored.sha256},seal:{attempt:lease.attempt,leaseNonce:lease.leaseNonce,manifest:verified.manifest}});await actualInput(request);await actualOutput(request,seal);
        const receipt=verifiedReceipt(await sql(request.jobId,'seal',()=>coordinator.sealOutput(request.jobId,seal.seal),current=>{if(!sealMatches(request,seal,current)||!current.verified)fail();return current.verified;},reconciled));
        if(!sealMatches(request,seal,{jobId:request.jobId,state:'verified',capture:captureReceipt(captured),lease,verified:receipt}))fail();
        return Object.freeze({state:'verified',request,lease,receipt,outputRef:reference,reconciled:Object.freeze([...reconciled])});
      }catch(error){if(permit&&!armed){try{await worker.releaseBeforeLaunch(permit);}catch{/* Retained failure is never repaired or inferred rolled back. */}}throw error;}
    },true,()=>{source=Buffer.from(original);});
  }
  function reconcile(value:SyntheticProcessingBinding):Promise<SyntheticOneAttemptReconciliation>{
    let binding:SyntheticProcessingBinding;try{binding=processingBinding(value);}catch{return Promise.reject(new SyntheticOneAttemptError('INVALID_INPUT'));}
    return admitted(async()=>{
      let request:SyntheticProcessingRequest|null=null;const blocked=():SyntheticOneAttemptReconciliation=>Object.freeze({state:'blocked',reason:'UNCONFIRMED',request});
      try{
        request=await requests.read(binding);if(request.workerId!==worker.workerId||request.journalId!==journal.journalId) return blocked();await actualInput(request);
        const current=view(await coordinator.readProcessing(request.jobId)),seal=await requests.readSeal(binding);
        if(!leaseMatches(request,current)||!current.lease)return blocked();
        if(current.verified){if(!seal||!sealMatches(request,seal,current))return blocked();await actualOutput(request,seal);return Object.freeze({state:'verified',request,lease:current.lease,receipt:current.verified});}
        if(seal)return blocked();
        if(current.state!=='processing'||Date.parse(current.lease.leaseExpiresAt)<=now()||Date.parse(request.context.expiresAt)<=now())return blocked();return Object.freeze({state:'processing',request,lease:current.lease});
      }catch(error){if((error instanceof SyntheticProcessingRequestError&&error.code==='INTEGRITY')||(error instanceof DurableStoreError&&error.code==='INTEGRITY'))throw error;return blocked();}
    });
  }
  function close():Promise<void>{closing=true;closed??=tail.then(()=>requests.close());return closed;}
  return Object.freeze({run,reconcile,close});
}
