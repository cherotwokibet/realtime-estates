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

// No native decoder is imported into this parent or given a database connection.
// The object-id/opaque-handle association below is ephemeral test state only.
export const WINDOWS_ONLY={skip:process.platform!=='win32',timeout:90_000};
const POWER_SHELL=process.env.REALTOR_TEST_POWERSHELL??path.join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','native','powershell','pwsh.exe');
const ENTRY=fileURLToPath(new URL('../dist/codec-worker.js',import.meta.url));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const TENANT=id(1),AGENT=id(11),LISTING=id(100);
const content={title:'Synthetic coordinator apartment',description:'Local process-to-SQL proof only.',purpose:'rent',propertyType:'apartment',currency:'KES',amountMinor:2000000,rentPeriod:'month',bedrooms:2,privateBathrooms:1,sharedBathrooms:null,country:'KE',locality:'Synthetic Nairobi',publicPrecision:'area',latitude:null,longitude:null,privateAddress:'PRIVATE SYNTHETIC ADDRESS'};
export async function* chunks(bytes){for(let n=0;n<bytes.length;n+=11)yield bytes.subarray(n,n+11);}
async function scalar(db,sql,values=[]){return Object.values((await db.query(sql,values)).rows[0])[0];}
export async function boundedRead(directory,name,maximum){
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
export async function environment(t){
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
  // Migration-owner fixture context only; no application lookup/grant is added.
  const storageIds=(await db.query('SELECT quarantine_id AS "quarantineId",output_id AS "outputId" FROM app_private.media_jobs WHERE id=$1',[registration.jobId])).rows[0];
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
  return{store,attempt,coordinator,jobId:registration.jobId,run,inspectUnchanged,asBootstrap,db,storageIds};
}
