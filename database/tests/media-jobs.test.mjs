import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';

const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const T=id(1), OTHER=id(2), ADMIN=id(10), AGENT=id(11), PEER=id(12), CUSTOMER=id(13), OTHERADMIN=id(20);
const content={title:'Synthetic registration apartment',description:'Local SQL policy fixture only.',purpose:'rent',
  propertyType:'apartment',currency:'KES',amountMinor:2000000,rentPeriod:'month',bedrooms:2,
  privateBathrooms:1,sharedBathrooms:null,country:'KE',locality:'Synthetic Nairobi',publicPrecision:'area',
  latitude:null,longitude:null,privateAddress:'PRIVATE SYNTHETIC ADDRESS'};
const receiptKeys=['altText','expectedVersion','expiresAt','jobId','kind','listingId','operationId','outcome','registeredAt','revision'];
async function scalar(db,sql,args=[]) { const result=await db.query(sql,args); return Object.values(result.rows[0])[0]; }
async function asActor(db,tenant,actor,callback) {
  await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');
  try {
    await db.query(`SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),
      set_config('realtor.correlation_id','synthetic-registration-test',true)`,[tenant??'',actor??'']);
    const result=await callback(); await db.exec('COMMIT'); return result;
  } catch(error) { await db.exec('ROLLBACK'); throw error; }
}
const denied=(callback,code='42501')=>assert.rejects(callback,error=>error.code===code);
async function fixture() {
  const db=new PGlite(); await applyTestMigrations(db);
  await db.query(`INSERT INTO app_private.tenants(id,slug,display_name) VALUES
    ($1,'registration-a','Synthetic A'),($2,'registration-b','Synthetic B')`,[T,OTHER]);
  for(const [tenant,actor,role] of [[T,ADMIN,'admin'],[T,AGENT,'agent'],[T,PEER,'agent'],[T,CUSTOMER,'customer'],[OTHER,OTHERADMIN,'admin']]) {
    await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenant,actor,role]);
  }
  return db;
}
async function draft(db,listing,{tenant=T,actor=AGENT}={}) {
  return asActor(db,tenant,actor,async()=>{
    await db.query('SELECT app_api.create_listing($1,$2)',[listing,`synthetic-${listing.slice(-3)}`]);
    return scalar(db,'SELECT app_api.save_draft($1,1,0,$2::jsonb)',[listing,JSON.stringify(content)]);
  });
}
function register(db,listing,operation,{actor=AGENT,tenant=T,revision=1,expected=2,alt='Synthetic apartment living room'}={}) {
  return asActor(db,tenant,actor,()=>scalar(db,'SELECT app_api.register_media_upload($1,$2,$3,$4,$5)',
    [listing,revision,expected,operation,alt]));
}
const receipt=(db,operation,actor=AGENT,tenant=T)=>asActor(db,tenant,actor,()=>scalar(db,'SELECT app_api.read_media_registration($1)',[operation]));
const job=(db,jobId,actor=AGENT,tenant=T)=>asActor(db,tenant,actor,()=>scalar(db,'SELECT app_api.read_media_job($1)',[jobId]));
async function counts(db) {
  return (await db.query(`SELECT (SELECT count(*)::integer FROM app_private.media_jobs) AS jobs,
    (SELECT count(*)::integer FROM app_private.media_operations) AS operations,
    (SELECT count(*)::integer FROM app_private.revision_media) AS media,
    (SELECT count(*)::integer FROM app_private.audit_events WHERE action='media.registered') AS audits`)).rows[0];
}
async function metadataOnlyPhotos(db,listing) {
  // These accepted fixture rows are metadata only, not decoded bytes or verified jobs.
  for(let position=0;position<4;position++) await db.query(`INSERT INTO app_private.revision_media
    (tenant_id,listing_id,revision_no,id,public_object_key,content_type,bytes,width,height,sha256,alt_text,position,accepted)
    VALUES($1,$2,1,$3,$4,'image/webp',100,100,100,$5,'Synthetic metadata only',$6,true)`,
    [T,listing,id(9000+Number(listing.slice(-3))*4+position),`synthetic/${listing}/${position}.webp`,'a'.repeat(64),position]);
}
async function seedHistorical(db,{listing,operation,jobId,created='2000-01-01T00:00:00.000Z',kind='register_media_upload'}) {
  const alt='Historical synthetic photo'; const createdAt=new Date(created).toISOString();
  const expiresAt=new Date(Date.parse(createdAt)+86400000).toISOString();
  const payload={kind,tenantId:T,actorId:AGENT,listingId:listing,revision:1,expectedVersion:'2',jobId,altText:alt};
  const result={kind,operationId:operation,jobId,listingId:listing,revision:1,expectedVersion:'2',altText:alt,
    outcome:'registered',registeredAt:createdAt,expiresAt};
  // Build timestamps in PostgreSQL so the canonical receipt has exactly its DB
  // representation; this is a privileged historical fixture, not a time travel claim.
  await db.query(`INSERT INTO app_private.media_operations(tenant_id,operation_id,kind,listing_id,revision_no,
    requester_id,expected_version,resource_id,request_payload,request_sha256,receipt,created_at)
    VALUES($1,$2,$3,$4,1,$5,2,$6,$7::jsonb,encode(sha256(convert_to(($7::jsonb)::text,'UTF8')),'hex'),
      ($8::jsonb-'registeredAt'-'expiresAt') || jsonb_build_object(
        'registeredAt',to_char($9::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'expiresAt',to_char(($9::timestamptz+interval '24 hours') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),$9::timestamptz)`,
    [T,operation,kind,listing,AGENT,jobId,JSON.stringify(payload),JSON.stringify(result),createdAt]);
  if(kind==='register_media_upload') await db.query(`INSERT INTO app_private.media_jobs(tenant_id,id,registration_id,
    listing_id,revision_no,requester_id,registered_assigned_agent_id,expected_version,alt_text,quarantine_id,output_id,created_at,expires_at)
    VALUES($1,$2,$3,$4,1,$5,$5,2,$6,$7,$8,$9::timestamptz,$9::timestamptz+interval '24 hours')`,
    [T,jobId,operation,listing,AGENT,alt,id(Number(operation.slice(-3))+7000),id(Number(operation.slice(-3))+8000),createdAt]);
}

// One disposable connection, sequential subtests. This proves local policy and
// transaction behavior; it does not prove independent PostgreSQL race behavior.
test('registered media jobs preserve private identity and authorized historical recovery',async t=>{
  const db=await fixture();
  try {
    await t.test('registration allocates one private job and receipt without changing content or accepting media',async()=>{
      const listing=id(100),operation=id(300); await draft(db,listing); const before=await counts(db);
      const versions=await db.query(`SELECT l.version::text AS listing,r.version::text AS revision FROM app_private.listings l
        JOIN app_private.listing_revisions r ON r.tenant_id=l.tenant_id AND r.listing_id=l.id WHERE l.id=$1`,[listing]);
      const result=await register(db,listing,operation);
      assert.deepEqual(Object.keys(result).sort(),receiptKeys); assert.equal(result.expectedVersion,'2');
      assert.equal(result.outcome,'registered'); assert.equal(result.kind,'register_media_upload');
      assert.equal(result.operationId,operation); assert.match(result.jobId,/^[a-f0-9-]{36}$/); assert.notEqual(result.jobId,operation);
      assert.equal(Date.parse(result.expiresAt)-Date.parse(result.registeredAt),86400000);
      assert.deepEqual(await register(db,listing,operation),result); assert.deepEqual(await receipt(db,operation),result);
      assert.deepEqual(await job(db,result.jobId),{...Object.fromEntries(Object.entries(result).filter(([key])=>key!=='outcome')),state:'registered'});
      const row=(await db.query('SELECT * FROM app_private.media_jobs WHERE id=$1',[result.jobId])).rows[0];
      assert.equal(new Set([operation,row.id,row.quarantine_id,row.output_id]).size,4);
      for(const value of [row.quarantine_id,row.output_id,T,AGENT]) assert.ok(!JSON.stringify(result).includes(value));
      assert.deepEqual(await counts(db),{...before,jobs:before.jobs+1,operations:before.operations+1,audits:before.audits+1});
      const after=await db.query(`SELECT l.version::text AS listing,r.version::text AS revision FROM app_private.listings l
        JOIN app_private.listing_revisions r ON r.tenant_id=l.tenant_id AND r.listing_id=l.id WHERE l.id=$1`,[listing]);
      assert.deepEqual(after.rows,versions.rows);
    });

    await t.test('lost-response retry recovers the same receipt after save, submit and approval',async()=>{
      const listing=id(101),operation=id(301); await draft(db,listing);
      await register(db,listing,operation); // Caller deliberately discards the committed response.
      const original=await receipt(db,operation); const registeredCounts=await counts(db);
      const edited=await asActor(db,T,AGENT,()=>scalar(db,'SELECT app_api.save_draft($1,1,2,$2::jsonb)',
        [listing,JSON.stringify({...content,title:'Synthetic later content'})]));
      assert.equal(String(edited),'3'); assert.deepEqual(await register(db,listing,operation),original);
      await metadataOnlyPhotos(db,listing);
      await asActor(db,T,AGENT,()=>db.query(`SELECT app_api.confirm_availability($1,1,'available')`,[listing]));
      const pending=await asActor(db,T,AGENT,()=>scalar(db,'SELECT app_api.submit_revision($1,1,3)',[listing]));
      assert.deepEqual(await register(db,listing,operation),original);
      await asActor(db,T,ADMIN,()=>db.query('SELECT app_api.decide_revision($1,1,$2,true)',[listing,pending]));
      const version=await scalar(db,'SELECT version::text FROM app_private.listing_revisions WHERE listing_id=$1',[listing]);
      assert.deepEqual(await register(db,listing,operation),original); assert.deepEqual(await receipt(db,operation),original);
      assert.equal(await scalar(db,'SELECT version::text FROM app_private.listing_revisions WHERE listing_id=$1',[listing]),version);
      const after=await counts(db); assert.equal(after.jobs,registeredCounts.jobs); assert.equal(after.operations,registeredCounts.operations);
      assert.equal(after.audits,registeredCounts.audits);
      await denied(()=>register(db,listing,id(302),{expected:Number(version)}),'23514');
      await db.exec("SET TIME ZONE 'Africa/Nairobi'");
      assert.deepEqual(await register(db,listing,operation),original);
      assert.equal(await scalar(db,`SELECT receipt->>'registeredAt'=to_char(created_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM app_private.media_operations WHERE operation_id=$1`,[operation]),true);
      assert.ok(original.registeredAt.endsWith('Z')); assert.ok(original.expiresAt.endsWith('Z'));
      await db.exec("SET TIME ZONE 'UTC'");
    });

    await t.test('changed version, alt text, principal, tuple or command kind cannot repurpose an operation',async()=>{
      const listing=id(102),otherListing=id(103),operation=id(303); await draft(db,listing); await draft(db,otherListing);
      await register(db,listing,operation); const before=await counts(db);
      for(const options of [{expected:3},{alt:'Changed synthetic alt'},{actor:ADMIN}]) {
        await denied(()=>register(db,listing,operation,options),'40001');
      }
      await denied(()=>register(db,otherListing,operation),'40001');
      await asActor(db,T,AGENT,()=>db.query('SELECT app_api.save_draft($1,2,0,$2::jsonb)',[listing,JSON.stringify(content)]));
      await denied(()=>register(db,listing,operation,{revision:2}),'40001');
      await seedHistorical(db,{listing,operation:id(304),jobId:id(404),kind:'attach_media'});
      await denied(()=>register(db,listing,id(304)),'40001');
      const after=await counts(db); assert.equal(after.jobs,before.jobs); assert.equal(after.audits,before.audits);
      assert.equal(after.operations,before.operations+1); // Privileged future-kind conflict fixture only.
    });

    await t.test('current tenant, membership and assignment guard receipt and job readback',async()=>{
      const listing=id(104),operation=id(305); await draft(db,listing); const result=await register(db,listing,operation);
      for(const actor of [PEER,ADMIN]) {
        await denied(()=>receipt(db,operation,actor),'P0002'); await denied(()=>job(db,result.jobId,actor),'P0002');
      }
      for(const actor of [CUSTOMER,null]) {
        await denied(()=>receipt(db,operation,actor)); await denied(()=>job(db,result.jobId,actor));
      }
      await denied(()=>receipt(db,operation,OTHERADMIN,OTHER),'P0002');
      await denied(()=>job(db,result.jobId,OTHERADMIN,OTHER),'P0002');
      await denied(()=>asActor(db,null,null,()=>db.query('SELECT app_api.read_media_registration($1)',[operation])));
      await asActor(db,T,ADMIN,()=>db.query('SELECT app_api.reassign_listing($1,1,$2)',[listing,PEER]));
      await denied(()=>receipt(db,operation),'P0002'); await denied(()=>job(db,result.jobId),'P0002');
      await denied(()=>register(db,listing,operation),'P0002');
      // Reassignment back can restore current read permission; it does not renew the job.
      await asActor(db,T,ADMIN,()=>db.query('SELECT app_api.reassign_listing($1,2,$2)',[listing,AGENT]));
      assert.deepEqual(await receipt(db,operation),result);
      await db.query('UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',[T,AGENT]);
      await denied(()=>receipt(db,operation)); await denied(()=>register(db,listing,operation));
      await db.query('UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',[T,AGENT]);
      await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1',[T]);
      await denied(()=>job(db,result.jobId)); await denied(()=>register(db,listing,operation));
      await db.query('UPDATE app_private.tenants SET enabled=true WHERE id=$1',[T]);
      assert.deepEqual(await register(db,listing,operation),result);
    });

    await t.test('new registrations require exact current draft and supported fields without partial writes',async()=>{
      const listing=id(105); await draft(db,listing); const before=await counts(db);
      for(const [options,code] of [[{expected:1},'40001'],[{expected:0},'40001'],[{expected:null},'40001'],
        [{expected:'9007199254740992'},'23514'],[{revision:2},'P0002'],[{revision:0},'23514']]) {
        await denied(()=>register(db,listing,id(306),options),code);
      }
      await denied(()=>register(db,listing,null),'23514');
      await denied(()=>register(db,listing,id(306),{actor:PEER}),'P0002');
      await denied(()=>register(db,listing,id(306),{actor:CUSTOMER}));
      await denied(()=>register(db,listing,id(306),{tenant:OTHER,actor:OTHERADMIN}),'P0002');
      await denied(()=>receipt(db,id(999)),'P0002'); await denied(()=>job(db,id(998)),'P0002');
      assert.deepEqual(await counts(db),before);
      const accepted=await register(db,listing,id(307),{actor:ADMIN});
      assert.equal(accepted.outcome,'registered'); assert.deepEqual(await receipt(db,id(307),ADMIN),accepted);
    });

    await t.test('alt text uses Unicode code points, canonical ECMAScript trim and control-free text',async()=>{
      const listing=id(106); await draft(db,listing); const before=await counts(db);
      const trimCharacters=[' ','\t','\n','\r','\f','\v','\u00a0','\u1680','\u2000','\u2001','\u2002','\u2003','\u2004',
        '\u2005','\u2006','\u2007','\u2008','\u2009','\u200a','\u2028','\u2029','\u202f','\u205f','\u3000','\ufeff'];
      for(const value of trimCharacters) {
        assert.equal(`${value}Photo`.trim(),'Photo');
        await denied(()=>register(db,listing,id(308),{alt:`${value}Photo`}), '23514');
        await denied(()=>register(db,listing,id(308),{alt:`Photo${value}`}), '23514');
      }
      for(const alt of ['',null,' '.repeat(3),'x'.repeat(301),'😀'.repeat(301),'Photo\u0001x','Photo\u001fx','Photo\u007fx','Photo\u0080x','Photo\u009fx']) {
        await denied(()=>register(db,listing,id(308),{alt}),'23514');
      }
      for(const alt of ['\ud800','\udfff','Photo\ud800']) {
        // JSON escapes preserve the invalid surrogate until PostgreSQL validates
        // Unicode. A text parameter cannot recover already-replaced wire bytes.
        await denied(()=>asActor(db,T,AGENT,()=>db.query(`SELECT app_api.register_media_upload($1,1,2,$2,$3::jsonb #>> '{}')`,
          [listing,id(308),JSON.stringify(alt)])),'22P02');
      }
      assert.deepEqual(await counts(db),before);
      const result=await register(db,listing,id(309),{alt:'😀'.repeat(300)});
      assert.equal([...result.altText].length,300); assert.equal(result.altText.length,600);
      assert.equal(await scalar(db,'SELECT char_length(alt_text)::integer FROM app_private.media_jobs WHERE id=$1',[result.jobId]),300);
    });

    await t.test('expired historical jobs reconcile without renewal or a fresh job identity',async()=>{
      const listing=id(107),operation=id(310),jobId=id(410); await draft(db,listing);
      await seedHistorical(db,{listing,operation,jobId}); const before=await counts(db);
      const original=await receipt(db,operation); assert.ok(Date.parse(original.expiresAt)<Date.now());
      assert.equal((await job(db,jobId)).state,'expired');
      assert.deepEqual(await register(db,listing,operation,{alt:'Historical synthetic photo'}),original);
      assert.deepEqual(await receipt(db,operation),original); assert.equal((await job(db,jobId)).expiresAt,original.expiresAt);
      assert.deepEqual(await counts(db),before);
    });

    await t.test('composite provenance and immutable job/receipt protections reject forged relationships and mutation',async()=>{
      const listing=id(108),operation=id(311); await draft(db,listing); const result=await register(db,listing,operation);
      for(const sql of ['UPDATE app_private.media_operations SET receipt=\'{}\'::jsonb WHERE operation_id=$1',
        'DELETE FROM app_private.media_operations WHERE operation_id=$1']) await denied(()=>db.query(sql,[operation]),'23514');
      for(const sql of ["UPDATE app_private.media_jobs SET expires_at=expires_at+interval '24 hours' WHERE id=$1",
        'DELETE FROM app_private.media_jobs WHERE id=$1']) await denied(()=>db.query(sql,[result.jobId]),'23514');
      await denied(()=>db.query(`INSERT INTO app_private.media_jobs(tenant_id,id,registration_id,listing_id,revision_no,
        requester_id,registered_assigned_agent_id,expected_version,alt_text,quarantine_id,output_id,created_at,expires_at)
        SELECT $1,$2,$3,listing_id,revision_no,$4,$4,expected_version,alt_text,$5,$6,created_at,expires_at
        FROM app_private.media_jobs WHERE id=$7`,[OTHER,id(411),id(312),OTHERADMIN,id(711),id(811),result.jobId]),'23503');
      await denied(()=>db.query(`INSERT INTO app_private.media_jobs(tenant_id,id,registration_id,listing_id,revision_no,
        requester_id,registered_assigned_agent_id,expected_version,alt_text,quarantine_id,output_id,created_at,expires_at)
        SELECT tenant_id,$1,$2,listing_id,revision_no,$3,registered_assigned_agent_id,expected_version,alt_text,$4,$5,created_at,expires_at
        FROM app_private.media_jobs WHERE id=$6`,[id(412),id(313),PEER,id(712),id(812),result.jobId]),'23503');
      assert.deepEqual(await receipt(db,operation),result);
    });

    await t.test('API role has named functions only, no private job reads/DML or owner/coordinator membership',async()=>{
      const tables=await db.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='app_private' AND relname IN ('media_jobs','media_operations')`);
      assert.equal(tables.rows.length,2); assert.ok(tables.rows.every(row=>row.relrowsecurity&&row.relforcerowsecurity));
      for(const table of ['media_jobs','media_operations']) {
        for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) assert.equal(await scalar(db,
          'SELECT has_table_privilege(\'api_runtime\',$1,$2)',[`app_private.${table}`,privilege]),false);
        await denied(()=>asActor(db,T,ADMIN,()=>db.query(`SELECT * FROM app_private.${table}`)));
        await denied(()=>asActor(db,T,ADMIN,()=>db.query(`DELETE FROM app_private.${table}`)));
      }
      const functions=await db.query(`SELECT p.proname,p.prosecdef,p.proconfig,r.rolname AS owner,
        EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
        WHERE n.nspname='app_api' AND p.proname IN ('register_media_upload','read_media_registration','read_media_job')`);
      assert.equal(functions.rows.length,3);
      for(const row of functions.rows) assert.deepEqual({owner:row.owner,securityDefiner:row.prosecdef,
        config:row.proconfig,publicExecute:row.public_execute},{owner:'realtor_owner',securityDefiner:true,
        config:['search_path=pg_catalog'],publicExecute:false});
      assert.equal(await scalar(db,"SELECT pg_has_role('api_runtime','realtor_owner','MEMBER')"),false);
      assert.equal(await scalar(db,"SELECT count(*)::integer FROM pg_roles WHERE rolname='media_coordinator'"),0);
      assert.deepEqual((await db.query("SELECT rolsuper,rolbypassrls,rolinherit,rolcanlogin FROM pg_roles WHERE rolname='api_runtime'")).rows[0],
        {rolsuper:false,rolbypassrls:false,rolinherit:false,rolcanlogin:false});
      // The existing API safety guard remains unchanged; these permissions do not
      // add role memberships, owner rights or schema CREATE to its isolated login.
      await db.exec('CREATE ROLE registered_media_test_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT api_runtime TO registered_media_test_login;');
      assert.equal(await scalar(db,"SELECT pg_has_role('registered_media_test_login','api_runtime','MEMBER')"),true);
      assert.equal(await scalar(db,"SELECT pg_has_role('registered_media_test_login','realtor_owner','MEMBER')"),false);
      assert.equal(await scalar(db,"SELECT has_schema_privilege('registered_media_test_login','app_private','CREATE') OR has_schema_privilege('registered_media_test_login','app_api','CREATE')"),false);
    });
  } finally { await db.close(); }
});
