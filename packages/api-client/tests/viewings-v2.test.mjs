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
