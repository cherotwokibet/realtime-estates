import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {createDevelopmentMediaPreviewApi} from '../dist/media-preview.js';

// Boundary doubles only: these bytes prove header/hash/identity handling, not
// decoding, SQL policy, native termination or real storage correctness.
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const TENANT=id(1),ACTOR=id(11),LISTING=id(100),MEDIA=id(200),OP=id(300),JOB=id(400),INPUT=id(500),OUTPUT=id(600),GEN=id(700),CLAIM=id(800),NONCE=id(900),REQUEST_STORE=id(1000),OUTPUT_STORE=id(1001),OTHER=id(1100);
const token='eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.signature';
const route=`http://127.0.0.1/v2/staff/listings/${LISTING}/revisions/1/media/${MEDIA}/preview`;
const TIME='2026-10-12T01:02:03.123456Z',EXPIRY='2026-10-13T01:02:03.123456Z',INPUT_HASH='b'.repeat(64),SQL_MANIFEST_HASH='d'.repeat(64);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function bytes(){const value=Buffer.alloc(24);value.write('RIFF',0);value.writeUInt32LE(value.length-8,4);value.write('WEBP',8);value.write('VP8L',12);value.writeUInt32LE(4,16);value.set([1,2,3,4],20);return value;}
function facts(){
 const context={jobId:JOB,quarantineId:INPUT,outputId:OUTPUT,expiresAt:EXPIRY,pipeline:'synthetic-codec-v1'};
 const capture={jobId:JOB,generationId:GEN,inputBytes:100,inputSha256:INPUT_HASH,capturedAt:TIME};
 const lease={jobId:JOB,claimId:CLAIM,attempt:1,leaseNonce:NONCE,leaseExpiresAt:TIME,quarantineId:INPUT,outputId:OUTPUT,input:{generationId:GEN,bytes:100,sha256:INPUT_HASH},pipeline:'synthetic-codec-v1'};
 const manifest={pipeline:'synthetic-codec-v1',sourceFormat:'png',inputSha256:INPUT_HASH,inputBytes:100,format:'webp',mimeType:'image/webp',sha256:digest(bytes()),width:1,height:1,bytes:24,encoder:{sharp:'0.35.5',vips:'8.18.7'},operations:['auto-orient','resize-inside-1920-without-enlargement','strip-metadata','webp-quality-82-effort-4']};
 const verified={jobId:JOB,attempt:1,leaseNonce:NONCE,outputId:OUTPUT,manifestSha256:SQL_MANIFEST_HASH,manifest,verifiedAt:TIME,outcome:'verified'};
 return {kind:'private_media_preview',tenantId:TENANT,listingId:LISTING,revision:1,version:'3',state:'draft',mediaId:MEDIA,operationId:OP,assignedAgentId:OTHER,actorRole:'admin',context,capture,lease,verified};
}
function requestRecord(value=facts()) {return {version:1,requestStoreId:REQUEST_STORE,jobId:JOB,claimId:CLAIM,generationId:GEN,workerId:id(1200),journalId:id(1201),reservationId:id(1202),inputStoreId:OUTPUT_STORE,context:value.context,input:value.lease.input};}
function sealRecord(value=facts()){return {version:1,requestStoreId:REQUEST_STORE,jobId:JOB,claimId:CLAIM,generationId:GEN,lease:value.lease,outputStoreId:OUTPUT_STORE,output:{objectId:OUTPUT,generationId:NONCE,bytes:24,sha256:digest(bytes())},seal:{attempt:1,leaseNonce:NONCE,manifest:value.verified.manifest}};}
function outputRecord(data=bytes()){return {receipt:{version:1,storeId:OUTPUT_STORE,jobId:JOB,objectId:OUTPUT,generationId:NONCE,kind:'output',bytes:data.length,sha256:digest(data)},data};}
const sqlError=code=>Object.assign(new Error('PRIVATE SQL DETAIL'),{code});
function fixture({reads=[facts(),facts()],original=requestRecord(),sealed=sealRecord(),output=outputRecord(),verifyError,onRequest,onSeal,onOutput,prototypeDatabase=false}={}){
 const calls={verify:0,reads:0,requests:0,seals:0,outputs:0,closed:0,sql:[],order:[],transactionActive:false};
 const databaseCall=async(context,run)=>{assert.equal(context.tenantId,TENANT);assert.equal(context.actorId,ACTOR);assert.match(context.correlationId,/^[a-f0-9-]{36}$/);calls.transactionActive=true;
  try{return await run({async query(sql,args){calls.sql.push({sql,args});calls.order.push('sql');const value=reads[Math.min(calls.reads++,reads.length-1)];if(value instanceof Error)throw value;return {rows:[{receipt:value}]};}});}finally{calls.transactionActive=false;}};
 class PrototypeDatabase{transaction(context,run){return databaseCall(context,run);}}
 const options={tenant:{tenantId:TENANT,slug:'synthetic',hostnames:['127.0.0.1']},database:prototypeDatabase?new PrototypeDatabase():{transaction:databaseCall},verifyBearer:async value=>{calls.order.push('verify');calls.verify++;assert.equal(value,token);if(verifyError)throw verifyError;return {actorId:ACTOR};},processingRequests:{requestStoreId:REQUEST_STORE,
  async read(binding){calls.order.push('request');calls.requests++;assert.equal(calls.transactionActive,false);assert.deepEqual(binding,{jobId:JOB,claimId:CLAIM,generationId:GEN});await onRequest?.();if(original instanceof Error)throw original;return original;},
  async readSeal(binding){calls.order.push('seal');calls.seals++;assert.equal(calls.transactionActive,false);assert.deepEqual(binding,{jobId:JOB,claimId:CLAIM,generationId:GEN});await onSeal?.();if(sealed instanceof Error)throw sealed;return sealed;},close:async()=>{calls.closed++;}},
  outputStore:{storeId:OUTPUT_STORE,async read(reference){calls.order.push('output');calls.outputs++;assert.equal(calls.transactionActive,false);assert.deepEqual(reference,{jobId:JOB,objectId:OUTPUT,generationId:NONCE,kind:'output'});await onOutput?.();if(output instanceof Error)throw output;return output;},close:async()=>{calls.closed++;}}};
 const api=createDevelopmentMediaPreviewApi(options);
 const request=(url=route,extra={},method='GET',signal)=>new Request(url,{method,headers:{Authorization:`Bearer ${token}`,'X-Revision-Version':'3',...extra},...(signal?{signal}:{})});
 return {api,calls,request,options};
}
async function safeFailure(response,status,code){assert.equal(response.status,status);assert.equal(response.headers.get('content-type'),'application/json');const body=await response.json();assert.equal(body.error.code,code);assert.match(body.requestId,/^[a-f0-9-]{36}$/);assert.deepEqual(Object.keys(body).sort(),['error','requestId']);const source=JSON.stringify(body);for(const hidden of ['PRIVATE',JOB,CLAIM,NONCE,OUTPUT_STORE,SQL_MANIFEST_HASH])assert.equal(source.includes(hidden),false);}

test('private preview authorizes before trusted IO and again before returning exact independently hashed bytes',async()=>{
 const f=fixture();try{
  const response=await f.api.handle(f.request());assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes());
  assert.deepEqual(f.calls.order,['verify','sql','request','seal','output','sql']);assert.equal(f.calls.reads,2);assert.equal(f.calls.closed,0);
  for(const item of f.calls.sql){assert.equal(item.sql,'SELECT app_api.read_private_media_preview($1::uuid,$2::integer,$3::uuid,$4::bigint) AS receipt');assert.deepEqual(item.args,[LISTING,1,MEDIA,'3']);}
  assert.equal(response.headers.get('content-type'),'image/webp');assert.equal(response.headers.get('content-length'),'24');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('pragma'),'no-cache');assert.match(response.headers.get('cache-control'),/private/);assert.match(response.headers.get('cache-control'),/no-store/);assert.match(response.headers.get('cache-control'),/no-cache/);
  for(const field of ['etag','last-modified','accept-ranges','location','content-disposition','x-storage-key','x-output-id'])assert.equal(response.headers.get(field),null);
  assert.notEqual(SQL_MANIFEST_HASH,digest(Buffer.from(JSON.stringify(facts().verified.manifest))),'Fixture deliberately preserves SQL digest instead of hashing JavaScript serialization.');
 }finally{await f.api.close();}assert.equal(f.calls.closed,0);
});

test('trusted prototype database instances work and store IDs/read methods are captured at construction',async()=>{
 const f=fixture({prototypeDatabase:true});try{f.options.processingRequests.requestStoreId=OTHER;f.options.outputStore.storeId=OTHER;f.options.outputStore.read=()=>{throw new Error('mutated callback');};assert.equal((await f.api.handle(f.request())).status,200);}finally{await f.api.close();}
});

test('verified bearer is required before SQL or any request/seal/output IO',async()=>{
 for(const authorization of ['',`Bearer ${token}, Bearer ${token}`,'Bearer private']){const f=fixture();try{await safeFailure(await f.api.handle(f.request(route,{Authorization:authorization})),401,'UNAUTHENTICATED');assert.equal(f.calls.reads,0);assert.equal(f.calls.requests,0);}finally{await f.api.close();}}
 const f=fixture({verifyError:new Error('PRIVATE ISSUER')});try{await safeFailure(await f.api.handle(f.request()),401,'UNAUTHENTICATED');assert.equal(f.calls.reads,0);assert.equal(f.calls.outputs,0);}finally{await f.api.close();}
});

test('current foreign/customer/revoked/missing and stale SQL denial occurs before any configured IO',async()=>{
 for(const [value,status,code] of [[sqlError('P0002'),404,'NOT_FOUND'],[sqlError('42501'),404,'NOT_FOUND'],[sqlError('40001'),409,'VERSION_CONFLICT'],[sqlError('08006'),503,'SERVICE_UNAVAILABLE']]){
  const f=fixture({reads:[value]});try{await safeFailure(await f.api.handle(f.request()),status,code);assert.equal(f.calls.reads,1);assert.equal(f.calls.requests,0);assert.equal(f.calls.seals,0);assert.equal(f.calls.outputs,0);}finally{await f.api.close();}
 }
});

test('removal/revocation/stale changes found after IO never emit image bytes or rerun the reads',async()=>{
 for(const [value,status,code] of [[sqlError('P0002'),404,'NOT_FOUND'],[sqlError('42501'),404,'NOT_FOUND'],[sqlError('40001'),409,'VERSION_CONFLICT']]){
  const f=fixture({reads:[facts(),value]});try{await safeFailure(await f.api.handle(f.request()),status,code);assert.equal(f.calls.reads,2);assert.equal(f.calls.outputs,1);assert.equal(f.calls.requests,1);assert.equal(f.calls.seals,1);}finally{await f.api.close();}
 }
});

test('before/after entire authorization fingerprint and SQL manifest identity must remain unchanged',async()=>{
 const variants=[{assignedAgentId:id(1101)},{actorRole:'agent',assignedAgentId:ACTOR},{operationId:id(301)}, {verified:{...facts().verified,manifestSha256:'e'.repeat(64)}},{capture:{...facts().capture,capturedAt:'2026-10-12T01:02:04.123456Z'}}];
 for(const patch of variants){const f=fixture({reads:[facts(),{...facts(),...patch}]});try{await safeFailure(await f.api.handle(f.request()),503,'SERVICE_UNAVAILABLE');assert.equal(f.calls.outputs,1);assert.equal(f.calls.reads,2);}finally{await f.api.close();}}
});

test('current assigned agent and admin can read a sealed association without original uploader ownership',async()=>{
 for(const role of [{actorRole:'agent',assignedAgentId:ACTOR},{actorRole:'admin',assignedAgentId:null},{actorRole:'admin',assignedAgentId:OTHER}]){const value={...facts(),...role},f=fixture({reads:[value,value]});try{assert.equal((await f.api.handle(f.request())).status,200);}finally{await f.api.close();}}
 const f=fixture({reads:[{...facts(),actorRole:'agent'}]});try{await safeFailure(await f.api.handle(f.request()),503,'SERVICE_UNAVAILABLE');assert.equal(f.calls.requests,0);}finally{await f.api.close();}
});

test('malformed joined SQL facts and future/private fields fail closed before IO',async()=>{
 const root=facts(),missing=facts();delete missing.operationId;let getters=0;const accessor=facts();Object.defineProperty(accessor,'context',{enumerable:true,get(){getters++;return root.context;}});
 const invalid=[null,missing,accessor,new Proxy(facts(),{}),{...facts(),privatePath:'PRIVATE'},...['tenantId','listingId','mediaId'].map(key=>({...facts(),[key]:OTHER})),{...facts(),revision:2},{...facts(),version:'4'},{...facts(),state:'pending'},{...facts(),actorRole:'customer'},
  {...facts(),context:{...root.context,outputId:INPUT}},{...facts(),capture:{...root.capture,generationId:OTHER}},{...facts(),capture:{...root.capture,inputBytes:101}},{...facts(),lease:{...root.lease,attempt:2}},{...facts(),lease:{...root.lease,quarantineId:OTHER}},{...facts(),verified:{...root.verified,outcome:'processing'}},{...facts(),verified:{...root.verified,manifestSha256:'BAD'}},{...facts(),verified:{...root.verified,manifest:{...root.verified.manifest,accepted:true}}}];
 for(const value of invalid){const f=fixture({reads:[value]});try{await safeFailure(await f.api.handle(f.request()),503,'SERVICE_UNAVAILABLE');assert.equal(f.calls.requests,0);}finally{await f.api.close();}}assert.equal(getters,0);
});

test('configured original processing request is exact and cannot select another principal context or store',async()=>{
 for(const patch of [{version:2},{requestStoreId:OTHER},{inputStoreId:OTHER},{jobId:OTHER},{claimId:OTHER},{generationId:OTHER},{workerId:'bad'},{context:{...facts().context,outputId:OTHER}},{input:{...facts().lease.input,sha256:'a'.repeat(64)}},{storagePath:'PRIVATE'}]){
  const f=fixture({original:{...requestRecord(),...patch}});try{await safeFailure(await f.api.handle(f.request()),503,'SERVICE_UNAVAILABLE');assert.equal(f.calls.requests,1);assert.equal(f.calls.seals,0);assert.equal(f.calls.outputs,0);}finally{await f.api.close();}
 }
});

test('original seal must match configured request/output stores and complete SQL lease/manifest provenance',async()=>{
 const value=sealRecord();
 for(const sealed of [null,{...value,version:2},{...value,requestStoreId:OTHER},{...value,outputStoreId:OTHER},{...value,jobId:OTHER},{...value,claimId:OTHER},{...value,generationId:OTHER},{...value,lease:{...value.lease,leaseNonce:OTHER}},{...value,output:{...value.output,objectId:OTHER}},{...value,output:{...value.output,generationId:OTHER}},{...value,output:{...value.output,bytes:23}},{...value,seal:{...value.seal,attempt:2}},{...value,seal:{...value.seal,manifest:{...value.seal.manifest,width:2}}}]){
  const f=fixture({sealed});try{await safeFailure(await f.api.handle(f.request()),503,'SERVICE_UNAVAILABLE');assert.equal(f.calls.requests,1);assert.equal(f.calls.seals,1);assert.equal(f.calls.outputs,0);}finally{await f.api.close();}
 }
});

test('output receipt, bound object identity, byte count and actual hash must all agree',async()=>{
 const value=outputRecord(),changed=bytes();changed[23]^=1;
 for(const output of [{...value,data:changed},{...value,data:Buffer.alloc(0)},{...value,data:Buffer.alloc(10485761)},{...value,data:new Uint8Array(bytes())},...['storeId','jobId','objectId','generationId'].map(key=>({...value,receipt:{...value.receipt,[key]:OTHER}})),{...value,receipt:{...value.receipt,kind:'quarantine'}},{...value,receipt:{...value.receipt,bytes:23}},{...value,receipt:{...value.receipt,sha256:'a'.repeat(64)}},{...value,privatePath:'PRIVATE'}]){
  const f=fixture({output});try{await safeFailure(await f.api.handle(f.request()),503,'SERVICE_UNAVAILABLE');assert.equal(f.calls.outputs,1);assert.equal(f.calls.reads,1);}finally{await f.api.close();}
 }
});

test('independently matching hashes still cannot authorize wrong RIFF/WebP header or RIFF length',async()=>{
 const wrongType=bytes();wrongType.write('PNG!',8);const wrongLength=bytes();wrongLength.writeUInt32LE(3,4);const highBit=bytes();highBit[0]|=128;
 for(const data of [wrongType,wrongLength,highBit]){
  const value=facts();value.verified.manifest.sha256=digest(data);const sealed=sealRecord(value);sealed.output.sha256=digest(data);const f=fixture({reads:[value],original:requestRecord(value),sealed,output:outputRecord(data)});
  try{await safeFailure(await f.api.handle(f.request()),503,'SERVICE_UNAVAILABLE');assert.equal(f.calls.outputs,1);assert.equal(f.calls.reads,1);}finally{await f.api.close();}
 }
});

test('returned bytes are an owned immutable snapshot across the post-IO authorization await',async()=>{
 const output=outputRecord(),reads=[facts(),facts()],f=fixture({output});let secondRead=false;
 const database={async transaction(context,run){return f.options.database.transaction(context,async query=>run({async query(sql,args){const result=await query.query(sql,args);if(f.calls.reads===2){output.data.fill(9);secondRead=true;}return result;}}));}};
 const api=createDevelopmentMediaPreviewApi({...f.options,database});try{const response=await api.handle(f.request());assert.equal(response.status,200);assert.equal(secondRead,true);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes());}finally{await api.close();await f.api.close();}
});

test('exact loopback URL/method/version and header denials occur before verification or IO',async()=>{
 for(const [url,extra,method,status] of [[route+'?mediaId='+OTHER,{},'GET',404],[route+'#fragment',{},'GET',404],[route+'/',{},'GET',404],[route.replace('http:','https:'),{},'GET',404],[route.replace('127.0.0.1','evil.invalid'),{},'GET',404],[route.replace('/revisions/1/','/revisions/2147483648/'),{},'GET',400],[route,{},'HEAD',405],[route,{},'POST',405],[route,{Host:'evil.invalid'},'GET',404],[route,{Origin:'http://evil.invalid'},'GET',403]]){
  const f=fixture();try{await safeFailure(await f.api.handle(f.request(url,extra,method)),status,status===404?'NOT_FOUND':status===405?'METHOD_NOT_ALLOWED':status===403?'FORBIDDEN':'INVALID_INPUT');assert.equal(f.calls.verify,0);assert.equal(f.calls.reads,0);assert.equal(f.calls.requests,0);}finally{await f.api.close();}
 }
 for(const extra of [{'Content-Length':'0'},{'Content-Length':'1'},{'Transfer-Encoding':'chunked'},{'Content-Type':'image/webp'},{'Content-Encoding':'identity'},{Cookie:'session=forged'},{Expect:'100-continue'},{Range:'bytes=0-1'},{'If-Range':'tag'},{'If-Match':'tag'},{'If-None-Match':'tag'},{'If-Modified-Since':TIME},{'If-Unmodified-Since':TIME}]){
  const f=fixture();try{await safeFailure(await f.api.handle(f.request(route,extra)),400,'INVALID_INPUT');assert.equal(f.calls.verify,0);assert.equal(f.calls.requests,0);}finally{await f.api.close();}
 }
});

test('preview version is an explicit canonical positive safe decimal and preserves maximum string identity',async()=>{
 for(const header of ['', '0','01','-1','3e0','3.0','3,3','9007199254740992']){const f=fixture();try{await safeFailure(await f.api.handle(f.request(route,{'X-Revision-Version':header})),400,'INVALID_INPUT');assert.equal(f.calls.reads,0);}finally{await f.api.close();}}
 const missing=fixture();try{const request=missing.request();request.headers.delete('x-revision-version');await safeFailure(await missing.api.handle(request),400,'INVALID_INPUT');assert.equal(missing.calls.verify,0);}finally{await missing.api.close();}
 const value={...facts(),version:'9007199254740991'},f=fixture({reads:[value,value]});try{assert.equal((await f.api.handle(f.request(route,{'X-Revision-Version':value.version}))).status,200);assert.equal(f.calls.sql[0].args[3],value.version);}finally{await f.api.close();}
});

test('any GET body is refused without iteration, including an empty stream representation',async()=>{
 let iterations=0;const f=fixture();try{const request=f.request();Object.defineProperty(request,'body',{value:new ReadableStream({pull(controller){iterations++;controller.close();}})});await safeFailure(await f.api.handle(request),400,'INVALID_INPUT');assert.equal(f.calls.reads,0);assert.equal(f.calls.requests,0);assert.ok(iterations<=1);}finally{await f.api.close();}
});

test('cancellation before authorization and during configured IO returns no image and grants no continuation',async()=>{
 const before=new AbortController();before.abort();const f=fixture();try{await safeFailure(await f.api.handle(f.request(route,{},'GET',before.signal)),400,'REQUEST_ABORTED');assert.equal(f.calls.verify,0);}finally{await f.api.close();}
 const during=new AbortController(),g=fixture({onOutput:()=>during.abort()});try{await safeFailure(await g.api.handle(g.request(route,{},'GET',during.signal)),400,'REQUEST_ABORTED');assert.equal(g.calls.outputs,1);assert.equal(g.calls.reads,1);}finally{await g.api.close();}
});

test('close drains admitted reads, rejects new admission and leaves caller-owned stores open',async()=>{
 let unblock,entered;const paused=new Promise(resolve=>{unblock=resolve;}),started=new Promise(resolve=>{entered=resolve;}),f=fixture({onOutput:async()=>{entered();await paused;}});
 const pending=f.api.handle(f.request());await started;let closed=false;const closure=f.api.close().then(()=>{closed=true;});await Promise.resolve();assert.equal(closed,false);
 await safeFailure(await f.api.handle(f.request()),503,'SERVICE_UNAVAILABLE');assert.equal(f.calls.outputs,1);unblock();assert.equal((await pending).status,200);await closure;await f.api.close();assert.equal(closed,true);assert.equal(f.calls.closed,0);
});

test('trusted construction refuses production and accessor/proxy/ambiguous store authority without invoking getters',async()=>{
 const f=fixture();try{
  let getters=0;const getter={...f.options.outputStore};Object.defineProperty(getter,'storeId',{enumerable:true,get(){getters++;return OUTPUT_STORE;}});
  const dbGetter={get transaction(){getters++;return ()=>{};}};
  for(const options of [{...f.options,outputStore:getter},{...f.options,database:dbGetter},{...f.options,outputStore:new Proxy(f.options.outputStore,{})},{...f.options,processingRequests:{...f.options.processingRequests,requestStoreId:OUTPUT_STORE}},{...f.options,privatePath:'PRIVATE'}])assert.throws(()=>createDevelopmentMediaPreviewApi(options),/Invalid trusted/);
  assert.equal(getters,0);const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';try{assert.throws(()=>createDevelopmentMediaPreviewApi(f.options),/development-only/);}finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
 }finally{await f.api.close();}
});
