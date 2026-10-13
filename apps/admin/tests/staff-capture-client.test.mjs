import test from 'node:test';
import assert from 'node:assert/strict';
import {createEnquiryPreviewClient} from '../dist/tests/lib/enquiry-client.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const input=()=>({listingId:null,name:'  Fictional contact  ',email:'TEST@example.invalid',phone:null,message:'  Original staff note  ',noticeVersion:'synthetic-staff-notice-v1',noticeAcknowledged:true});
const client=fetch=>createEnquiryPreviewClient({basePath:'/api/enquiry-preview/agent',instanceId:id(1),fetch});
const receipt=()=>Response.json({id:id(10)},{status:201});
test('staff browser capture snapshots raw input; fixed source-free request has no credentials',async()=>{
 const calls=[],api=client(async(path,init)=>{calls.push({path,init});return receipt();}),raw=input(),attempt=api.prepareCapture(raw,id(9));raw.message='Changed';assert.equal(attempt.input.message,'  Original staff note  ');assert.ok(Object.isFrozen(attempt.input));
 await attempt.submit();const call=calls[0];assert.equal(call.path,'/api/enquiry-preview/agent/capture');assert.equal(call.init.headers.Authorization,undefined);assert.equal(call.init.credentials,'omit');assert.equal(call.init.redirect,'error');assert.equal(call.init.headers['Idempotency-Key'],id(9));assert.equal(Object.hasOwn(JSON.parse(call.init.body),'origin'),false);assert.equal(attempt.status,'received');await assert.rejects(attempt.submit());await assert.rejects(attempt.retryOriginal());assert.equal(calls.length,1);
});
test('lost reply locks original input/key and requires explicit recovery, retaining uncertainty after denial',async()=>{
 let release,calls=[];const attempt=client(async(_,init)=>{calls.push(init);if(calls.length===1)return new Promise((_,reject)=>release=reject);if(calls.length===2)return Response.json({error:{code:'FORBIDDEN',message:'Denied'},requestId:id(4)},{status:403});return receipt();}).prepareCapture(input(),id(9));
 const sent=attempt.submit();assert.equal(attempt.status,'sending');await assert.rejects(attempt.submit());await assert.rejects(attempt.retryOriginal());release(Error('lost'));await assert.rejects(sent);assert.equal(attempt.status,'uncertain');await assert.rejects(attempt.submit());await assert.rejects(attempt.retryOriginal());assert.equal(attempt.status,'uncertain');await attempt.retryOriginal();assert.equal(calls[0].body,calls[2].body);assert.equal(calls[0].headers['Idempotency-Key'],calls[2].headers['Idempotency-Key']);
});
test('browser validation rejects authority/source overrides and malformed success remains uncertain',async()=>{
 let sent=0;const api=client(async()=>{sent++;return Response.json({id:'bad'},{status:201});});
 for(const body of [{...input(),origin:'staff'},{...input(),tenantId:id(8)},{...input(),actorId:id(8)},{...input(),noticeAcknowledged:false}])assert.throws(()=>api.prepareCapture(body,id(9)));assert.equal(sent,0);
 const attempt=api.prepareCapture(input(),id(9));await assert.rejects(attempt.submit());assert.equal(attempt.status,'uncertain');assert.equal(sent,1);
});
