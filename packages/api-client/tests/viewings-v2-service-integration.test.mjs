import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {startStaffPreview} from '../../../apps/api/dev/staff-preview.mjs';
import {RealtorApiClient,ApiClientError} from '../dist/index.js';
const slot={startAt:'2090-01-01T09:00:00.000Z',endAt:'2090-01-01T10:00:00.000Z',timeZone:'Africa/Nairobi'};
const denied=status=>e=>e instanceof ApiClientError&&e.kind==='HTTP'&&e.status===status&&!e.submissionUncertain;
test('signed phone confirmation recovers a lost committed result and preserves historical proposals/current access',async()=>{
 const preview=await startStaffPreview({port:0,enquiryPreview:'synthetic-v1',enquiryCatalogue:'synthetic-v1'});
 try{
  const make=fetch=>new RealtorApiClient({baseUrl:preview.origin,allowLoopbackHttp:true,privacyNoticeVersion:'synthetic-staff-notice-v1',...(fetch?{fetch}:{})}),api=make(),admin={bearerToken:preview.enquiryStaff.admin.bearerToken},agent={bearerToken:preview.enquiryStaff.agent.bearerToken},enquiry=preview.enquiryFixtures.assigned;
  const request={operationId:randomUUID(),expectedEnquiryVersion:'2',listingId:preview.listingId,preferredSlots:[],notes:'Synthetic request before agreement.'},requested=await api.requestViewingV2(enquiry,request,agent);
  const proposal={operationId:randomUUID(),expectedVersion:'1',slot},proposed=await api.proposeViewingV2(enquiry,requested.viewingId,proposal,agent);
  const command={operationId:randomUUID(),expectedVersion:'2',slot,channel:'phone',agreedAt:proposed.completedAt,notes:'  Fictional phone agreement.\nExact original evidence.  '};
  let writes=0;const lost=make(async(url,init)=>{const response=await fetch(url,init);if(init.method==='POST'&&url.endsWith('/confirmations')){writes++;assert.equal(response.status,200);await response.arrayBuffer();throw new Error('Synthetic loss after committed confirmation');}return response;});
  await assert.rejects(()=>lost.confirmViewingV2(enquiry,requested.viewingId,command,agent),e=>e.submissionUncertain&&e.kind==='NETWORK');assert.equal(writes,1);
  const receipt=await api.getViewingConfirmationReceiptV2(enquiry,requested.viewingId,command,agent);assert.equal(receipt.result.status,'confirmed');assert.equal(receipt.result.version,'3');assert.equal(receipt.result.agreement.notes,command.notes);assert.deepEqual(await api.confirmViewingV2(enquiry,requested.viewingId,command,agent),receipt);
  assert.deepEqual(await api.getViewingReceiptV2(enquiry,{kind:'request',command:request},agent),requested);assert.deepEqual(await api.getViewingReceiptV2(enquiry,{kind:'propose',viewingId:requested.viewingId,command:proposal},agent),proposed);
  const detail=await api.getViewingV2(enquiry,requested.viewingId,admin);assert.equal(detail.confirmation.recordedById,preview.enquiryStaff.agent.actorId);assert.equal(detail.confirmation.proposedAt,proposed.completedAt);assert.equal((await api.listViewingsV2(enquiry,agent)).items.length,1);assert.equal((await api.getStaffEnquiryV2(enquiry,admin)).version,'2');
  await assert.rejects(()=>api.confirmViewingV2(enquiry,requested.viewingId,{...command,notes:'changed'},agent),denied(409));await assert.rejects(()=>api.getViewingConfirmationReceiptV2(enquiry,requested.viewingId,command,admin),denied(404));
  const directory=await api.listEnquiryAssigneesV2(admin),peer=directory.items.find(x=>x.role==='agent'&&x.userId!==preview.enquiryStaff.agent.actorId).userId;
  await api.applyEnquiryOperationV2(enquiry,{operationId:randomUUID(),kind:'assign',expectedVersion:'2',assignedAgentId:peer,status:null,nextActionAt:null,reason:null},admin);await assert.rejects(()=>api.getViewingConfirmationReceiptV2(enquiry,requested.viewingId,command,agent),denied(404));
  await api.applyEnquiryOperationV2(enquiry,{operationId:randomUUID(),kind:'assign',expectedVersion:'3',assignedAgentId:preview.enquiryStaff.agent.actorId,status:null,nextActionAt:null,reason:null},admin);assert.deepEqual(await api.confirmViewingV2(enquiry,requested.viewingId,command,agent),receipt);
  assert.equal((await api.getStaffEnquiryV2(enquiry,agent)).version,'4');assert.equal((await api.listViewingsV2(enquiry,agent)).items.length,1);
 }finally{await preview.close();}
});
test('signed viewing SDK preserves original committed receipts,replay and current assignment over real HTTP/restricted SQL',async()=>{
 const preview=await startStaffPreview({port:0,enquiryPreview:'synthetic-v1',enquiryCatalogue:'synthetic-v1',actor:'other-company-admin'});
 try{
  const make=fetch=>new RealtorApiClient({baseUrl:preview.origin,allowLoopbackHttp:true,privacyNoticeVersion:'synthetic-staff-notice-v1',...(fetch?{fetch}:{})}),api=make();
  const admin={bearerToken:preview.enquiryStaff.admin.bearerToken},agent={bearerToken:preview.enquiryStaff.agent.bearerToken},enquiry=preview.enquiryFixtures.assigned;
  const command={operationId:randomUUID(),expectedEnquiryVersion:'2',listingId:preview.listingId,preferredSlots:[slot],notes:'  Fictional signed viewing request.\nKeep original notes.  '};
  let writes=0;const lost=make(async(url,init)=>{const response=await fetch(url,init);if(init.method==='POST'&&url.endsWith('/viewings')){writes++;assert.equal(response.status,200);await response.arrayBuffer();throw new Error('Synthetic loss after committed HTTP reply');}return response;});
  await assert.rejects(()=>lost.requestViewingV2(enquiry,command,agent),e=>e instanceof ApiClientError&&e.kind==='NETWORK'&&e.submissionUncertain);assert.equal(writes,1);
  const original={kind:'request',command},receipt=await api.getViewingReceiptV2(enquiry,original,agent);assert.equal(receipt.outcome,'applied');assert.equal(receipt.request.notes,command.notes);assert.equal(receipt.result.status,'requested');
  assert.deepEqual(await api.requestViewingV2(enquiry,command,agent),receipt);assert.equal((await api.listViewingsV2(enquiry,agent)).items.length,1);
  const proposal={operationId:randomUUID(),expectedVersion:'1',slot},proposed=await api.proposeViewingV2(enquiry,receipt.viewingId,proposal,agent);assert.equal(proposed.result.status,'proposed');assert.equal(proposed.result.version,'2');
  assert.deepEqual(await api.getViewingReceiptV2(enquiry,original,agent),receipt);assert.deepEqual(await api.proposeViewingV2(enquiry,receipt.viewingId,proposal,agent),proposed);
  assert.equal((await api.getViewingV2(enquiry,receipt.viewingId,admin)).schedule.version,'2');assert.equal((await api.getStaffEnquiryV2(enquiry,admin)).version,'2');
  await assert.rejects(()=>api.requestViewingV2(enquiry,{...command,notes:'changed'},agent),denied(409));await assert.rejects(()=>api.getViewingReceiptV2(enquiry,original,admin),denied(404));
  await assert.rejects(()=>api.listViewingsV2(enquiry,{bearerToken:preview.bearerToken}),denied(403));
  const directory=await api.listEnquiryAssigneesV2(admin),peer=directory.items.find(x=>x.role==='agent'&&x.userId!==preview.enquiryStaff.agent.actorId).userId;
  await api.applyEnquiryOperationV2(enquiry,{operationId:randomUUID(),kind:'assign',expectedVersion:'2',assignedAgentId:peer,status:null,nextActionAt:null,reason:null},admin);
  await assert.rejects(()=>api.getViewingReceiptV2(enquiry,original,agent),denied(404));await assert.rejects(()=>api.listViewingsV2(enquiry,agent),denied(404));assert.equal((await api.listViewingsV2(enquiry,admin)).items[0].assignedAgentId,peer);
  const recoveredProposal=await api.getViewingReceiptV2(enquiry,{kind:'propose',viewingId:receipt.viewingId,command:proposal},admin).then(()=>null,e=>e);assert.ok(denied(404)(recoveredProposal));
  assert.equal((await fetch(`${preview.origin}/v2/staff/enquiries/${enquiry}/viewings?limit=26`,{headers:{Authorization:`Bearer ${admin.bearerToken}`}})).status,400);
  assert.equal((await fetch(`${preview.origin}/v2/staff/enquiries/${enquiry}/viewings`)).status,401);
 }finally{await preview.close();}
});
