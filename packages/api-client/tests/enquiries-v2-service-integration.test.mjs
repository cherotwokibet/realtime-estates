import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {PGlite} from '@electric-sql/pglite';
import {applyTestMigrations} from '../../../database/test-helpers/migrations.mjs';
import {createApiService} from '../../../apps/api/dist/service.js';
import {createDevelopmentServer} from '../../../apps/api/dist/http.js';
import {createIdentityVerifier,parseBearerHeader} from '../../../apps/api/dist/auth.js';
import {PostgresTransactionDatabase} from '../../../apps/api/dist/database.js';
import {ApiClientError,RealtorApiClient} from '../dist/index.js';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const TENANT=id(1),OTHER=id(2),ADMIN=id(10),AGENT=id(11),PEER=id(12),CUSTOMER=id(13),INACTIVE=id(14),FOREIGN=id(20);
const contact={name:'Synthetic prospect',phone:'0712345678',email:null,message:'Fictional general enquiry; never contact this number.\nSecond line\twith a storage-valid C1 character:\u0085',origin:'web',noticeVersion:'synthetic-v1',noticeAcknowledged:true};
const assign=(operationId,expectedVersion,assignedAgentId)=>({operationId,kind:'assign',expectedVersion,assignedAgentId,status:null,nextActionAt:null,reason:null});
const transition=(operationId,expectedVersion,status,nextActionAt=null,reason=null)=>({operationId,kind:'transition',expectedVersion,assignedAgentId:null,status,nextActionAt,reason});
const reschedule=(operationId,expectedVersion,nextActionAt)=>({operationId,kind:'reschedule',expectedVersion,assignedAgentId:null,status:null,nextActionAt,reason:null});
const denied=status=>error=>error instanceof ApiClientError&&error.kind==='HTTP'&&error.status===status&&!error.submissionUncertain;
async function listen(server){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return `http://127.0.0.1:${server.address().port}`;}
async function stop(server){if(!server)return;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

test('enquiry SDK uses signed identity, actual loopback HTTP and restricted SQL with original-command recovery',async t=>{
 const db=new PGlite();let apiServer,keyServer;
 try{
  const fixtureOwner=(await db.query('SELECT session_user AS name')).rows[0].name,quotedOwner='"'+fixtureOwner.replaceAll('"','""')+'"';
  await applyTestMigrations(db);
  await db.query("INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'enquiry-http-a','Synthetic Enquiry A'),($2,'enquiry-http-b','Synthetic Enquiry B')",[TENANT,OTHER]);
  for(const [tenant,actor,role] of [[TENANT,ADMIN,'admin'],[TENANT,AGENT,'agent'],[TENANT,PEER,'agent'],[TENANT,CUSTOMER,'customer'],[TENANT,INACTIVE,'agent'],[OTHER,FOREIGN,'admin']])await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenant,actor,role]);
  await db.query('UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',[TENANT,INACTIVE]);
  await db.exec('CREATE ROLE api_enquiry_sdk_test_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;GRANT api_runtime TO api_enquiry_sdk_test_login;SET SESSION AUTHORIZATION api_enquiry_sdk_test_login;');
  // Serialized PGlite checkouts model privileges, not independent PostgreSQL races.
  let tail=Promise.resolve();const pool={async connect(){let unlock;const previous=tail;tail=new Promise(resolve=>{unlock=resolve;});await previous;return {query:(sql,args)=>db.query(sql,args?[...args]:[]),release(){unlock();}};}};
  const database=new PostgresTransactionDatabase(pool);await database.checkConnection();
  async function asOwner(operation){await tail;await db.exec(`SET SESSION AUTHORIZATION ${quotedOwner};RESET ROLE;`);try{return await operation(db);}finally{await db.exec('SET SESSION AUTHORIZATION api_enquiry_sdk_test_login;RESET ROLE;');await database.checkConnection();}}
  const keys=await generateKeyPair('RS256'),jwk={...await exportJWK(keys.publicKey),kid:'synthetic-enquiry-key',alg:'RS256',use:'sig'};
  keyServer=createServer((_,response)=>{response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({keys:[jwk]}));});const issuer=await listen(keyServer);
  const verify=createIdentityVerifier({issuer,audience:'synthetic-enquiry-sdk',jwksUrl:issuer+'/jwks',allowLoopbackHttpForTests:true});
  const serviceFor=tenantId=>createApiService({tenantId,database,privacyNoticeVersion:'synthetic-v1',verifyAuthorization:request=>verify(parseBearerHeader(request.headers.get('authorization')??undefined))});
  apiServer=createDevelopmentServer(serviceFor(TENANT));const origin=await listen(apiServer);
  const makeClient=transport=>new RealtorApiClient({baseUrl:origin,privacyNoticeVersion:'synthetic-v1',allowLoopbackHttp:true,...(transport?{fetch:transport}:{})}),api=makeClient();
  const token=async actor=>new SignJWT({}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer).setAudience('synthetic-enquiry-sdk').setSubject(actor).setIssuedAt().setExpirationTime('10m').sign(keys.privateKey);
  const admin={bearerToken:await token(ADMIN)},agent={bearerToken:await token(AGENT)},peer={bearerToken:await token(PEER)},customer={bearerToken:await token(CUSTOMER)},foreign={bearerToken:await token(FOREIGN)},inactive={bearerToken:await token(INACTIVE)};
  const counts=enquiry=>asOwner(async query=>(await query.query("SELECT (SELECT version::text FROM app_private.enquiries WHERE tenant_id=$1 AND id=$2) AS version,(SELECT count(*)::integer FROM app_private.audit_events WHERE tenant_id=$1 AND object_id=$2) AS audits,(SELECT count(*)::integer FROM app_private.enquiry_operations WHERE tenant_id=$1 AND enquiry_id=$2) AS operations",[TENANT,enquiry])).rows[0]);
  let enquiry,second,originalAssignment,lostReceipt;

  await t.test('guest capture remains durable/idempotent and bounded staff views reveal no public contacts',async()=>{
   enquiry=(await api.submitEnquiry(contact,{idempotencyKey:id(500)})).id;assert.equal((await api.submitEnquiry(contact,{idempotencyKey:id(500)})).id,enquiry);
   second=(await api.submitEnquiry({...contact,name:'Second synthetic prospect'},{idempotencyKey:id(501)})).id;
   const queue=await api.listStaffEnquiriesV2({...admin,limit:1});assert.equal(queue.items.length,1);assert.equal(queue.truncated,true);assert.equal(queue.limit,1);assert.equal(Object.hasOwn(queue.items[0],'phone'),false);assert.equal(Object.hasOwn(queue.items[0],'message'),false);
   const all=await api.listStaffEnquiriesV2(admin);assert.equal(all.items.length,2);assert.equal(all.truncated,false);assert.equal((await api.listStaffEnquiriesV2(agent)).items.length,0);
   for(const identity of [customer,foreign,inactive,{bearerToken:'forged'}])await assert.rejects(()=>api.listStaffEnquiriesV2(identity),denied(identity.bearerToken==='forged'?401:403));
   const response=await fetch(origin+'/v2/staff/enquiries');assert.equal(response.status,401);
  });
  await t.test('admin picker and exact assignment control current agent visibility',async()=>{
   const picker=await api.listEnquiryAssigneesV2(admin);assert.deepEqual(new Set(picker.items.map(x=>x.userId)),new Set([ADMIN,AGENT,PEER]));assert.equal(Object.hasOwn(picker.items[0],'name'),false);await assert.rejects(()=>api.listEnquiryAssigneesV2(agent),denied(403));
   originalAssignment=await api.applyEnquiryOperationV2(enquiry,assign(id(1000),'1',AGENT),admin);assert.equal(originalAssignment.outcome,'applied');assert.equal(originalAssignment.result.version,'2');
   const detail=await api.getStaffEnquiryV2(enquiry,agent);assert.equal(detail.phone,'+254712345678');assert.equal(detail.message,contact.message);assert.equal(detail.listingId,null);assert.equal(detail.contactedRevision,null);assert.equal(detail.noticeVersion,'synthetic-v1');assert.equal(detail.status,'assigned');
   await assert.rejects(()=>api.getStaffEnquiryV2(enquiry,peer),denied(404));await assert.rejects(()=>api.applyEnquiryOperationV2(enquiry,assign(id(1001),'2',PEER),agent),denied(403));
   const unavailable=await api.applyEnquiryOperationV2(second,assign(id(1002),'1',INACTIVE),admin);assert.equal(unavailable.outcome,'rejected');assert.equal(unavailable.reason,'ASSIGNEE_UNAVAILABLE');assert.equal(unavailable.result.version,'1');
   const disallowed=await api.applyEnquiryOperationV2(enquiry,transition(id(1003),'2','closed_won'),agent);assert.equal(disallowed.reason,'INVALID_TRANSITION');assert.equal(disallowed.result.version,'2');
  });
  await t.test('contact and separate follow-up dates use exact versions; noops and rejected writes do not advance',async()=>{
   const contacted=await api.applyEnquiryOperationV2(enquiry,transition(id(1010),'2','contacted','2026-10-12T00:00:00.000Z'),agent);assert.equal(contacted.result.version,'3');assert.equal(contacted.result.status,'contacted');
   const stale=await api.applyEnquiryOperationV2(enquiry,reschedule(id(1011),'2','2026-10-13T06:30:00.000Z'),agent);assert.equal(stale.outcome,'conflict');assert.equal(stale.reason,'VERSION_CONFLICT');assert.equal(stale.result.version,'3');
   const moved=await api.applyEnquiryOperationV2(enquiry,reschedule(id(1012),'3','2026-10-13T06:30:00.000Z'),agent);assert.equal(moved.result.version,'4');
   const before=await counts(enquiry),noop=await api.applyEnquiryOperationV2(enquiry,reschedule(id(1013),'4','2026-10-13T06:30:00.000Z'),agent);assert.equal(noop.outcome,'noop');assert.equal(noop.result.version,'4');assert.equal((await counts(enquiry)).audits,before.audits);
   assert.deepEqual(await api.getEnquiryOperationV2(enquiry,id(1011),agent),stale);
   const qualified=await api.applyEnquiryOperationV2(enquiry,transition(id(1014),'4','qualified','2026-10-14T06:30:00.000Z'),agent);assert.equal(qualified.result.version,'5');
  });
  await t.test('a lost successful HTTP reply recovers the original result after later work with one submission',async()=>{
   let writes=0;const once=makeClient(async(input,init)=>{const response=await fetch(input,init);if(init.method==='POST'){writes++;assert.equal(response.status,200);await response.arrayBuffer();throw new Error('Synthetic lost reply after committed HTTP response');}return response;});
   const request=reschedule(id(1020),'5','2026-10-15T06:30:00.000Z');await assert.rejects(()=>once.applyEnquiryOperationV2(enquiry,request,agent),error=>error.kind==='NETWORK'&&error.submissionUncertain);assert.equal(writes,1);
   lostReceipt=await api.getEnquiryOperationV2(enquiry,request.operationId,agent);assert.equal(lostReceipt.outcome,'applied');assert.equal(lostReceipt.result.version,'6');
   const closed=await api.applyEnquiryOperationV2(enquiry,transition(id(1021),'6','closed_won'),agent);assert.equal(closed.result.version,'7');assert.equal(closed.result.nextActionAt,null);
   const before=await counts(enquiry);assert.deepEqual(await api.getEnquiryOperationV2(enquiry,request.operationId,agent),lostReceipt);assert.deepEqual(await api.applyEnquiryOperationV2(enquiry,request,agent),lostReceipt);assert.deepEqual(await counts(enquiry),before);assert.equal(writes,1);
   await assert.rejects(()=>api.applyEnquiryOperationV2(enquiry,{...request,nextActionAt:'2026-10-16T06:30:00.000Z'},agent),denied(409));
   const reopened=await api.applyEnquiryOperationV2(enquiry,transition(id(1022),'7','assigned',null,'Synthetic prospect asked to continue'),agent);assert.equal(reopened.result.version,'8');
  });
  await t.test('reassignment and original requester checks restrict historical recovery under current authorization',async()=>{
   await api.applyEnquiryOperationV2(enquiry,assign(id(1030),'8',PEER),admin);
   await assert.rejects(()=>api.getStaffEnquiryV2(enquiry,agent),denied(404));await assert.rejects(()=>api.getEnquiryOperationV2(enquiry,id(1020),agent),denied(404));await assert.rejects(()=>api.getEnquiryOperationV2(enquiry,id(1020),peer),denied(404));await assert.rejects(()=>api.getEnquiryOperationV2(enquiry,id(1020),admin),denied(404));
   assert.deepEqual(await api.getEnquiryOperationV2(enquiry,id(1000),admin),originalAssignment);assert.equal((await api.getStaffEnquiryV2(enquiry,peer)).version,'9');
   await assert.rejects(()=>api.getEnquiryOperationV2(second,id(1000),admin),denied(404));await assert.rejects(()=>api.applyEnquiryOperationV2(second,assign(id(1000),'1',AGENT),admin),denied(409));
   const otherClient=new RealtorApiClient({baseUrl:'https://synthetic-other.invalid',privacyNoticeVersion:'synthetic-v1',fetch:(input,init)=>serviceFor(OTHER)(new Request(input,init))});await assert.rejects(()=>otherClient.getStaffEnquiryV2(enquiry,foreign),denied(404));
  });
  await t.test('staff capture persists verified attribution and exact actor-bound receipt replay',async()=>{
   const {origin:ignored,...body}=contact,key=id(550);
   const capture=(identity,value=body)=>fetch(origin+'/v2/staff/enquiry-captures',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,...(identity?{Authorization:'Bearer '+identity.bearerToken}:{})},body:JSON.stringify(value)});
   for(const identity of [null,customer,foreign,inactive])assert.equal((await capture(identity)).status,identity?403:401);
   const receipt=await api.captureStaffEnquiryV2(body,{...admin,idempotencyKey:key});
   const stored=await asOwner(async q=>(await q.query('SELECT origin,requested_by_id AS actor FROM app_private.enquiries WHERE tenant_id=$1 AND id=$2',[TENANT,receipt.id])).rows[0]);assert.deepEqual(stored,{origin:'staff',actor:ADMIN});
   const before=await counts(receipt.id);const replay=await capture(admin);assert.equal(replay.status,201);assert.deepEqual(await replay.json(),receipt);assert.deepEqual(await counts(receipt.id),before);
   assert.equal((await capture(agent)).status,409);assert.equal((await capture(admin,{...body,message:'Changed original'})).status,409);
   assert.equal((await capture(admin,{...body,origin:'web'})).status,400);assert.deepEqual(await counts(receipt.id),before);
  });
  await t.test('shared activity read uses current authorization, historical actors and no writes',async()=>{
   const before=await counts(enquiry),page=await api.listEnquiryActivityV2(enquiry,{...peer,limit:2});assert.equal(page.coverage,'capture-and-v2-operations');assert.equal(page.currentVersion,'9');assert.equal(page.items.length,2);assert.equal(page.truncated,true);assert.equal(page.items[0].kind,'assign');assert.equal(page.items[0].actorId,ADMIN);assert.equal(page.items[0].version,'9');assert.deepEqual(await counts(enquiry),before);
   await assert.rejects(()=>api.listEnquiryActivityV2(enquiry,agent),denied(404));for(const identity of [customer,foreign,inactive])await assert.rejects(()=>api.listEnquiryActivityV2(enquiry,identity),denied(403));
   assert.doesNotMatch(JSON.stringify(page),/closureReason|email|phone|message|request_payload/);
  });
  await t.test('contact SDK recovers a lost committed reply and retains original facts after later workflow changes',async()=>{
   const original={operationId:id(1600),expectedVersion:'9',channel:'whatsapp',outcome:'no_response',occurredAt:'2026-01-02T03:04:05.006Z',notes:'  Synthetic original contact note\nRaw whitespace retained  '};let writes=0;
   const once=makeClient(async(input,init)=>{const response=await fetch(input,init);if(init.method==='POST'&&String(input).endsWith('/contacts')){writes++;assert.equal(response.status,200);await response.arrayBuffer();throw Error('Synthetic lost committed contact reply');}return response;});
   const before=await counts(enquiry);await assert.rejects(()=>once.recordContactV2(enquiry,original,peer),e=>e.kind==='NETWORK'&&e.submissionUncertain);assert.equal(writes,1);const saved=await api.getContactReceiptV2(enquiry,original,peer);assert.equal(saved.outcome,'applied');assert.equal(saved.entry.notes,original.notes);assert.equal(saved.actorId,PEER);const after=await counts(enquiry);assert.equal(after.version,before.version);assert.equal(after.audits,before.audits+1);
   await api.applyEnquiryOperationV2(enquiry,transition(id(1601),'9','contacted','2026-10-16T06:00:00.000Z'),peer);const later=await counts(enquiry);assert.deepEqual(await api.getContactReceiptV2(enquiry,original,peer),saved);assert.deepEqual(await api.recordContactV2(enquiry,original,peer),saved);assert.deepEqual(await counts(enquiry),later);assert.equal(writes,1);
   const stale=await api.recordContactV2(enquiry,{...original,operationId:id(1602)},peer);assert.equal(stale.outcome,'conflict');assert.equal(stale.entry,null);assert.equal(stale.observedVersion,'10');assert.equal(stale.request.notes,original.notes);const page=await api.listContactsV2(enquiry,{...admin,limit:1});assert.equal(page.items.length,1);assert.deepEqual(page.items[0],saved.entry);
   await assert.rejects(()=>api.recordContactV2(enquiry,{...original,notes:'Changed original'},peer),denied(409));await assert.rejects(()=>api.getContactReceiptV2(enquiry,original,admin),denied(404));await assert.rejects(()=>api.listContactsV2(enquiry,agent),denied(404));for(const identity of [customer,foreign,inactive])await assert.rejects(()=>api.listContactsV2(enquiry,identity),denied(403));
  });
  await t.test('reads leave records/audits/operations intact; runtime has no receipt DML or unscoped directory',async()=>{
   const before=await counts(enquiry);await api.listStaffEnquiriesV2(admin);await api.listEnquiryAssigneesV2(admin);await api.getStaffEnquiryV2(enquiry,peer);await api.getEnquiryOperationV2(enquiry,id(1000),admin);assert.deepEqual(await counts(enquiry),before);
   for(const sql of ['SELECT * FROM app_private.enquiry_operations','DELETE FROM app_private.enquiry_operations','UPDATE app_private.enquiries SET status=\'new\''])await assert.rejects(()=>db.query(sql),error=>error.code==='42501');
   await asOwner(query=>query.query('UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',[TENANT,PEER]));await assert.rejects(()=>api.getStaffEnquiryV2(enquiry,peer),denied(403));
   await asOwner(query=>query.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1',[TENANT]));await assert.rejects(()=>api.getEnquiryOperationV2(enquiry,id(1000),admin),denied(403));
  });
 }finally{await stop(apiServer);await stop(keyServer);await db.close();}
});
