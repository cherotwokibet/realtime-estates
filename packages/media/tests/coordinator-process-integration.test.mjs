import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, lstat, open, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { MediaCoordinatorDatabase } from '@realtor/media/coordinator-database';
import { createLocalSyntheticStore } from '@realtor/media/local-store';
import { verifySyntheticProcessReadback } from '@realtor/media/process-readback';
import { createWindowsSyntheticSupervisor } from '@realtor/media/windows-supervisor';
import { syntheticPng } from './fixtures.mjs';

// No native decoder is imported into this parent or given a database connection.
// The object-id/opaque-handle association below is ephemeral test state only.
const WINDOWS_ONLY={skip:process.platform!=='win32',timeout:90_000};
const POWER_SHELL=process.env.REALTOR_TEST_POWERSHELL??path.join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','native','powershell','pwsh.exe');
const ENTRY=fileURLToPath(new URL('../dist/codec-worker.js',import.meta.url));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const TENANT=id(1),AGENT=id(11),LISTING=id(100);
const content={title:'Synthetic coordinator apartment',description:'Local process-to-SQL proof only.',purpose:'rent',propertyType:'apartment',currency:'KES',amountMinor:2000000,rentPeriod:'month',bedrooms:2,privateBathrooms:1,sharedBathrooms:null,country:'KE',locality:'Synthetic Nairobi',publicPrecision:'area',latitude:null,longitude:null,privateAddress:'PRIVATE SYNTHETIC ADDRESS'};
async function* chunks(bytes){for(let n=0;n<bytes.length;n+=11)yield bytes.subarray(n,n+11);}
async function scalar(db,sql,values=[]){return Object.values((await db.query(sql,values)).rows[0])[0];}
async function boundedRead(directory,name,maximum){
  const location=path.join(directory,name),stat=await lstat(location,{bigint:true});
  assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1n&&stat.size>0n&&stat.size<=BigInt(maximum));
  const file=await open(location,'r');
  try{
    const before=await file.stat({bigint:true});assert.equal(before.ino,stat.ino);assert.equal(before.dev,stat.dev);
    assert.ok(before.isFile()&&before.nlink===1n&&before.size>0n&&before.size<=BigInt(maximum));
    const bytes=Buffer.alloc(Number(before.size)+1);let offset=0;
    while(offset<bytes.length){const result=await file.read(bytes,offset,bytes.length-offset,null);if(!result.bytesRead)break;offset+=result.bytesRead;}
    const after=await file.stat({bigint:true});assert.equal(offset,Number(before.size));assert.equal(after.size,before.size);assert.equal(after.mtimeNs,before.mtimeNs);
    return bytes.subarray(0,offset);
  }finally{await file.close();}
}
async function environment(t){
  const parent=await mkdtemp(path.join(tmpdir(),'realtor processing SQL '));
  const attemptParent=await mkdtemp(path.join(parent,'attempts ')),attempt=await mkdtemp(path.join(attemptParent,'owned '));
  const store=await createLocalSyntheticStore(parent),supervisor=await createWindowsSyntheticSupervisor({powerShellPath:POWER_SHELL,attemptParent});
  let cleanupAllowed=true;
  t.after(async()=>{
    if(!cleanupAllowed){t.diagnostic(`Unconfirmed attempt retained, including store: ${parent}`);return;}
    await store.dispose();
    for(const name of await readdir(attempt)){
      assert.ok(['source.input','converted.webp','manifest.json'].includes(name));
      const location=path.join(attempt,name),stat=await lstat(location);assert.ok(stat.isFile()&&!stat.isSymbolicLink());await unlink(location);
    }
    await rmdir(attempt);await rmdir(attemptParent);await rmdir(parent);
  });
  const db=new PGlite();t.after(()=>db.close());await applyTestMigrations(db);
  const bootstrapUser=await scalar(db,'SELECT session_user');
  const bootstrapQuoted='"'+bootstrapUser.replaceAll('"','""')+'"';
  await db.query("INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'processor-sql','Synthetic Process SQL')",[TENANT]);
  await db.query("INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'agent')",[TENANT,AGENT]);
  await db.exec('BEGIN;SET LOCAL ROLE api_runtime;');
  let registration;
  try{
    await db.query("SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",[TENANT,AGENT]);
    await db.query('SELECT app_api.create_listing($1,$2)',[LISTING,'synthetic-process-sql']);
    await db.query('SELECT app_api.save_draft($1,1,0,$2::jsonb)',[LISTING,JSON.stringify(content)]);
    registration=await scalar(db,'SELECT app_api.register_media_upload($1,1,2,$2,$3)',[LISTING,randomUUID(),'Synthetic processed apartment']);
    await db.exec('COMMIT');
  }catch(error){await db.exec('ROLLBACK');throw error;}
  await db.exec('CREATE ROLE synthetic_media_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;GRANT media_coordinator TO synthetic_media_login;SET SESSION AUTHORIZATION synthetic_media_login;');
  let tail=Promise.resolve();
  const pool={async connect(){let unlock;const next=new Promise(resolve=>{unlock=resolve;});const previous=tail;tail=next;await previous;return{query:(sql,values)=>db.query(sql,values?[...values]:[]),release(){unlock();}};}};
  const coordinator=new MediaCoordinatorDatabase(pool);await coordinator.checkConnection();
  async function run(){
    cleanupAllowed=false;
    const result=await supervisor.run({executablePath:process.execPath,arguments:[ENTRY],workingDirectory:attempt,timeoutMs:10_000});
    cleanupAllowed=result.termination==='job_empty';assert.equal(result.termination,'job_empty');assert.equal(result.activeProcesses,0);assert.equal(result.state,'exited',JSON.stringify(result));return result;
  }
  async function asBootstrap(operation){
    await db.exec(`SET SESSION AUTHORIZATION ${bootstrapQuoted}; RESET ROLE;`);
    try{return await operation(db);}finally{await db.exec('SET SESSION AUTHORIZATION synthetic_media_login; RESET ROLE;');}
  }
  async function inspectUnchanged(expectedSeals){
    // Bootstrap fixture inspection only; restore the isolated session and rerun
    // its guard before any subsequent command. Runtime privileges never widen.
    await asBootstrap(async()=>{
      assert.deepEqual((await db.query('SELECT version::text,state FROM app_private.listing_revisions WHERE listing_id=$1 AND revision_no=1',[LISTING])).rows[0],{version:'2',state:'draft'});
      assert.equal(await scalar(db,'SELECT count(*)::integer FROM app_private.revision_media'),0);
      assert.equal(await scalar(db,'SELECT count(*)::integer FROM app_private.media_verified_outputs'),expectedSeals);
    });
    await coordinator.checkConnection();
  }
  return{store,attempt,coordinator,jobId:registration.jobId,run,inspectUnchanged,asBootstrap,db};
}

test('real supervised codec output seals through the restricted processing adapter without accepting a photo',WINDOWS_ONLY,async t=>{
  const e=await environment(t),input=syntheticPng(31,23,(x,y)=>[x*7,y*10,90,(x+y)%2?120:255]);
  assert.equal((await e.coordinator.readProcessing(e.jobId)).state,'registered');
  const stored=await e.store.ingest(chunks(input)),captured=await e.store.read(stored.handle);
  const identity={generationId:randomUUID(),bytes:stored.bytes,sha256:stored.sha256};
  const receipt=await e.coordinator.captureInput(e.jobId,identity);
  assert.deepEqual(await e.coordinator.captureInput(e.jobId,identity),receipt);
  await assert.rejects(()=>e.coordinator.captureInput(e.jobId,{...identity,generationId:randomUUID()}),error=>error.sqlState==='40001');
  const claimId=randomUUID(),lease=await e.coordinator.claimProcessing(e.jobId,claimId);
  assert.equal(lease.attempt,1);assert.deepEqual(lease.input,identity);
  await writeFile(path.join(e.attempt,'source.input'),captured,{flag:'wx',mode:0o600});
  assert.equal((await e.run()).exitCode,0);
  const output=await boundedRead(e.attempt,'converted.webp',10*1024*1024),sidecar=await boundedRead(e.attempt,'manifest.json',4096);
  // A damaged readback is refused before any SQL seal is attempted.
  const damaged=Buffer.from(output);damaged[damaged.length-1]^=1;
  assert.throws(()=>verifySyntheticProcessReadback(captured,damaged,sidecar));
  assert.equal((await e.coordinator.readProcessing(e.jobId)).verified,null);
  const verified=verifySyntheticProcessReadback(captured,output,sidecar);
  assert.equal(verified.manifest.width,31);assert.equal(verified.manifest.height,23);
  const published=await e.store.publish(verified.data);
  assert.equal(published.bytes,verified.manifest.bytes);assert.equal(published.sha256,verified.manifest.sha256);
  const ephemeralObjects=new Map([[lease.outputId,published.handle]]);
  assert.deepEqual(await e.store.read(ephemeralObjects.get(lease.outputId)),output);
  const seal={attempt:lease.attempt,leaseNonce:lease.leaseNonce,manifest:verified.manifest};
  const sealed=await e.coordinator.sealOutput(e.jobId,seal);
  assert.equal(sealed.outputId,lease.outputId);assert.deepEqual(sealed.manifest,verified.manifest);
  assert.deepEqual(await e.coordinator.sealOutput(e.jobId,seal),sealed);
  assert.deepEqual(await e.coordinator.claimProcessing(e.jobId,claimId),lease);
  await assert.rejects(()=>e.coordinator.sealOutput(e.jobId,{...seal,manifest:{...seal.manifest,width:30}}),error=>error.sqlState==='40001');
  const view=await e.coordinator.readProcessing(e.jobId);assert.equal(view.state,'verified');assert.deepEqual(view.verified,sealed);
  await e.inspectUnchanged(1);
});

test('corrupt real child input leaves a claimed job unsealed after confirmed termination',WINDOWS_ONLY,async t=>{
  const e=await environment(t),input=Buffer.from('synthetic invalid image');
  const stored=await e.store.ingest(chunks(input));
  await e.coordinator.captureInput(e.jobId,{generationId:randomUUID(),bytes:stored.bytes,sha256:stored.sha256});
  await e.coordinator.claimProcessing(e.jobId,randomUUID());
  await writeFile(path.join(e.attempt,'source.input'),await e.store.read(stored.handle),{flag:'wx'});
  assert.equal((await e.run()).exitCode,1);assert.deepEqual(await readdir(e.attempt),['source.input']);
  const view=await e.coordinator.readProcessing(e.jobId);assert.equal(view.state,'processing');assert.equal(view.verified,null);
  await e.inspectUnchanged(0);
});

test('actual isolated connection guard rejects changed grants, roles and command definitions despite a temporary catalog shadow',WINDOWS_ONLY,async t=>{
  const e=await environment(t);
  const attacks=[
    ['GRANT api_runtime TO synthetic_media_login','REVOKE api_runtime FROM synthetic_media_login'],
    ['ALTER ROLE synthetic_media_login CREATEROLE','ALTER ROLE synthetic_media_login NOCREATEROLE'],
    ['ALTER ROLE media_coordinator CREATEDB','ALTER ROLE media_coordinator NOCREATEDB'],
    ['GRANT USAGE ON SCHEMA app_private TO synthetic_media_login','REVOKE USAGE ON SCHEMA app_private FROM synthetic_media_login'],
    ['GRANT CREATE ON SCHEMA app_media TO media_coordinator','REVOKE CREATE ON SCHEMA app_media FROM media_coordinator'],
    ['GRANT SELECT(input_bytes) ON app_private.media_input_captures TO synthetic_media_login','REVOKE SELECT(input_bytes) ON app_private.media_input_captures FROM synthetic_media_login'],
    ['GRANT EXECUTE ON FUNCTION app_api.read_media_job(uuid) TO synthetic_media_login','REVOKE EXECUTE ON FUNCTION app_api.read_media_job(uuid) FROM synthetic_media_login'],
    ['GRANT USAGE ON SCHEMA app_media TO PUBLIC','REVOKE USAGE ON SCHEMA app_media FROM PUBLIC'],
    ['GRANT EXECUTE ON FUNCTION app_media.read_processing(uuid) TO media_coordinator WITH GRANT OPTION','REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION app_media.read_processing(uuid) FROM media_coordinator'],
    ['GRANT media_coordinator TO synthetic_media_login WITH ADMIN OPTION','REVOKE ADMIN OPTION FOR media_coordinator FROM synthetic_media_login'],
    ["ALTER FUNCTION app_media.read_processing(uuid) SET search_path=pg_catalog,public","ALTER FUNCTION app_media.read_processing(uuid) SET search_path=pg_catalog"],
  ];
  for(const [alter,restore] of attacks){
    await e.asBootstrap(db=>db.exec(alter));
    try{await assert.rejects(()=>e.coordinator.readProcessing(e.jobId),error=>error.code==='UNSAFE_MEDIA_COORDINATOR_ROLE',alter);}
    finally{await e.asBootstrap(db=>db.exec(restore));}
    await e.coordinator.checkConnection();
  }
  await e.asBootstrap(db=>db.exec('GRANT SELECT ON app_private.media_input_captures TO synthetic_media_login'));
  await e.db.exec('CREATE TEMP VIEW pg_class AS SELECT * FROM pg_catalog.pg_class WHERE false');
  try{await assert.rejects(()=>e.coordinator.readProcessing(e.jobId),error=>error.code==='UNSAFE_MEDIA_COORDINATOR_ROLE');}
  finally{
    await e.db.exec('DROP VIEW pg_temp.pg_class');
    await e.asBootstrap(db=>db.exec('REVOKE SELECT ON app_private.media_input_captures FROM synthetic_media_login'));
  }
  await e.coordinator.checkConnection();await e.inspectUnchanged(0);
});
