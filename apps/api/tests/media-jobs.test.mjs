import assert from 'node:assert/strict';
import test from 'node:test';
import {createApiService} from '../dist/service.js';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),actor=id(11),listing=id(100),registration=id(200),job=id(300);
const prefix=`/v2/staff/listings/${listing}/revisions/1`,registerPath=prefix+'/media-registrations';
const receipt={kind:'register_media_upload',operationId:registration,jobId:job,listingId:listing,revision:1,expectedVersion:'2',altText:'Synthetic living room',outcome:'registered',registeredAt:'2026-10-10T10:20:30.123456+00:00',expiresAt:'2026-10-11T10:20:30.123456+00:00'};
function fixture({role='agent',result=receipt,code}={}){
  const calls=[];
  const service=createApiService({tenantId:tenant,privacyNoticeVersion:'synthetic-media-notice',verifyAuthorization:async request=>{
    if(request.headers.get('authorization')!=='Bearer synthetic-agent')throw new Error('Invalid synthetic token');return {actorId:actor};
  },database:{transaction:async(context,operation)=>operation({query:async(sql,values)=>{
    calls.push({context,sql,values});if(sql.includes('staff_role'))return {rows:[{role}]};
    if(code)throw Object.assign(new Error('PRIVATE DATABASE DETAILS'),{code});return {rows:[{receipt:result}]};
  }})}});
  const call=(path=registerPath,{method='POST',body={registrationId:registration,expectedVersion:2,altText:receipt.altText},token='synthetic-agent',headers={}}={})=>service(new Request('https://synthetic.invalid'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json',...headers},...(method==='GET'||body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}));
  return {calls,call};
}

test('media registration sends only canonical command facts under trusted tenant and verified actor',async()=>{
 const {call,calls}=fixture();const response=await call();assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.ok(response.headers.get('x-request-id'));
 assert.deepEqual(await response.json(),{...receipt,registeredAt:'2026-10-10T10:20:30.123Z',expiresAt:'2026-10-11T10:20:30.123Z'});
 assert.deepEqual(calls[1].values,[listing,1,2,registration,receipt.altText]);assert.equal(calls[1].context.tenantId,tenant);assert.equal(calls[1].context.actorId,actor);
});
test('media routes require bearer verification and active staff before a command or read',async()=>{
 for(const token of [null,'forged']){const f=fixture();assert.equal((await f.call(undefined,{token})).status,401);assert.equal(f.calls.length,0);}
 for(const role of ['customer',null]){const f=fixture({role});assert.equal((await f.call()).status,403);assert.equal(f.calls.length,1);}
});
test('registration rejects unsupported context, capability, job and acceptance fields before SQL',async()=>{
 for(const key of ['tenantId','actorId','jobId','outputId','quarantineId','sha256','width','accepted','manifest','expiresAt']){
  const f=fixture();assert.equal((await f.call(undefined,{body:{registrationId:registration,expectedVersion:2,altText:receipt.altText,[key]:'forged'}})).status,400);assert.equal(f.calls.length,0);
 }
});
test('registration validates original integer tokens and decoded duplicate keys',async()=>{
 for(const raw of ['2.00000000000000001','2e0','0','-1','9007199254740992','"2"','null']){
  const f=fixture();assert.equal((await f.call(undefined,{body:`{"registrationId":"${registration}","expectedVersion":${raw},"altText":"Synthetic"}`})).status,400);assert.equal(f.calls.length,0);
 }
 for(const extra of ['"expectedVersion":2','"\\u0065xpectedVersion":2','"altText":"Synthetic"']){
  const f=fixture();assert.equal((await f.call(undefined,{body:`{"registrationId":"${registration}","expectedVersion":2,"altText":"Synthetic",${extra}}`})).status,400);assert.equal(f.calls.length,0);
 }
});
test('registration enforces Unicode alt bounds, strict whitespace and control-free input',async()=>{
 for(const altText of ['',null,' leading','trailing\u00a0','\ufeffleading','\tinside','a\u0085b','a\u007fb','\ud800','😀'.repeat(301)]){
  const f=fixture();assert.equal((await f.call(undefined,{body:{registrationId:registration,expectedVersion:2,altText}})).status,400);assert.equal(f.calls.length,0);
 }
 const f=fixture();assert.equal((await f.call(undefined,{body:{registrationId:registration,expectedVersion:2,altText:'😀'.repeat(300)}})).status,200);assert.equal(f.calls[1].values[4],'😀'.repeat(300));
});
test('media body parser bounds actual bytes, rejects invalid UTF8 and requires JSON',async()=>{
 const f=fixture();assert.equal((await f.call(undefined,{headers:{'Content-Type':'text/plain'}})).status,415);
 assert.equal((await f.call(undefined,{body:' '.repeat(8193)})).status,413);
 assert.equal((await f.call(undefined,{headers:{'Content-Length':'8193'}})).status,413);
 const raw=new Request('https://synthetic.invalid'+registerPath,{method:'POST',headers:{Authorization:'Bearer synthetic-agent','Content-Type':'application/json'},body:new Uint8Array([0xc3,0x28])});
 const service=createApiService({tenantId:tenant,privacyNoticeVersion:'synthetic',verifyAuthorization:async()=>({actorId:actor}),database:{transaction:()=>{throw new Error('SQL must not run');}}});
 assert.equal((await service(raw)).status,400);assert.equal(f.calls.length,0);
});
test('media method, path identity and query overrides are refused',async()=>{
 const f=fixture();for(const key of ['tenantId','limit','jobId'])assert.equal((await f.call(registerPath+'?'+key+'=forged')).status,400);
 for(const path of [registerPath.replace(listing,'bad'),registerPath.replace('/1/','/2147483648/'),registerPath+'/bad'])assert.equal((await f.call(path)).status,400);
 const r=await f.call(undefined,{method:'GET'});assert.equal(r.status,405);assert.equal(r.headers.get('allow'),'POST');
 assert.equal((await f.call(registerPath+'/'+registration)).status,405);assert.equal((await f.call(prefix+'/media-jobs',{method:'GET'})).status,404);
});
test('historical registration readback is narrowly projected and bound to the requested resource tuple',async()=>{
 const f=fixture({result:{...receipt,quarantineId:'PRIVATE KEY',actorId:'PRIVATE ACTOR'}});
 const response=await f.call(registerPath+'/'+registration,{method:'GET'});assert.equal(response.status,200);const body=await response.json();assert.equal('quarantineId' in body,false);assert.equal('actorId' in body,false);assert.deepEqual(f.calls[1].values,[registration]);
 for(const changes of [{listingId:id(101)},{revision:2},{operationId:id(201)}]){const wrong=fixture({result:{...receipt,...changes}});assert.equal((await wrong.call(registerPath+'/'+registration,{method:'GET'})).status,404);}
});
test('job readback reports expiry distinctly without converting historical receipt into a capability',async()=>{
 const {outcome,...common}=receipt;const f=fixture({result:{...common,state:'expired',publicUrl:'PRIVATE'}});
 const r=await f.call(prefix+'/media-jobs/'+job,{method:'GET'});assert.equal(r.status,200);const body=await r.json();assert.equal(body.state,'expired');assert.equal('outcome' in body,false);assert.equal('publicUrl' in body,false);assert.deepEqual(f.calls[1].values,[job]);
 const wrong=fixture({result:{...common,state:'registered',jobId:id(301)}});assert.equal((await wrong.call(prefix+'/media-jobs/'+job,{method:'GET'})).status,404);
 const invalid=fixture({result:{...common,state:'processing'}});assert.equal((await invalid.call(prefix+'/media-jobs/'+job,{method:'GET'})).status,503);
});
test('media SQL errors map to safe HTTP errors without private details',async()=>{
 for(const [code,status] of [['42501',403],['P0002',404],['40001',409],['23514',422],['unexpected',503]]){
  const f=fixture({code});const r=await f.call();assert.equal(r.status,status);assert.equal((await r.text()).includes('PRIVATE DATABASE DETAILS'),false);
 }
});
