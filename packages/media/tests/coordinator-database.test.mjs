import test from 'node:test';
import assert from 'node:assert/strict';
import {MediaCoordinatorDatabase,MediaCoordinatorSafetyError,MediaCoordinatorInputError,MediaCoordinatorDatabaseError,assertSafeMediaCoordinatorConnection} from '../dist/coordinator-database.js';

const id=number=>`00000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
const JOB=id(100),GEN=id(200),CLAIM=id(300),NONCE=id(400),QUARANTINE=id(500),OUTPUT=id(600),OTHER=id(700);
const TIME='2026-10-11T00:00:00.123456Z',EXPIRY='2026-10-11T00:03:00.123456Z';
const input={generationId:GEN,bytes:100,sha256:'a'.repeat(64)};
const capture={jobId:JOB,generationId:GEN,inputBytes:100,inputSha256:input.sha256,capturedAt:TIME};
const lease={jobId:JOB,claimId:CLAIM,attempt:1,leaseNonce:NONCE,leaseExpiresAt:EXPIRY,quarantineId:QUARANTINE,outputId:OUTPUT,input,pipeline:'synthetic-codec-v1'};
const manifest={pipeline:'synthetic-codec-v1',sourceFormat:'png',inputSha256:input.sha256,inputBytes:100,format:'webp',mimeType:'image/webp',sha256:'b'.repeat(64),width:40,height:30,bytes:80,encoder:{sharp:'0.35.5',vips:'8.18.7'},operations:['auto-orient','resize-inside-1920-without-enlargement','strip-metadata','webp-quality-82-effort-4']};
const verified={jobId:JOB,attempt:1,leaseNonce:NONCE,outputId:OUTPUT,manifestSha256:'c'.repeat(64),manifest,verifiedAt:TIME,outcome:'verified'};
const seal={attempt:1,leaseNonce:NONCE,manifest};
const view=(patch={})=>({jobId:JOB,state:'registered',capture:null,lease:null,verified:null,...patch});
const copy=value=>JSON.parse(JSON.stringify(value));
const safe=()=>({currentUser:'media_test_login',sessionUser:'media_test_login',canLogin:true,coordinatorMember:true,coordinatorSchemaUsage:true,
  superuser:false,bypassRls:false,inheritsRoles:false,canEscalate:false,ownerMember:false,apiMember:false,canDelegateRole:false,otherRoleMembership:false,coordinatorOtherMembership:false,unsafeCoordinatorRole:false,unsafeSchemaOwner:false,schemaOwner:false,canCreateInApp:false,publicSchemaPrivilege:false,privateSchemaUsage:false,tableOwner:false,tablePrivilege:false,columnPrivilege:false,sequencePrivilege:false,privateFunctionPrivilege:false,unexpectedFunctionPrivilege:false,missingFunctionPrivilege:false,unsafeFunctionDefinition:false,publicFunctionPrivilege:false,canDelegatePrivilege:false});
function fixture({flags=safe(),receipt=view(),fail,connect}={}){
  const calls=[],releases=[];let checkouts=0,ends=0;
  const database=new MediaCoordinatorDatabase({async connect(){checkouts++;await connect?.();return {async query(sql,values){calls.push({sql,values:values?[...values]:undefined});if(fail)await fail(sql);
    return {rows:sql.startsWith('SELECT current_user')?[typeof flags==='function'?flags():flags]:sql.startsWith('SELECT app_media.')?[{receipt:copy(receipt)}]:[]};},release(destroy){releases.push(destroy);}};},async end(){ends++;}});
  return {database,calls,releases,get checkouts(){return checkouts;},get ends(){return ends;}};
}
const rejectsInput=operation=>assert.rejects(operation,MediaCoordinatorInputError);
const rejectsSafe=operation=>assert.rejects(operation,error=>error instanceof MediaCoordinatorSafetyError&&!error.message.includes('PRIVATE'));
const rejectsDatabase=(operation,uncertain=false,state)=>assert.rejects(operation,error=>error instanceof MediaCoordinatorDatabaseError&&error.commitUncertain===uncertain&&(state===undefined||error.sqlState===state)&&!error.message.includes('PRIVATE'));

test('dedicated guard accepts only complete safe role metadata and queries the four exact reviewed signatures',async()=>{
  let query;await assertSafeMediaCoordinatorConnection({async query(sql){query=sql;return {rows:[safe()]};}});
  for(const name of ['capture_input','claim_processing','seal_output','read_processing'])assert.ok(query.includes(`p.proname='${name}'`));
  assert.ok(query.includes("p.proargtypes[3]='pg_catalog.text'::pg_catalog.regtype"));assert.ok(query.includes("p.proargtypes[3]='pg_catalog.jsonb'::pg_catalog.regtype"));assert.equal(query.includes('to_regprocedure'),false);
  for(const name of ['pg_roles','pg_auth_members','pg_class','pg_namespace','pg_proc','pg_has_role','has_table_privilege','has_schema_privilege','has_function_privilege','aclexplode','acldefault'])assert.equal(new RegExp('(?<![\\w.])'+name+'\\b').test(query),false,name);
  assert.ok(query.includes('has_any_column_privilege'));assert.ok(query.includes('aclexplode'));assert.ok(query.includes('search_path=pg_catalog'));
});

test('every unsafe privilege/ownership/membership flag and malformed guard row fails closed',async()=>{
  const truthy=['canLogin','coordinatorMember','coordinatorSchemaUsage'];
  for(const key of Object.keys(safe()).filter(key=>!['currentUser','sessionUser'].includes(key))){
    for(const value of [!truthy.includes(key),'false',null,undefined]){
      const row=safe();row[key]=value;await rejectsSafe(()=>assertSafeMediaCoordinatorConnection({async query(){return {rows:[row]};}}));
    }
  }
  const missing=safe();delete missing.tablePrivilege;
  const inherited=Object.create(safe());
  const getter=safe();Object.defineProperty(getter,'columnPrivilege',{enumerable:true,get(){throw new Error('PRIVATE getter');}});
  for(const rows of [[],[safe(),safe()],[missing],[{...safe(),unexpected:true}],[inherited],[getter],[{...safe(),currentUser:'media_coordinator'}],[{...safe(),currentUser:'',sessionUser:''}]])await rejectsSafe(()=>assertSafeMediaCoordinatorConnection({async query(){return {rows};}}));
  await rejectsSafe(()=>assertSafeMediaCoordinatorConnection({async query(){throw new Error('PRIVATE connection details');}}));
});

test('unsafe checkout is destroyed before BEGIN, role selection, job work or actor context',async()=>{
  const f=fixture({flags:{...safe(),apiMember:true}});await rejectsSafe(()=>f.database.readProcessing(JOB));
  assert.equal(f.calls.length,1);assert.ok(f.calls[0].sql.startsWith('SELECT current_user'));assert.deepEqual(f.releases,[true]);
});

test('guard is rechecked on every checkout rather than trusting a previous successful connection',async()=>{
  let changed=false;const f=fixture({flags:()=>({...safe(),tablePrivilege:changed})});
  await f.database.checkConnection();changed=true;await rejectsSafe(()=>f.database.readProcessing(JOB));
  assert.equal(f.checkouts,2);assert.deepEqual(f.releases,[false,true]);assert.equal(f.calls.filter(call=>call.sql==='BEGIN').length,0);
});

test('four fixed commands use parameterized SQL in short transactions with no caller SQL or actor GUC surface',async()=>{
  for(const [receipt,call,statement,values] of [
    [capture,api=>api.captureInput(JOB,input),'SELECT app_media.capture_input($1::uuid,$2::uuid,$3::bigint,$4::text) AS receipt',[JOB,GEN,100,input.sha256]],
    [lease,api=>api.claimProcessing(JOB,CLAIM),'SELECT app_media.claim_processing($1::uuid,$2::uuid) AS receipt',[JOB,CLAIM]],
    [verified,api=>api.sealOutput(JOB,seal),'SELECT app_media.seal_output($1::uuid,$2::integer,$3::uuid,$4::jsonb) AS receipt',[JOB,1,NONCE,JSON.stringify(manifest)]],
    [view(),api=>api.readProcessing(JOB),'SELECT app_media.read_processing($1::uuid) AS receipt',[JOB]],
  ]){
    const f=fixture({receipt});assert.deepEqual(await call(f.database),receipt);
    assert.deepEqual(f.calls.slice(1).map(call=>call.sql),['BEGIN','SET LOCAL ROLE media_coordinator',statement,'COMMIT']);
    assert.deepEqual(f.calls[3].values,values);assert.deepEqual(f.releases,[false]);
    assert.equal('query' in f.database,false);assert.equal('transaction' in f.database,false);assert.ok(f.calls.every(call=>!call.sql.includes('set_config')));
  }
});

test('invalid command identities, bounds and unsupported grant/manifest fields fail before a checkout',async()=>{
  const f=fixture();
  for(const value of ['bad','../private',null,undefined])await rejectsInput(()=>f.database.readProcessing(value));
  for(const patch of [{generationId:'bad'},{bytes:0},{bytes:10485761},{bytes:1.5},{bytes:NaN},{sha256:'A'.repeat(64)},{sha256:'bad'},{actorId:OTHER},{tenantId:OTHER},{storageKey:'private'}])await rejectsInput(()=>f.database.captureInput(JOB,{...input,...patch}));
  for(const patch of [{attempt:0},{attempt:4},{attempt:1.5},{leaseNonce:'bad'},{actorId:OTHER}])await rejectsInput(()=>f.database.sealOutput(JOB,{...seal,...patch}));
  for(const patch of [{pipeline:'other'},{sourceFormat:'gif'},{inputBytes:0},{bytes:10485761},{width:1921},{height:0},{sha256:'bad'},{mimeType:'image/png'},{accepted:true},{encoder:{sharp:'unknown',vips:'8.18.7'}},{operations:['strip-metadata']}])await rejectsInput(()=>f.database.sealOutput(JOB,{...seal,manifest:{...manifest,...patch}}));
  await rejectsInput(()=>f.database.claimProcessing(JOB,'bad'));
  const accessor={...input};Object.defineProperty(accessor,'bytes',{enumerable:true,get(){throw new Error('PRIVATE accessor');}});await rejectsInput(()=>f.database.captureInput(JOB,accessor));
  const sparse=[...manifest.operations];delete sparse[1];await rejectsInput(()=>f.database.sealOutput(JOB,{...seal,manifest:{...manifest,operations:sparse}}));
  const operations=[...manifest.operations];Object.defineProperty(operations,'0',{enumerable:true,get(){throw new Error('PRIVATE accessor');}});await rejectsInput(()=>f.database.sealOutput(JOB,{...seal,manifest:{...manifest,operations}}));
  assert.equal(f.checkouts,0);
});

test('capture and manifest snapshots precede checkout awaits and returned receipts are deeply immutable',async()=>{
  const mutableInput={...input};const captured=fixture({receipt:capture,connect(){mutableInput.bytes=999;mutableInput.sha256='d'.repeat(64);}});
  const result=await captured.database.captureInput(JOB,mutableInput);assert.equal(captured.calls[3].values[2],100);assert.ok(Object.isFrozen(result));
  const mutableManifest=copy(manifest);const sealed=fixture({receipt:verified,connect(){mutableManifest.bytes=999;mutableManifest.encoder.sharp='changed';mutableManifest.operations[0]='changed';}});
  const output=await sealed.database.sealOutput(JOB,{...seal,manifest:mutableManifest});assert.equal(JSON.parse(sealed.calls[3].values[3]).bytes,80);
  for(const value of [output,output.manifest,output.manifest.encoder,output.manifest.operations])assert.ok(Object.isFrozen(value));
});

test('response job, capture, claim, fencing and submitted-manifest mismatches roll back without committing',async()=>{
  for(const [receipt,call] of [
    [{...capture,jobId:OTHER},api=>api.captureInput(JOB,input)],[{...capture,generationId:OTHER},api=>api.captureInput(JOB,input)],[{...capture,inputBytes:101},api=>api.captureInput(JOB,input)],
    [{...lease,claimId:OTHER},api=>api.claimProcessing(JOB,CLAIM)],[{...lease,attempt:4},api=>api.claimProcessing(JOB,CLAIM)],[{...lease,quarantineId:OUTPUT},api=>api.claimProcessing(JOB,CLAIM)],
    [{...verified,attempt:2},api=>api.sealOutput(JOB,seal)],[{...verified,leaseNonce:OTHER},api=>api.sealOutput(JOB,seal)],[{...verified,outputId:JOB},api=>api.sealOutput(JOB,seal)],[{...verified,manifest:{...manifest,bytes:81}},api=>api.sealOutput(JOB,seal)],
    [{...verified,uploadUrl:'PRIVATE'},api=>api.sealOutput(JOB,seal)],
  ]){
    const f=fixture({receipt});await rejectsDatabase(()=>call(f.database));assert.equal(f.calls.at(-1).sql,'ROLLBACK');assert.equal(f.calls.some(call=>call.sql==='COMMIT'),false);assert.deepEqual(f.releases,[false]);
  }
});

test('processing readback distinguishes historical leases and verified output while enforcing their captured input relationships',async()=>{
  for(const current of [view(),view({state:'captured',capture}),view({state:'captured',capture,lease}),view({state:'processing',capture,lease}),view({state:'expired',capture,lease}),view({state:'verified',capture,lease,verified})]){
    const result=await fixture({receipt:current}).database.readProcessing(JOB);assert.deepEqual(result,current);assert.ok(Object.isFrozen(result));if(result.lease)assert.ok(Object.isFrozen(result.lease.input));
  }
  for(const current of [view({state:'registered',capture}),view({state:'captured'}),view({state:'processing',capture}),view({state:'verified',capture,lease}),view({state:'expired',capture,lease,verified}),
    view({state:'processing',capture,lease:{...lease,input:{...input,sha256:'d'.repeat(64)}}}),view({state:'verified',capture,lease,verified:{...verified,outputId:OTHER}}),view({state:'verified',capture,lease,verified:{...verified,manifest:{...manifest,inputBytes:101}}}),view({state:'failed'}),view({tenantId:OTHER})])await rejectsDatabase(()=>fixture({receipt:current}).database.readProcessing(JOB));
});

test('receipt timestamps preserve UTC microseconds and past historical receipts without accepting impossible calendar dates',async()=>{
  const past={...capture,capturedAt:'2000-01-01T00:00:00.123456Z'};assert.deepEqual(await fixture({receipt:past}).database.captureInput(JOB,input),past);
  for(const capturedAt of ['2026-02-30T00:00:00.123456Z','2026-10-11T00:00:00.123Z','2026-10-11T00:00:00.123456+00:00','not-time'])await rejectsDatabase(()=>fixture({receipt:{...capture,capturedAt}}).database.captureInput(JOB,input));
});

test('definite SQL rejection rolls back once, exposes bounded SQLSTATE and suppresses diagnostic text without retry',async()=>{
  const f=fixture({fail(sql){if(sql.startsWith('SELECT app_media.'))throw Object.assign(new Error('PRIVATE database path and token'),{code:'40001'});}});
  await rejectsDatabase(()=>f.database.readProcessing(JOB),false,'40001');assert.equal(f.checkouts,1);assert.equal(f.calls.filter(call=>call.sql.startsWith('SELECT app_media.')).length,1);assert.equal(f.calls.at(-1).sql,'ROLLBACK');assert.deepEqual(f.releases,[false]);
});

test('failed rollback destroys the checkout instead of returning contaminated transaction state',async()=>{
  const f=fixture({fail(sql){if(sql.startsWith('SELECT app_media.')||sql==='ROLLBACK')throw new Error('PRIVATE broken connection');}});
  await rejectsDatabase(()=>f.database.readProcessing(JOB));assert.deepEqual(f.releases,[true]);assert.equal(f.calls.at(-1).sql,'ROLLBACK');
});

test('unconfirmed COMMIT is uncertain even when a later rollback responds and the checkout is destroyed',async()=>{
  const f=fixture({receipt:capture,fail(sql){if(sql==='COMMIT')throw new Error('PRIVATE response loss after commit');}});
  await rejectsDatabase(()=>f.database.captureInput(JOB,input),true);assert.equal(f.checkouts,1);assert.equal(f.calls.at(-1).sql,'ROLLBACK');assert.deepEqual(f.releases,[true]);
});

test('BEGIN failure destroys checkout without pretending a transaction rollback was confirmed',async()=>{
  const f=fixture({fail(sql){if(sql==='BEGIN')throw new Error('PRIVATE connect error');}});
  await rejectsDatabase(()=>f.database.readProcessing(JOB));assert.deepEqual(f.releases,[true]);assert.equal(f.calls.some(call=>call.sql==='ROLLBACK'),false);
});

test('connection and pool shutdown errors are bounded; close releases only the injected trusted pool',async()=>{
  const broken=new MediaCoordinatorDatabase({async connect(){throw new Error('PRIVATE database password');}});await rejectsDatabase(()=>broken.readProcessing(JOB));await rejectsDatabase(()=>broken.checkConnection());
  const f=fixture();await f.database.close();assert.equal(f.ends,1);assert.equal(f.checkouts,0);
  const badClose=new MediaCoordinatorDatabase({async connect(){throw new Error('unused');},async end(){throw new Error('PRIVATE shutdown');}});await rejectsDatabase(()=>badClose.close());
});

test('response envelope requires exactly one receipt row rather than silently choosing a malformed result',async()=>{
  for(const response of [{rows:[]},{rows:[{receipt:view()},{receipt:view()}]},{rows:[{receipt:view(),private:'PRIVATE'}]}]){
    let released;const api=new MediaCoordinatorDatabase({async connect(){return {async query(sql){return sql.startsWith('SELECT current_user')?{rows:[safe()]}:sql.startsWith('SELECT app_media.')?response:{rows:[]};},release(destroy){released=destroy;}};}});
    await rejectsDatabase(()=>api.readProcessing(JOB));assert.equal(released,false);
  }
});
