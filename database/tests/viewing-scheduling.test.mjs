import assert from 'node:assert/strict';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {applyTestMigrations} from '../test-helpers/migrations.mjs';
import {seedSyntheticSealedMedia} from '../test-helpers/synthetic-sealed-media.mjs';
import {validateViewingSchedule} from '../../packages/domain/dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const T=id(1),OTHER=id(2),ADMIN=id(10),AGENT=id(11),PEER=id(12),CUSTOMER=id(13),ADMIN2=id(14),OTHERADMIN=id(20);
const L=id(100),SECOND_L=id(101),FOREIGN_L=id(200),E=id(300),GENERAL=id(301),FOREIGN_E=id(400);
const NOTES='  Synthetic viewing notes.\nPreserve the original.  ';
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
