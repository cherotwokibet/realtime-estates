import assert from 'node:assert/strict';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {applyTestMigrations} from '../../../database/test-helpers/migrations.mjs';
import {seedSyntheticSealedMedia} from '../../../database/test-helpers/synthetic-sealed-media.mjs';
import {createApiService} from '../../../apps/api/dist/service.js';
import {PostgresTransactionDatabase} from '../../../apps/api/dist/database.js';
import {ApiClientError,RealtorApiClient} from '../dist/index.js';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const TENANT=id(1),OTHER=id(2),ADMIN=id(10),AGENT=id(11),PEER=id(12),CUSTOMER=id(13),OTHERADMIN=id(20);
const MIXED=id(100),EMPTY=id(101),FULL=id(102),PEERLISTING=id(103),FOREIGN=id(200),options={bearerToken:'synthetic-agent'};
const content={title:'Synthetic gallery workspace',description:'Synthetic staff workspace fixture, never real inventory or image bytes.',purpose:'rent',propertyType:'studio',currency:'KES',amountMinor:2000001,rentPeriod:'month',bedrooms:0,privateBathrooms:1,sharedBathrooms:null,country:'KE',locality:'Synthetic locality',publicPrecision:'area',latitude:-1.3,longitude:36.7,privateAddress:'PRIVATE SYNTHETIC ADDRESS',pricing:{declaration:'not_declared',charges:[]},location:{county:'Synthetic County',town:null,area:null}};
async function asActor(db,tenant,actor,operation){await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');try{await db.query("SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",[tenant,actor]);const result=await operation(db);await db.exec('COMMIT');return result;}catch(error){await db.exec('ROLLBACK');throw error;}}
const isHttp=(status,code)=>error=>error instanceof ApiClientError&&error.kind==='HTTP'&&error.status===status&&error.serverCode===code&&!error.submissionUncertain;

test('workspace SDK reads one RLS-authorized current draft/gallery snapshot through a restricted login',async t=>{
 const db=new PGlite();
 try{
  const fixtureSession=(await db.query('SELECT session_user AS name')).rows[0].name,quotedOwner='"'+fixtureSession.replaceAll('"','""')+'"';await applyTestMigrations(db);
  await db.query("INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'workspace-sdk-a','Synthetic Workspace A'),($2,'workspace-sdk-b','Synthetic Workspace B')",[TENANT,OTHER]);
  for(const [tenant,actor,role] of [[TENANT,ADMIN,'admin'],[TENANT,AGENT,'agent'],[TENANT,PEER,'agent'],[TENANT,CUSTOMER,'customer'],[OTHER,OTHERADMIN,'admin']])await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenant,actor,role]);
  for(const [tenant,actor,listings] of [[TENANT,AGENT,[MIXED,EMPTY,FULL]],[TENANT,PEER,[PEERLISTING]],[OTHER,OTHERADMIN,[FOREIGN]]])for(const listing of listings)await asActor(db,tenant,actor,async query=>{await query.query('SELECT app_api.create_listing($1,$2)',[listing,`synthetic-workspace-${listing.slice(-3)}`]);await query.query('SELECT app_api.save_draft_v2($1,1,0,$2::jsonb)',[listing,JSON.stringify(content)]);});
  // Fabricated SQL-only provenance satisfies the FK; no native upload, decoder,
  // processing or attachment workflow is asserted by this read-contract fixture.
  await seedSyntheticSealedMedia(db,{tenantId:TENANT,listingId:MIXED,mediaId:id(700),position:0,altText:'Synthetic sealed label'});
  const legacy=async(listing,mediaId,position,accepted,alt)=>db.query(`INSERT INTO app_private.revision_media(tenant_id,listing_id,revision_no,id,public_object_key,content_type,bytes,width,height,sha256,alt_text,position,accepted)
    VALUES($1,$2,1,$3,$4,'image/webp',100,100,100,$5,$6,$7,$8)`,[TENANT,listing,mediaId,`synthetic/legacy-${mediaId.slice(-3)}.webp`,'1'.repeat(64),alt,position,accepted]);
  await legacy(MIXED,id(701),3,false,'  old synthetic label  ');await legacy(MIXED,id(702),11,true,'Legacy accepted synthetic label');for(let n=0;n<12;n++)await legacy(FULL,id(800+n),n,n%2===0,`Synthetic legacy label ${n}`);
  await db.exec('CREATE ROLE api_workspace_sdk_test_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT api_runtime TO api_workspace_sdk_test_login; SET SESSION AUTHORIZATION api_workspace_sdk_test_login;');
  let tail=Promise.resolve();const sqlCalls=[];const pool={async connect(){let unlock;const next=new Promise(resolve=>{unlock=resolve;}),previous=tail;tail=next;await previous;return {query:(sql,args)=>{sqlCalls.push(sql);return db.query(sql,args?[...args]:[]);},release(){unlock();}};}};
  const database=new PostgresTransactionDatabase(pool);await database.checkConnection();
  const identities=new Map([['synthetic-agent',AGENT],['synthetic-admin',ADMIN],['synthetic-peer',PEER],['synthetic-customer',CUSTOMER],['synthetic-other-admin',OTHERADMIN]]);
  // Synthetic verification and serialized PGlite test grants/RLS and SQL statement
  // projection, not a provider, independent PostgreSQL connections or live races.
  const serviceFor=tenantId=>createApiService({tenantId,database,privacyNoticeVersion:'synthetic-v1',verifyAuthorization:async request=>{const actorId=identities.get((request.headers.get('authorization')??'').replace(/^Bearer /,''));if(!actorId)throw new Error('Unknown synthetic identity');return {actorId};}});
  const service=serviceFor(TENANT),otherService=serviceFor(OTHER),api=new RealtorApiClient({baseUrl:'https://workspace.example.invalid',privacyNoticeVersion:'synthetic-v1',fetch:(input,init)=>service(new Request(input,init))}),otherApi=new RealtorApiClient({baseUrl:'https://workspace-other.example.invalid',privacyNoticeVersion:'synthetic-v1',fetch:(input,init)=>otherService(new Request(input,init))});
  async function asOwner(operation){await tail;await db.exec(`SET SESSION AUTHORIZATION ${quotedOwner}; RESET ROLE;`);try{return await operation(db);}finally{await db.exec('SET SESSION AUTHORIZATION api_workspace_sdk_test_login; RESET ROLE;');await database.checkConnection();}}
  const snapshot=()=>asOwner(async query=>(await query.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY listing_id,revision_no) FROM app_private.listing_revisions r) AS revisions,
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY listing_id,revision_no,position) FROM app_private.revision_media m) AS photos,
    (SELECT count(*)::integer FROM app_private.media_operations) AS operations,
    (SELECT count(*)::integer FROM app_private.audit_events) AS audits,
    (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM app_private.listings l) AS listings`)).rows[0]);
  await t.test('empty/full and sparse galleries retain every association and safe private content',async()=>{
   const result=await api.getStaffDraftWorkspaceV2(MIXED,1,options);assert.deepEqual(result,{listingId:MIXED,draft:{revision:1,state:'draft',version:'2',content},photos:[{id:id(700),position:0,altText:'Synthetic sealed label',accepted:true,provenance:'sealed'},{id:id(701),position:3,altText:'  old synthetic label  ',accepted:false,provenance:'legacy'},{id:id(702),position:11,altText:'Legacy accepted synthetic label',accepted:true,provenance:'legacy'}]});
   const serialized=JSON.stringify(result);for(const field of ['public_object_key','sha256','jobId','sealed_job_id','actorId','requester','manifest','storageKey'])assert.equal(serialized.includes(field),false,field);
   assert.equal((await api.getStaffDraftWorkspaceV2(EMPTY,1,options)).photos.length,0);const full=await api.getStaffDraftWorkspaceV2(FULL,1,options);assert.equal(full.photos.length,12);assert.deepEqual(full.photos.map(p=>p.position),Array.from({length:12},(_,n)=>n));assert.equal(full.photos.filter(p=>!p.accepted).length,6);
   assert.deepEqual(await api.getStaffDraftWorkspaceV2(MIXED,1,{bearerToken:'synthetic-admin'}),result);
  });
  await t.test('successful and denied GETs mutate no tokens, gallery, operations or audits',async()=>{
   const before=await snapshot();sqlCalls.length=0;await api.getStaffDraftWorkspaceV2(MIXED,1,options);const statementCalls=sqlCalls.filter(sql=>sql.includes('jsonb_agg(jsonb_build_object'));assert.equal(statementCalls.length,1);assert.doesNotMatch(statementCalls[0],/AND m\.accepted|INSERT|UPDATE|DELETE/i);
   await assert.rejects(()=>api.getStaffDraftWorkspaceV2(MIXED,2,options),isHttp(404,'NOT_FOUND'));await assert.rejects(()=>api.getStaffDraftWorkspaceV2(MIXED,1,{bearerToken:'synthetic-peer'}),isHttp(404,'NOT_FOUND'));assert.deepEqual(await snapshot(),before);
  });
  await t.test('identity, customer, peer, foreign membership and tenant isolation remain distinct',async()=>{
   const guest=await service(new Request(`https://workspace.example.invalid/v2/staff/listings/${MIXED}/revisions/1/workspace`));assert.equal(guest.status,401);
   for(const [bearerToken,status,code] of [['unknown',401,'UNAUTHENTICATED'],['synthetic-customer',403,'FORBIDDEN'],['synthetic-peer',404,'NOT_FOUND'],['synthetic-other-admin',403,'FORBIDDEN']])await assert.rejects(()=>api.getStaffDraftWorkspaceV2(MIXED,1,{bearerToken}),isHttp(status,code));
   await assert.rejects(()=>api.getStaffDraftWorkspaceV2(PEERLISTING,1,options),isHttp(404,'NOT_FOUND'));await assert.rejects(()=>otherApi.getStaffDraftWorkspaceV2(MIXED,1,{bearerToken:'synthetic-other-admin'}),isHttp(404,'NOT_FOUND'));await assert.rejects(()=>api.getStaffDraftWorkspaceV2(FOREIGN,1,{bearerToken:'synthetic-admin'}),isHttp(404,'NOT_FOUND'));
  });
  await t.test('explicit sparse repair/reorder and removal produce current versions and ordered readback',async()=>{
   const initial=await api.getStaffDraftWorkspaceV2(MIXED,1,options),orderedIds=[id(702),id(700),id(701)];const ordered=await api.reorderDraftMediaV2(MIXED,1,{operationId:id(1000),orderedIds,expectedVersion:initial.draft.version},options);assert.equal(ordered.outcome,'applied');assert.equal(ordered.version,'3');
   const readOrder=await api.getStaffDraftWorkspaceV2(MIXED,1,options);assert.equal(readOrder.draft.version,'3');assert.deepEqual(readOrder.photos.map(p=>[p.id,p.position]),orderedIds.map((id,n)=>[id,n]));assert.equal(readOrder.photos[2].accepted,false);
   const removed=await api.removeDraftMediaV2(MIXED,1,{operationId:id(1001),mediaId:id(700),expectedVersion:readOrder.draft.version},options);assert.equal(removed.version,'4');const readRemoved=await api.getStaffDraftWorkspaceV2(MIXED,1,options);assert.equal(readRemoved.draft.version,'4');assert.deepEqual(readRemoved.photos.map(p=>[p.id,p.position]),[[id(702),0],[id(701),1]]);
   const changed={...content,title:'Synthetic later content'};await api.saveStaffDraftV2(MIXED,1,{expectedVersion:'4',content:changed},options);const readEdited=await api.getStaffDraftWorkspaceV2(MIXED,1,options);assert.equal(readEdited.draft.version,'5');assert.deepEqual(readEdited.draft.content,changed);assert.deepEqual(readEdited.photos,readRemoved.photos);assert.deepEqual(await api.getMediaOperationV2(MIXED,1,id(1000),options),ordered);
  });
  await t.test('reassignment, current revoked membership and disabled tenant immediately deny reads',async()=>{
   await asOwner(query=>asActor(query,TENANT,ADMIN,actor=>actor.query('SELECT app_api.reassign_listing($1,1,$2)',[MIXED,PEER])));await assert.rejects(()=>api.getStaffDraftWorkspaceV2(MIXED,1,options),isHttp(404,'NOT_FOUND'));assert.equal((await api.getStaffDraftWorkspaceV2(MIXED,1,{bearerToken:'synthetic-peer'})).draft.version,'5');assert.equal((await api.getStaffDraftWorkspaceV2(MIXED,1,{bearerToken:'synthetic-admin'})).photos.length,2);
   await asOwner(query=>query.query('UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',[TENANT,AGENT]));await assert.rejects(()=>api.getStaffDraftWorkspaceV2(EMPTY,1,options),isHttp(403,'FORBIDDEN'));await asOwner(query=>query.query('UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',[TENANT,AGENT]));
   await asOwner(query=>query.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1',[TENANT]));await assert.rejects(()=>api.getStaffDraftWorkspaceV2(MIXED,1,{bearerToken:'synthetic-admin'}),isHttp(403,'FORBIDDEN'));await assert.rejects(()=>api.getStaffDraftWorkspaceV2(EMPTY,1,options),isHttp(403,'FORBIDDEN'));
  });
  await t.test('workspace needs no media DML, coordinator capability or privileged API login',async()=>{
   for(const sql of ['DELETE FROM app_private.revision_media WHERE id=$1','UPDATE app_private.listing_revisions SET title=title WHERE listing_id=$1','SELECT app_media.finalize_media($1)','SELECT * FROM app_private.media_jobs WHERE listing_id=$1'])await assert.rejects(()=>db.query(sql,[MIXED]),error=>error.code==='42501');
  });
 }finally{await db.close();}
});
