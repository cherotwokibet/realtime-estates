import assert from 'node:assert/strict';import test from 'node:test';import {PGlite} from '@electric-sql/pglite';
import {applyTestMigrations} from '../test-helpers/migrations.mjs';import {seedHistoricalConfirmedViewing} from '../test-helpers/historical-confirmed-viewing.mjs';
import {prepareViewingReminderCandidate,evaluateViewingReminder} from '../../packages/domain/dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,T=id(1),A=id(10),E=id(100),L=id(200),V=id(300),W=id(301);
test('private SQL reminder suppression matches pure domain and grants no runtime dispatch surface',async t=>{
 const db=new PGlite();try{
  await applyTestMigrations(db);await db.query("INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'reminder-sql','Synthetic reminder SQL')",[T]);await db.query("INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[T,A]);
  await db.exec('BEGIN');await db.query("SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",[T,A]);await db.query('SELECT app_api.create_listing($1,$2)',[L,'synthetic-reminder']);await db.exec('COMMIT');
  await db.query("INSERT INTO app_private.enquiries(tenant_id,id,idempotency_key,assigned_agent_id,contact_name,email,message,origin,notice_version,status) VALUES($1,$2,$2,$3,'Synthetic reminder','synthetic@example.invalid','Fictional planning fixture','staff','synthetic-v1','assigned')",[T,E,A]);
  await seedHistoricalConfirmedViewing(db,{tenantId:T,enquiryId:E,listingId:L,actorId:A,viewingId:V,offset:1000});await seedHistoricalConfirmedViewing(db,{tenantId:T,enquiryId:E,listingId:L,actorId:A,viewingId:W,later:true,offset:1100});
  const detail=async viewing=>(await db.query('SELECT app_private.viewing_detail(v,$2) value FROM app_private.viewings v WHERE id=$1',[viewing,A])).rows[0].value;
  const current=await detail(V),later=await detail(W),window={dueAt:'2020-01-01T08:35:00.000Z',expiresAt:'2020-01-01T08:50:00.000Z'},candidate=prepareViewingReminderCandidate(current,window),eligibility={enquiryOpen:true,listingAvailable:true},now='2020-01-01T08:40:00.000Z';
  const sql=async(value=candidate,viewing=V,at=now,flags=eligibility)=>(await db.query('SELECT app_private.evaluate_viewing_reminder($1::jsonb,v,$3,$4,$5) value FROM app_private.viewings v WHERE id=$2',[JSON.stringify(value),viewing,flags.enquiryOpen,flags.listingAvailable,at])).rows[0].value;
  await t.test('exact due expiry slot and saved-clock boundaries match',async()=>{for(const at of ['2020-01-01T08:29:59.999Z','2020-01-01T08:34:59.999Z',window.dueAt,now,'2020-01-01T08:49:59.999Z',window.expiresAt,current.schedule.proposedSlot.startAt])assert.deepEqual(await sql(candidate,V,at),evaluateViewingReminder(candidate,current,eligibility,at));});
  await t.test('different targets versions cycles slots agreements and fresh eligibility suppress identically',async()=>{
   for(const patch of [{viewingId:id(999)},{viewingVersion:'2'},{cycleNumber:'2'},{slot:{...candidate.slot,endAt:'2020-01-01T10:01:00.000Z'}},{agreedAt:'2020-01-01T08:16:00.000Z'},{confirmationRecordedAt:'2020-01-01T08:31:00.000Z'}])assert.deepEqual(await sql({...candidate,...patch}),evaluateViewingReminder({...candidate,...patch},current,eligibility,now));
   for(const flags of [{...eligibility,enquiryOpen:false},{...eligibility,listingAvailable:false}])assert.deepEqual(await sql(candidate,V,now,flags),evaluateViewingReminder(candidate,current,flags,now));
  });
  await t.test('later confirmed cycle needs its own exact candidate',async()=>{assert.deepEqual(await sql({...candidate,viewingId:W},W),evaluateViewingReminder({...candidate,viewingId:W},later,eligibility,now));const own=prepareViewingReminderCandidate(later,{dueAt:'2020-01-02T08:35:00.000Z',expiresAt:'2020-01-02T08:50:00.000Z'});assert.deepEqual(await sql(own,W,'2020-01-02T08:40:00.000Z'),{state:'eligible',reason:null});});
  await t.test('malformed and null candidate facts fail closed',async()=>{
   for(const value of [null,{}, {...candidate,viewingVersion:3},{...candidate,cycleNumber:'0'},{...candidate,dueAt:window.expiresAt},{...candidate,dueAt:'2020-01-01T08:35:00Z'},{...candidate,expiresAt:'2020-01-01T09:00:00.001Z'},{...candidate,tenantId:T},{...candidate,slot:null}]){assert.equal((await db.query('SELECT app_private.viewing_reminder_candidate_valid($1::jsonb) value',[JSON.stringify(value)])).rows[0].value,false);await assert.rejects(()=>sql(value));}
   await assert.rejects(()=>sql(candidate,V,now,{enquiryOpen:null,listingAvailable:true}));
  });
  await t.test('UUID and version facts with trailing line breaks remain invalid',async()=>{
   for(const field of ['enquiryId','viewingId','listingId','viewingVersion','cycleNumber'])for(const suffix of ['\n','\r','\r\n'])assert.equal((await db.query('SELECT app_private.viewing_reminder_candidate_valid($1::jsonb) value',[JSON.stringify({...candidate,[field]:candidate[field]+suffix})])).rows[0].value,false);
  });
  await t.test('persisted first and later outcomes suppress earlier candidates identically',async()=>{
   for(const [viewing,kind,version,occurredAt] of [[V,'complete',3,'2020-01-01T10:00:00.000Z'],[W,'no_show',5,'2020-01-02T10:00:00.000Z']]){
    const before=await detail(viewing),own=prepareViewingReminderCandidate(before,{dueAt:before.confirmation.recordedAt,expiresAt:before.schedule.proposedSlot.startAt});
    await db.exec('BEGIN');await db.query("SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",[T,A]);await db.query('SELECT app_api.record_viewing_outcome($1,$2,$3,$4,$5,$6,$7)',[E,viewing,id(2000+version),version,kind,occurredAt,'Synthetic outcome suppression parity.']);await db.exec('COMMIT');
    const after=await detail(viewing);assert.deepEqual(await sql(own,viewing),evaluateViewingReminder(own,after,eligibility,now));assert.equal((await sql(own,viewing)).reason,'NOT_CONFIRMED');
   }
  });
  await t.test('runtime cannot invoke planning primitives or gain owner privileges',async()=>{await db.exec('CREATE ROLE reminder_sql_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;GRANT api_runtime TO reminder_sql_login;SET SESSION AUTHORIZATION reminder_sql_login;SET ROLE api_runtime;');assert.equal((await db.query("SELECT has_function_privilege(current_user,'app_private.viewing_reminder_candidate_valid(jsonb)','EXECUTE') allowed")).rows[0].allowed,false);await assert.rejects(()=>db.query('SELECT app_private.viewing_reminder_candidate_valid($1::jsonb)',[JSON.stringify(candidate)]));await assert.rejects(()=>db.exec('SET ROLE realtor_owner;'));});
 }finally{await db.close();}
});
