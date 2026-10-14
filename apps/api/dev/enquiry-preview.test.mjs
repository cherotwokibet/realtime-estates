import assert from 'node:assert/strict';
import {request} from 'node:http';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {ENQUIRY_PREVIEW_FIXTURES,startStaffPreview} from './staff-preview.mjs';

const call=(preview,path,{role='admin',token=preview.enquiryStaff?.[role].bearerToken,method='GET',body,headers={}}={})=>fetch(preview.origin+path,{
  method,headers:{...(token?{Authorization:`Bearer ${token}`}:{}) ,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},
  ...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)}),
});
async function read(preview,path,options){const response=await call(preview,path,options);assert.equal(response.status,200);return response.json();}
const base='/v2/staff/enquiries';
test('targeted ending corruption skips request/proposal/confirmation and preserves original terminal recovery',async()=>{
 const preview=await startStaffPreview({port:0,enquiryPreview:'synthetic-v1',enquiryCatalogue:'synthetic-v1',viewingReplyFault:'invalid-first-termination-v1'});
 try{
  const path=base+'/'+preview.enquiryFixtures.assigned,request={operationId:randomUUID(),expectedEnquiryVersion:2,listingId:preview.listingId,preferredSlots:[],notes:'Fictional viewing before phone agreement.'};
  const requested=await read(preview,path+'/viewings',{role:'agent',method:'POST',body:request});assert.equal(requested.outcome,'applied');
  const slot={startAt:'2090-01-01T09:00:00.000Z',endAt:'2090-01-01T10:00:00.000Z',timeZone:'Africa/Nairobi'},target=path+'/viewings/'+requested.viewingId;
  const proposed=await read(preview,target+'/proposals',{role:'agent',method:'POST',body:{operationId:randomUUID(),expectedVersion:1,slot}});assert.equal(proposed.outcome,'applied');
  const phone={operationId:randomUUID(),expectedVersion:2,slot,channel:'phone',agreedAt:proposed.completedAt,notes:'Synthetic phone agreement before ending.'};
  const confirmed=await read(preview,target+'/confirmations',{role:'agent',method:'POST',body:phone});assert.equal(confirmed.result.status,'confirmed');
  const command={operationId:randomUUID(),expectedVersion:3,reason:'  Synthetic cancellation with exact original reason.  '};
  const stale=await read(preview,target+'/cancellations',{role:'agent',method:'POST',body:{...command,operationId:randomUUID(),expectedVersion:2}});assert.equal(stale.outcome,'conflict');
  assert.deepEqual(await read(preview,target+'/cancellations',{role:'agent',method:'POST',body:command}),{syntheticReplyCorruption:true});
  const recovered=await read(preview,path+'/viewing-operations/'+command.operationId,{role:'agent'});assert.equal(recovered.result.status,'cancelled');assert.equal(recovered.result.termination.reason,command.reason);assert.deepEqual(recovered.result.agreement,confirmed.result.agreement);assert.deepEqual(await read(preview,target+'/cancellations',{role:'agent',method:'POST',body:command}),recovered);
  assert.equal((await read(preview,path+'/viewings?limit=25',{role:'agent'})).items.length,1);
 }finally{await preview.close();}
});
test('targeted confirmation corruption skips request/proposal and preserves committed phone agreement recovery',async()=>{
 const preview=await startStaffPreview({port:0,enquiryPreview:'synthetic-v1',enquiryCatalogue:'synthetic-v1',viewingReplyFault:'invalid-first-confirmation-v1'});
 try{
  const path=base+'/'+preview.enquiryFixtures.assigned,request={operationId:randomUUID(),expectedEnquiryVersion:2,listingId:preview.listingId,preferredSlots:[],notes:'Fictional viewing before phone agreement.'};
  const requested=await read(preview,path+'/viewings',{role:'agent',method:'POST',body:request});assert.equal(requested.outcome,'applied');
  const slot={startAt:'2090-01-01T09:00:00.000Z',endAt:'2090-01-01T10:00:00.000Z',timeZone:'Africa/Nairobi'},target=path+'/viewings/'+requested.viewingId;
  const proposed=await read(preview,target+'/proposals',{role:'agent',method:'POST',body:{operationId:randomUUID(),expectedVersion:1,slot}});assert.equal(proposed.outcome,'applied');
  const command={operationId:randomUUID(),expectedVersion:2,slot,channel:'phone',agreedAt:proposed.completedAt,notes:'  Fictional completed phone agreement.  '};
  assert.equal((await call(preview,target+'/confirmations',{token:null,method:'POST',body:command})).status,401);
  assert.equal((await call(preview,target+'/confirmations',{role:'agent'})).status,405);
  const stale=await read(preview,target+'/confirmations',{role:'agent',method:'POST',body:{...command,operationId:randomUUID(),expectedVersion:1}});assert.equal(stale.outcome,'conflict');
  assert.deepEqual(await read(preview,target+'/confirmations',{role:'agent',method:'POST',body:command}),{syntheticReplyCorruption:true});
  const recovered=await read(preview,path+'/viewing-operations/'+command.operationId,{role:'agent'});assert.equal(recovered.result.status,'confirmed');assert.equal(recovered.result.agreement.notes,command.notes);assert.deepEqual(await read(preview,target+'/confirmations',{role:'agent',method:'POST',body:command}),recovered);
  assert.equal((await read(preview,path+'/viewings?limit=25',{role:'agent'})).items.length,1);
 }finally{await preview.close();}
});
test('one-shot synthetic viewing corruption preserves original receipt reads and exact replay after commit',async()=>{
 await assert.rejects(()=>startStaffPreview({port:0,viewingReplyFault:'invalid-first-applied-v1'}));
 await assert.rejects(()=>startStaffPreview({port:0,enquiryPreview:'synthetic-v1',viewingReplyFault:'invalid-first-applied-v1'}));
 await assert.rejects(()=>startStaffPreview({port:0,enquiryPreview:'synthetic-v1',enquiryCatalogue:'synthetic-v1',viewingReplyFault:'unknown'}));
 const preview=await startStaffPreview({port:0,enquiryPreview:'synthetic-v1',enquiryCatalogue:'synthetic-v1',viewingReplyFault:'invalid-first-applied-v1'});
 try{
  const path=base+'/'+preview.enquiryFixtures.general,command={operationId:randomUUID(),expectedEnquiryVersion:1,listingId:preview.listingId,preferredSlots:[],notes:'  Fictional viewing.\nExact original notes.  '};
  assert.equal((await call(preview,path+'/viewings',{token:null,method:'POST',body:command})).status,401);
  const stale=await read(preview,path+'/viewings',{method:'POST',body:{...command,operationId:randomUUID(),expectedEnquiryVersion:2}});assert.equal(stale.outcome,'conflict');
  assert.equal((await read(preview,path+'/viewings?limit=25')).items.length,0);
  assert.deepEqual(await read(preview,path+'/viewings',{method:'POST',body:command}),{syntheticReplyCorruption:true});
  const recovered=await read(preview,path+'/viewing-operations/'+command.operationId);assert.equal(recovered.outcome,'applied');assert.equal(recovered.request.notes,command.notes);
  assert.deepEqual(await read(preview,path+'/viewings',{method:'POST',body:command}),recovered);
  assert.equal((await read(preview,path+'/viewings?limit=25')).items.length,1);assert.equal((await read(preview,path)).version,'1');
  const second=await read(preview,path+'/viewings',{method:'POST',body:{...command,operationId:randomUUID()}});assert.equal(second.outcome,'applied');
  assert.equal((await read(preview,path+'/viewings?limit=25')).items.length,2);
 }finally{await preview.close();}
});
test('one-shot synthetic contact receipt corruption preserves committed original recovery and exact replay',async()=>{
 await assert.rejects(()=>startStaffPreview({port:0,contactReplyFault:'invalid-first-applied-v1'}));
 await assert.rejects(()=>startStaffPreview({port:0,enquiryPreview:'synthetic-v1',contactReplyFault:'unknown'}));
 const preview=await startStaffPreview({port:0,enquiryPreview:'synthetic-v1',contactReplyFault:'invalid-first-applied-v1'});
 try{
  const path=base+'/'+preview.enquiryFixtures.general,operationId=randomUUID(),command={operationId,expectedVersion:1,channel:'call',outcome:'connected',occurredAt:'2026-01-01T00:00:00.000Z',notes:'  Synthetic original notes.\nKept exactly.  '};
  assert.equal((await call(preview,path+'/contacts',{token:null,method:'POST',body:command})).status,401);
  const stale=await read(preview,path+'/contacts',{method:'POST',body:{...command,operationId:randomUUID(),expectedVersion:2}});assert.equal(stale.outcome,'conflict');
  assert.equal((await read(preview,path+'/contacts?limit=25')).items.length,0);
  assert.deepEqual(await read(preview,path+'/contacts',{method:'POST',body:command}),{syntheticReplyCorruption:true});
  const recovered=await read(preview,path+'/contacts/operations/'+operationId);assert.equal(recovered.outcome,'applied');assert.equal(recovered.request.notes,command.notes);
  assert.deepEqual(await read(preview,path+'/contacts',{method:'POST',body:command}),recovered);
  assert.equal((await read(preview,path+'/contacts?limit=25')).items.length,1);assert.equal((await read(preview,path)).version,'1');
  const second=await read(preview,path+'/contacts',{method:'POST',body:{...command,operationId:randomUUID()}});assert.equal(second.outcome,'applied');
  assert.equal((await read(preview,path+'/contacts?limit=25')).items.length,2);
 }finally{await preview.close();}
});
test('published synthetic catalogue binds property capture to the fixed company and original receipt',async()=>{
 const preview=await startStaffPreview({port:0,enquiryPreview:'synthetic-v1',enquiryCatalogue:'synthetic-v1'});
 try{
  const catalogue=await read(preview,'/v2/properties?limit=100',{token:null});assert.equal(catalogue.items.length,1);assert.equal(catalogue.items[0].id,preview.listingId);
  const body={listingId:preview.listingId,name:'Synthetic property prospect',email:'property@example.invalid',phone:null,message:'Fictional property enquiry',origin:'web',noticeVersion:'synthetic-staff-notice-v1',noticeAcknowledged:true};
  const options={token:null,method:'POST',body,headers:{'Idempotency-Key':randomUUID()}};
  const saved=await call(preview,'/v1/enquiries',options);assert.equal(saved.status,201);const receipt=await saved.json();
  const replay=await call(preview,'/v1/enquiries',options);assert.equal(replay.status,201);assert.deepEqual(await replay.json(),receipt);
  const detail=await read(preview,base+'/'+receipt.id);assert.equal(detail.listingId,preview.listingId);assert.equal(detail.origin,'web');
  for(const listingId of ['00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000500']){
    const response=await call(preview,'/v1/enquiries',{...options,body:{...body,listingId},headers:{'Idempotency-Key':randomUUID()}});assert.ok(response.status>=400);
  }
  assert.equal((await read(preview,base)).items.length,6);
  assert.equal((await call(preview,'/v2/properties?tenantId=other',{token:null})).status,400);
  assert.equal((await call(preview,'/v2/properties',{method:'POST',token:null,body:{}})).status,403);
 }finally{await preview.close();}
});
test('property catalogue requires its own exact opt-in and stays absent from general intake',async()=>{
 for(const enquiryCatalogue of [true,'synthetic','constructor'])await assert.rejects(()=>startStaffPreview({port:0,enquiryPreview:'synthetic-v1',enquiryCatalogue}));
 await assert.rejects(()=>startStaffPreview({port:0,enquiryCatalogue:'synthetic-v1'}));
 const preview=await startStaffPreview({port:0,enquiryPreview:'synthetic-v1'});try{assert.equal((await call(preview,'/v2/properties',{token:null})).status,404);}finally{await preview.close();}
});
test('guest intake enters the same private inbox and exact replay creates one row',async()=>{
 const preview=await startStaffPreview({port:0,enquiryPreview:'synthetic-v1'});
 try{
  const body={listingId:null,name:'Synthetic guest intake',email:'guest@example.invalid',phone:null,message:'Fictional guest capture',origin:'web',noticeVersion:'synthetic-staff-notice-v1',noticeAcknowledged:true},key=randomUUID();
  const options={token:null,method:'POST',body,headers:{'Idempotency-Key':key}};
  const first=await call(preview,'/v1/enquiries',options);assert.equal(first.status,201);const receipt=await first.json();
  const replay=await call(preview,'/v1/enquiries',options);assert.equal(replay.status,201);assert.deepEqual(await replay.json(),receipt);
  const admin=await read(preview,base);assert.equal(admin.items.length,6);assert.equal(admin.items.filter(row=>row.id===receipt.id).length,1);
  const detail=await read(preview,base+'/'+receipt.id);assert.equal(detail.email,body.email);assert.equal(detail.message,body.message);assert.equal(detail.status,'new');
  assert.equal((await call(preview,base+'/'+receipt.id,{role:'agent'})).status,404);
  assert.equal((await call(preview,'/v1/enquiries',{...options,token:preview.enquiryStaff.admin.bearerToken})).status,403);
 }finally{await preview.close();}
});
const assign=(operationId,expectedVersion,assignedAgentId)=>({operationId,kind:'assign',expectedVersion,assignedAgentId,status:null,nextActionAt:null,reason:null});
const transition=(operationId,expectedVersion,status,nextActionAt=null,reason=null)=>({operationId,kind:'transition',expectedVersion,assignedAgentId:null,status,nextActionAt,reason});
const reschedule=(operationId,expectedVersion,nextActionAt)=>({operationId,kind:'reschedule',expectedVersion,assignedAgentId:null,status:null,nextActionAt,reason:null});

test('enquiry preview requires its exact explicit mode and refuses unrelated media flags before startup',async()=>{
  for(const options of [{enquiryPreview:true},{enquiryPreview:'synthetic'},{enquiryPreview:'constructor'},
    {enquiryPreview:'synthetic-v1',seedAcceptedMedia:true},{enquiryPreview:'synthetic-v1',seedPendingReviews:true},
    {enquiryPreview:'synthetic-v1',nativeUploads:{mode:'synthetic-native-v1'}}])await assert.rejects(()=>startStaffPreview({port:0,...options}));
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
  try{await assert.rejects(()=>startStaffPreview({port:0,enquiryPreview:'synthetic-v1'}),/production/);}
  finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
test('default staff preview keeps its old draft surface and does not enable enquiry routes or dual credentials',async()=>{
  const preview=await startStaffPreview({port:0});try{
    assert.equal(Object.hasOwn(preview,'enquiryStaff'),false);assert.equal(Object.hasOwn(preview,'enquiryFixtures'),false);
    const draft=await fetch(`${preview.origin}/v2/staff/listings/${preview.listingId}/drafts/1`,{headers:{Authorization:`Bearer ${preview.bearerToken}`}});assert.equal(draft.status,200);
    for(const path of [base,'/v2/staff/enquiry-assignees',base+'/'+ENQUIRY_PREVIEW_FIXTURES['realtime-estates'].general])assert.equal((await call(preview,path,{token:preview.bearerToken})).status,404);
  }finally{await preview.close();}
});
test('one opt-in database provides fixed admin and assigned-agent views with trusted nonenumerable credentials',async()=>{
  const preview=await startStaffPreview({port:0,enquiryPreview:'synthetic-v1'});try{
    assert.equal(Object.isFrozen(preview),true);assert.equal(Object.getOwnPropertyDescriptor(preview,'enquiryStaff').enumerable,false);
    assert.ok(Object.isFrozen(preview.enquiryStaff)&&Object.isFrozen(preview.enquiryStaff.admin)&&Object.isFrozen(preview.enquiryStaff.agent));
    assert.notEqual(preview.enquiryStaff.admin.actorId,preview.enquiryStaff.agent.actorId);assert.notEqual(preview.enquiryStaff.admin.bearerToken,preview.enquiryStaff.agent.bearerToken);
    for(const credential of Object.values(preview.enquiryStaff)){
      const claims=JSON.parse(Buffer.from(credential.bearerToken.split('.')[1],'base64url').toString('utf8'));
      assert.equal(claims.sub,credential.actorId);assert.equal(claims.exp-claims.iat,1800);assert.equal(claims.synthetic,true);
      assert.equal(Object.hasOwn(claims,'role'),false);assert.equal(Object.hasOwn(claims,'tenantId'),false);
      assert.equal(JSON.stringify(preview).includes(credential.bearerToken),false);
    }
    assert.deepEqual(preview.enquiryFixtures,ENQUIRY_PREVIEW_FIXTURES['realtime-estates']);
    const admin=await read(preview,base),agent=await read(preview,base,{role:'agent'});
    assert.equal(admin.items.length,5);assert.equal(admin.truncated,false);assert.equal(agent.items.length,3);
    assert.deepEqual(new Set(agent.items.map(row=>row.id)),new Set([preview.enquiryFixtures.assigned,preview.enquiryFixtures.contacted,preview.enquiryFixtures.qualified]));
    assert.equal(admin.items.some(row=>Object.hasOwn(row,'email')||Object.hasOwn(row,'message')),false);
    const page=await read(preview,base+'?limit=1');assert.equal(page.items.length,1);assert.equal(page.truncated,true);
    const contact=await read(preview,base+'/'+preview.enquiryFixtures.contacted,{role:'agent'});
    assert.equal(contact.version,'3');assert.equal(contact.status,'contacted');assert.ok(Date.parse(contact.nextActionAt)<Date.now());
    assert.equal(contact.listingId,null);assert.equal(contact.contactedRevision,null);assert.match(contact.email,/@example\.invalid$/);assert.match(contact.message,/Fictional enquiry fixture/);assert.ok(contact.message.includes('\n'));
    const qualified=await read(preview,base+'/'+preview.enquiryFixtures.qualified,{role:'agent'});assert.equal(qualified.status,'qualified');assert.equal(qualified.version,'4');
    assert.equal((await call(preview,base+'/'+preview.enquiryFixtures.peer,{role:'agent'})).status,404);
    const picker=await read(preview,'/v2/staff/enquiry-assignees');assert.equal(picker.items.length,3);assert.ok(picker.items.every(row=>Object.keys(row).sort().join(',')==='role,userId'));
    assert.equal((await call(preview,'/v2/staff/enquiry-assignees',{role:'agent'})).status,403);
    const healthText=await (await fetch(preview.origin+'/health')).text();
    for(const credential of Object.values(preview.enquiryStaff))assert.equal(healthText.includes(credential.bearerToken),false);
    const health=JSON.parse(healthText);assert.equal(health.acceptedMediaMetadataOnly,false);assert.equal(health.nativeUploads,false);assert.equal(health.privateMediaPreviews,false);assert.equal(health.productionReady,false);
  }finally{await preview.close();}
});
test('shared signed views apply exact operations and retain original history after stale work and reassignment',async()=>{
  const preview=await startStaffPreview({port:0,enquiryPreview:'synthetic-v1'});try{
    const enquiry=preview.enquiryFixtures.general,path=base+'/'+enquiry,operationId=randomUUID();
    const command=assign(operationId,1,preview.enquiryStaff.agent.actorId);
    assert.equal((await call(preview,path+'/operations',{role:'agent',method:'POST',body:command})).status,403);
    const assigned=await read(preview,path+'/operations',{method:'POST',body:command});assert.equal(assigned.outcome,'applied');assert.equal(assigned.result.version,'2');
    assert.equal((await read(preview,base,{role:'agent'})).items.length,4);
    const contactedId=randomUUID(),due='2026-01-02T03:04:05.006Z';
    const contacted=await read(preview,path+'/operations',{role:'agent',method:'POST',body:transition(contactedId,2,'contacted',due)});assert.equal(contacted.result.version,'3');
    const stale=await read(preview,path+'/operations',{role:'agent',method:'POST',body:reschedule(randomUUID(),2,'2026-01-03T03:04:05.006Z')});assert.equal(stale.outcome,'conflict');assert.equal(stale.result.version,'3');
    assert.deepEqual(await read(preview,path+'/operations/'+operationId),assigned);
    assert.deepEqual(await read(preview,path+'/operations',{method:'POST',body:command}),assigned);
    assert.equal((await read(preview,path)).version,'3','Recovery/replay never adopts historical version or mutates current record.');
    const picker=await read(preview,'/v2/staff/enquiry-assignees');const peer=picker.items.find(row=>row.role==='agent'&&row.userId!==preview.enquiryStaff.agent.actorId);
    const moved=await read(preview,path+'/operations',{method:'POST',body:assign(randomUUID(),3,peer.userId)});assert.equal(moved.result.version,'4');
    assert.equal((await call(preview,path,{role:'agent'})).status,404);assert.equal((await call(preview,path+'/operations/'+contactedId,{role:'agent'})).status,404);
    assert.equal((await call(preview,path+'/operations/'+contactedId)).status,404,'Current admin cannot read another original requester receipt.');
    assert.deepEqual(await read(preview,path+'/operations/'+operationId),assigned);
    assert.equal((await read(preview,path)).version,'4');
  }finally{await preview.close();}
});
test('opt-in allowlist refuses unsafe context, credentials, extra routes and methods without leaking tokens',async()=>{
  const preview=await startStaffPreview({port:0,enquiryPreview:'synthetic-v1'});try{
    const detail=base+'/'+preview.enquiryFixtures.general,operations=detail+'/operations';
    assert.equal((await call(preview,base,{token:null})).status,401);
    assert.equal((await call(preview,base,{token:'forged'})).status,401);
    for(const path of [base+'?tenantId=foreign',base+'?actor=admin',base+'?limit=1&limit=2',base+'?limit=01',base+'?limit=101',detail+'?limit=1',operations+'?limit=1','/v2/staff/enquiry-assignees?actor=agent'])assert.equal((await call(preview,path)).status,400,path);
    for(const path of ['/login','/token','/credentials','/v2/properties',`/v2/staff/listings/${preview.listingId}/drafts/1`,detail+'/transitions',operations+'/'+randomUUID()+'/finalize'])assert.equal((await call(preview,path)).status,404,path);
    assert.equal((await call(preview,base,{method:'POST',body:{}})).status,405);
    assert.equal((await call(preview,'/v1/enquiries',{token:null})).status,405);
    assert.equal((await call(preview,operations)).status,405);
    assert.equal((await call(preview,operations,{method:'POST',body:'{}',headers:{'Content-Type':'text/plain'}})).status,415);
    assert.equal((await call(preview,base,{headers:{Origin:'https://synthetic-untrusted.invalid'}})).status,403);
    assert.equal((await call(preview,base,{headers:{Cookie:'synthetic=forged'}})).status,400);
    const hostStatus=await new Promise((resolve,reject)=>{const outgoing=request(preview.origin+base,{headers:{Host:'untrusted.invalid'}},incoming=>{incoming.resume();incoming.once('end',()=>resolve(incoming.statusCode));});outgoing.once('error',reject);outgoing.end();});assert.equal(hostStatus,404);
    const foreign=await call(preview,base+'/'+ENQUIRY_PREVIEW_FIXTURES['sample-homes'].general);assert.equal(foreign.status,404);
    for(const credential of Object.values(preview.enquiryStaff))assert.equal((await foreign.clone().text()).includes(credential.bearerToken),false);
    const after=await read(preview,detail);assert.equal(after.status,'new');assert.equal(after.version,'1');
  }finally{await preview.close();await preview.close();}
  await assert.rejects(()=>fetch(preview.origin+'/health'));
});
test('configured second realtor gets its own fixed signed identities and synthetic enquiry fixtures',async()=>{
  const preview=await startStaffPreview({port:0,tenantSlug:'sample-homes',enquiryPreview:'synthetic-v1',actor:'customer'});try{
    assert.deepEqual(preview.enquiryFixtures,ENQUIRY_PREVIEW_FIXTURES['sample-homes']);
    const own=await read(preview,base);assert.equal(own.items.length,5);assert.ok(own.items.every(row=>row.email===undefined));
    assert.equal((await call(preview,base,{token:preview.bearerToken})).status,403,'A genuinely signed customer has no staff access.');
    assert.equal((await call(preview,base+'/'+ENQUIRY_PREVIEW_FIXTURES['realtime-estates'].general)).status,404);
    assert.equal((await read(preview,base,{role:'agent'})).items.length,3);
  }finally{await preview.close();}
});

test('staff capture preview requires signed identity and binds original receipt to the requester',async()=>{
 const preview=await startStaffPreview({port:0,enquiryPreview:'synthetic-v1'});
 try{
 const path='/v2/staff/enquiry-captures',body={listingId:null,name:'Fictional operator intake',email:'operator@example.invalid',message:'Synthetic only',noticeVersion:'synthetic-staff-notice-v1',noticeAcknowledged:true},options={method:'POST',body,headers:{'Idempotency-Key':randomUUID()}};
 assert.equal((await call(preview,path,{...options,token:null})).status,401);
 const saved=await call(preview,path,options);assert.equal(saved.status,201);const receipt=await saved.json();const replay=await call(preview,path,options);assert.equal(replay.status,201);assert.deepEqual(await replay.json(),receipt);
 assert.equal((await call(preview,path,{...options,role:'agent'})).status,409);const detail=await read(preview,base+'/'+receipt.id);assert.equal(detail.origin,'staff');assert.equal(detail.version,'1');
 assert.equal((await call(preview,path,{...options,body:{...body,origin:'web'}})).status,400);assert.equal((await call(preview,path,{method:'GET'})).status,405);
 }finally{await preview.close();}
});

test('synthetic activity allowlist exposes authorized bounded reads and preserves current assignment guard',async()=>{
 const preview=await startStaffPreview({port:0,enquiryPreview:'synthetic-v1'});try{
  const rows=await read(preview,base),enquiry=rows.items.find(x=>x.assignedAgentId===null).id,path=base+'/'+enquiry+'/activity?limit=1';
  const result=await read(preview,path);assert.equal(result.coverage,'capture-and-v2-operations');assert.equal(result.items.length,1);assert.equal((await call(preview,path,{role:'agent'})).status,404);assert.equal((await call(preview,path,{token:null})).status,401);
  assert.equal((await call(preview,base+'/'+enquiry+'/activity?tenantId=other')).status,400);assert.equal((await call(preview,base+'/'+enquiry+'/activity',{method:'POST',body:{}})).status,405);
 }finally{await preview.close();}
});


test('signed synthetic contact routes retain original receipts and enforce current assignment',async()=>{
 const preview=await startStaffPreview({port:0,enquiryPreview:'synthetic-v1'});
 try{
  const rows=await read(preview,base),selected=rows.items.find(row=>row.assignedAgentId===null),path=base+'/'+selected.id,contacts=path+'/contacts';
  const command={operationId:randomUUID(),expectedVersion:Number(selected.version),channel:'call',outcome:'connected',occurredAt:'2026-01-02T03:04:05.006Z',notes:'  Synthetic only.\nOriginal spacing.  '};
  assert.equal((await call(preview,contacts,{method:'POST',body:command,token:null})).status,401);
  assert.equal((await call(preview,contacts,{method:'POST',body:command,role:'agent'})).status,404);
  const receipt=await read(preview,contacts,{method:'POST',body:command});assert.equal(receipt.outcome,'applied');assert.equal(receipt.request.notes,command.notes);assert.equal(receipt.actorId,preview.enquiryStaff.admin.actorId);
  assert.deepEqual(await read(preview,contacts+'/operations/'+command.operationId),receipt);
  assert.deepEqual(await read(preview,contacts,{method:'POST',body:command}),receipt);
  assert.equal((await read(preview,path)).version,selected.version);
  const feed=await read(preview,contacts+'?limit=25');assert.equal(feed.items.length,1);assert.equal(feed.items[0].notes,command.notes);assert.equal(feed.limit,25);
  assert.equal((await call(preview,contacts,{method:'POST',body:{...command,notes:'changed'}})).status,409);
  assert.equal((await call(preview,contacts+'?actor=other')).status,400);
  assert.equal((await call(preview,contacts+'/operations/'+command.operationId+'?limit=1')).status,400);
  assert.equal((await call(preview,contacts+'/operations/'+command.operationId,{method:'POST',body:command})).status,405);
  const assigned=await read(preview,path+'/operations',{method:'POST',body:{operationId:randomUUID(),kind:'assign',expectedVersion:Number(selected.version),assignedAgentId:preview.enquiryStaff.agent.actorId,status:null,nextActionAt:null,reason:null}});assert.equal(assigned.outcome,'applied');
  assert.equal((await read(preview,contacts+'?limit=1',{role:'agent'})).items.length,1);
  assert.equal((await call(preview,contacts+'/operations/'+command.operationId,{role:'agent'})).status,404);
  assert.deepEqual(await read(preview,contacts+'/operations/'+command.operationId),receipt);
  const conflict=await read(preview,contacts,{method:'POST',body:{...command,operationId:randomUUID()}});assert.equal(conflict.outcome,'conflict');assert.equal(conflict.entry,null);assert.equal(conflict.request.notes,command.notes);
  assert.equal((await read(preview,contacts+'?limit=25')).items.length,1);
 }finally{await preview.close();}
});

test('targeted reschedule corruption skips earlier saves and retains the old agreement and exact original new slot',async()=>{
 const preview=await startStaffPreview({port:0,enquiryPreview:'synthetic-v1',enquiryCatalogue:'synthetic-v1',viewingReplyFault:'invalid-first-reschedule-v1'});
 try{
  const path=base+'/'+preview.enquiryFixtures.assigned,request={operationId:randomUUID(),expectedEnquiryVersion:2,listingId:preview.listingId,preferredSlots:[],notes:'Fictional viewing before phone agreement.'};
  const requested=await read(preview,path+'/viewings',{role:'agent',method:'POST',body:request});assert.equal(requested.outcome,'applied');
  const slot={startAt:'2090-01-01T09:00:00.000Z',endAt:'2090-01-01T10:00:00.000Z',timeZone:'Africa/Nairobi'},target=path+'/viewings/'+requested.viewingId;
  const proposed=await read(preview,target+'/proposals',{role:'agent',method:'POST',body:{operationId:randomUUID(),expectedVersion:1,slot}});assert.equal(proposed.outcome,'applied');
  const phone={operationId:randomUUID(),expectedVersion:2,slot,channel:'phone',agreedAt:proposed.completedAt,notes:'Synthetic phone agreement before ending.'};
  const confirmed=await read(preview,target+'/confirmations',{role:'agent',method:'POST',body:phone});assert.equal(confirmed.result.status,'confirmed');
  const command={operationId:randomUUID(),expectedVersion:3,slot:{...slot,startAt:'2090-01-02T09:00:00.000Z',endAt:'2090-01-02T10:00:00.000Z'},reason:'  Synthetic cancellation with exact original reason.  '};
  const stale=await read(preview,target+'/reschedules',{role:'agent',method:'POST',body:{...command,operationId:randomUUID(),expectedVersion:2}});assert.equal(stale.outcome,'conflict');
  assert.deepEqual(await read(preview,target+'/reschedules',{role:'agent',method:'POST',body:command}),{syntheticReplyCorruption:true});
  const recovered=await read(preview,path+'/viewing-operations/'+command.operationId,{role:'agent'});assert.equal(recovered.result.status,'proposed');assert.equal(recovered.result.cycle.reason,command.reason);assert.equal(Object.hasOwn(recovered.result,'agreement'),false);assert.deepEqual(recovered.result.proposedSlot,command.slot);assert.deepEqual((await read(preview,path+'/viewing-operations/'+phone.operationId,{role:'agent'})).result.agreement,confirmed.result.agreement);assert.deepEqual(await read(preview,target+'/reschedules',{role:'agent',method:'POST',body:command}),recovered);
  assert.equal((await read(preview,path+'/viewings?limit=25',{role:'agent'})).items.length,1);
 }finally{await preview.close();}
});
