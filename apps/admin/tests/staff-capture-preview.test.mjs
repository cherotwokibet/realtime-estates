import test from 'node:test';
import assert from 'node:assert/strict';
import {staffCapturePreviewRequest} from '../dist/tests/lib/enquiry-preview-server.js';
import {POST} from '../dist/tests/app/api/enquiry-preview/[actor]/capture/route.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const env={NODE_ENV:'development',STAFF_ENQUIRY_PREVIEW_MODE:'synthetic-v1',STAFF_PREVIEW_API_ORIGIN:'http://127.0.0.1:4101',STAFF_ENQUIRY_ADMIN_TOKEN:'admin.fixed.token',STAFF_ENQUIRY_ADMIN_ID:id(1),STAFF_ENQUIRY_ADMIN_INSTANCE:id(3),STAFF_ENQUIRY_AGENT_TOKEN:'agent.fixed.token',STAFF_ENQUIRY_AGENT_ID:id(2),STAFF_ENQUIRY_AGENT_INSTANCE:id(4)};
const input={listingId:null,name:'Synthetic staff contact',email:'TEST@example.invalid',phone:null,message:'Fictional staff request',noticeVersion:'synthetic-staff-notice-v1',noticeAcknowledged:true};
const request=(actor='admin',body=JSON.stringify(input),headers={})=>new Request(`http://127.0.0.1:3001/api/enquiry-preview/${actor}/capture`,{method:'POST',body,headers:{host:'127.0.0.1:3001',origin:'http://127.0.0.1:3001','content-type':'application/json','x-preview-instance':id(actor==='admin'?3:4),'idempotency-key':id(9),...headers}});
test('protected synthetic staff capture boundary',async t=>{
 const prior={...process.env},original=globalThis.fetch;Object.assign(process.env,env);let calls=[];
 globalThis.fetch=async(url,init)=>{calls.push({url,init});return Response.json({id:id(10)},{status:201});};
 try{
 await t.test('both fixed roles use server credentials and private source-free receipts',async()=>{
  for(const actor of ['admin','agent']){const response=await POST(request(actor),{params:Promise.resolve({actor})});assert.equal(response.status,201);assert.deepEqual(await response.json(),{id:id(10)});assert.match(response.headers.get('cache-control'),/private, no-store/);const call=calls.at(-1);assert.equal(call.url,'http://127.0.0.1:4101/v2/staff/enquiry-captures');assert.equal(call.init.headers.Authorization,'Bearer '+env[`STAFF_ENQUIRY_${actor.toUpperCase()}_TOKEN`]);assert.equal(Object.hasOwn(JSON.parse(call.init.body),'origin'),false);assert.equal(call.init.headers['Idempotency-Key'],id(9));}
 });
 await t.test('caller authority, source, property and origin overrides never dispatch',async()=>{
  const before=calls.length;
  for(const headers of [{authorization:'Bearer forged'},{cookie:'private=secret'},{origin:'https://other.invalid'},{'x-preview-instance':id(99)},{'x-tenant-id':id(2)}])assert.ok((await staffCapturePreviewRequest(request('admin',undefined,headers),'admin')).status>=400);
  for(const body of [{...input,origin:'staff'},{...input,actorId:id(1)},{...input,tenantId:id(2)},{...input,listingId:id(12)},{...input,noticeVersion:'old'}])assert.equal((await staffCapturePreviewRequest(request('admin',JSON.stringify(body)),'admin')).status,400);
  assert.equal((await staffCapturePreviewRequest(request('customer'),'customer')).status,403);assert.equal(calls.length,before);
 });
 await t.test('escaped duplicates and oversized bytes rejected; production remains disabled',async()=>{
  const before=calls.length;
  for(const body of [JSON.stringify(input).replace('"name":','"na\\u006de":"Other","name":'),' '.repeat(16385)])assert.ok((await staffCapturePreviewRequest(request('admin',body),'admin')).status>=400);
  process.env.NODE_ENV='production';assert.equal((await staffCapturePreviewRequest(request(),'admin')).status,403);process.env.NODE_ENV='development';assert.equal(calls.length,before);
 });
 await t.test('lost reply returns bounded failure without hidden replay or credential disclosure',async()=>{
  let sent=0;globalThis.fetch=async()=>{sent++;throw Error('private-token-diagnostic');};const response=await staffCapturePreviewRequest(request(),'admin');assert.equal(response.status,503);assert.equal(sent,1);assert.doesNotMatch(JSON.stringify(await response.json()),/token|diagnostic|admin.fixed/);
 });
 }finally{globalThis.fetch=original;for(const key of Object.keys(process.env))if(!(key in prior))delete process.env[key];Object.assign(process.env,prior);}
});
