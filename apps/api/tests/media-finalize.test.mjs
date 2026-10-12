import test from 'node:test';
import assert from 'node:assert/strict';
import {createDevelopmentMediaFinalizeApi} from '../dist/media-finalize.js';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const token='eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.signature';
const route=`http://127.0.0.1/v2/staff/listings/${id(100)}/revisions/1/media-attach-intents/${id(200)}/finalize`;
const facts={kind:'attach_media',operationId:id(200),jobId:id(300),listingId:id(100),revision:1,expectedVersion:'2'};
const ready={...facts,altText:'Synthetic entrance',status:'ready',receipt:null};
const applied={...ready,status:'applied',receipt:{...facts,version:'3',outcome:'applied',reason:null,mediaId:id(400),position:0,completedAt:'2026-10-12T01:02:03.123456Z'}};
const wire=value=>({...value,receipt:value.receipt===null?null:{...value.receipt,completedAt:value.receipt.completedAt.slice(0,23)+'Z'}});
function fixture({reads=[ready,applied],verifyError,finalizeError,returned=applied,onFinalize}={}){
  const calls={verify:0,reads:0,finalize:[],sql:[],contexts:[],transactionActive:false};
  const api=createDevelopmentMediaFinalizeApi({tenant:{tenantId:id(1),slug:'synthetic',hostnames:['127.0.0.1']},verifyBearer:async value=>{
    calls.verify++;assert.equal(value,token);if(verifyError)throw verifyError;return {actorId:id(11)};
  },database:{async transaction(context,run){
    calls.contexts.push(context);assert.equal(context.tenantId,id(1));assert.equal(context.actorId,id(11));calls.transactionActive=true;
    try{return await run({async query(sql,args){calls.sql.push({sql,args});const value=reads[Math.min(calls.reads++,reads.length-1)];if(value instanceof Error)throw value;return {rows:[{receipt:value}]};}});}finally{calls.transactionActive=false;}
  }},coordinator:{async finalizeMedia(operation){assert.equal(calls.transactionActive,false);calls.finalize.push(operation);await onFinalize?.();if(finalizeError)throw finalizeError;return returned;}}});
  const request=(url=route,headers={Authorization:`Bearer ${token}`},method='POST',body)=>new Request(url,{method,headers,...(body===undefined?{}:{body})});
  return {api,calls,request};
}
const sqlError=code=>Object.assign(new Error('PRIVATE SQL DETAIL'),{code});

test('explicit finalization verifies the original tuple twice around one operation-only coordinator command',async()=>{
  const f=fixture();try{
    const response=await f.api.handle(f.request());assert.equal(response.status,200);assert.deepEqual(await response.json(),wire(applied));
    assert.equal(f.calls.verify,1);assert.deepEqual(f.calls.finalize,[id(200)]);assert.equal(f.calls.reads,2);
    for(const call of f.calls.sql){assert.equal(call.sql,'SELECT app_api.read_media_attach_intent($1::uuid) AS receipt');assert.deepEqual(call.args,[id(200)]);}
    assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('x-request-id'),/^[a-f0-9-]{36}$/);
  }finally{await f.api.close();}
});

test('missing, duplicate and unverified bearer identities never reach SQL or finalization',async()=>{
  for(const headers of [{},{Authorization:`Bearer ${token}, Bearer ${token}`}]){
    const f=fixture();try{const r=await f.api.handle(f.request(route,headers));assert.equal(r.status,401);assert.equal(f.calls.reads,0);assert.deepEqual(f.calls.finalize,[]);}finally{await f.api.close();}
  }
  const f=fixture({verifyError:new Error('PRIVATE ISSUER')});try{const r=await f.api.handle(f.request());assert.equal(r.status,401);assert.ok(!(await r.text()).includes('PRIVATE'));assert.equal(f.calls.reads,0);}finally{await f.api.close();}
});

test('exact loopback host, URL tuple, methods and context aliases are checked before authorization',async()=>{
  for(const [url,method,headers,status] of [[route+'?tenantId='+id(2),'POST',{},404],[route+'/','POST',{},404],[route.replace('127.0.0.1','attacker.invalid'),'POST',{},404],[route.replace('http:','https:'),'POST',{},404],[route.replace('/revisions/1/','/revisions/2147483648/'),'POST',{},400],[route,'GET',{},405],[route,'PUT',{},405],[route,'POST',{Host:'attacker.invalid'},404],[route,'POST',{Origin:'http://attacker.invalid'},403]]){
    const f=fixture();try{const r=await f.api.handle(f.request(url,{Authorization:`Bearer ${token}`,...headers},method));assert.equal(r.status,status);assert.equal(f.calls.verify,0);assert.equal(f.calls.reads,0);assert.deepEqual(f.calls.finalize,[]);}finally{await f.api.close();}
  }
});

test('finalize accepts no posted metadata or framing, including untyped bytes, before SQL',async()=>{
  for(const headers of [{'Content-Type':'application/json'},{'Content-Encoding':'identity'},{'Content-Length':'1'},{'Content-Length':'00'},{'Transfer-Encoding':'chunked'},{Expect:'100-continue'},{Cookie:'session=forged'}]){
    const f=fixture();try{const r=await f.api.handle(f.request(route,{Authorization:`Bearer ${token}`,...headers}));assert.equal(r.status,400);assert.equal(f.calls.reads,0);assert.deepEqual(f.calls.finalize,[]);}finally{await f.api.close();}
  }
  const f=fixture();try{const r=await f.api.handle(f.request(route,undefined,'POST',new Uint8Array([1])));assert.equal(r.status,400);assert.equal(f.calls.reads,0);}finally{await f.api.close();}
  for(const body of [undefined,new Uint8Array(0)]){
    const f=fixture();try{assert.equal((await f.api.handle(f.request(route,{Authorization:`Bearer ${token}`,'Content-Length':'0'},'POST',body))).status,200);}finally{await f.api.close();}
  }
});

test('current SQL principal/access denial and wrong original URL tuple prevent coordinator invocation',async()=>{
  for(const value of [sqlError('42501'),sqlError('P0002'),{...ready,operationId:id(201)},{...ready,listingId:id(101)},{...ready,revision:2}]){
    const f=fixture({reads:[value]});try{const r=await f.api.handle(f.request());assert.equal(r.status,404);assert.ok(!(await r.text()).includes('PRIVATE'));assert.deepEqual(f.calls.finalize,[]);}finally{await f.api.close();}
  }
  const f=fixture({reads:[sqlError('08006')]});try{assert.equal((await f.api.handle(f.request())).status,503);assert.deepEqual(f.calls.finalize,[]);}finally{await f.api.close();}
});

test('authorized terminal original history returns without rerunning coordinator or creating another intent',async()=>{
  for(const value of [applied,...Object.entries({conflict:'VERSION_CONFLICT',rejected:'REVISION_NOT_DRAFT',expired:'JOB_EXPIRED'}).map(([status,reason])=>({...ready,status,receipt:{...facts,version:'2',outcome:status,reason,mediaId:null,position:null,completedAt:'2026-10-12T01:02:03.123456Z'}}))]){
    const f=fixture({reads:[value]});try{const r=await f.api.handle(f.request());assert.equal(r.status,200);assert.deepEqual(await r.json(),wire(value));assert.equal(f.calls.reads,1);assert.deepEqual(f.calls.finalize,[]);}finally{await f.api.close();}
  }
});

test('lost coordinator success is recovered only by original authenticated read, while ready stays uncertain',async()=>{
  const recovered=fixture({finalizeError:new Error('PRIVATE LOST COMMIT REPLY')});try{
    const response=await recovered.api.handle(recovered.request());assert.equal(response.status,200);assert.deepEqual(await response.json(),wire(applied));assert.equal(recovered.calls.reads,2);assert.deepEqual(recovered.calls.finalize,[id(200)]);
  }finally{await recovered.api.close();}
  const blocked=fixture({reads:[ready,ready],finalizeError:new Error('PRIVATE UNKNOWN')});try{
    const response=await blocked.api.handle(blocked.request());assert.equal(response.status,503);const body=await response.json();assert.equal(body.submissionUncertain,true);assert.equal(body.error.code,'ATTACHMENT_UNCONFIRMED');assert.ok(!JSON.stringify(body).includes('PRIVATE'));assert.deepEqual(blocked.calls.finalize,[id(200)]);assert.equal(blocked.calls.reads,2);
  }finally{await blocked.api.close();}
});

test('post-command authorization loss, binding change or conflicting coordinator result never returns accepted media',async()=>{
  for(const options of [{reads:[ready,sqlError('P0002')],status:404},{reads:[ready,{...applied,altText:'Changed original description'}],status:503},{returned:{...applied,receipt:{...applied.receipt,mediaId:id(401)}},status:503},{returned:ready,status:503},{returned:{...applied,receipt:{...applied.receipt,version:'4'}},status:503}]){
    const f=fixture(options);try{const r=await f.api.handle(f.request());assert.equal(r.status,options.status);assert.equal((await r.json()).submissionUncertain,true);assert.equal(f.calls.reads,2);assert.deepEqual(f.calls.finalize,[id(200)]);}finally{await f.api.close();}
  }
});

test('projection strips future private fields and rejects malformed immutable facts before authority is used',async()=>{
  const secret={...applied,outputId:'PRIVATE',receipt:{...applied.receipt,storageKey:'PRIVATE'}};
  const f=fixture({reads:[ready,secret],returned:secret});try{const r=await f.api.handle(f.request());assert.equal(r.status,200);assert.deepEqual(await r.json(),wire(applied));}finally{await f.api.close();}
  for(const value of [{...ready,receipt:applied.receipt},{...ready,jobId:id(200)},{...ready,expectedVersion:'9007199254740991'},{...ready,altText:' bad '},{...applied,receipt:{...applied.receipt,completedAt:'2026-02-30T01:02:03.123456Z'}},{...applied,receipt:{...applied.receipt,reason:'FORGED'}}]){
    const f=fixture({reads:[value]});try{assert.equal((await f.api.handle(f.request())).status,503);assert.deepEqual(f.calls.finalize,[]);}finally{await f.api.close();}
  }
});

test('known cancellation before finalization does not grant a new command; close drains admitted work only',async()=>{
  const cancelled=fixture(),controller=new AbortController();controller.abort();
  try{const r=await cancelled.api.handle(new Request(route,{method:'POST',headers:{Authorization:`Bearer ${token}`},signal:controller.signal}));assert.equal(r.status,400);assert.deepEqual(cancelled.calls.finalize,[]);}finally{await cancelled.api.close();}
  let entered,release;const arrived=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({onFinalize:async()=>{entered();await gate;}});const pending=f.api.handle(f.request());await arrived;
  let drained=false;const closing=f.api.close().then(()=>{drained=true;});await Promise.resolve();assert.equal(drained,false);assert.equal((await f.api.handle(f.request())).status,503);assert.deepEqual(f.calls.finalize,[id(200)]);
  release();assert.equal((await pending).status,200);await closing;assert.equal(drained,true);assert.equal(f.calls.reads,2);
});

test('development finalization factory refuses production without invoking dependencies',()=>{
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';try{assert.throws(()=>fixture(),/development-only/);}finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
