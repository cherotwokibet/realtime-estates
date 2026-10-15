import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {applyTestMigrations} from '../test-helpers/migrations.mjs';
import {normalizeStaffDraftContentV2,validateListingCreationReceipt,validateListingCreationSnapshot} from '../../packages/domain/dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,T=id(1),F=id(2),U=id(11),P=id(12),A=id(10),C=id(13),FA=id(20),L=id(100),O=id(200);
const content=()=>normalizeStaffDraftContentV2({title:'Synthetic creation',privateAddress:' FICTIONAL PRIVATE ONLY ',pricing:{declaration:'not_declared',charges:[]},location:{county:null,town:null,area:null}});
async function actor(db,user,work,tenant=T){await db.exec('BEGIN;SET LOCAL ROLE api_runtime');try{await db.query("SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",[tenant,user]);const value=await work();await db.exec('COMMIT');return value;}catch(e){await db.exec('ROLLBACK');throw e;}}
const scalar=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0].value;
test('durable listing creation allocates atomically and recovers only exact current-authorized originals',async t=>{
 const db=new PGlite();try{
  await applyTestMigrations(db);await db.query("INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'synthetic-creation','Synthetic creation'),($2,'foreign-creation','Foreign creation')",[T,F]);
  for(const [tenant,user,role] of [[T,U,'agent'],[T,P,'agent'],[T,A,'admin'],[T,C,'customer'],[F,FA,'admin']])await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenant,user,role]);
  const create=(listing=L,operation=O,slug='synthetic-creation',body=content(),user=U,tenant=T)=>actor(db,user,()=>scalar(db,'SELECT app_api.create_listing_draft_v2($1,$2,$3,$4::jsonb) value',[listing,operation,slug,JSON.stringify(body)]),tenant);
  const read=(listing=L,operation=O,user=U,tenant=T)=>actor(db,user,()=>scalar(db,'SELECT app_api.read_listing_creation($1,$2) value',[listing,operation]),tenant);
  const count=table=>scalar(db,`SELECT count(*)::int value FROM app_private.${table}`);
  let saved;
  await t.test('created request and original agree with domain, initial versions and minimized audits',async()=>{
   saved=await create();assert.equal(saved.outcome,'created');assert.deepEqual(validateListingCreationReceipt(saved,{listingId:L,operationId:O,slug:'synthetic-creation',content:content()},U),saved);assert.deepEqual(validateListingCreationSnapshot(await read(),L,O),saved);
   assert.deepEqual((await db.query('SELECT version,assigned_agent_id,publication_status,published_revision_no FROM app_private.listings WHERE id=$1',[L])).rows[0],{version:1,assigned_agent_id:U,publication_status:'unpublished',published_revision_no:null});assert.equal(await scalar(db,'SELECT version value FROM app_private.listing_revisions WHERE listing_id=$1',[L]),2);
   assert.equal(await count('audit_events'),2);assert.ok(!(JSON.stringify((await db.query('SELECT summary FROM app_private.audit_events')).rows)).includes('FICTIONAL'));
  });
  await t.test('exact replay returns historical original without allocations or audits after a later edit',async()=>{
   await actor(db,U,()=>db.query('SELECT app_api.save_draft_v2($1,1,2,$2::jsonb)',[L,JSON.stringify({...content(),title:'Deliberate later draft'})]));assert.deepEqual(await create(),saved);assert.deepEqual(await read(),saved);assert.equal(await count('listings'),1);assert.equal(await count('listing_revisions'),1);assert.equal(await count('audit_events'),3);
   await assert.rejects(()=>create(L,O,'changed-slug'),e=>e.code==='40001');await assert.rejects(()=>create(L,O,'synthetic-creation',{...content(),title:'Changed'}),e=>e.code==='40001');
  });
  await t.test('wrong route, requester, peer, admin and foreign tenant cannot read another original',async()=>{
   for(const work of [()=>read(id(999)),()=>read(L,O,P),()=>read(L,O,A),()=>read(L,O,FA,F),()=>create(id(999),O),()=>create(L,O,'synthetic-creation',content(),P),()=>create(L,id(900),'other',content(),C)])await assert.rejects(work);
  });
  await t.test('assignment and membership loss hide successful originals until current access is restored',async()=>{
   await db.query('UPDATE app_private.listings SET assigned_agent_id=$1 WHERE id=$2',[P,L]);await assert.rejects(()=>read());await assert.rejects(()=>create());await db.query('UPDATE app_private.listings SET assigned_agent_id=$1 WHERE id=$2',[U,L]);assert.deepEqual(await read(),saved);
   await db.query('UPDATE app_private.memberships SET active=false,revoked_at=clock_timestamp() WHERE user_id=$1',[U]);await assert.rejects(()=>read());await db.query('UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE user_id=$1',[U]);assert.deepEqual(await create(),saved);
  });
  await t.test('identity and slug collisions retain indistinguishable generic refusals without private inventory facts',async()=>{
   const one=await create(L,id(201),'another-slug',content(),P),two=await create(id(101),id(202),'synthetic-creation',content(),P);for(const r of [one,two]){assert.equal(r.outcome,'refused');assert.equal(r.reason,'TARGET_UNAVAILABLE');assert.equal(r.result,null);assert.deepEqual(validateListingCreationSnapshot(r),r);}assert.deepEqual(await create(id(101),id(202),'synthetic-creation',content(),P),two);assert.equal(await count('listings'),1);assert.equal(await count('audit_events'),3);
  });
  await t.test('invalid facts cannot become durable collision refusals or partial allocations',async()=>{
   const before=await count('listing_creation_requests');for(const patch of [{title:' unnormalized '},{amountMinor:1.5},{bedrooms:101},{latitude:1},{actorId:U},{pricing:{declaration:'incomplete',charges:[{id:'x'}]}},{privateAddress:'x'.repeat(1001)},{title:'bad\u0001'}])await assert.rejects(()=>create(L,id(300),'synthetic-creation',{...content(),...patch}));
   const missing={...content()};delete missing.title;await assert.rejects(()=>create(id(301),id(301),'invalid',missing));await assert.rejects(()=>create(id(302),id(302),'a'.repeat(161)));assert.equal(await count('listing_creation_requests'),before);assert.equal(await count('listings'),1);
  });
  await t.test('outer rollback removes successful allocation, original and audits',async()=>{
   await db.exec('BEGIN;SET LOCAL ROLE api_runtime');await db.query("SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",[T,U]);assert.equal((await scalar(db,'SELECT app_api.create_listing_draft_v2($1,$2,$3,$4::jsonb) value',[id(400),id(400),'rolled-back',JSON.stringify(content())])).outcome,'created');await db.exec('ROLLBACK');await assert.rejects(()=>read(id(400),id(400)));assert.equal(await count('listings'),1);assert.equal(await count('audit_events'),3);
  });
  await t.test('deferred completion linkage forbids committed orphan reservations',async()=>{
   await db.exec('BEGIN');try{await db.query('INSERT INTO app_private.listing_creation_requests VALUES($1,$2,$3,$4,$5,$6::jsonb)',[T,id(500),id(500),U,'orphan',JSON.stringify(content())]);await assert.rejects(()=>db.exec('COMMIT'),e=>e.code==='23503');}finally{await db.exec('ROLLBACK');}assert.equal(await scalar(db,'SELECT count(*)::int value FROM app_private.listing_creation_requests WHERE operation_id=$1',[id(500)]),0);
  });
  await t.test('private ledgers force RLS, deny runtime access and are immutable even for owner',async()=>{
   for(const table of ['listing_creation_requests','listing_creation_results']){const flags=(await db.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',['app_private.'+table])).rows[0];assert.deepEqual(flags,{relrowsecurity:true,relforcerowsecurity:true});await assert.rejects(()=>actor(db,U,()=>db.query(`SELECT * FROM app_private.${table}`)));await assert.rejects(()=>db.query(`UPDATE app_private.${table} SET listing_id=listing_id WHERE operation_id=$1`,[O]));await assert.rejects(()=>db.query(`DELETE FROM app_private.${table} WHERE operation_id=$1`,[O]));}
   await assert.rejects(()=>actor(db,U,()=>db.query('SELECT app_private.creation_content_valid($1::jsonb)',[JSON.stringify(content())])));
  });
  await t.test('bounded canonical snapshots preserve Unicode, exact money and original private text',async()=>{
   for(const input of [content(),{...content(),title:'🏡'.repeat(160),privateAddress:'\n FICTIONAL\t'},normalizeStaffDraftContentV2({...content(),purpose:'rent',amountMinor:2000001,rentPeriod:'month',propertyType:'studio',bedrooms:0,latitude:-1.366,longitude:36.75}),normalizeStaffDraftContentV2({...content(),purpose:'sale',amountMinor:1,rentPeriod:null})])assert.equal(await scalar(db,'SELECT app_private.creation_content_valid($1::jsonb) value',[JSON.stringify(input)]),true);
   for(const input of [null,[],{...content(),title:'🏡'.repeat(161)},{...content(),title:'\u00a0padded\u00a0'},{...content(),currency:null},{...content(),country:'UG'},{...content(),purpose:'sale',rentPeriod:'month'},{...content(),propertyType:'land',bedrooms:0},{...content(),propertyType:'studio',bedrooms:1},{...content(),longitude:181,latitude:0},{...content(),description:true},{...content(),location:{county:null,town:null,area:null,privateAddress:'unknown'}}])assert.equal(await scalar(db,'SELECT app_private.creation_content_valid($1::jsonb) value',[JSON.stringify(input)]),false);
  });
  await t.test('admin creation self-assigns and tenant-scoped identities do not expose another company',async()=>{
   const admin=await create(id(600),id(600),'admin-created',content(),A);assert.equal(admin.actorId,A);assert.equal(await scalar(db,'SELECT assigned_agent_id value FROM app_private.listings WHERE tenant_id=$1 AND id=$2',[T,id(600)]),A);
   const foreign=await create(L,O,'synthetic-creation',content(),FA,F);assert.equal(foreign.outcome,'created');assert.equal(foreign.actorId,FA);assert.deepEqual(await read(),saved);await assert.rejects(()=>read(L,O,U,F));
  });
 }finally{await db.close();}
});
