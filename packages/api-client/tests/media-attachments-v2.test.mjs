import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiClientError,RealtorApiClient} from '../dist/index.js';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ID=id(100),OP=id(500),JOB=id(600),OTHER=id(700),MEDIA=id(800);
const input={operationId:OP,jobId:JOB,expectedVersion:'2'},options={bearerToken:'synthetic-staff'};
const facts={kind:'attach_media',operationId:OP,jobId:JOB,listingId:ID,revision:2,expectedVersion:'2'};
const ready=(patch={})=>({...facts,altText:'Synthetic entrance',status:'ready',receipt:null,...patch});
const applied=(patch={})=>ready({status:'applied',receipt:{...facts,version:'3',outcome:'applied',reason:null,mediaId:MEDIA,position:0,completedAt:'2020-01-01T00:00:00.000Z',...patch}});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const raw=value=>new Response(value,{headers:{'Content-Type':'application/json'}});
const client=fetch=>new RealtorApiClient({baseUrl:'https://attach.example.invalid',privacyNoticeVersion:'synthetic-v1',fetch});
const reject=(operation,kind,uncertain=false)=>assert.rejects(operation,error=>error instanceof ApiClientError&&error.kind===kind&&error.submissionUncertain===uncertain);

test('attach calls require per-call bearer and public requests retain no credentials',async()=>{
 const calls=[],api=client(async(url,init)=>{calls.push({url,init});return json(url.includes('/v1/properties')?{items:[],limit:50}:ready());});
 for(const opts of [{},undefined,{bearerToken:''},{bearerToken:'bad\r\nheader'}]){
  await reject(()=>api.createMediaAttachIntentV2(ID,2,input,opts),'VALIDATION');await reject(()=>api.getMediaAttachIntentV2(ID,2,OP,opts),'VALIDATION');
 }
 assert.equal(calls.length,0);await api.createMediaAttachIntentV2(ID,2,input,{bearerToken:'one'});await api.getMediaAttachIntentV2(ID,2,OP,{bearerToken:'two'});await api.listProperties();
 assert.deepEqual(calls.map(call=>call.init.headers.Authorization),['Bearer one','Bearer two',undefined]);
});
test('attach sends the exact tuple and original command while ready remains an acknowledgement',async()=>{
 let seen;const result=await client(async(url,init)=>{seen={url,init};return json(ready());}).createMediaAttachIntentV2(ID.toUpperCase(),2,{...input,operationId:OP.toUpperCase(),jobId:JOB.toUpperCase()},options);
 assert.deepEqual(result,ready());assert.ok(Object.isFrozen(result));assert.equal(result.receipt,null);
 assert.equal(seen.url,`https://attach.example.invalid/v2/staff/listings/${ID}/revisions/2/media-attach-intents`);
 assert.equal(seen.init.method,'POST');assert.equal(seen.init.credentials,'omit');assert.equal(seen.init.redirect,'error');assert.equal(seen.init.cache,'no-store');
 assert.deepEqual(JSON.parse(seen.init.body),{operationId:OP,jobId:JOB,expectedVersion:2});assert.equal(seen.init.headers['Idempotency-Key'],undefined);
});
test('attach snapshots strict own input data before transport and explicit replay retains body',async()=>{
 const mutable={...input},bodies=[],api=client(async(_,init)=>{bodies.push(init.body);mutable.expectedVersion='3';mutable.jobId=OTHER;return json(ready());});
 assert.deepEqual(await api.createMediaAttachIntentV2(ID,2,mutable,options),ready());assert.deepEqual(await api.createMediaAttachIntentV2(ID,2,{...input},options),ready());assert.equal(bodies[0],bodies[1]);
 let getters=0;const accessor={...input};Object.defineProperty(accessor,'jobId',{enumerable:true,get(){getters++;return JOB;}});
 const symbol={...input,[Symbol('secret')]:true},hidden={...input};Object.defineProperty(hidden,'private',{value:true});
 const inherited=Object.assign(Object.create({hidden:'secret'}),input);
 let calls=0;const invalidApi=client(async()=>{calls++;return json(ready());});
 for(const value of [accessor,symbol,hidden,inherited])await reject(()=>invalidApi.createMediaAttachIntentV2(ID,2,value,options),'VALIDATION');
 assert.equal(getters,0);assert.equal(calls,0);
});
test('attach validates original UUIDs, exact fields and the supported incrementable version before transport',async()=>{
 let calls=0;const api=client(async(_,init)=>{calls++;return json(ready({expectedVersion:String(JSON.parse(init.body).expectedVersion)}));});
 for(const patch of [{operationId:'bad'},{jobId:'bad'},{operationId:JOB},{expectedVersion:2},{expectedVersion:'02'},{expectedVersion:'0'},{expectedVersion:'2e0'},{expectedVersion:' 2'},{expectedVersion:'9007199254740991'},{expectedVersion:'9223372036854775807'},
  ...['tenantId','actorId','altText','manifest','outputId','storageKey','accepted','sha256','version','receipt'].map(key=>({[key]:'forged'}))])await reject(()=>api.createMediaAttachIntentV2(ID,2,{...input,...patch},options),'VALIDATION');
 for(const [listing,revision] of [['bad',2],[ID,0],[ID,1.5],[ID,2147483648]])await reject(()=>api.createMediaAttachIntentV2(listing,revision,input,options),'VALIDATION');
 await reject(()=>api.getMediaAttachIntentV2(ID,2,'bad',options),'VALIDATION');assert.equal(calls,0);
 assert.equal((await api.createMediaAttachIntentV2(ID,2,{...input,expectedVersion:'9007199254740990'},options)).expectedVersion,'9007199254740990');assert.equal(calls,1);
});
test('attach GET binds the exact path and returns a frozen immutable terminal receipt after historical expiry',async()=>{
 let seen;const result=await client(async(url,init)=>{seen={url,init};return json(applied());}).getMediaAttachIntentV2(ID,2,OP,options);
 assert.deepEqual(result,applied());assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.receipt));
 assert.equal(seen.url,`https://attach.example.invalid/v2/staff/listings/${ID}/revisions/2/media-attach-intents/${OP}`);assert.equal(seen.init.method,'GET');assert.equal(seen.init.body,undefined);
 for(const key of ['outputId','storageKey','manifest','sha256','tenantId','requesterId','accepted']){assert.equal(key in result,false);assert.equal(key in result.receipt,false);}
});
test('attach response binds original intent facts and rejects unexpected or inconsistent envelopes',async()=>{
 const missing=ready();delete missing.altText;
 for(const value of [missing,ready({kind:'register_media_upload'}),ready({operationId:OTHER}),ready({jobId:OP}),ready({jobId:'bad'}),ready({jobId:OTHER}),ready({listingId:OTHER}),ready({revision:3}),ready({expectedVersion:'3'}),ready({expectedVersion:2}),ready({expectedVersion:'02'}),ready({expectedVersion:'9007199254740991'}),ready({altText:' bad '}),ready({status:'processing'}),ready({receipt:applied().receipt}),ready({manifest:{}})])await reject(()=>client(async()=>json(value)).createMediaAttachIntentV2(ID,2,input,options),'INVALID_RESPONSE',true);
 for(const patch of [{operationId:OTHER},{listingId:OTHER},{revision:3}])await reject(()=>client(async()=>json(ready(patch))).getMediaAttachIntentV2(ID,2,OP,options),'INVALID_RESPONSE');
});
test('terminal parser requires exact outcome correlations, complete identity, media facts and resulting version',async()=>{
 const missing={...applied().receipt};delete missing.reason;
 const invalid=[ready({status:'applied',receipt:null}),ready({status:'applied',receipt:missing}),
  ...[{operationId:OTHER},{jobId:OTHER},{expectedVersion:'3'},{version:'4'},{version:'03'},{version:'9007199254740992'},{outcome:'conflict'},{reason:'VERSION_CONFLICT'},{mediaId:null},{mediaId:OP},{mediaId:JOB},{position:null},{position:12},{position:0.5},{completedAt:'2026-02-30T00:00:00.000Z'},{completedAt:'2020-01-01T00:00:00.000000Z'},{completedAt:null},{storageKey:'PRIVATE'}].map(applied)];
 for(const value of invalid)await reject(()=>client(async()=>json(value)).getMediaAttachIntentV2(ID,2,OP,options),'INVALID_RESPONSE');
 const reasons={conflict:['VERSION_CONFLICT','ASSIGNMENT_CHANGED'],expired:['JOB_EXPIRED'],rejected:['REVISION_NOT_DRAFT','DUPLICATE_OUTPUT','CAPACITY_REACHED','JOB_ALREADY_ATTACHED','PROVENANCE_CHANGED']};
 for(const [status,list] of Object.entries(reasons))for(const reason of list){
  const value=ready({status,receipt:{...facts,version:'2',outcome:status,reason,mediaId:null,position:null,completedAt:'2020-01-01T00:00:00.000Z'}});
  assert.deepEqual(await client(async()=>json(value)).getMediaAttachIntentV2(ID,2,OP,options),value);
  await reject(()=>client(async()=>json({...value,receipt:{...value.receipt,reason:status==='expired'?'VERSION_CONFLICT':'JOB_EXPIRED'}})).getMediaAttachIntentV2(ID,2,OP,options),'INVALID_RESPONSE');
 }
 const max='9007199254740990',value=applied({expectedVersion:max,version:'9007199254740991'});value.expectedVersion=max;
 assert.deepEqual(await client(async()=>json(value)).getMediaAttachIntentV2(ID,2,OP,options),value);
});
test('attach raw JSON rejects duplicate nested keys and original revision/position token aliases',async()=>{
 const source=JSON.stringify(applied());
 for(const value of [source.replace('"revision":2','"revision":2,"revi\\u0073ion":2'),source.replace('"revision":2','"revision":2.00000000000000001'),source.replace('"position":0','"position":0.00000000000000001'),source.replace('"position":0','"posi\\u0074ion":0e0'),source.replace('"version":"3"','"version":"3","ver\\u0073ion":"3"'),source.replace('"outcome":"applied"','"outcome":"applied","outcome":"applied"')]){
  await reject(()=>client(async()=>raw(value)).getMediaAttachIntentV2(ID,2,OP,options),'INVALID_RESPONSE');await reject(()=>client(async()=>raw(value)).createMediaAttachIntentV2(ID,2,input,options),'INVALID_RESPONSE',true);
 }
 const text='Photo text containing "position":0.0001 and {"same":1,"same":2}';assert.equal((await client(async()=>json(ready({altText:text}))).getMediaAttachIntentV2(ID,2,OP,options)).altText,text);
});
test('attach explicit creation replay can recover terminal status without adopting a newer request version',async()=>{
 const bodies=[];let count=0;const api=client(async(_,init)=>{bodies.push(init.body);return json(count++===0?ready():applied());});
 assert.equal((await api.createMediaAttachIntentV2(ID,2,input,options)).status,'ready');assert.equal((await api.createMediaAttachIntentV2(ID,2,input,options)).status,'applied');assert.equal(bodies[0],bodies[1]);assert.equal(bodies.length,2);
});
test('attach definite HTTP failures are safe and do not trigger automatic mutation retries',async()=>{
 for(const [status,code] of [[400,'INVALID_INPUT'],[401,'UNAUTHENTICATED'],[403,'FORBIDDEN'],[404,'NOT_FOUND'],[409,'CONFLICT'],[422,'INVALID_STATE']]){
  let calls=0;await assert.rejects(()=>client(async()=>{calls++;return json({error:{code,message:'PRIVATE SQL DETAIL'},requestId:OTHER},status);}).createMediaAttachIntentV2(ID,2,input,options),error=>error.kind==='HTTP'&&error.status===status&&error.serverCode===code&&!error.submissionUncertain&&!error.message.includes('PRIVATE'));assert.equal(calls,1);
 }
});
test('attach lost writes, timeout, redirects, malformed success and server errors stay uncertain without retry',async()=>{
 for(const [transport,kind] of [[async()=>{throw new Error('PRIVATE');},'NETWORK'],[async()=>json(ready({jobId:OTHER})),'INVALID_RESPONSE'],[async()=>json(ready(),201),'INVALID_RESPONSE'],[async()=>new Response(null,{status:302}),'REDIRECT'],[async()=>json({error:{code:'SERVICE_UNAVAILABLE',message:'PRIVATE'},requestId:OTHER},503),'HTTP'],[async()=>new Promise(()=>{}),'TIMEOUT']]){
  let calls=0;await reject(()=>client(async(...args)=>{calls++;return transport(...args);}).createMediaAttachIntentV2(ID,2,input,{...options,timeoutMs:20}),kind,true);assert.equal(calls,1);
 }
 let calls=0;await reject(()=>client(async()=>{calls++;throw new Error('PRIVATE');}).getMediaAttachIntentV2(ID,2,OP,options),'NETWORK');assert.equal(calls,1);
});
test('attach cancellation before admission sends nothing and cancellation after transport remains uncertain',async()=>{
 const before=new AbortController();before.abort();let calls=0;await reject(()=>client(async()=>{calls++;return json(ready());}).createMediaAttachIntentV2(ID,2,input,{...options,signal:before.signal}),'CANCELLED');assert.equal(calls,0);
 const during=new AbortController();await reject(()=>client(async()=>{calls++;during.abort();return new Promise(()=>{});}).createMediaAttachIntentV2(ID,2,input,{...options,signal:during.signal}),'CANCELLED',true);assert.equal(calls,1);
});
