import test from 'node:test';
import assert from 'node:assert/strict';
import {RealtorApiClient} from '../dist/index.js';
const key='00000000-0000-4000-8000-000000000900',id='00000000-0000-4000-8000-000000000901';
const input=()=>({name:'  Synthetic staff prospect  ',email:'SAMPLE@example.invalid',message:'  Fictional intake  ',noticeVersion:'synthetic-v1',noticeAcknowledged:true});
const receipt=()=>new Response(JSON.stringify({id}),{status:201,headers:{'content-type':'application/json'}});
const api=fetch=>new RealtorApiClient({baseUrl:'https://api.example.invalid',privacyNoticeVersion:'synthetic-v1',fetch});
test('staff capture fixes command route, omits origin and validates identity before transport',async()=>{
 const calls=[],client=api(async(url,init)=>{calls.push({url,init});return receipt();});
 for(const body of [{...input(),origin:'staff'},{...input(),actorId:id},{...input(),tenantId:id}])await assert.rejects(client.captureStaffEnquiryV2(body,{bearerToken:'synthetic-admin',idempotencyKey:key}));
 await assert.rejects(client.captureStaffEnquiryV2(input(),{idempotencyKey:key}));assert.equal(calls.length,0);
 await client.captureStaffEnquiryV2(input(),{bearerToken:'synthetic-admin',idempotencyKey:key});assert.equal(calls[0].url,'https://api.example.invalid/v2/staff/enquiry-captures');assert.equal(calls[0].init.headers.Authorization,'Bearer synthetic-admin');assert.equal(Object.hasOwn(JSON.parse(calls[0].init.body),'origin'),false);
});
test('staff attempt snapshots raw input and identity; exact explicit replay recovers a lost reply',async()=>{
 const calls=[],raw=input(),identity={bearerToken:'synthetic-admin'},attempt=api(async(_,init)=>{calls.push(init);if(calls.length===1)throw Error('lost');return receipt();}).prepareStaffEnquiryV2(raw,key,identity);
 raw.message='Changed';identity.bearerToken='different';assert.equal(attempt.input.message,'  Fictional intake  ');assert.ok(Object.isFrozen(attempt.input));
 await assert.rejects(attempt.submit());assert.equal(attempt.state.status,'uncertain');assert.equal(calls.length,1);await assert.rejects(attempt.submit());
 for(const override of [{bearerToken:'different'},{idempotencyKey:id},{tenantId:id}])await assert.rejects(attempt.retryOriginal(override));assert.equal(calls.length,1);
 assert.deepEqual(await attempt.retryOriginal(),{id});assert.equal(calls[1].body,calls[0].body);assert.equal(calls[1].headers.Authorization,'Bearer synthetic-admin');assert.equal(calls[1].headers['Idempotency-Key'],key);assert.equal(attempt.state.status,'received');await assert.rejects(attempt.retryOriginal());
});
test('staff attempt locks concurrent writes and preserves uncertainty after subsequent denial',async()=>{
 let release,calls=0;const attempt=api(async()=>{calls++;if(calls===1)return new Promise((_,reject)=>release=reject);return new Response(JSON.stringify({error:{code:'FORBIDDEN',message:'Denied'},requestId:id}),{status:403,headers:{'content-type':'application/json'}});}).prepareStaffEnquiryV2(input(),key,{bearerToken:'synthetic-admin'});
 const first=attempt.submit();assert.equal(attempt.state.status,'sending');await assert.rejects(attempt.submit());await assert.rejects(attempt.retryOriginal());assert.equal(calls,1);release(Error('lost'));await assert.rejects(first);await assert.rejects(attempt.retryOriginal());assert.equal(attempt.state.status,'uncertain');
});
