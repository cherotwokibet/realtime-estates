import assert from 'node:assert/strict';
import test from 'node:test';
import {createEnquiryPreviewClient,EnquiryPreviewError} from '../dist/tests/lib/enquiry-client.js';
import {prepareViewingAttempt} from '../dist/tests/lib/viewing-attempt.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const enquiry=id(1),viewing=id(2),listing=id(3),actor=id(4),operation=id(5),instance=id(6),time='2026-10-13T20:00:00.000Z';
const slot={startAt:'2090-01-01T09:00:00.000Z',endAt:'2090-01-01T10:00:00.000Z',timeZone:'Africa/Nairobi'};
const original={kind:'request',command:{operationId:operation,expectedEnquiryVersion:'3',listingId:listing,preferredSlots:[slot],notes:'  Private original request.  '}};
const schedule={viewingId:viewing,enquiryId:enquiry,listingId:listing,version:'1',status:'requested',preferredSlots:[slot],proposedSlot:null};
const receipt={operationId:operation,enquiryId:enquiry,viewingId:viewing,actorId:actor,kind:'request',expectedVersion:'3',observedVersion:'3',request:{listingId:listing,preferredSlots:[slot],notes:original.command.notes},outcome:'applied',reason:null,result:schedule,completedAt:time};
const client=fetch=>createEnquiryPreviewClient({basePath:'/api/enquiry-preview/admin',instanceId:instance,fetch});
test('browser viewing saves/recovery use fixed same-origin routes and source-free original bodies',async()=>{
 const calls=[],api=client(async(url,init)=>{calls.push({url,init});return Response.json(receipt);});assert.deepEqual(await api.saveViewing(enquiry,original),receipt);assert.deepEqual(await api.recoverViewing(enquiry,original),receipt);
 assert.equal(calls.length,2);assert.equal(calls[0].url,`/api/enquiry-preview/admin/enquiries/${enquiry}/viewings`);assert.equal(JSON.parse(calls[0].init.body).expectedEnquiryVersion,3);assert.equal(JSON.parse(calls[1].init.body).command.notes,original.command.notes);
 assert.equal(calls[1].init.method,'POST');assert.ok(calls[1].url.endsWith('/viewings/recover'));for(const call of calls){assert.equal(new Headers(call.init.headers).get('authorization'),null);assert.equal(new Headers(call.init.headers).get('x-preview-instance'),instance);assert.equal(call.init.credentials,'omit');assert.equal(call.init.redirect,'error');}
});
test('browser original recovery remains read-only on failure and writes preserve uncertainty',async()=>{
 const api=client(async()=>{throw new Error('synthetic lost reply');});await assert.rejects(()=>api.saveViewing(enquiry,original),e=>e instanceof EnquiryPreviewError&&e.uncertain);await assert.rejects(()=>api.recoverViewing(enquiry,original),e=>e instanceof EnquiryPreviewError&&!e.uncertain);
 const altered=client(async()=>Response.json({...receipt,request:{...receipt.request,notes:'altered'}}));await assert.rejects(()=>altered.saveViewing(enquiry,original),e=>e.uncertain);await assert.rejects(()=>altered.recoverViewing(enquiry,original),e=>!e.uncertain);
});
test('browser proposal route binds original viewing,while feed is independently bounded',async()=>{
 let calls=[];const proposal={kind:'propose',viewingId:viewing,command:{operationId:operation,expectedVersion:'1',slot}},proposed={...receipt,kind:'propose',expectedVersion:'1',observedVersion:'1',request:{slot},result:{...schedule,status:'proposed',version:'2',proposedSlot:slot}};
 const api=client(async(url,init)=>{calls.push({url,init});return Response.json(url.includes('?limit=')?{items:[],limit:25,truncated:false}:proposed);});assert.equal((await api.saveViewing(enquiry,proposal)).result.status,'proposed');assert.ok(calls[0].url.endsWith(`/viewings/${viewing}/proposals`));assert.equal(JSON.parse(calls[0].init.body).expectedVersion,1);assert.equal((await api.viewings(enquiry)).limit,25);assert.ok(calls[1].url.endsWith('/viewings?limit=25'));
});
test('viewing attempt freezes original and locks concurrent request/recovery/replay',async()=>{
 let resolve,calls=0;const input=structuredClone(original),attempt=prepareViewingAttempt({saveViewing:async()=>{calls++;return new Promise(done=>resolve=done);},recoverViewing:async()=>receipt},enquiry,input);input.command.notes='changed';assert.equal(attempt.original.command.notes,original.command.notes);
 const pending=attempt.submit();assert.equal(attempt.status,'sending');await assert.rejects(()=>attempt.submit());await assert.rejects(()=>attempt.recoverOriginal());await assert.rejects(()=>attempt.replayOriginal());assert.equal(calls,1);resolve(receipt);assert.deepEqual(await pending,receipt);assert.equal(attempt.status,'received');await assert.rejects(()=>attempt.replayOriginal());
});
test('viewing uncertain original survives denied read and explicitly replays identical facts',async()=>{
 let writes=0,reads=0;const attempt=prepareViewingAttempt({saveViewing:async(id,input)=>{writes++;assert.equal(input.command.notes,original.command.notes);if(writes===1)throw new EnquiryPreviewError('network',0,true);return receipt;},recoverViewing:async()=>{reads++;throw new EnquiryPreviewError('http',404,false);}},enquiry,original);
 await assert.rejects(()=>attempt.submit());assert.equal(attempt.status,'uncertain');await assert.rejects(()=>attempt.recoverOriginal());assert.equal(attempt.status,'uncertain');assert.equal(writes,1);assert.equal(reads,1);assert.deepEqual(await attempt.replayOriginal(),receipt);assert.equal(attempt.status,'received');assert.equal(writes,2);
});
test('viewing durable conflict/refusal are terminal while altered write receipts stay uncertain',async()=>{
 for(const result of [{...receipt,outcome:'conflict',reason:'VERSION_CONFLICT',observedVersion:'4',viewingId:null,result:null},{...receipt,outcome:'refused',reason:'LISTING_UNAVAILABLE',viewingId:null,result:null}]){const attempt=prepareViewingAttempt({saveViewing:async()=>result,recoverViewing:async()=>result},enquiry,original);assert.equal((await attempt.submit()).outcome,result.outcome);assert.equal(attempt.status,'received');await assert.rejects(()=>attempt.replayOriginal());}
 const attempt=prepareViewingAttempt({saveViewing:async()=>({...receipt,request:{...receipt.request,notes:'altered'}}),recoverViewing:async()=>receipt},enquiry,original);await assert.rejects(()=>attempt.submit());assert.equal(attempt.status,'uncertain');assert.deepEqual(await attempt.recoverOriginal(),receipt);
});
