import test from 'node:test';
import assert from 'node:assert/strict';
import {createDevelopmentUploadApi} from '../dist/upload.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const route=`http://127.0.0.1/v2/staff/listings/${id(100)}/revisions/1/media-jobs/${id(200)}/uploads/${id(300)}`;
const token='eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.signature';
function fixture({verifyError,sqlError,row}={}){
  const calls={verify:0,sql:0,source:0,reserve:0,processor:0};
  const requests={requestStoreId:id(400),rootDirectory:'synthetic-only-not-read',reserve:async()=>{calls.reserve++;throw new Error('Unexpected reserve');},consume:()=>{throw new Error();},read:async()=>{throw new Error('Unexpected history');},close:async()=>{}};
  const api=createDevelopmentUploadApi({tenant:{tenantId:id(1),slug:'synthetic',hostnames:['127.0.0.1']},database:{async transaction(context,operation){calls.sql++;assert.equal(context.tenantId,id(1));assert.equal(context.actorId,id(11));return operation({async query(sql,args){if(sqlError)throw sqlError;return {rows:[{receipt:row??{jobId:id(200),listingId:id(100),revision:1}}]};}});}},verifyBearer:async()=>{calls.verify++;if(verifyError)throw verifyError;return {actorId:id(11)};},requests,createProcessor:async()=>{calls.processor++;throw new Error('Unexpected processor');}});
  const source={[Symbol.asyncIterator](){calls.source++;throw new Error('Body must remain unread');}};
  const request=(url=route,headers={Authorization:`Bearer ${token}`,'Content-Type':'application/octet-stream'},method='PUT')=>new Request(url,{method,headers});
  return {api,calls,source,request};
}
test('upload boundary rejects missing/duplicate/unverified identities before SQL or source iteration',async()=>{
  for(const headers of [{},{Authorization:`Bearer ${token}, Bearer ${token}`}]){
    const f=fixture();try{const r=await f.api.handle(f.request(route,headers),f.source);assert.equal(r.status,401);assert.deepEqual(await r.json(),{error:'UNAUTHENTICATED'});assert.equal(f.calls.sql,0);assert.equal(f.calls.source,0);}finally{await f.api.close();}
  }
  const f=fixture({verifyError:new Error('SECRET issuer diagnostic')});try{const r=await f.api.handle(f.request(),f.source);assert.equal(r.status,401);assert.ok(!(await r.text()).includes('SECRET'));assert.equal(f.calls.sql,0);assert.equal(f.calls.source,0);}finally{await f.api.close();}
});
test('configured hostname and exact tuple reject aliases without consuming bytes',async()=>{
  for(const url of [route.replace('127.0.0.1','attacker.invalid'),route+'?tenantId='+id(2),route+'/',route.replace('/revisions/1/','/revisions/2147483648/')]){
    const f=fixture();try{const r=await f.api.handle(f.request(url),f.source);assert.ok([400,404].includes(r.status));assert.equal(f.calls.sql,0);assert.equal(f.calls.source,0);}finally{await f.api.close();}
  }
});
test('SQL authorization denials and mismatched returned tuple stop before the first byte',async()=>{
  for(const options of [{sqlError:{code:'42501',message:'SECRET actor'}},{sqlError:{code:'P0002'}},{sqlError:{code:'40001'}},{sqlError:{code:'23514'}},{row:{jobId:id(201),listingId:id(100),revision:1}}]){
    const f=fixture(options);try{const r=await f.api.handle(f.request(),f.source);assert.equal(r.status,404);assert.deepEqual(await r.json(),{error:'NOT_FOUND'});assert.equal(f.calls.sql,1);assert.equal(f.calls.source,0);assert.equal(f.calls.reserve,0);assert.equal(f.calls.processor,0);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');}finally{await f.api.close();}
  }
});
test('invalid transport metadata and unconfirmed SQL remain bounded and reveal no internals',async()=>{
  for(const [headers,status] of [[{'Content-Type':'image/png'},415],[{'Content-Type':'application/octet-stream','Content-Encoding':'gzip'},415],[{'Content-Type':'application/octet-stream','Content-Length':'10485761'},413],[{'Content-Type':'application/octet-stream',Expect:'100-continue'},417]]){
    const f=fixture();try{const r=await f.api.handle(f.request(route,{Authorization:`Bearer ${token}`,...headers}),f.source);assert.equal(r.status,status);assert.equal(f.calls.source,0);assert.equal(f.calls.sql,0);}finally{await f.api.close();}
  }
  const f=fixture({sqlError:{code:'08006',message:'SECRET dsn/storage'}});try{const r=await f.api.handle(f.request(),f.source);assert.equal(r.status,409);assert.deepEqual(await r.json(),{error:'UPLOAD_UNCONFIRMED'});assert.equal(f.calls.source,0);}finally{await f.api.close();}
});
test('synthetic upload factory refuses production before creating a service',()=>{
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';try{assert.throws(()=>fixture(),/development-only/);}finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
