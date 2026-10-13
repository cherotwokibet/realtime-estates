import assert from 'node:assert/strict';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {applyTestMigrations} from '../test-helpers/migrations.mjs';
import {seedSyntheticSealedMedia} from '../test-helpers/synthetic-sealed-media.mjs';
import {validateViewingSchedule,validateViewingDetail,validateViewingConfirmationReceipt,validateViewingTerminationReceipt} from '../../packages/domain/dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const T=id(1),OTHER=id(2),ADMIN=id(10),AGENT=id(11),PEER=id(12),CUSTOMER=id(13),ADMIN2=id(14),OTHERADMIN=id(20);
const L=id(100),SECOND_L=id(101),FOREIGN_L=id(200),E=id(300),GENERAL=id(301),FOREIGN_E=id(400);
const NOTES='  Synthetic viewing notes.\nPreserve the original.  ';
const PHONE_NOTES='  Fictional completed phone agreement.\nPreserve exact evidence.  ';
const END_REASON='  Fictional cancellation reason.\nPreserve exact history.  ';
const slot=(startAt='2090-01-01T09:00:00.000Z',endAt='2090-01-01T10:00:00.000Z')=>({startAt,endAt,timeZone:'Africa/Nairobi'});
const content={title:'Synthetic viewing studio',description:'Disposable scheduling SQL fixture only.',purpose:'rent',propertyType:'studio',currency:'KES',amountMinor:2000000,rentPeriod:'month',bedrooms:0,privateBathrooms:1,sharedBathrooms:null,country:'KE',locality:'Synthetic Nairobi',publicPrecision:'area',latitude:null,longitude:null,privateAddress:null};
async function scalar(db,sql,args=[]){return Object.values((await db.query(sql,args)).rows[0])[0];}
async function actor(db,user,callback,tenant=T){
 await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');
 try{await db.query("SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),set_config('realtor.correlation_id','synthetic-viewing',true)",[tenant??'',user??'']);const value=await callback();await db.exec('COMMIT');return value;}
 catch(error){await db.exec('ROLLBACK');throw error;}
}
async function publish(db,listing,user,tenant){
 const version=await actor(db,user,async()=>{await db.query('SELECT app_api.create_listing($1,$2)',[listing,'synthetic-'+listing.slice(-3)]);return scalar(db,'SELECT app_api.save_draft($1,1,0,$2::jsonb)',[listing,JSON.stringify(content)]);},tenant);
 for(let position=0;position<4;position++)await seedSyntheticSealedMedia(db,{tenantId:tenant,listingId:listing,position,mediaId:id(Number(listing.slice(-3))*100+position)});
 const pending=await actor(db,user,async()=>{await db.query("SELECT app_api.confirm_availability($1,1,'available')",[listing]);return scalar(db,'SELECT app_api.submit_revision($1,1,$2)',[listing,version]);},tenant);
 await actor(db,tenant===T?ADMIN:OTHERADMIN,()=>db.query('SELECT app_api.decide_revision($1,1,$2,true)',[listing,pending]),tenant);
}
async function fixture(){
 const db=new PGlite();try{
  await applyTestMigrations(db);
  await db.query("INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'viewing-test','Synthetic Viewing'),($2,'foreign-viewing','Synthetic Foreign')",[T,OTHER]);
  for(const [tenant,user,role] of [[T,ADMIN,'admin'],[T,AGENT,'agent'],[T,PEER,'agent'],[T,CUSTOMER,'customer'],[T,ADMIN2,'admin'],[OTHER,OTHERADMIN,'admin']])await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenant,user,role]);
  await publish(db,L,AGENT,T);await publish(db,SECOND_L,PEER,T);await publish(db,FOREIGN_L,OTHERADMIN,OTHER);
  for(const [tenant,enquiry,listing,assigned] of [[T,E,L,AGENT],[T,GENERAL,null,AGENT],[OTHER,FOREIGN_E,FOREIGN_L,OTHERADMIN]])await db.query(`INSERT INTO app_private.enquiries(tenant_id,id,idempotency_key,listing_id,contacted_revision_no,assigned_agent_id,contact_name,email,message,origin,notice_version,status)
   VALUES($1,$2,$2,$3,CASE WHEN $3::uuid IS NULL THEN NULL ELSE 1 END,$4,'Synthetic prospect','synthetic@example.invalid','Synthetic viewing interest','staff','synthetic-v1','assigned')`,[tenant,enquiry,listing,assigned]);
  return db;
 }catch(error){await db.close();throw error;}
}
function command(db,{kind='request',user=AGENT,enquiry=E,viewing=null,operation=id(1000),expected='1',listing=kind==='request'?L:null,preferences=kind==='request'?[slot()]:null,notes=kind==='request'?NOTES:null,proposalSlot=kind==='propose'?slot():null,tenant=T}={}){
 return actor(db,user,()=>scalar(db,'SELECT app_api.execute_viewing_operation($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb)',[enquiry,viewing,operation,expected,kind,listing,preferences===null?null:JSON.stringify(preferences),notes,proposalSlot===null?null:JSON.stringify(proposalSlot)]),tenant);
}
const history=(db,operation=id(1000),user=AGENT,enquiry=E,tenant=T)=>actor(db,user,()=>scalar(db,'SELECT app_api.read_viewing_operation($1,$2)',[enquiry,operation]),tenant);
const read=(db,viewing,user=AGENT,enquiry=E,tenant=T)=>actor(db,user,()=>scalar(db,'SELECT app_api.read_viewing($1,$2)',[enquiry,viewing]),tenant);
const denied=(fn,code)=>assert.rejects(fn,error=>error.code===code);
const totals=db=>db.query("SELECT (SELECT count(*)::int FROM app_private.viewings) viewings,(SELECT count(*)::int FROM app_private.viewing_operations) operations,(SELECT count(*)::int FROM app_private.audit_events WHERE object_type='viewing') audits,(SELECT version::text FROM app_private.enquiries WHERE id=$1) enquiry_version",[E]).then(r=>r.rows[0]);
function confirmation(db,{viewing,user=AGENT,enquiry=E,operation=id(2000),expected='2',proposalSlot=slot(),channel='phone',agreedAt=new Date().toISOString(),notes=PHONE_NOTES,tenant=T}={}){
 return actor(db,user,()=>scalar(db,'SELECT app_api.confirm_viewing_phone($1,$2,$3,$4,$5::jsonb,$6,$7,$8)',[enquiry,viewing,operation,expected,JSON.stringify(proposalSlot),channel,agreedAt,notes]),tenant);
}
async function proposed(db){const requested=await command(db);const proposal=await command(db,{kind:'propose',viewing:requested.viewingId,operation:id(1001)});return {requested,proposal};}
function terminate(db,{viewing,user=AGENT,enquiry=E,operation=id(3000),expected='2',kind='cancel',reason=END_REASON,tenant=T}={}){
 return actor(db,user,()=>scalar(db,'SELECT app_api.terminate_viewing($1,$2,$3,$4,$5,$6)',[enquiry,viewing,operation,expected,kind,reason]),tenant);
}
test('reasoned cancellation preserves confirmed phone evidence and all original receipts without enquiry mutation',async()=>{
 const db=await fixture();try{
  const {requested,proposal}=await proposed(db),confirmed=await confirmation(db,{viewing:requested.viewingId,agreedAt:proposal.completedAt}),before=await read(db,requested.viewingId);
  const receipt=await terminate(db,{viewing:requested.viewingId,expected:'3'});assert.equal(receipt.result.status,'cancelled');assert.equal(receipt.result.version,'4');assert.equal(receipt.result.termination.reason,END_REASON);assert.equal(receipt.result.termination.fromStatus,'confirmed');assert.equal(receipt.result.termination.previousUpdatedAt,confirmed.completedAt);
  validateViewingTerminationReceipt(receipt,E,requested.viewingId,'cancel',{operationId:id(3000),expectedVersion:'3',reason:END_REASON});
  const after=await read(db,requested.viewingId);validateViewingDetail(after,E);assert.deepEqual(after.schedule.agreement,before.schedule.agreement);assert.deepEqual(after.confirmation,before.confirmation);assert.equal(after.notes,before.notes);assert.equal(after.terminationRecord.recordedById,AGENT);
  assert.deepEqual(await history(db),requested);assert.deepEqual(await history(db,id(1001)),proposal);assert.deepEqual(await history(db,id(2000)),confirmed);assert.deepEqual(await history(db,id(3000)),receipt);
  assert.deepEqual(await command(db),requested);assert.deepEqual(await command(db,{kind:'propose',viewing:requested.viewingId,operation:id(1001)}),proposal);assert.deepEqual(await confirmation(db,{viewing:requested.viewingId,agreedAt:proposal.completedAt}),confirmed);
  assert.deepEqual(await totals(db),{viewings:1,operations:4,audits:4,enquiry_version:'1'});
  const audits=await db.query("SELECT summary FROM app_private.audit_events WHERE object_type='viewing'");assert.ok(audits.rows.every(x=>!JSON.stringify(x.summary).includes(END_REASON)&&!Object.hasOwn(x.summary,'reason')));
 }finally{await db.close();}
});
test('cancellation remains possible for closed enquiry and paused unavailable listing and exact terminal replay stays original',async()=>{
 const db=await fixture();try{
  const {requested}=await proposed(db),options={viewing:requested.viewingId};
  await db.query("UPDATE app_private.enquiries SET status='closed_lost',closure_reason='Synthetic closed' WHERE tenant_id=$1 AND id=$2",[T,E]);await db.query("UPDATE app_private.listings SET publication_status='paused',availability='withdrawn' WHERE tenant_id=$1 AND id=$2",[T,L]);
  const receipt=await terminate(db,options);assert.equal(receipt.outcome,'applied');assert.deepEqual(await terminate(db,options),receipt);assert.deepEqual(await history(db,id(3000)),receipt);
  await denied(()=>terminate(db,{...options,reason:'Changed history.'}),'40001');await denied(()=>terminate(db,{...options,kind:'decline'}),'40001');await denied(()=>terminate(db,{...options,user:ADMIN}),'40001');
 }finally{await db.close();}
});
test('decline is allowed before confirmation and cannot erase a recorded phone agreement',async()=>{
 const db=await fixture();try{
  const requested=await command(db),declined=await terminate(db,{viewing:requested.viewingId,expected:'1',kind:'decline'});assert.equal(declined.result.status,'declined');assert.equal(declined.result.version,'2');assert.equal(declined.result.proposedSlot,null);
  const second=await command(db,{operation:id(1010)}),proposal=await command(db,{kind:'propose',viewing:second.viewingId,operation:id(1011)}),confirmed=await confirmation(db,{viewing:second.viewingId,agreedAt:proposal.completedAt});
  const refused=await terminate(db,{viewing:second.viewingId,operation:id(3001),kind:'decline',expected:'3'});assert.equal(refused.reason,'INVALID_STATE');assert.equal(refused.result,null);assert.deepEqual((await read(db,second.viewingId)).schedule,confirmed.result);
 }finally{await db.close();}
});
test('stale terminal attempts and repeated new termination decisions are durable without another mutation',async()=>{
 const db=await fixture();try{
  const {requested}=await proposed(db),stale=await terminate(db,{viewing:requested.viewingId,expected:'1'});assert.equal(stale.reason,'VERSION_CONFLICT');assert.equal(stale.result,null);
  const ended=await terminate(db,{viewing:requested.viewingId,operation:id(3001)});assert.equal(ended.result.version,'3');assert.deepEqual(await terminate(db,{viewing:requested.viewingId,expected:'1'}),stale);
  const again=await terminate(db,{viewing:requested.viewingId,operation:id(3002),expected:'3'});assert.equal(again.reason,'INVALID_STATE');assert.equal((await read(db,requested.viewingId)).schedule.version,'3');assert.equal((await totals(db)).audits,3);
 }finally{await db.close();}
});
test('terminal receipts and reads enforce current assignment,company,active role and original requester',async()=>{
 const db=await fixture();try{
  const {requested}=await proposed(db),options={viewing:requested.viewingId};
  for(const user of [PEER,CUSTOMER,OTHERADMIN])await assert.rejects(()=>terminate(db,{...options,user}));await denied(()=>terminate(db,{...options,enquiry:GENERAL}),'P0002');await denied(()=>terminate(db,{...options,user:OTHERADMIN,tenant:OTHER}),'P0002');
  const receipt=await terminate(db,options);await denied(()=>history(db,id(3000),ADMIN),'P0002');
  await db.query('UPDATE app_private.enquiries SET assigned_agent_id=$1 WHERE tenant_id=$2 AND id=$3',[PEER,T,E]);await denied(()=>history(db,id(3000)),'P0002');await denied(()=>terminate(db,options),'P0002');assert.equal((await read(db,requested.viewingId,PEER)).schedule.status,'cancelled');
  await db.query('UPDATE app_private.enquiries SET assigned_agent_id=$1 WHERE tenant_id=$2 AND id=$3',[AGENT,T,E]);assert.deepEqual(await terminate(db,options),receipt);
  await db.query('UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',[T,AGENT]);await assert.rejects(()=>history(db,id(3000)));
 }finally{await db.close();}
});
test('terminal reason,state,ending metadata and original evidence cannot be edited,reverted or deleted',async()=>{
 const db=await fixture();try{
  const {requested}=await proposed(db);await terminate(db,{viewing:requested.viewingId});
  for(const sql of ["UPDATE app_private.viewings SET termination_reason='Changed' WHERE id=$1","UPDATE app_private.viewings SET status='proposed',version=2 WHERE id=$1","UPDATE app_private.viewings SET previous_updated_at=previous_updated_at-interval '1 second' WHERE id=$1","DELETE FROM app_private.viewings WHERE id=$1"])await denied(()=>db.query(sql,[requested.viewingId]),'23514');
  await denied(()=>actor(db,AGENT,()=>db.query("UPDATE app_private.viewings SET termination_reason='Changed' WHERE id=$1",[requested.viewingId])),'42501');
 }finally{await db.close();}
});
test('invalid terminal commands reserve no ledger entry and existing operation kind cannot be replaced',async()=>{
 const db=await fixture();try{
  const {requested}=await proposed(db),options={viewing:requested.viewingId},before=await totals(db);
  for(const patch of [{reason:null},{reason:' '},{reason:'😀'.repeat(1001)},{kind:'delete'},{kind:null},{expected:null},{expected:'9007199254740991'}])await denied(()=>terminate(db,{...options,...patch}),'23514');
  await denied(()=>terminate(db,{...options,operation:id(1000)}),'40001');assert.deepEqual(await totals(db),before);
  const max=await terminate(db,{...options,reason:'😀'.repeat(1000)});assert.equal([...max.request.reason].length,1000);
 }finally{await db.close();}
});
test('historical proposed slot can be explicitly cancelled after its start without changing its saved time',async()=>{
 const db=await fixture();try{
  const viewing=id(9001),oldSlot=slot('2001-01-01T09:00:00.000Z','2001-01-01T10:00:00.000Z');
  await db.query("INSERT INTO app_private.viewings(tenant_id,id,enquiry_id,listing_id,requested_by_id,status,version,preferred_slots,notes,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'requested',1,'[]',$6,'2000-01-01T00:00:00Z','2000-01-01T00:00:00Z')",[T,viewing,E,L,AGENT,NOTES]);
  await db.query("UPDATE app_private.viewings SET status='proposed',version=2,proposed_slot=$1::jsonb,updated_at='2000-01-02T00:00:00Z' WHERE tenant_id=$2 AND id=$3",[JSON.stringify(oldSlot),T,viewing]);
  const receipt=await terminate(db,{viewing});assert.equal(receipt.outcome,'applied');assert.deepEqual(receipt.result.proposedSlot,oldSlot);const detail=await read(db,viewing);validateViewingDetail(detail,E);assert.equal(detail.schedule.status,'cancelled');
 }finally{await db.close();}
});
test('requested cancellation and proposed decline retain distinct prior stages and exact original times',async()=>{
 const db=await fixture();try{
  const requested=await command(db),cancelled=await terminate(db,{viewing:requested.viewingId,expected:'1'});assert.equal(cancelled.result.status,'cancelled');assert.equal(cancelled.result.version,'2');assert.equal(cancelled.result.proposedSlot,null);assert.equal(cancelled.result.termination.previousUpdatedAt,requested.completedAt);validateViewingDetail(await read(db,requested.viewingId),E);
  const second=await command(db,{operation:id(1010)}),proposal=await command(db,{kind:'propose',viewing:second.viewingId,operation:id(1011)}),declined=await terminate(db,{viewing:second.viewingId,operation:id(3001),kind:'decline'});assert.equal(declined.result.status,'declined');assert.equal(declined.result.version,'3');assert.deepEqual(declined.result.proposedSlot,proposal.result.proposedSlot);assert.equal(declined.result.termination.previousUpdatedAt,proposal.completedAt);validateViewingDetail(await read(db,second.viewingId),E);
 }finally{await db.close();}
});
test('future saved-record clock refuses terminal mutation and retains its original refusal receipt',async()=>{
 const db=await fixture();try{
  const viewing=id(9002);await db.query("INSERT INTO app_private.viewings(tenant_id,id,enquiry_id,listing_id,requested_by_id,status,version,preferred_slots,notes,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'requested',1,'[]',$6,'2090-01-01T00:00:00Z','2090-01-01T00:00:00Z')",[T,viewing,E,L,AGENT,NOTES]);
  const receipt=await terminate(db,{viewing,expected:'1'});assert.equal(receipt.reason,'RECORD_TIME_IN_FUTURE');assert.equal(receipt.result,null);assert.equal((await read(db,viewing)).schedule.status,'requested');assert.deepEqual(await history(db,id(3000)),receipt);
 }finally{await db.close();}
});

test('phone agreement confirms only exact proposal and retains private attributable evidence and historical originals',async()=>{
 const db=await fixture();try{
  const {requested,proposal}=await proposed(db),agreedAt=proposal.completedAt,receipt=await confirmation(db,{viewing:requested.viewingId,agreedAt});
  assert.equal(receipt.outcome,'applied');assert.equal(receipt.kind,'confirm');assert.equal(receipt.result.status,'confirmed');assert.equal(receipt.result.version,'3');assert.equal(receipt.result.agreement.notes,PHONE_NOTES);
  validateViewingConfirmationReceipt(receipt,E,requested.viewingId,{operationId:id(2000),expectedVersion:'2',slot:slot(),channel:'phone',agreedAt,notes:PHONE_NOTES});
  const detail=await read(db,requested.viewingId);validateViewingDetail(detail,E,requested.viewingId);assert.equal(detail.confirmation.recordedById,AGENT);assert.equal(detail.confirmation.proposedAt,proposal.completedAt);assert.equal(detail.confirmation.recordedAt,receipt.completedAt);assert.equal(detail.notes,NOTES);
  assert.deepEqual(await history(db),requested);assert.deepEqual(await history(db,id(1001)),proposal);assert.deepEqual(await history(db,id(2000)),receipt);
  assert.deepEqual(await command(db),requested);assert.deepEqual(await command(db,{kind:'propose',viewing:requested.viewingId,operation:id(1001)}),proposal);
  assert.deepEqual(await totals(db),{viewings:1,operations:3,audits:3,enquiry_version:'1'});
  const audits=await db.query("SELECT summary FROM app_private.audit_events WHERE object_type='viewing'");assert.ok(audits.rows.every(x=>!JSON.stringify(x.summary).includes('evidence')&&!JSON.stringify(x.summary).includes('Preserve')));
 }finally{await db.close();}
});
test('phone confirmation original replay survives later closure and listing pause but changed facts/requester conflict',async()=>{
 const db=await fixture();try{
  const {requested,proposal}=await proposed(db),options={viewing:requested.viewingId,agreedAt:proposal.completedAt},receipt=await confirmation(db,options);
  await db.query("UPDATE app_private.enquiries SET status='closed_lost',closure_reason='Synthetic closure' WHERE tenant_id=$1 AND id=$2",[T,E]);await db.query("UPDATE app_private.listings SET publication_status='paused' WHERE tenant_id=$1 AND id=$2",[T,L]);
  assert.deepEqual(await confirmation(db,options),receipt);assert.deepEqual(await history(db,id(2000)),receipt);
  await denied(()=>confirmation(db,{...options,notes:'Changed agreement.'}),'40001');await denied(()=>confirmation(db,{...options,user:ADMIN}),'40001');
  await denied(()=>command(db,{kind:'propose',viewing:requested.viewingId,operation:id(2000)}),'40001');
 }finally{await db.close();}
});
test('stale and invalid-state confirmation decisions are durable and never create an agreement',async()=>{
 const db=await fixture();try{
  const requested=await command(db),initial=await confirmation(db,{viewing:requested.viewingId,expected:'1'});assert.equal(initial.reason,'INVALID_STATE');assert.equal(initial.result,null);
  const proposal=await command(db,{kind:'propose',viewing:requested.viewingId,operation:id(1001)});
  assert.deepEqual(await confirmation(db,{viewing:requested.viewingId,expected:'1',agreedAt:initial.request.agreedAt}),initial);
  const stale=await confirmation(db,{viewing:requested.viewingId,operation:id(2001),expected:'1'});assert.equal(stale.reason,'VERSION_CONFLICT');assert.equal(stale.observedVersion,'2');
  const applied=await confirmation(db,{viewing:requested.viewingId,operation:id(2002),agreedAt:proposal.completedAt});assert.equal(applied.result.version,'3');
  const again=await confirmation(db,{viewing:requested.viewingId,operation:id(2003),expected:'3'});assert.equal(again.reason,'INVALID_STATE');assert.equal((await read(db,requested.viewingId)).schedule.agreement.notes,PHONE_NOTES);
 }finally{await db.close();}
});
test('changed slot,agreement before proposal and future agreement are durable refusals with no viewing mutation',async()=>{
 const db=await fixture();try{
  const {requested,proposal}=await proposed(db),before=await read(db,requested.viewingId),changed=slot('2090-01-01T10:00:00.000Z','2090-01-01T11:00:00.000Z');
  const mismatch=await confirmation(db,{viewing:requested.viewingId,proposalSlot:changed});assert.equal(mismatch.reason,'PROPOSED_SLOT_MISMATCH');
  const early=await confirmation(db,{viewing:requested.viewingId,operation:id(2001),agreedAt:new Date(Date.parse(proposal.completedAt)-1).toISOString()});assert.equal(early.reason,'AGREEMENT_BEFORE_PROPOSAL');
  const future=await confirmation(db,{viewing:requested.viewingId,operation:id(2002),agreedAt:'2080-01-01T00:00:00.000Z'});assert.equal(future.reason,'AGREEMENT_IN_FUTURE');assert.equal(future.result,null);
  assert.deepEqual(await read(db,requested.viewingId),before);assert.deepEqual(await history(db,id(2002)),future);
 }finally{await db.close();}
});
test('phone confirmation enforces current staff assignment and requester-private recovery without consuming denied operations',async()=>{
 const db=await fixture();try{
  const {requested,proposal}=await proposed(db),options={viewing:requested.viewingId,agreedAt:proposal.completedAt};
  for(const user of [PEER,CUSTOMER,OTHERADMIN])await assert.rejects(()=>confirmation(db,{...options,user}));
  await denied(()=>confirmation(db,{...options,enquiry:GENERAL}),'P0002');await denied(()=>confirmation(db,{...options,tenant:OTHER,user:OTHERADMIN}),'P0002');
  const receipt=await confirmation(db,options);await denied(()=>history(db,id(2000),ADMIN),'P0002');
  await db.query('UPDATE app_private.enquiries SET assigned_agent_id=$1 WHERE tenant_id=$2 AND id=$3',[PEER,T,E]);await denied(()=>confirmation(db,options),'P0002');await denied(()=>history(db,id(2000)),'P0002');assert.equal((await read(db,requested.viewingId,PEER)).schedule.status,'confirmed');
  await db.query('UPDATE app_private.enquiries SET assigned_agent_id=$1 WHERE tenant_id=$2 AND id=$3',[AGENT,T,E]);assert.deepEqual(await confirmation(db,options),receipt);
  await db.query("UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2",[T,AGENT]);await assert.rejects(()=>confirmation(db,options));
 }finally{await db.close();}
});
test('confirmation evidence and confirmed slot remain immutable and runtime cannot write tables',async()=>{
 const db=await fixture();try{
  const {requested,proposal}=await proposed(db);await confirmation(db,{viewing:requested.viewingId,agreedAt:proposal.completedAt});
  for(const sql of ["UPDATE app_private.viewings SET phone_agreement=jsonb_set(phone_agreement,'{notes}','\"Changed\"') WHERE id=$1","UPDATE app_private.viewings SET status='proposed',version=2 WHERE id=$1","DELETE FROM app_private.viewings WHERE id=$1"])await denied(()=>db.query(sql,[requested.viewingId]),'23514');
  await denied(()=>actor(db,AGENT,()=>db.query('UPDATE app_private.viewings SET version=version+1 WHERE id=$1',[requested.viewingId])),'42501');
  await denied(()=>actor(db,AGENT,()=>db.query('SELECT * FROM app_private.viewing_operations')),'42501');
 }finally{await db.close();}
});
test('malformed phone agreement arguments fail before ledger reservation and existing operation IDs cannot change kind',async()=>{
 const db=await fixture();try{
  const {requested}=await proposed(db),options={viewing:requested.viewingId},before=await totals(db);
  for(const patch of [{channel:'email'},{channel:null},{notes:' '},{notes:'x'.repeat(2001)},{agreedAt:null},{expected:null},{expected:'9007199254740991'},{proposalSlot:{...slot(),confirmed:true}}])await denied(()=>confirmation(db,{...options,...patch}),'23514');
  await denied(()=>confirmation(db,{...options,operation:id(1000)}),'40001');assert.deepEqual(await totals(db),before);
 }finally{await db.close();}
});
test('new confirmations refuse unavailable listing and closed enquiry while retaining durable no-mutation decisions',async()=>{
 const db=await fixture();try{
  const {requested,proposal}=await proposed(db),options={viewing:requested.viewingId,agreedAt:proposal.completedAt};
  await db.query("UPDATE app_private.listings SET publication_status='paused' WHERE tenant_id=$1 AND id=$2",[T,L]);
  const unavailable=await confirmation(db,options);assert.equal(unavailable.reason,'LISTING_UNAVAILABLE');assert.equal(unavailable.result,null);
  await db.query("UPDATE app_private.listings SET publication_status='published' WHERE tenant_id=$1 AND id=$2",[T,L]);assert.deepEqual(await confirmation(db,options),unavailable);
  await db.query("UPDATE app_private.enquiries SET status='closed_lost',closure_reason='Synthetic closed' WHERE tenant_id=$1 AND id=$2",[T,E]);
  const closed=await confirmation(db,{...options,operation:id(2001)});assert.equal(closed.reason,'ENQUIRY_CLOSED');assert.equal((await read(db,requested.viewingId)).schedule.status,'proposed');assert.equal((await totals(db)).audits,2);
 }finally{await db.close();}
});
test('historical proposed slot cannot be newly confirmed after its start time',async()=>{
 const db=await fixture();try{
  const viewing=id(9000),oldSlot=slot('2001-01-01T09:00:00.000Z','2001-01-01T10:00:00.000Z');
  await db.query("INSERT INTO app_private.viewings(tenant_id,id,enquiry_id,listing_id,requested_by_id,status,version,preferred_slots,notes,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'requested',1,'[]',$6,'2000-01-01T00:00:00Z','2000-01-01T00:00:00Z')",[T,viewing,E,L,AGENT,NOTES]);
  await db.query("UPDATE app_private.viewings SET status='proposed',version=2,proposed_slot=$1::jsonb,updated_at='2000-01-02T00:00:00Z' WHERE tenant_id=$2 AND id=$3",[JSON.stringify(oldSlot),T,viewing]);
  const refused=await confirmation(db,{viewing,proposalSlot:oldSlot,agreedAt:'2000-01-03T00:00:00.000Z'});assert.equal(refused.reason,'SLOT_NOT_FUTURE');assert.equal(refused.result,null);assert.equal((await read(db,viewing)).schedule.status,'proposed');
 }finally{await db.close();}
});

test('request and first proposal are private,attributable and independent of enquiry version',async()=>{
 const db=await fixture();try{
  const requested=await command(db);assert.equal(requested.outcome,'applied');assert.equal(requested.actorId,AGENT);assert.equal(requested.result.status,'requested');assert.equal(requested.result.version,'1');assert.equal(requested.result.proposedSlot,null);validateViewingSchedule(requested.result);
  const proposed=await command(db,{kind:'propose',viewing:requested.viewingId,operation:id(1001)});assert.equal(proposed.result.status,'proposed');assert.equal(proposed.result.version,'2');assert.deepEqual(proposed.result.proposedSlot,slot());validateViewingSchedule(proposed.result);
  const detail=await read(db,requested.viewingId,ADMIN);assert.equal(detail.notes,NOTES);assert.equal(detail.requestedById,AGENT);assert.equal(detail.assignedAgentId,AGENT);assert.equal(detail.schedule.version,'2');assert.equal(Object.hasOwn(detail.schedule,'confirmedSlot'),false);
  assert.deepEqual(await totals(db),{viewings:1,operations:2,audits:2,enquiry_version:'1'});
  const audits=await db.query("SELECT summary FROM app_private.audit_events WHERE object_type='viewing'");assert.ok(audits.rows.every(x=>!JSON.stringify(x).includes('Preserve')&&!Object.hasOwn(x.summary,'notes')));
 }finally{await db.close();}
});
test('original request and proposal replay recover historical results after later closure and listing pause',async()=>{
 const db=await fixture();try{
  const request=await command(db),proposalOptions={kind:'propose',viewing:request.viewingId,operation:id(1001)},proposed=await command(db,proposalOptions);
  await db.query("UPDATE app_private.listings SET publication_status='paused' WHERE id=$1",[L]);await db.query("UPDATE app_private.enquiries SET status='closed_lost',closure_reason='Synthetic closed later' WHERE id=$1",[E]);
  const before=await totals(db);assert.deepEqual(await command(db),request);assert.deepEqual(await command(db,proposalOptions),proposed);assert.deepEqual(await history(db),request);assert.deepEqual(await history(db,id(1001)),proposed);assert.deepEqual(await totals(db),before);
  assert.equal(request.result.status,'requested');assert.equal((await read(db,request.viewingId)).schedule.status,'proposed');
  for(const changes of [{notes:NOTES+'changed'},{expected:'2'},{listing:SECOND_L},{preferences:[]},{user:ADMIN},{enquiry:GENERAL}])await denied(()=>command(db,changes),'40001');
 }finally{await db.close();}
});
test('stale request and proposal conflicts are durable and cannot be upgraded by replay',async()=>{
 const db=await fixture();try{
  const stale=await command(db,{expected:'2'});assert.equal(stale.outcome,'conflict');assert.equal(stale.reason,'VERSION_CONFLICT');assert.equal(stale.result,null);assert.equal(stale.viewingId,null);assert.equal((await totals(db)).viewings,0);
  await db.query("UPDATE app_private.enquiries SET contact_name='Synthetic later version' WHERE id=$1",[E]);assert.deepEqual(await command(db,{expected:'2'}),stale);
  const saved=await command(db,{operation:id(1001),expected:'2'});const proposed=await command(db,{kind:'propose',viewing:saved.viewingId,operation:id(1002)});
  const conflict=await command(db,{kind:'propose',viewing:saved.viewingId,operation:id(1003),expected:'1'});assert.equal(conflict.outcome,'conflict');assert.equal(conflict.observedVersion,'2');assert.equal(conflict.result,null);
  const refused=await command(db,{kind:'propose',viewing:saved.viewingId,operation:id(1004),expected:'2'});assert.equal(refused.reason,'INVALID_STATE');assert.equal((await read(db,saved.viewingId)).schedule.version,proposed.result.version);
 }finally{await db.close();}
});
test('new commands require current open enquiry,own bound listing and fresh available publication',async()=>{
 const db=await fixture();try{
  assert.equal((await command(db,{listing:SECOND_L})).reason,'LISTING_MISMATCH');
  assert.equal((await command(db,{enquiry:GENERAL,listing:SECOND_L,operation:id(1001),preferences:[]})).outcome,'applied');
  await denied(()=>command(db,{listing:FOREIGN_L,operation:id(1002)}),'P0002');
  await db.query("UPDATE app_private.listings SET publication_status='paused' WHERE id=$1",[L]);const refused=await command(db,{operation:id(1003)});assert.equal(refused.reason,'LISTING_UNAVAILABLE');
  await db.query("UPDATE app_private.listings SET publication_status='published' WHERE id=$1",[L]);assert.deepEqual(await command(db,{operation:id(1003)}),refused);
  await db.query("UPDATE app_private.listings SET last_availability_confirmed_at=now()-interval '31 days' WHERE id=$1",[L]);assert.equal((await command(db,{operation:id(1004)})).reason,'LISTING_UNAVAILABLE');
  await db.query("UPDATE app_private.enquiries SET status='closed_lost',closure_reason='Synthetic no longer interested' WHERE id=$1",[E]);assert.equal((await command(db,{operation:id(1005),expected:'2'})).reason,'ENQUIRY_CLOSED');
 }finally{await db.close();}
});
test('requester-private receipts,current assignment,revocation and company guards apply to reads and replay',async()=>{
 const db=await fixture();try{
  const original=await command(db);for(const user of [CUSTOMER,null])await denied(()=>command(db,{user,operation:id(1010)}),'42501');
  await denied(()=>command(db,{user:PEER,operation:id(1011)}),'P0002');await denied(()=>history(db,id(1000),ADMIN),'P0002');await denied(()=>read(db,original.viewingId,PEER),'P0002');
  await denied(()=>read(db,original.viewingId,OTHERADMIN,E,OTHER),'P0002');await denied(()=>command(db,{tenant:OTHER,user:OTHERADMIN,operation:id(1012)}),'P0002');
  await db.query('UPDATE app_private.enquiries SET assigned_agent_id=$1 WHERE id=$2',[PEER,E]);await denied(()=>history(db),'P0002');await denied(()=>command(db),'P0002');assert.equal((await read(db,original.viewingId,PEER)).assignedAgentId,PEER);
  await denied(()=>history(db,id(1000),PEER),'P0002');await db.query('UPDATE app_private.enquiries SET assigned_agent_id=$1 WHERE id=$2',[AGENT,E]);assert.deepEqual(await history(db),original);
  await db.query('UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',[T,AGENT]);await denied(()=>history(db),'42501');await denied(()=>read(db,original.viewingId),'42501');
 }finally{await db.close();}
});
test('slot structure,bounds,original notes and future execution are independently enforced in SQL',async()=>{
 const db=await fixture();try{
  for(const bad of [{...slot(),timeZone:null},{...slot(),timeZone:'UTC'},{...slot(),confirmed:true},slot('2090-02-30T09:00:00.000Z'),slot('2090-01-01T09:00:00.000Z','2090-01-01T09:14:59.999Z'),slot('2090-01-01T09:00:00.000Z','2090-01-01T13:00:00.001Z')])await denied(()=>command(db,{preferences:[bad]}),'23514');
  for(const preferences of [[slot(),slot()],Array(4).fill(slot()),null])await denied(()=>command(db,{preferences}),'23514');
  for(const notes of ['   ','😀'.repeat(2001),null])await denied(()=>command(db,{notes}),'23514');
  const past=slot('2026-01-01T09:00:00.000Z','2026-01-01T10:00:00.000Z'),refused=await command(db,{preferences:[past]});assert.equal(refused.reason,'SLOT_NOT_FUTURE');assert.deepEqual(await history(db),refused);
  const saved=await command(db,{operation:id(1001),preferences:[],notes:'😀'.repeat(2000)});assert.equal((await read(db,saved.viewingId)).notes,'😀'.repeat(2000));
  const rejected=await command(db,{kind:'propose',viewing:saved.viewingId,operation:id(1002),proposalSlot:past});assert.equal(rejected.reason,'SLOT_NOT_FUTURE');assert.equal((await read(db,saved.viewingId)).schedule.status,'requested');
 }finally{await db.close();}
});
test('forced RLS,runtime privilege denial and immutable original records prevent direct bypass',async()=>{
 const db=await fixture();try{
  const saved=await command(db);const rows=await db.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('viewings','viewing_operations')");assert.equal(rows.rows.length,2);assert.ok(rows.rows.every(x=>x.relrowsecurity&&x.relforcerowsecurity));
  for(const table of ['viewings','viewing_operations'])for(const sql of [`SELECT * FROM app_private.${table}`,`DELETE FROM app_private.${table}`,`UPDATE app_private.${table} SET tenant_id=tenant_id`])await denied(()=>actor(db,ADMIN,()=>db.query(sql)),'42501');
  await denied(()=>db.query("UPDATE app_private.viewings SET notes='altered' WHERE id=$1",[saved.viewingId]),'23514');await denied(()=>db.query('DELETE FROM app_private.viewings WHERE id=$1',[saved.viewingId]),'23514');
  await denied(()=>db.query("UPDATE app_private.viewing_operations SET receipt='{}'::jsonb"),'23514');await denied(()=>db.query('DELETE FROM app_private.viewing_operations'),'23514');
  const functions=await db.query("SELECT p.proname,r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.proname IN ('execute_viewing_operation','read_viewing_operation','read_viewing','list_enquiry_viewings')");assert.equal(functions.rows.length,4);assert.ok(functions.rows.every(x=>x.rolname==='realtor_owner'));
 }finally{await db.close();}
});
test('bounded viewing feed includes current assignment and only saved schedules,with truthful truncation',async()=>{
 const db=await fixture();try{
  const list=(limit=1,user=AGENT)=>actor(db,user,()=>scalar(db,'SELECT app_api.list_enquiry_viewings($1,$2)',[E,limit]));
  assert.deepEqual(await list(),{items:[],limit:1,truncated:false});
  await command(db);await command(db,{operation:id(1001)});await command(db,{operation:id(1002),expected:'9'});
  const page=await list();assert.equal(page.items.length,1);assert.equal(page.truncated,true);assert.equal(page.items[0].notes,NOTES);
  const all=await list(25);assert.equal(all.items.length,2);assert.equal(all.truncated,false);assert.ok(all.items.every(x=>x.assignedAgentId===AGENT&&x.requestedById===AGENT));
  await denied(()=>list(26),'23514');await denied(()=>list(0),'23514');await denied(()=>list(1,PEER),'P0002');
  await db.query('UPDATE app_private.enquiries SET assigned_agent_id=$1 WHERE id=$2',[PEER,E]);await denied(()=>list(),'P0002');assert.ok((await list(25,PEER)).items.every(x=>x.assignedAgentId===PEER));
 }finally{await db.close();}
});
