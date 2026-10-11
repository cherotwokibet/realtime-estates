import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {MediaCoordinatorDatabase,MediaCoordinatorDatabaseError} from '@realtor/media/coordinator-database';
import {verifySyntheticProcessReadback} from '@realtor/media/process-readback';
import {syntheticPng} from './fixtures.mjs';
import {environment,boundedRead,chunks,WINDOWS_ONLY} from './coordinator-fixture.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const TENANT=id(1),AGENT=id(11),LISTING=id(100);
async function scalar(db,sql,values=[]){return Object.values((await db.query(sql,values)).rows[0])[0];}

test('actual supervised image attaches once through persisted authorization and recovers a deliberately lost successful COMMIT reply',WINDOWS_ONLY,async t=>{
  const e=await environment(t),input=syntheticPng(29,21,(x,y)=>[x*8,y*11,130,255]);
  const stored=await e.store.ingest(chunks(input)),actualInput=await e.store.read(stored.handle);
  await e.coordinator.captureInput(e.jobId,{generationId:randomUUID(),bytes:stored.bytes,sha256:stored.sha256});
  const lease=await e.coordinator.claimProcessing(e.jobId,randomUUID());
  await writeFile(path.join(e.attempt,'source.input'),actualInput,{flag:'wx',mode:0o600});
  assert.equal((await e.run()).exitCode,0);
  const output=await boundedRead(e.attempt,'converted.webp',10*1024*1024),sidecar=await boundedRead(e.attempt,'manifest.json',4096);
  const verified=verifySyntheticProcessReadback(actualInput,output,sidecar),published=await e.store.publish(verified.data);
  assert.deepEqual(await e.store.read(published.handle),output);
  const sealed=await e.coordinator.sealOutput(e.jobId,{attempt:lease.attempt,leaseNonce:lease.leaseNonce,manifest:verified.manifest});
  await e.inspectUnchanged(1);
  const operation=randomUUID();
  // Test bootstrap installs the existing synthetic API principal, then uses only
  // the granted API command. This is not a production authentication session.
  const ready=await e.asBootstrap(async db=>{
    await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');
    try{
      await db.query("SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",[TENANT,AGENT]);
      const result=await scalar(db,'SELECT app_api.create_media_attach_intent($1,1,2,$2,$3)',[LISTING,operation,e.jobId]);
      await db.exec('COMMIT');return result;
    }catch(error){await db.exec('ROLLBACK');throw error;}
  });
  assert.equal(ready.status,'ready');assert.equal(ready.receipt,null);await e.inspectUnchanged(1);
  let finalizeWrites=0,commits=0,destroyed=0;
  const uncertain=new MediaCoordinatorDatabase({async connect(){return{
    async query(sql,values){
      if(sql.startsWith('SELECT app_media.finalize_media'))finalizeWrites++;
      const result=await e.db.query(sql,values?[...values]:[]);
      if(sql==='COMMIT'&&++commits===1)throw new Error('Synthetic acknowledgement loss after actual successful COMMIT');
      return result;
    },release(destroy){if(destroy)destroyed++;},
  };}});
  await assert.rejects(()=>uncertain.finalizeMedia(operation),error=>error instanceof MediaCoordinatorDatabaseError&&error.commitUncertain);
  assert.equal(finalizeWrites,1);assert.equal(commits,1);assert.equal(destroyed,1);
  const recovered=await e.coordinator.readMediaAttachIntent(operation);
  assert.equal(recovered.status,'applied');assert.equal(recovered.receipt.version,'3');assert.equal(recovered.receipt.position,0);
  assert.deepEqual(await e.coordinator.finalizeMedia(operation),recovered);
  await e.asBootstrap(async db=>{
    const rows=(await db.query('SELECT * FROM app_private.revision_media WHERE listing_id=$1 AND revision_no=1',[LISTING])).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].accepted,true);assert.equal(rows[0].sha256,verified.manifest.sha256);
    assert.equal(rows[0].width,29);assert.equal(rows[0].height,21);assert.equal(Number(rows[0].bytes),verified.manifest.bytes);
    assert.equal(await scalar(db,'SELECT version::text FROM app_private.listing_revisions WHERE listing_id=$1 AND revision_no=1',[LISTING]),'3');
    assert.equal(await scalar(db,"SELECT count(*)::integer FROM app_private.audit_events WHERE object_id=$1 AND action='media.attached'",[LISTING]),1);
    const attachment=(await db.query('SELECT * FROM app_private.media_attachments WHERE operation_id=$1',[operation])).rows[0];
    assert.equal(attachment.job_id,e.jobId);assert.equal(attachment.manifest_sha256,sealed.manifestSha256);
    // A later version makes the original receipt historical, never a fresh token.
    await db.query("UPDATE app_private.listing_revisions SET description='Later synthetic edit' WHERE listing_id=$1 AND revision_no=1",[LISTING]);
  });
  assert.deepEqual(await e.coordinator.readMediaAttachIntent(operation),recovered);
  assert.equal(finalizeWrites,1);assert.deepEqual(await e.store.read(published.handle),output);

  // Gallery commands exercise this actual stored output without deleting bytes.
  // The existing fixture bootstrap supplies API context; production identity and
  // independent PostgreSQL connection races remain separate acceptance work.
  const mediaId=recovered.receipt.mediaId,orderOperation=randomUUID(),removeOperation=randomUUID();
  async function gallery(sql,values,{loseReply=false}={}) {
    return e.asBootstrap(async db=>{
      await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');
      let committed=false;
      try {
        await db.query("SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",[TENANT,AGENT]);
        const result=await scalar(db,sql,values);
        await db.exec('COMMIT');committed=true;
        if(loseReply)throw new Error('Synthetic lost gallery response after actual COMMIT');
        return result;
      } catch(error) {if(!committed)await db.exec('ROLLBACK');throw error;}
    });
  }
  const noop=await gallery('SELECT app_api.reorder_draft_media($1,1,4,$2,$3::uuid[])',[LISTING,orderOperation,[mediaId]]);
  assert.equal(noop.outcome,'noop');assert.equal(noop.version,'4');assert.deepEqual(noop.orderedIds,[mediaId]);
  await assert.rejects(()=>gallery('SELECT app_api.remove_draft_media($1,1,4,$2,$3)',
    [LISTING,removeOperation,mediaId],{loseReply:true}),/lost gallery response after actual COMMIT/);
  const removed=await gallery('SELECT app_api.read_media_operation($1)',[removeOperation]);
  assert.equal(removed.outcome,'applied');assert.equal(removed.expectedVersion,'4');assert.equal(removed.version,'5');
  assert.equal(removed.mediaId,mediaId);assert.deepEqual(removed.orderedIds,[]);
  assert.deepEqual(await gallery('SELECT app_api.remove_draft_media($1,1,4,$2,$3)',[LISTING,removeOperation,mediaId]),removed);
  await e.asBootstrap(async db=>{
    assert.equal(await scalar(db,'SELECT count(*)::integer FROM app_private.revision_media WHERE listing_id=$1',[LISTING]),0);
    assert.equal(await scalar(db,'SELECT count(*)::integer FROM app_private.media_attachments WHERE operation_id=$1',[operation]),1);
    assert.equal(await scalar(db,'SELECT count(*)::integer FROM app_private.media_verified_outputs WHERE job_id=$1',[e.jobId]),1);
    assert.equal(await scalar(db,"SELECT count(*)::integer FROM app_private.audit_events WHERE object_id=$1 AND action='media.removed'",[LISTING]),1);
    assert.equal(await scalar(db,"SELECT count(*)::integer FROM app_private.audit_events WHERE object_id=$1 AND action='media.reordered'",[LISTING]),0);
    assert.equal(await scalar(db,'SELECT version::text FROM app_private.listing_revisions WHERE listing_id=$1 AND revision_no=1',[LISTING]),'5');
    await db.query("UPDATE app_private.listing_revisions SET description='Later edit after photo removal' WHERE listing_id=$1 AND revision_no=1",[LISTING]);
  });
  assert.deepEqual(await gallery('SELECT app_api.read_media_operation($1)',[removeOperation]),removed);
  assert.deepEqual(await gallery('SELECT app_api.read_media_operation($1)',[orderOperation]),noop);
  assert.deepEqual(await e.coordinator.readMediaAttachIntent(operation),recovered);
  assert.deepEqual(await e.coordinator.finalizeMedia(operation),recovered);
  assert.deepEqual(await e.store.read(published.handle),output);
});
