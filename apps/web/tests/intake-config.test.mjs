import test from 'node:test';
import assert from 'node:assert/strict';
import {publicIntakeConfig,authorizePublicIntake} from '../dist/tests/lib/intake-config.js';
import {handleSyntheticEnquiry} from '@realtor/api-client';
const id='00000000-0000-4000-8000-000000000919';
const env={NODE_ENV:'development',WEB_ENQUIRY_PREVIEW_MODE:'synthetic-v1',WEB_ENQUIRY_API_ORIGIN:'http://127.0.0.1:4101',WEB_ENQUIRY_INSTANCE:id,TENANT_SLUG:'realtime-estates'};
const request=(headers={},body)=>new Request('http://127.0.0.1:3002/api/enquiry-intake',{method:'POST',body:body??JSON.stringify({listingId:null,name:'Fictional guest',email:'guest@example.invalid',phone:null,message:'Synthetic public website enquiry',origin:'web',noticeVersion:'synthetic-staff-notice-v1',noticeAcknowledged:true}),headers:{host:'127.0.0.1:3002',origin:'http://127.0.0.1:3002','x-preview-instance':id,'content-type':'application/json','idempotency-key':id,...headers}});
test('public capture needs explicit development deployment configuration without staff tokens',()=>{
 assert.equal(publicIntakeConfig(env).tenantSlug,'realtime-estates');assert.ok(Object.isFrozen(publicIntakeConfig(env)));
 for(const overrides of [{NODE_ENV:'production'},{WEB_ENQUIRY_PREVIEW_MODE:undefined},{WEB_ENQUIRY_API_ORIGIN:'https://other.invalid'},{WEB_ENQUIRY_API_ORIGIN:'http://127.0.0.1:4101/?tenant=other'},{WEB_ENQUIRY_INSTANCE:'bad'},{TENANT_SLUG:'unknown'}])assert.throws(()=>publicIntakeConfig({...env,...overrides}));
});
test('public authorization refuses foreign origin, host, identity and stale instance',()=>{
 authorizePublicIntake(request(),id);
 for(const headers of [{origin:'https://other.invalid'},{host:'localhost:3002'},{authorization:'Bearer secret'},{'x-preview-instance':'stale'},{'sec-fetch-site':'cross-site'}])assert.throws(()=>authorizePublicIntake(request(headers),id));
});
test('public form boundary saves guest-only to fixed upstream and denies caller tenant/property/cookie',async()=>{
 const scope=publicIntakeConfig(env),original=globalThis.fetch;let calls=[];
 globalThis.fetch=async(url,init)=>{calls.push({url,init});return Response.json({id},{status:201});};
 const run=r=>handleSyntheticEnquiry(r,{...scope,authorize:r=>authorizePublicIntake(r,scope.instanceId)});
 try{
  assert.equal((await run(request())).status,201);assert.equal(calls.length,1);assert.equal(calls[0].url,'http://127.0.0.1:4101/v1/enquiries');assert.equal(calls[0].init.headers.Authorization,undefined);
  for(const headers of [{cookie:'session=secret'},{'x-tenant-id':id}])assert.equal((await run(request(headers))).status,400);
  for(const change of [{tenantId:id},{listingId:id},{noticeVersion:'catalogue-read-only'},{noticeAcknowledged:false}]){const body={...JSON.parse(await request().text()),...change};assert.equal((await run(request({},JSON.stringify(body)))).status,400);}
  assert.equal(calls.length,1);
 }finally{globalThis.fetch=original;}
});
