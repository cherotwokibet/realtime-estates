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
