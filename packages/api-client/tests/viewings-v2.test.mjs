import {outcomeFixture} from '../../domain/test-helpers/viewing-outcome-fixtures.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {RealtorApiClient,ApiClientError} from '../dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const enquiry=id(1),viewing=id(2),listing=id(3),actor=id(4),operation=id(5),time='2026-10-13T20:00:00.000Z';
const slot={startAt:'2090-01-01T09:00:00.000Z',endAt:'2090-01-01T10:00:00.000Z',timeZone:'Africa/Nairobi'};
const command={operationId:operation,expectedEnquiryVersion:'3',listingId:listing,preferredSlots:[slot],notes:'  Private synthetic viewing.\nExact original.  '};
const schedule={viewingId:viewing,enquiryId:enquiry,listingId:listing,version:'1',status:'requested',preferredSlots:[slot],proposedSlot:null};
const receipt={operationId:operation,enquiryId:enquiry,viewingId:viewing,actorId:actor,kind:'request',expectedVersion:'3',observedVersion:'3',request:{listingId:listing,preferredSlots:[slot],notes:command.notes},outcome:'applied',reason:null,result:schedule,completedAt:time};
const detail={schedule,notes:command.notes,requestedById:actor,assignedAgentId:actor,createdAt:time,updatedAt:time};
const options={bearerToken:'synthetic-only'};
const client=fetch=>new RealtorApiClient({baseUrl:'https://synthetic.invalid',privacyNoticeVersion:'synthetic-v1',fetch});
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const rejects=(fn,kind,uncertain=false)=>assert.rejects(fn,e=>e instanceof ApiClientError&&e.kind===kind&&e.submissionUncertain===uncertain);
const phone={operationId:operation,expectedVersion:'2',slot,channel:'phone',agreedAt:'2026-10-13T19:00:00.000Z',notes:'  Exact phone agreement.\nSynthetic only.  '};
const confirmed={...receipt,kind:'confirm',expectedVersion:'2',observedVersion:'2',request:{slot,channel:'phone',agreedAt:phone.agreedAt,notes:phone.notes},result:{...schedule,status:'confirmed',version:'3',proposedSlot:slot,agreement:{channel:'phone',agreedAt:phone.agreedAt,notes:phone.notes}}};
const ending={operationId:operation,expectedVersion:'2',reason:'  Synthetic ending reason.\nExact original.  '};
const cancelled={...receipt,kind:'cancel',expectedVersion:'2',observedVersion:'2',request:{reason:ending.reason},result:{...schedule,status:'cancelled',version:'3',proposedSlot:slot,termination:{kind:'cancel',fromStatus:'proposed',reason:ending.reason,endedAt:time,previousUpdatedAt:'2026-10-13T18:00:00.000Z'}}};
const move={operationId:operation,expectedVersion:'3',slot,reason:'  Synthetic new time and exact original reason.  '};
const moved={...receipt,kind:'reschedule',expectedVersion:'3',observedVersion:'3',request:{slot,reason:move.reason},result:{...schedule,status:'proposed',version:'4',proposedSlot:slot,cycle:{number:'2',proposalVersion:'4',proposedAt:time,reason:move.reason,previousStatus:'confirmed',previousUpdatedAt:'2026-10-13T19:00:00.000Z'}}};
test('reschedule SDK sends fixed original facts once and recovers by private GET without slot or reason in URL',async()=>{
 const calls=[],api=client(async(url,init)=>{calls.push({url,init});return json(moved);});assert.deepEqual(await api.rescheduleViewingV2(enquiry,viewing,move,options),moved);assert.deepEqual(await api.getViewingRescheduleReceiptV2(enquiry,viewing,move,options),moved);assert.ok(calls[0].url.endsWith(`/viewings/${viewing}/reschedules`));assert.deepEqual(JSON.parse(calls[0].init.body),{...move,expectedVersion:3});assert.equal(calls[1].init.method,'GET');assert.equal(calls[1].init.body,undefined);assert.ok(calls[1].url.endsWith('/viewing-operations/'+operation));assert.equal(calls[1].url.includes('reason'),false);
});
test('lost or malformed reschedule writes stay uncertain and recovery cannot retry or become a write',async()=>{
 let count=0;const api=client(async()=>{count++;throw new Error('Synthetic discarded committed reschedule');});await rejects(()=>api.rescheduleViewingV2(enquiry,viewing,move,options),'NETWORK',true);assert.equal(count,1);await rejects(()=>api.getViewingRescheduleReceiptV2(enquiry,viewing,move,options),'NETWORK',false);assert.equal(count,2);
 const wrong=client(async()=>json({...moved,result:{...moved.result,cycle:{...moved.result.cycle,reason:'changed'}}}));await rejects(()=>wrong.rescheduleViewingV2(enquiry,viewing,move,options),'INVALID_RESPONSE',true);await rejects(()=>wrong.getViewingRescheduleReceiptV2(enquiry,viewing,move,options),'INVALID_RESPONSE',false);
});
test('invalid reschedule commands never dispatch and original conflict or refusal remains terminal',async()=>{
 let count=0;const api=client(async()=>{count++;return json({...moved,outcome:'conflict',reason:'VERSION_CONFLICT',observedVersion:'4',result:null});});for(const patch of [{actorId:actor},{cycle:{number:'2'}},{agreement:phone},{expectedVersion:3},{reason:' '}])await rejects(()=>api.rescheduleViewingV2(enquiry,viewing,{...move,...patch},options),'VALIDATION');assert.equal(count,0);assert.equal((await api.rescheduleViewingV2(enquiry,viewing,move,options)).outcome,'conflict');assert.equal((await client(async()=>json({...moved,outcome:'refused',reason:'SLOT_UNCHANGED',result:null})).rescheduleViewingV2(enquiry,viewing,move,options)).reason,'SLOT_UNCHANGED');
});
test('history client sends a bounded private read with no original command or operation identifiers',async()=>{
 const page={items:[{kind:'request',actorId:actor,recordedAt:time,schedule}],limit:1,truncated:false,currentVersion:'1'},calls=[],api=client(async(url,init)=>{calls.push({url,init});return json(page);});assert.deepEqual(await api.getViewingHistoryV2(enquiry,viewing,{...options,limit:1}),page);assert.ok(calls[0].url.endsWith(`/viewings/${viewing}/history?limit=1`));assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.body,undefined);assert.equal(calls[0].init.credentials,'omit');assert.equal(calls[0].init.redirect,'error');assert.equal(calls.length,1);
});
test('history read rejects bad limits and altered projections without write uncertainty or retry',async()=>{
 let calls=0;const api=client(async()=>{calls++;return json({items:[],limit:25,truncated:false,currentVersion:'1'});});await rejects(()=>api.getViewingHistoryV2(enquiry,viewing,{...options,limit:26}),'VALIDATION');assert.equal(calls,0);await rejects(()=>api.getViewingHistoryV2(enquiry,viewing,options),'INVALID_RESPONSE',false);assert.equal(calls,1);const lost=client(async()=>{throw new Error('Synthetic history read loss');});await rejects(()=>lost.getViewingHistoryV2(enquiry,viewing,options),'NETWORK',false);
});
test('terminal commands send one fixed kind route and recover original without reason in URL',async()=>{
 for(const [kind,suffix,status] of [['cancel','cancellations','cancelled'],['decline','declines','declined']]){
  const result={...cancelled,kind,result:{...cancelled.result,status,termination:{...cancelled.result.termination,kind}}},calls=[],api=client(async(url,init)=>{calls.push({url,init});return json(result);});
  assert.deepEqual(await api.terminateViewingV2(enquiry,viewing,kind,ending,options),result);assert.deepEqual(await api.getViewingTerminationReceiptV2(enquiry,viewing,kind,ending,options),result);
  assert.ok(calls[0].url.endsWith(`/viewings/${viewing}/${suffix}`));assert.deepEqual(JSON.parse(calls[0].init.body),{...ending,expectedVersion:2});assert.equal(calls[1].init.method,'GET');assert.equal(calls[1].init.body,undefined);assert.ok(calls[1].url.endsWith('/viewing-operations/'+operation));assert.equal(calls[1].url.includes('reason'),false);
 }
});
test('lost or altered terminal replies stay uncertain and original recovery remains read-only without retry',async()=>{
 let calls=0;const api=client(async()=>{calls++;throw new Error('Synthetic committed reply loss');});await rejects(()=>api.terminateViewingV2(enquiry,viewing,'cancel',ending,options),'NETWORK',true);assert.equal(calls,1);await rejects(()=>api.getViewingTerminationReceiptV2(enquiry,viewing,'cancel',ending,options),'NETWORK',false);assert.equal(calls,2);
 const altered=client(async()=>json({...cancelled,request:{reason:'changed'}}));await rejects(()=>altered.terminateViewingV2(enquiry,viewing,'cancel',ending,options),'INVALID_RESPONSE',true);await rejects(()=>altered.getViewingTerminationReceiptV2(enquiry,viewing,'cancel',ending,options),'INVALID_RESPONSE',false);
});
test('invalid terminal inputs never dispatch and conflicts or refusals retain original command',async()=>{
 let calls=0;const api=client(async()=>{calls++;return json({...cancelled,outcome:'conflict',reason:'VERSION_CONFLICT',observedVersion:'3',result:null});});
 for(const patch of [{expectedVersion:2},{actorId:actor},{reason:' '},{reason:'x'.repeat(1001)}])await rejects(()=>api.terminateViewingV2(enquiry,viewing,'cancel',{...ending,...patch},options),'VALIDATION');await rejects(()=>api.terminateViewingV2(enquiry,viewing,'confirm',ending,options),'VALIDATION');assert.equal(calls,0);
 assert.equal((await api.terminateViewingV2(enquiry,viewing,'cancel',ending,options)).outcome,'conflict');
 const refused=client(async()=>json({...cancelled,outcome:'refused',reason:'INVALID_STATE',result:null}));assert.equal((await refused.terminateViewingV2(enquiry,viewing,'cancel',ending,options)).reason,'INVALID_STATE');
});
test('phone confirmation sends one fixed source-free command and recovers original privately without notes in URL',async()=>{
 const calls=[],api=client(async(url,init)=>{calls.push({url,init});return json(confirmed);});assert.deepEqual(await api.confirmViewingV2(enquiry,viewing,phone,options),confirmed);assert.deepEqual(await api.getViewingConfirmationReceiptV2(enquiry,viewing,phone,options),confirmed);
 assert.equal(calls[0].url,`https://synthetic.invalid/v2/staff/enquiries/${enquiry}/viewings/${viewing}/confirmations`);assert.deepEqual(JSON.parse(calls[0].init.body),{...phone,expectedVersion:2});assert.equal(calls[1].init.method,'GET');assert.equal(calls[1].init.body,undefined);assert.ok(calls[1].url.endsWith('/viewing-operations/'+operation));assert.equal(calls[1].url.includes('agreement'),false);
});
test('invalid or lost confirmation writes stay uncertain and recoveries remain read-only with no retry',async()=>{
 let calls=0;const lost=client(async()=>{calls++;throw new Error('Synthetic lost committed confirmation');});await rejects(()=>lost.confirmViewingV2(enquiry,viewing,phone,options),'NETWORK',true);assert.equal(calls,1);await rejects(()=>lost.getViewingConfirmationReceiptV2(enquiry,viewing,phone,options),'NETWORK',false);
 const altered=client(async()=>json({...confirmed,request:{...confirmed.request,notes:'changed'}}));await rejects(()=>altered.confirmViewingV2(enquiry,viewing,phone,options),'INVALID_RESPONSE',true);await rejects(()=>altered.getViewingConfirmationReceiptV2(enquiry,viewing,phone,options),'INVALID_RESPONSE',false);
});
test('invalid phone evidence refuses before network while original conflict receipt remains terminal',async()=>{
 let calls=0;const api=client(async()=>{calls++;return json({...confirmed,outcome:'conflict',reason:'VERSION_CONFLICT',result:null,observedVersion:'3'});});for(const patch of [{channel:'email'},{expectedVersion:2},{actorId:actor},{notes:' '},{agreedAt:null}])await rejects(()=>api.confirmViewingV2(enquiry,viewing,{...phone,...patch},options),'VALIDATION');assert.equal(calls,0);
 const value=await api.confirmViewingV2(enquiry,viewing,phone,options);assert.equal(value.outcome,'conflict');assert.equal(value.result,null);assert.equal(calls,1);
});
test('request and original recovery send fixed routes and explicit original facts without private URL notes',async()=>{
 const calls=[],api=client(async(url,init)=>{calls.push({url,init});return json(receipt);});
 assert.deepEqual(await api.requestViewingV2(enquiry,command,options),receipt);assert.deepEqual(await api.getViewingReceiptV2(enquiry,{kind:'request',command},options),receipt);
 assert.equal(calls.length,2);assert.equal(JSON.parse(calls[0].init.body).expectedEnquiryVersion,3);assert.equal(JSON.parse(calls[0].init.body).notes,command.notes);
 assert.equal(calls[1].init.method,'GET');assert.ok(calls[1].url.endsWith('/viewing-operations/'+operation));assert.equal(calls[1].url.includes('Private'),false);
 for(const call of calls){assert.equal(call.init.credentials,'omit');assert.equal(call.init.redirect,'error');assert.equal(call.init.headers.Authorization,'Bearer synthetic-only');}
});
test('proposal binds original target and exposes only explicit source-free payload',async()=>{
 let sent;const response={...receipt,kind:'propose',expectedVersion:'1',observedVersion:'1',request:{slot},result:{...schedule,version:'2',status:'proposed',proposedSlot:slot}},api=client(async(url,init)=>{sent={url,init};return json(response);});
 assert.equal((await api.proposeViewingV2(enquiry,viewing,{operationId:operation,expectedVersion:'1',slot},options)).result.status,'proposed');assert.ok(sent.url.endsWith(`/viewings/${viewing}/proposals`));assert.deepEqual(JSON.parse(sent.init.body),{operationId:operation,expectedVersion:1,slot});
});
test('lost or invalid successful write replies remain uncertain with one dispatch;recovery errors are read-only',async()=>{
 let calls=0;const lost=client(async()=>{calls++;throw new Error('Synthetic lost committed reply');});await rejects(()=>lost.requestViewingV2(enquiry,command,options),'NETWORK',true);assert.equal(calls,1);
 for(const response of [{...receipt,request:{...receipt.request,notes:'altered'}},{...receipt,result:{...schedule,version:'2'}}])await rejects(()=>client(async()=>json(response)).requestViewingV2(enquiry,command,options),'INVALID_RESPONSE',true);
 await rejects(()=>client(async()=>json({...receipt,request:{...receipt.request,notes:'altered'}})).getViewingReceiptV2(enquiry,{kind:'request',command},options),'INVALID_RESPONSE',false);
 const duplicate=JSON.stringify(receipt).replace('"reason":null','"reason":null,"reason":null');await rejects(()=>client(async()=>new Response(duplicate,{headers:{'Content-Type':'application/json'}})).requestViewingV2(enquiry,command,options),'INVALID_RESPONSE',true);
});
test('invalid authority,versions,targets and overlarge feed limits never dispatch',async()=>{
 let calls=0;const api=client(async()=>{calls++;return json(receipt);});
 for(const invalid of [{...command,actorId:actor},{...command,expectedEnquiryVersion:'01'},{...command,notes:' '},{...command,preferredSlots:[{...slot,confirmed:true}]}])await rejects(()=>api.requestViewingV2(enquiry,invalid,options),'VALIDATION');
 await rejects(()=>api.proposeViewingV2(enquiry,'bad',{operationId:operation,expectedVersion:'1',slot},options),'VALIDATION');await rejects(()=>api.listViewingsV2(enquiry,{...options,limit:26}),'VALIDATION');await rejects(()=>api.getViewingReceiptV2(enquiry,{kind:'request',command,tenantId:id(9)},options),'VALIDATION');assert.equal(calls,0);
});
test('bounded feed and detail reject wrong targets and preserve immutable private projections',async()=>{
 const api=client(async url=>json(url.includes('?limit=')?{items:[detail],limit:25,truncated:false}:detail));assert.equal((await api.listViewingsV2(enquiry,options)).items[0].notes,command.notes);assert.ok(Object.isFrozen(await api.getViewingV2(enquiry,viewing,options)));
 await rejects(()=>client(async()=>json({...detail,schedule:{...schedule,enquiryId:id(9)}})).getViewingV2(enquiry,viewing,options),'INVALID_RESPONSE');
 await rejects(()=>client(async()=>json({items:[detail,detail],limit:25,truncated:false})).listViewingsV2(enquiry,options),'INVALID_RESPONSE');
});

test('outcome SDK private reads preserve exact saved detail and history using GET only',async()=>{
 const o=outcomeFixture({enquiry,viewing,listing,actor,operation,later:true,kind:'no_show'}),calls=[];
 const api=client(async(url,init)=>{calls.push({url,init});return json(url.includes('/history')?o.history:url.includes('?limit')?{items:[o.detail],limit:25,truncated:false}:o.detail);});assert.deepEqual(await api.getViewingV2(enquiry,viewing,options),o.detail);assert.deepEqual((await api.listViewingsV2(enquiry,options)).items,[o.detail]);assert.deepEqual(await api.getViewingHistoryV2(enquiry,viewing,options),o.history);for(const {init} of calls){assert.equal(init.method,'GET');assert.equal(init.body,undefined);assert.equal(init.credentials,'omit');}assert.equal(calls.length,3);
});
test('outcome SDK malformed saved evidence fails as a read without retry or write uncertainty',async()=>{
 const o=outcomeFixture({enquiry,viewing,listing,actor,operation});let calls=0;const api=client(async()=>{calls++;return json({...o.detail,updatedAt:o.detail.confirmation.recordedAt});});await rejects(()=>api.getViewingV2(enquiry,viewing,options),'INVALID_RESPONSE',false);assert.equal(calls,1);const page=structuredClone(o.history);page.items[0].schedule.agreement.notes='Changed';await rejects(()=>client(async()=>json(page)).getViewingHistoryV2(enquiry,viewing,options),'INVALID_RESPONSE',false);
});
