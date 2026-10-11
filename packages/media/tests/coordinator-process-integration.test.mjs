import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { verifySyntheticProcessReadback } from '@realtor/media/process-readback';
import { syntheticPng } from './fixtures.mjs';
import { environment, boundedRead, chunks, WINDOWS_ONLY } from './coordinator-fixture.mjs';

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
