import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const T=id(1),OTHER=id(2),ADMIN=id(10),AGENT=id(11),PEER=id(12),OTHERADMIN=id(20);
const content={title:'Synthetic upload context apartment',description:'SQL policy fixture only; no bytes uploaded.',purpose:'rent',
  propertyType:'apartment',currency:'KES',amountMinor:2000000,rentPeriod:'month',bedrooms:2,privateBathrooms:1,
  sharedBathrooms:null,country:'KE',locality:'Synthetic Nairobi',publicPrecision:'area',latitude:null,longitude:null,
  privateAddress:'PRIVATE SYNTHETIC ADDRESS'};
async function scalar(db,sql,args=[]) {const result=await db.query(sql,args);return Object.values(result.rows[0])[0];}
async function transaction(db,role,tenant,actor,callback) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${role};`);
  try {
    await db.query(`SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),
      set_config('realtor.correlation_id','synthetic-forged-context',true)`,[tenant??'',actor??'']);
    const result=await callback();await db.exec('COMMIT');return result;
  }catch(error){await db.exec('ROLLBACK');throw error;}
}
const api=(db,actor,callback,tenant=T)=>transaction(db,'api_runtime',tenant,actor,callback);
const context=(db,job,{tenant=OTHER,actor=OTHERADMIN}={})=>transaction(db,'media_coordinator',tenant,actor,
  ()=>scalar(db,'SELECT app_media.read_upload_context($1)',[job]));
const denied=(callback,code='42501')=>assert.rejects(callback,error=>error.code===code);
async function fixture() {
  const db=new PGlite();await applyTestMigrations(db);
  await db.query(`INSERT INTO app_private.tenants(id,slug,display_name) VALUES
    ($1,'upload-context-a','Synthetic A'),($2,'upload-context-b','Synthetic B')`,[T,OTHER]);
  for(const [tenant,user,role] of [[T,ADMIN,'admin'],[T,AGENT,'agent'],[T,PEER,'agent'],[OTHER,OTHERADMIN,'admin']])
    await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenant,user,role]);
  return db;
}
async function job(db,n,{actor=AGENT,tenant=T}={}) {
  const listing=id(n),operation=id(n+1000);
  return api(db,actor,async()=>{
    await db.query('SELECT app_api.create_listing($1,$2)',[listing,`synthetic-${n}`]);
    await db.query('SELECT app_api.save_draft($1,1,0,$2::jsonb)',[listing,JSON.stringify(content)]);
    const receipt=await scalar(db,'SELECT app_api.register_media_upload($1,1,2,$2,$3)',[listing,operation,'Synthetic context photo']);
    return {listing,operation,job:receipt.jobId,receipt};
  },tenant);
}
async function snapshot(db) {
  const result={};
  for(const table of ['listings','listing_revisions','revision_media','media_jobs','media_operations',
    'media_input_captures','media_processing_leases','media_verified_outputs','audit_events']) {
    result[table]=(await db.query(`SELECT to_jsonb(x) AS value FROM app_private.${table} x ORDER BY to_jsonb(x)::text`)).rows;
  }
  return result;
}
async function expiredJob(db,n) {
  const listing=id(n),operation=id(n+1000),jobId=id(n+2000),quarantine=id(n+3000),output=id(n+4000);
  await api(db,AGENT,async()=>{
    await db.query('SELECT app_api.create_listing($1,$2)',[listing,`synthetic-${n}`]);
    await db.query('SELECT app_api.save_draft($1,1,0,$2::jsonb)',[listing,JSON.stringify(content)]);
  });
  // Privileged immutable historical fixture. No clock advance, actual upload or
  // successful historical worker execution is claimed by this seeded data.
  await db.query(`WITH facts AS (SELECT '2000-01-01T00:00:00Z'::timestamptz AS created), request AS (
    SELECT created,jsonb_build_object('kind','register_media_upload','tenantId',$1::uuid,'actorId',$5::uuid,
      'listingId',$3::uuid,'revision',1,'expectedVersion','2','jobId',$4::uuid,'altText','Expired synthetic context') AS payload FROM facts)
    INSERT INTO app_private.media_operations(tenant_id,operation_id,kind,listing_id,revision_no,requester_id,
      expected_version,resource_id,request_payload,request_sha256,receipt,created_at)
    SELECT $1,$2,'register_media_upload',$3,1,$5,2,$4,payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'),
      jsonb_build_object('kind','register_media_upload','operationId',$2::uuid,'jobId',$4::uuid,'listingId',$3::uuid,
        'revision',1,'expectedVersion','2','altText','Expired synthetic context','outcome','registered',
        'registeredAt',app_private.media_utc(created),'expiresAt',app_private.media_utc(created+interval '24 hours')),created FROM request`,
    [T,operation,listing,jobId,AGENT]);
  await db.query(`INSERT INTO app_private.media_jobs(tenant_id,id,registration_id,listing_id,revision_no,requester_id,
    registered_assigned_agent_id,expected_version,alt_text,quarantine_id,output_id,created_at,expires_at)
    SELECT tenant_id,resource_id,operation_id,listing_id,revision_no,requester_id,requester_id,expected_version,
      request_payload->>'altText',$2,$3,created_at,created_at+interval '24 hours'
    FROM app_private.media_operations WHERE operation_id=$1`,[operation,quarantine,output]);
  return {listing,operation,job:jobId};
}

// One serialized disposable connection proves local policy and nonmutation only.
// Independent PostgreSQL concurrency and deployed coordinator isolation remain open.
test('coordinator upload context resolves generated identities under current new-work authorization',async t=>{
  const db=await fixture();
  try {
    await t.test('before capture the restricted coordinator resolves server identities without a private-table lookup',async()=>{
      const x=await job(db,100);const before=await snapshot(db);
      // The runtime lookup itself uses only its narrow function. Owner inspection
      // comes later solely to verify the returned server-generated identifiers.
      const result=await context(db,x.job);
      assert.deepEqual(Object.keys(result).sort(),['expiresAt','jobId','outputId','pipeline','quarantineId']);
      assert.equal(result.jobId,x.job);assert.equal(result.pipeline,'synthetic-codec-v1');
      assert.match(result.expiresAt,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
      const owner=(await db.query('SELECT * FROM app_private.media_jobs WHERE id=$1',[x.job])).rows[0];
      assert.equal(result.quarantineId,owner.quarantine_id);assert.equal(result.outputId,owner.output_id);
      assert.equal(Date.parse(result.expiresAt),new Date(owner.expires_at).getTime());
      assert.equal(new Set([result.jobId,result.quarantineId,result.outputId]).size,3);
      assert.deepEqual(await context(db,x.job,{tenant:null,actor:null}),result);
      assert.deepEqual(await context(db,x.job,{tenant:T,actor:PEER}),result);
      assert.deepEqual(await snapshot(db),before);
    });

    await t.test('stored company and original requester determine authorization rather than forged GUC selectors',async()=>{
      const x=await job(db,101),other=await job(db,102,{tenant:OTHER,actor:OTHERADMIN});
      assert.equal((await context(db,x.job,{tenant:OTHER,actor:OTHERADMIN})).jobId,x.job);
      assert.equal((await context(db,other.job,{tenant:T,actor:AGENT})).jobId,other.job);
      await db.query('UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',[T,AGENT]);
      const before=await snapshot(db);
      await denied(()=>context(db,x.job,{tenant:T,actor:ADMIN}),'P0002');
      await denied(()=>context(db,x.job,{tenant:OTHER,actor:OTHERADMIN}),'P0002');
      assert.deepEqual(await snapshot(db),before);
      await db.query('UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',[T,AGENT]);
      await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1',[T]);
      await denied(()=>context(db,x.job,{tenant:OTHER,actor:OTHERADMIN}),'P0002');
      assert.equal((await context(db,other.job)).jobId,other.job);
      await db.query('UPDATE app_private.tenants SET enabled=true WHERE id=$1',[T]);
    });

    await t.test('current agent assignment and the original registered assignment snapshot both apply',async()=>{
      const x=await job(db,103),admin=await job(db,104,{actor:ADMIN});
      await api(db,ADMIN,()=>db.query('SELECT app_api.reassign_listing($1,1,$2)',[x.listing,PEER]));
      const before=await snapshot(db);await denied(()=>context(db,x.job,{tenant:T,actor:ADMIN}),'P0002');
      assert.deepEqual(await snapshot(db),before);
      await api(db,ADMIN,()=>db.query('SELECT app_api.reassign_listing($1,1,$2)',[admin.listing,PEER]));
      await denied(()=>context(db,admin.job,{tenant:T,actor:ADMIN}),'40001');
      await api(db,ADMIN,()=>db.query('SELECT app_api.reassign_listing($1,2,$2)',[x.listing,AGENT]));
      assert.equal((await context(db,x.job)).jobId,x.job);
    });

    await t.test('expired, non-draft, missing and null jobs expose no upload context and mutate nothing',async()=>{
      const expired=await expiredJob(db,105),pending=await job(db,106);
      // State-only trusted fixture isolates the existing draft guard. This does
      // not label metadata fixtures processed or accept a submission media gate.
      await db.query(`UPDATE app_private.listing_revisions SET state='pending',submitted_at=now(),submitted_by=$2 WHERE listing_id=$1`,[pending.listing,AGENT]);
      const before=await snapshot(db);
      await denied(()=>context(db,expired.job),'23514');await denied(()=>context(db,pending.job),'23514');
      await denied(()=>context(db,id(99999)),'P0002');await denied(()=>context(db,null),'P0002');
      assert.deepEqual(await snapshot(db),before);
      const original=await api(db,AGENT,()=>scalar(db,'SELECT app_api.read_media_registration($1)',[expired.operation]));
      assert.ok(Date.parse(original.expiresAt)<Date.now());
    });

    await t.test('context lookup adopts no new draft token and creates no capture, lease, seal or audit receipt',async()=>{
      const x=await job(db,107);const first=await context(db,x.job);
      await api(db,AGENT,()=>db.query('SELECT app_api.save_draft($1,1,2,$2::jsonb)',[x.listing,JSON.stringify({...content,title:'Later synthetic title'})]));
      const before=await snapshot(db);assert.deepEqual(await context(db,x.job),first);assert.deepEqual(await snapshot(db),before);
      assert.equal(await scalar(db,'SELECT version::text FROM app_private.listing_revisions WHERE listing_id=$1',[x.listing]),'3');
      assert.equal(await scalar(db,'SELECT count(*)::integer FROM app_private.media_input_captures WHERE job_id=$1',[x.job]),0);
      assert.equal(await scalar(db,'SELECT count(*)::integer FROM app_private.media_processing_leases WHERE job_id=$1',[x.job]),0);
      assert.equal(await scalar(db,'SELECT count(*)::integer FROM app_private.media_verified_outputs WHERE job_id=$1',[x.job]),0);
    });

    await t.test('one fixed owner function is executable only by the coordinator and adds no private-table privilege',async()=>{
      const functionRow=(await db.query(`SELECT p.prosecdef,p.proconfig,r.rolname AS owner,
        has_function_privilege('media_coordinator',p.oid,'EXECUTE') AS coordinator_execute,
        has_function_privilege('api_runtime',p.oid,'EXECUTE') AS api_execute,
        EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
        FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid='app_media.read_upload_context(uuid)'::regprocedure`)).rows[0];
      assert.deepEqual(functionRow,{prosecdef:true,proconfig:['search_path=pg_catalog'],owner:'realtor_owner',
        coordinator_execute:true,api_execute:false,public_execute:false});
      assert.equal(await scalar(db,"SELECT has_schema_privilege('media_coordinator','app_private','USAGE')"),false);
      assert.equal(await scalar(db,"SELECT has_schema_privilege('media_coordinator','app_media','CREATE')"),false);
      assert.equal(await scalar(db,"SELECT has_schema_privilege('api_runtime','app_media','USAGE')"),false);
      for(const table of ['media_jobs','media_operations','media_input_captures','media_processing_leases','media_verified_outputs']) {
        for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal(await scalar(db,
          "SELECT has_table_privilege('media_coordinator',$1,$2)",[`app_private.${table}`,privilege]),false);
      }
      await denied(()=>transaction(db,'media_coordinator',T,ADMIN,()=>db.query('SELECT quarantine_id FROM app_private.media_jobs')));
      await denied(()=>api(db,ADMIN,()=>db.query('SELECT app_media.read_upload_context($1)',[id(99999)])));
      assert.equal(await scalar(db,"SELECT pg_has_role('media_coordinator','api_runtime','MEMBER') OR pg_has_role('media_coordinator','realtor_owner','MEMBER')"),false);
    });
  }finally{await db.close();}
});
