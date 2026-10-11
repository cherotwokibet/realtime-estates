import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {isProxy} from 'node:util/types';
import {readSyntheticUploadBody,SyntheticUploadBodyError,type SyntheticUploadBodyOptions} from './upload-body.js';
import type {SyntheticUploadRequest,SyntheticUploadRequests} from './upload-request.js';
import type {SyntheticOneAttemptProcessor} from './one-attempt.js';
import {processingData,processingLease,processingLeaseMatches,processingManifest,processingUuid,type SyntheticProcessingRequest} from './processing-request.js';

/** Trusted configured tenant and verified actor, plus exact registered-job URL tuple. */
export interface SyntheticUploadResource {
  readonly tenantId:string;readonly actorId:string;readonly listingId:string;readonly revision:number;readonly jobId:string;readonly uploadId:string;
}
export interface SyntheticUploadServiceResult {
  readonly uploadId:string;readonly jobId:string;readonly listingId:string;readonly revision:number;
  readonly state:'verified'|'processing'|'blocked'|'native_failed';
}
export interface SyntheticUploadServiceConfiguration {
  readonly requests:SyntheticUploadRequests;
  readonly createProcessor:()=>Promise<SyntheticOneAttemptProcessor>;
  readonly authorize:(resource:SyntheticUploadResource,purpose:'new'|'history')=>Promise<void>;
}
export interface SyntheticUploadService {
  upload(resource:SyntheticUploadResource,source:AsyncIterable<Uint8Array>,options?:SyntheticUploadBodyOptions):Promise<SyntheticUploadServiceResult>;
  read(resource:SyntheticUploadResource):Promise<SyntheticUploadServiceResult>;
  /** Drains this adapter only. Caller-owned request, worker and storage roots stay open. */
  close():Promise<void>;
}
export type SyntheticUploadServiceErrorCode='INVALID_CONFIGURATION'|'INVALID_INPUT'|'NOT_AUTHORIZED'|'BUSY'|'CLOSED'|'BLOCKED';
export class SyntheticUploadServiceError extends Error {
  override readonly name='SyntheticUploadServiceError';
  constructor(readonly code:SyntheticUploadServiceErrorCode){super(`Synthetic upload service: ${code}.`);}
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,MAX_BYTES=10485760;
const RESOURCE_KEYS=['tenantId','actorId','listingId','revision','jobId','uploadId'] as const;
const REQUEST_KEYS=['version','requestStoreId','uploadId','tenantId','actorId','listingId','revision','jobId','claimId','generationId','input'] as const;
const PROCESSING_KEYS=['version','requestStoreId','jobId','claimId','generationId','workerId','journalId','reservationId','inputStoreId','context','input'] as const;
const aborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')!.get!;
type Code=SyntheticUploadServiceErrorCode;
function fail(code:Code='BLOCKED'):never{throw new SyntheticUploadServiceError(code);}
function mapped(error:unknown):SyntheticUploadServiceError|SyntheticUploadBodyError{
  if(error instanceof SyntheticUploadServiceError||error instanceof SyntheticUploadBodyError)return error;
  return new SyntheticUploadServiceError('BLOCKED');
}
function data(value:unknown,keys:readonly string[],code:Code='BLOCKED'):Record<string,unknown>{
  if(!value||typeof value!=='object'||isProxy(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))fail(code);
  const own=Reflect.ownKeys(value),snapshot:Record<string,unknown>={};if(own.length!==keys.length)fail(code);
  for(const key of own){if(typeof key!=='string'||!keys.includes(key))fail(code);const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))fail(code);snapshot[key]=descriptor.value;}return snapshot;
}
function uuid(value:unknown,code:Code='BLOCKED'):string{if(typeof value!=='string'||!UUID.test(value))fail(code);return value.toLowerCase();}
function revision(value:unknown,code:Code='BLOCKED'):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>2147483647)fail(code);return value;}
function resource(value:unknown):SyntheticUploadResource{
  const row=data(value,RESOURCE_KEYS,'INVALID_INPUT');return Object.freeze({tenantId:uuid(row.tenantId,'INVALID_INPUT'),actorId:uuid(row.actorId,'INVALID_INPUT'),listingId:uuid(row.listingId,'INVALID_INPUT'),revision:revision(row.revision,'INVALID_INPUT'),jobId:uuid(row.jobId,'INVALID_INPUT'),uploadId:uuid(row.uploadId,'INVALID_INPUT')});
}
function options(value:SyntheticUploadBodyOptions):SyntheticUploadBodyOptions{
  if(!value||typeof value!=='object'||isProxy(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))fail('INVALID_INPUT');
  const keys=Reflect.ownKeys(value);if(keys.some(key=>typeof key!=='string'||!['signal','declaredBytes','timeoutMs'].includes(key)))fail('INVALID_INPUT');
  const row=data(value,keys as string[],'INVALID_INPUT'),signal=row.signal,declaredBytes=row.declaredBytes,timeoutMs=row.timeoutMs;
  if(signal!==undefined){if(isProxy(signal))fail('INVALID_INPUT');try{Reflect.apply(aborted,signal,[]);}catch{fail('INVALID_INPUT');}}
  if(declaredBytes!==undefined&&(typeof declaredBytes!=='number'||!Number.isSafeInteger(declaredBytes)||declaredBytes<1||declaredBytes>MAX_BYTES))fail('INVALID_INPUT');
  if(timeoutMs!==undefined&&(typeof timeoutMs!=='number'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000))fail('INVALID_INPUT');
  return Object.freeze({...signal===undefined?{}:{signal:signal as AbortSignal},...declaredBytes===undefined?{}:{declaredBytes:declaredBytes as number},...timeoutMs===undefined?{}:{timeoutMs:timeoutMs as number}});
}
function request(value:unknown,expected:SyntheticUploadResource,requestStoreId:string):SyntheticUploadRequest{
  const row=data(value,REQUEST_KEYS),input=data(row.input,['bytes','sha256']);
  if(row.version!==1||row.requestStoreId!==requestStoreId||RESOURCE_KEYS.some(key=>row[key]!==expected[key])||typeof input.bytes!=='number'||!Number.isSafeInteger(input.bytes)||input.bytes<1||input.bytes>MAX_BYTES||typeof input.sha256!=='string'||!/^[a-f0-9]{64}$/.test(input.sha256))fail();
  const claimId=uuid(row.claimId),generationId=uuid(row.generationId);if(claimId===generationId||[expected.jobId,expected.uploadId].includes(claimId)||[expected.jobId,expected.uploadId].includes(generationId))fail();
  return Object.freeze({version:1,requestStoreId,uploadId:expected.uploadId,tenantId:expected.tenantId,actorId:expected.actorId,listingId:expected.listingId,revision:expected.revision,jobId:expected.jobId,claimId,generationId,input:Object.freeze({bytes:input.bytes,sha256:input.sha256})});
}
function equal(a:unknown,b:unknown):boolean{return JSON.stringify(a)===JSON.stringify(b);}
function processingRequest(value:unknown,original:SyntheticUploadRequest):SyntheticProcessingRequest{
  const row=processingData(value,PROCESSING_KEYS,'INTEGRITY'),input=processingData(row.input,['generationId','bytes','sha256'],'INTEGRITY');
  if(row.version!==1||row.jobId!==original.jobId||row.claimId!==original.claimId||row.generationId!==original.generationId||input.generationId!==original.generationId||input.bytes!==original.input.bytes||input.sha256!==original.input.sha256)fail();
  const context=processingData(row.context,['jobId','quarantineId','outputId','expiresAt','pipeline'],'INTEGRITY');
  if(context.jobId!==original.jobId||context.pipeline!=='synthetic-codec-v1')fail();
  // The processor validates its full private persisted records and actual byte
  // readback. This join independently binds that proof to the original admission.
  for(const key of ['requestStoreId','workerId','journalId','reservationId','inputStoreId'])processingUuid(row[key],'INTEGRITY');
  return value as SyntheticProcessingRequest;
}
function processingResult(value:unknown,original:SyntheticUploadRequest,recovery:boolean):SyntheticUploadServiceResult['state']{
  if(!value||typeof value!=='object'||isProxy(value))fail();const state=Object.getOwnPropertyDescriptor(value,'state');if(!state?.enumerable||!Object.hasOwn(state,'value'))fail();
  if(state.value==='blocked'&&recovery){const row=data(value,['state','reason','request']);if(row.reason!=='UNCONFIRMED')fail();if(row.request!==null)processingRequest(row.request,original);return 'blocked';}
  if(state.value==='native_failed'&&!recovery){
    const row=data(value,['state','outcome']),outcome=data(row.outcome,['state','termination','exitCode','activeProcesses','safeCode']);
    if(!['failed','timed_out','cancelled','exited'].includes(String(outcome.state))||outcome.termination!=='job_empty'||outcome.activeProcesses!==0||typeof outcome.safeCode!=='string'||!/^[A-Z_]{1,64}$/.test(outcome.safeCode)||(outcome.exitCode!==null&&(typeof outcome.exitCode!=='number'||!Number.isInteger(outcome.exitCode)||outcome.exitCode<0||outcome.exitCode>0xffffffff))||(outcome.state==='exited'&&(outcome.exitCode===null||outcome.exitCode===0)))fail();return 'native_failed';
  }
  if(state.value!=='verified'&&!(state.value==='processing'&&recovery))fail();
  const row=data(value,state.value==='processing'?['state','request','lease']:recovery?['state','request','lease','receipt']:['state','request','lease','receipt','outputRef','reconciled']);
  const persisted=processingRequest(row.request,original),lease=processingLease(row.lease,'INTEGRITY');if(!processingLeaseMatches(persisted,lease))fail();
  if(state.value==='processing')return 'processing';
  const receipt=processingData(row.receipt,['jobId','attempt','leaseNonce','outputId','manifestSha256','manifest','verifiedAt','outcome'],'INTEGRITY'),manifest=processingManifest(receipt.manifest,'INTEGRITY');
  if(receipt.jobId!==original.jobId||receipt.attempt!==lease.attempt||receipt.leaseNonce!==lease.leaseNonce||receipt.outputId!==lease.outputId||receipt.outcome!=='verified'||typeof receipt.manifestSha256!=='string'||!/^[a-f0-9]{64}$/.test(receipt.manifestSha256)||manifest.inputBytes!==original.input.bytes||manifest.inputSha256!==original.input.sha256||typeof receipt.verifiedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(receipt.verifiedAt)||!Number.isFinite(Date.parse(receipt.verifiedAt))||new Date(receipt.verifiedAt).toISOString()!==receipt.verifiedAt.slice(0,23)+'Z')fail();
  if(!recovery){const output=data(row.outputRef,['jobId','objectId','generationId','kind']);if(output.jobId!==original.jobId||output.objectId!==lease.outputId||output.generationId!==lease.leaseNonce||output.kind!=='output'||!Array.isArray(row.reconciled)||row.reconciled.some(stage=>!['capture','claim','seal'].includes(stage)))fail();}
  return 'verified';
}
function projected(original:SyntheticUploadRequest,state:SyntheticUploadServiceResult['state']):SyntheticUploadServiceResult{return Object.freeze({uploadId:original.uploadId,jobId:original.jobId,listingId:original.listingId,revision:original.revision,state});}
function processor(value:unknown):SyntheticOneAttemptProcessor{
  const row=data(value,['run','reconcile','close']);for(const key of ['run','reconcile','close'])if(typeof row[key]!=='function')fail();
  const source=value as SyntheticOneAttemptProcessor;return Object.freeze({run:(row.run as SyntheticOneAttemptProcessor['run']).bind(source),reconcile:(row.reconcile as SyntheticOneAttemptProcessor['reconcile']).bind(source),close:(row.close as SyntheticOneAttemptProcessor['close']).bind(source)});
}

/**
 * Local synthetic orchestration only. The injected authorizer must validate the
 * currently verified principal and registered job in a completed short transaction.
 * New work additionally requires current draft/expiry/registered-assignee eligibility;
 * history requires current same-requester access, without manufacturing new authority.
 * No HTTP, identity provider, native restart, attach/finalize or production boundary.
 */
export function createSyntheticUploadService(value:SyntheticUploadServiceConfiguration):SyntheticUploadService{
  let requests:SyntheticUploadRequests,createProcessor:SyntheticUploadServiceConfiguration['createProcessor'],authorize:SyntheticUploadServiceConfiguration['authorize'];
  try{
    const row=data(value,['requests','createProcessor','authorize'],'INVALID_CONFIGURATION'),store=data(row.requests,['requestStoreId','rootDirectory','reserve','consume','read','close'],'INVALID_CONFIGURATION');
    if(typeof row.createProcessor!=='function'||typeof row.authorize!=='function'||typeof store.rootDirectory!=='string'||!store.rootDirectory||['reserve','consume','read','close'].some(key=>typeof store[key]!=='function'))fail('INVALID_CONFIGURATION');
    const source=row.requests as SyntheticUploadRequests;requests=Object.freeze({requestStoreId:uuid(store.requestStoreId,'INVALID_CONFIGURATION'),rootDirectory:store.rootDirectory,reserve:(store.reserve as SyntheticUploadRequests['reserve']).bind(source),consume:(store.consume as SyntheticUploadRequests['consume']).bind(source),read:(store.read as SyntheticUploadRequests['read']).bind(source),close:(store.close as SyntheticUploadRequests['close']).bind(source)});createProcessor=row.createProcessor as typeof createProcessor;authorize=row.authorize as typeof authorize;
  }catch{return fail('INVALID_CONFIGURATION');}
  let busy=false,closing=false,closed:Promise<void>|undefined;const active=new Set<Promise<unknown>>();
  function tracked<T>(operation:()=>Promise<T>):Promise<T>{const work=operation().catch(error=>{throw mapped(error);});active.add(work);void work.finally(()=>active.delete(work)).catch(()=>undefined);return work;}
  function upload(value:SyntheticUploadResource,source:AsyncIterable<Uint8Array>,suppliedOptions:SyntheticUploadBodyOptions={}):Promise<SyntheticUploadServiceResult>{
    if(closing)return Promise.reject(new SyntheticUploadServiceError('CLOSED'));if(busy)return Promise.reject(new SyntheticUploadServiceError('BUSY'));
    let expected:SyntheticUploadResource,config:SyntheticUploadBodyOptions;try{expected=resource(value);config=options(suppliedOptions);}catch(error){return Promise.reject(mapped(error));}busy=true;
    return tracked(async()=>{
      let runner:SyntheticOneAttemptProcessor|undefined;
      try{
        await authorize(expected,'new');const bytes=await readSyntheticUploadBody(source,config);await authorize(expected,'new');
        if(config.signal&&Reflect.apply(aborted,config.signal,[]))throw new SyntheticUploadBodyError('ABORTED');
        const reserved=await requests.reserve({...expected,input:bytes}),original=request(reserved.request,expected,requests.requestStoreId),consumed=request(requests.consume(reserved.ticket),expected,requests.requestStoreId);
        if(!equal(original,consumed)||original.input.bytes!==bytes.length||original.input.sha256!==createHash('sha256').update(bytes).digest('hex'))fail();
        runner=processor(await createProcessor());const result=await runner.run({jobId:original.jobId,claimId:original.claimId,generationId:original.generationId,input:bytes},config.signal===undefined?{}:{signal:config.signal});return projected(original,processingResult(result,original,false));
      }finally{try{await runner?.close();}finally{busy=false;}}
    });
  }
  function read(value:SyntheticUploadResource):Promise<SyntheticUploadServiceResult>{
    if(closing)return Promise.reject(new SyntheticUploadServiceError('CLOSED'));let expected:SyntheticUploadResource;try{expected=resource(value);}catch(error){return Promise.reject(mapped(error));}
    return tracked(async()=>{let runner:SyntheticOneAttemptProcessor|undefined;try{await authorize(expected,'history');const original=request(await requests.read({jobId:expected.jobId,uploadId:expected.uploadId}),expected,requests.requestStoreId);runner=processor(await createProcessor());const observed=await runner.reconcile({jobId:original.jobId,claimId:original.claimId,generationId:original.generationId});return projected(original,processingResult(observed,original,true));}finally{await runner?.close();}});
  }
  function close():Promise<void>{closing=true;closed??=Promise.allSettled([...active]).then(()=>undefined);return closed;}
  return Object.freeze({upload,read,close});
}
