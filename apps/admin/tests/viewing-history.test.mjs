import {outcomeFixture} from '../../../packages/domain/test-helpers/viewing-outcome-fixtures.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {GET} from '../dist/tests/app/api/enquiry-preview/[actor]/enquiries/[id]/viewings/[viewingId]/history/route.js';
import {createEnquiryPreviewClient,EnquiryPreviewError} from '../dist/tests/lib/enquiry-client.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),instance=id(3),enquiry=id(5),viewing=id(6),schedule={viewingId:viewing,enquiryId:enquiry,listingId:id(7),version:'1',status:'requested',preferredSlots:[],proposedSlot:null};
const page={items:[{kind:'request',actorId:id(99),recordedAt:'2026-10-14T00:00:00.000Z',schedule}],limit:25,truncated:false,currentVersion:'1'};
const context={params:Promise.resolve({actor:'admin',id:enquiry,viewingId:viewing})};
const path=`/api/enquiry-preview/admin/enquiries/${enquiry}/viewings/${viewing}/history`;
const request=(suffix='?limit=25',headers={})=>new Request('http://127.0.0.1:3001'+path+suffix,{headers:{host:'127.0.0.1:3001','sec-fetch-site':'same-origin','x-preview-instance':instance,...headers}});
test('saved viewing history BFF remains a bounded current-staff read with fixed server authority',async t=>{
 const oldEnv={...process.env},oldFetch=globalThis.fetch;Object.assign(process.env,{NODE_ENV:'development',STAFF_ENQUIRY_PREVIEW_MODE:'synthetic-v1',STAFF_PREVIEW_API_ORIGIN:'http://127.0.0.1:4101',STAFF_ENQUIRY_ADMIN_TOKEN:'admin.fixed.token',STAFF_ENQUIRY_ADMIN_ID:actor,STAFF_ENQUIRY_ADMIN_INSTANCE:instance,STAFF_ENQUIRY_AGENT_TOKEN:'agent.fixed.token',STAFF_ENQUIRY_AGENT_ID:id(2),STAFF_ENQUIRY_AGENT_INSTANCE:id(4)});
 t.after(()=>{globalThis.fetch=oldFetch;for(const key of Object.keys(process.env))if(!(key in oldEnv))delete process.env[key];Object.assign(process.env,oldEnv);});
 let calls=[];const mock=value=>{calls=[];globalThis.fetch=async(url,init)=>{calls.push({url:String(url),init});if(value instanceof Error)throw value;return Response.json(value,{headers:{'X-Request-Id':id(9)}});};};
 await t.test('authorized read accepts a different historical actor without exposing original command facts',async()=>{
  mock(page);const response=await GET(request(),context);assert.equal(response.status,200);assert.deepEqual(await response.json(),page);assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');assert.equal(calls.length,1);assert.equal(calls[0].url,`http://127.0.0.1:4101/v2/staff/enquiries/${enquiry}/viewings/${viewing}/history?limit=25`);assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.body,undefined);assert.equal(new Headers(calls[0].init.headers).get('authorization'),'Bearer admin.fixed.token');
 });
 await t.test('outcome history BFF preserves old agreements and staff evidence using upstream GET only',async()=>{
  const o=outcomeFixture({enquiry,viewing,actor,listing:id(7),later:true,kind:'no_show'});mock(o.history);assert.deepEqual(await(await GET(request(),context)).json(),o.history);assert.equal(calls.length,1);assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.body,undefined);const bad=structuredClone(o.history);bad.items[0].schedule.agreement.notes='Changed';mock(bad);const response=await GET(request(),context);assert.equal(response.status,502);assert.equal((await response.json()).submissionUncertain,false);
 });
 await t.test('unsupported context,method and limits never dispatch',async()=>{
  mock(page);for(const suffix of ['?limit=26','?limit=025','?limit=25&limit=25','?tenantId=foreign'])assert.equal((await GET(request(suffix),context)).status,400);assert.equal((await GET(request('?limit=25',{'x-preview-instance':id(99)}),context)).status,403);assert.equal((await GET(new Request(request().url,{method:'POST',headers:{...Object.fromEntries(request().headers),origin:'http://127.0.0.1:3001','content-type':'application/json'},body:'{}'}),context)).status,405);assert.equal(calls.length,0);
 });
 await t.test('lost and malformed successful history replies are read-only failures',async()=>{
  for(const value of [new Error('Synthetic history read loss'),{...page,items:[{...page.items[0],operationId:id(8)}]}]){mock(value);const response=await GET(request(),context);assert.equal(response.status,502);assert.equal((await response.json()).submissionUncertain,false);assert.equal(calls.length,1);assert.equal(calls[0].init.method,'GET');}
 });
});
test('history browser transport uses source-free same-origin GET and retains frozen historical actors',async()=>{
 let captured;const api=createEnquiryPreviewClient({basePath:'/api/enquiry-preview/admin',instanceId:instance,fetch:async(url,init)=>{captured={url,init};return Response.json(page);}});const value=await api.viewingHistory(enquiry,viewing);assert.equal(captured.url,path+'?limit=25');assert.equal(captured.init.method,'GET');assert.equal(captured.init.body,undefined);assert.equal(captured.init.credentials,'omit');assert.equal(new Headers(captured.init.headers).get('authorization'),null);assert.ok(Object.isFrozen(value.items[0].schedule));assert.equal(value.items[0].actorId,id(99));
});
test('history browser rejects altered targets and failed transport without write uncertainty',async()=>{
 for(const fetch of [async()=>{throw new Error('Synthetic read loss');},async()=>Response.json({...page,items:[{...page.items[0],schedule:{...schedule,enquiryId:id(99)}}]})]){const api=createEnquiryPreviewClient({basePath:'/api/enquiry-preview/admin',instanceId:instance,fetch});await assert.rejects(()=>api.viewingHistory(enquiry,viewing),e=>e instanceof EnquiryPreviewError&&!e.uncertain);}
});

test('outcome history browser reads exact frozen evidence and refuses changed predecessor facts without writing',async()=>{
 const o=outcomeFixture({enquiry,viewing,actor,listing:id(7),later:true,kind:'no_show'}),calls=[],api=createEnquiryPreviewClient({basePath:'/api/enquiry-preview/admin',instanceId:instance,fetch:async(url,init)=>{calls.push({url,init});return Response.json(o.history);}});const value=await api.viewingHistory(enquiry,viewing);assert.deepEqual(value,o.history);assert.ok(Object.isFrozen(value.items[0].schedule.outcome));assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.body,undefined);assert.equal(new Headers(calls[0].init.headers).get('authorization'),null);const bad=structuredClone(o.history);bad.items[0].schedule.agreement.notes='Changed';const invalid=createEnquiryPreviewClient({basePath:'/api/enquiry-preview/admin',instanceId:instance,fetch:async()=>Response.json(bad)});await assert.rejects(()=>invalid.viewingHistory(enquiry,viewing),e=>e instanceof EnquiryPreviewError&&!e.uncertain);
});
