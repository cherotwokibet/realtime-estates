import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { lstat,mkdir,mkdtemp,readFile,readdir,rename,rmdir,unlink,writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDurableSyntheticStore,reopenDurableSyntheticStore } from '../dist/durable-store.js';
import { createSyntheticAttemptJournal } from '../dist/attempt-journal.js';
import { createSyntheticWorkerAdmission,reopenSyntheticWorkerAdmission } from '../dist/worker-admission.js';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const code=expected=>error=>error?.code===expected;
const canonical=value=>JSON.stringify(value)+'\n';
let sequence=1;
// These are explicitly simulated trusted-supervisor observations. No child,
// decoder, OS Job Object or process termination is exercised by this file.
const empty=()=>({state:'exited',termination:'job_empty',exitCode:0,activeProcesses:0,safeCode:'EXITED'});
const unknown=()=>({state:'containment_unknown',termination:'unconfirmed',cleanupAllowed:false,safeCode:'PROTOCOL_INVALID'});
async function exists(location){try{return await lstat(location);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function directDirectory(location){const stat=await lstat(location);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());}
async function removeKnownFiles(directory,names){
  await directDirectory(directory);
  for(const entry of await readdir(directory))assert.ok(names.includes(entry),`Unexpected fixture entry retained: ${entry}`);
  for(const name of names){const file=path.join(directory,name),stat=await exists(file);if(!stat)continue;
    assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1);await unlink(file);}
  await rmdir(directory);
}

async function fixture(t){
  const parent=await mkdtemp(path.join(os.tmpdir(),'realtor-worker-admission-'));
  const workerParent=path.join(parent,'workers'),attemptParent=path.join(parent,'attempts');
  await mkdir(workerParent);await mkdir(attemptParent);
  const store=await createDurableSyntheticStore(parent),stores=new Set([store]),journals=new Set(),workers=new Set(),roots=new Map(),jobs=new Set();
  // Every path below was created by this fixture. Cleanup is explicit and
  // nonrecursive and refuses unknown entries. Simulated unknowns own no process.
  t.after(async()=>{
    for(const worker of workers)await worker.close();
    for(const journal of journals)await journal.close();
    for(const opened of stores)await opened.close();
    for(const [root,reservations] of roots){
      assert.equal(path.dirname(root),workerParent);await directDirectory(root);
      for(const name of await readdir(root))assert.ok(['worker.json','history','active'].includes(name));
      const active=path.join(root,'active');if(await exists(active))await removeKnownFiles(active,['owner.json','launch.json','completion.json','owned-sentinel.txt']);
      const history=path.join(root,'history');await directDirectory(history);
      for(const name of await readdir(history))assert.ok(reservations.has(name),`Unknown worker archive retained: ${name}`);
      for(const reservationId of reservations){
        const envelope=path.join(history,reservationId);if(!await exists(envelope))continue;await directDirectory(envelope);
        for(const name of await readdir(envelope))assert.ok(['slot','owned-sentinel.txt'].includes(name));
        const slot=path.join(envelope,'slot');if(await exists(slot))await removeKnownFiles(slot,['owner.json','launch.json','completion.json','owned-sentinel.txt']);
        await removeKnownFiles(envelope,['owned-sentinel.txt']);
      }
      await rmdir(history);
      const marker=path.join(root,'worker.json'),stat=await lstat(marker);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1);
      await unlink(marker);await rmdir(root);
    }
    assert.deepEqual(await readdir(workerParent),[]);await rmdir(workerParent);
    for(const jobId of jobs){const attempt=path.join(attemptParent,jobId);if(await exists(attempt))await removeKnownFiles(attempt,['owned-sentinel.txt']);}
    assert.deepEqual(await readdir(attemptParent),[]);await rmdir(attemptParent);
    const objects=path.join(store.rootDirectory,'objects');await directDirectory(objects);
    for(const jobId of await readdir(objects))assert.ok(jobs.has(jobId),`Unknown journal job retained: ${jobId}`);
    for(const jobId of jobs){const job=path.join(objects,jobId);if(!await exists(job))continue;await directDirectory(job);
      for(const kind of await readdir(job))assert.ok(['quarantine','output'].includes(kind));
      for(const kind of ['quarantine','output']){const directory=path.join(job,kind);if(await exists(directory))await removeKnownFiles(directory,['data.bin','receipt.json']);}
      await rmdir(job);
    }
    await rmdir(objects);assert.deepEqual((await readdir(store.rootDirectory)).sort(),['store.json']);
    const marker=path.join(store.rootDirectory,'store.json'),stat=await lstat(marker);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1);
    await unlink(marker);await rmdir(store.rootDirectory);assert.deepEqual(await readdir(parent),[]);await rmdir(parent);
  });
  function binding(){const n=sequence++;const value={jobId:id(n),claimId:id(10000+n),attempt:1,leaseNonce:id(20000+n)};jobs.add(value.jobId);return value;}
  async function openJournal(){const opened=await reopenDurableSyntheticStore(store.rootDirectory,store.storeId);stores.add(opened);
    const journal=await createSyntheticAttemptJournal({store:opened,attemptParent});journals.add(journal);return journal;}
  const journal=await openJournal();
  function track(worker){workers.add(worker);if(!roots.has(worker.rootDirectory))roots.set(worker.rootDirectory,new Set());return worker;}
  async function create(using=journal){return track(await createSyntheticWorkerAdmission({parentDirectory:workerParent,journal:using}));}
  async function reopen(worker,using=journal){return track(await reopenSyntheticWorkerAdmission({rootDirectory:worker.rootDirectory,workerId:worker.workerId,journal:using}));}
  async function reserve(worker,value){const reservation=await worker.reserve({jobId:value.jobId,claimId:value.claimId});roots.get(worker.rootDirectory).add(reservation.owner.reservationId);return reservation;}
  function archive(worker,reservation){return path.join(worker.rootDirectory,'history',reservation.owner.reservationId);}
  async function armed(worker,value,using=journal){const reservation=await reserve(worker,value),attempt=await using.reserve(value);await worker.arm(reservation.permit,attempt);return {reservation,attempt};}
  return {parent,workerParent,attemptParent,store,journal,jobs,binding,openJournal,create,reopen,reserve,archive,armed,
    trackArchive(worker,reservationId){roots.get(worker.rootDirectory).add(reservationId);}};
}

test('fresh worker identity and exclusive reservation persist canonical owner without issuing restart authority',async t=>{
  const f=await fixture(t),worker=await f.create(),binding=f.binding();
  assert.ok(Object.isFrozen(worker));assert.equal(worker.journalId,f.journal.journalId);
  assert.equal(await readFile(path.join(worker.rootDirectory,'worker.json'),'utf8'),canonical({version:1,workerId:worker.workerId,journalId:worker.journalId}));
  assert.deepEqual(await worker.inspect(),{state:'idle',owner:null});
  const reserved=await f.reserve(worker,binding);
  assert.ok(Object.isFrozen(reserved)&&Object.isFrozen(reserved.owner)&&Object.isFrozen(reserved.permit));
  assert.deepEqual(reserved.permit,{kind:'synthetic_worker'});
  assert.deepEqual(reserved.owner,{version:1,workerId:worker.workerId,journalId:worker.journalId,jobId:binding.jobId,claimId:binding.claimId,reservationId:reserved.owner.reservationId});
  assert.equal(await readFile(path.join(worker.rootDirectory,'active','owner.json'),'utf8'),canonical(reserved.owner));
  assert.deepEqual(await worker.inspect(),{state:'blocked',owner:reserved.owner});
  await worker.close();const reopened=await f.reopen(worker,await f.openJournal());
  assert.deepEqual(await reopened.inspect(),{state:'blocked',owner:reserved.owner});
  await assert.rejects(reopened.releaseBeforeLaunch(reserved.permit),code('INVALID_PERMIT'));
  await assert.rejects(reopened.reserve({jobId:binding.jobId,claimId:binding.claimId}),code('BLOCKED'));
  assert.deepEqual(await readdir(path.join(worker.rootDirectory,'history')),[]);
});

test('two independent instances admit one global owner and block different jobs until the live owner releases',async t=>{
  const f=await fixture(t),one=await f.create(),two=await f.reopen(one,await f.openJournal()),first=f.binding(),second=f.binding();
  const results=await Promise.allSettled([f.reserve(one,first),f.reserve(two,second)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const failure=results.find(result=>result.status==='rejected');assert.ok(['BLOCKED','INTEGRITY'].includes(failure.reason?.code));
  const winner=results.find(result=>result.status==='fulfilled').value,loser=results[0].status==='fulfilled'?two:one;
  assert.deepEqual(await loser.inspect(),{state:'blocked',owner:winner.owner});
  await assert.rejects(loser.reserve({jobId:f.binding().jobId,claimId:id(90001)}),code('BLOCKED'));
  assert.deepEqual(await readdir(path.join(one.rootDirectory,'history')),[]);
});

test('empty active directory is conservatively blocked before and after reopening',async t=>{
  const f=await fixture(t),worker=await f.create();await mkdir(path.join(worker.rootDirectory,'active'));
  assert.deepEqual(await worker.inspect(),{state:'blocked',owner:null});
  await assert.rejects(worker.reserve({jobId:f.binding().jobId,claimId:id(90002)}),code('BLOCKED'));
  await worker.close();const reopened=await f.reopen(worker,await f.openJournal());
  assert.deepEqual(await reopened.inspect(),{state:'blocked',owner:null});
  assert.deepEqual(await readdir(path.join(worker.rootDirectory,'active')),[]);
});

test('unarmed live permit releases only as not_launched, preserves history and admits a distinct job',async t=>{
  const f=await fixture(t),worker=await f.create(),first=f.binding(),reserved=await f.reserve(worker,first);
  const completion=await worker.releaseBeforeLaunch(reserved.permit),slot=path.join(f.archive(worker,reserved),'slot');
  assert.ok(Object.isFrozen(completion));assert.deepEqual(completion,{owner:reserved.owner,state:'not_launched'});
  assert.equal(await exists(path.join(worker.rootDirectory,'active')),null);
  assert.equal(await readFile(path.join(slot,'owner.json'),'utf8'),canonical(reserved.owner));
  assert.equal(await readFile(path.join(slot,'completion.json'),'utf8'),canonical(completion));
  assert.deepEqual((await readdir(slot)).sort(),['completion.json','owner.json']);
  assert.deepEqual(await worker.inspect(),{state:'idle',owner:null});
  await assert.rejects(worker.releaseBeforeLaunch(reserved.permit),code('INVALID_STATE'));
  const successor=await f.reserve(worker,f.binding());assert.notEqual(successor.owner.reservationId,reserved.owner.reservationId);
  await assert.rejects(worker.releaseBeforeLaunch(reserved.permit),code('INVALID_STATE'));
  assert.deepEqual(await worker.inspect(),{state:'blocked',owner:successor.owner});
  assert.equal(await readFile(path.join(slot,'completion.json'),'utf8'),canonical(completion));
});

test('foreign, copied, inherited and reopened permits never release another reservation',async t=>{
  const f=await fixture(t),worker=await f.create(),other=await f.create(),binding=f.binding(),reserved=await f.reserve(worker,binding);
  for(const permit of [null,{},'synthetic_worker',{...reserved.permit},Object.create(reserved.permit)]){
    await assert.rejects(worker.releaseBeforeLaunch(permit),code('INVALID_PERMIT'));
    await assert.rejects(worker.confirmTermination(permit,empty()),code('INVALID_PERMIT'));
  }
  await assert.rejects(other.releaseBeforeLaunch(reserved.permit),code('INVALID_PERMIT'));
  const reopened=await f.reopen(worker,await f.openJournal());await assert.rejects(reopened.releaseBeforeLaunch(reserved.permit),code('INVALID_PERMIT'));
  assert.deepEqual(await worker.inspect(),{state:'blocked',owner:reserved.owner});assert.deepEqual(await readdir(path.join(worker.rootDirectory,'history')),[]);
});

test('arming consumes one fresh same-journal ticket, persists launch and prohibits a prelaunch release',async t=>{
  const f=await fixture(t),worker=await f.create(),binding=f.binding(),reservation=await f.reserve(worker,binding),attempt=await f.journal.reserve(binding);
  const supplied={ticket:attempt.ticket,intent:{...attempt.intent}},arming=worker.arm(reservation.permit,supplied);
  supplied.intent.attempt=3;supplied.intent.leaseNonce=id(90010);supplied.intent.attemptDirectory=f.attemptParent;
  await arming;
  assert.equal(await readFile(path.join(worker.rootDirectory,'active','launch.json'),'utf8'),canonical({owner:reservation.owner,intent:attempt.intent}));
  assert.throws(()=>f.journal.consumeLaunchTicket(attempt.ticket),code('INVALID_TICKET'));
  await assert.rejects(worker.releaseBeforeLaunch(reservation.permit),code('INVALID_STATE'));
  await assert.rejects(worker.arm(reservation.permit,attempt),code('INVALID_STATE'));
  await worker.close();const reopened=await f.reopen(worker,await f.openJournal());
  assert.deepEqual(await reopened.inspect(),{state:'blocked',owner:reservation.owner});
  await assert.rejects(reopened.confirmTermination(reservation.permit,empty()),code('INVALID_PERMIT'));
  assert.equal(await exists(path.join(worker.rootDirectory,'active','completion.json')),null);
});

test('malformed reservation descriptors and mismatched intent facts confer no launch authority',async t=>{
  const f=await fixture(t),worker=await f.create(),binding=f.binding(),reservation=await f.reserve(worker,binding),attempt=await f.journal.reserve(binding);let getters=0;
  const accessor={ticket:attempt.ticket,intent:attempt.intent};Object.defineProperty(accessor,'ticket',{enumerable:true,get(){getters++;return attempt.ticket;}});
  for(const supplied of [null,[],{...attempt,extra:true},{...attempt,[Symbol('hidden')]:true},accessor,
    {ticket:{...attempt.ticket},intent:attempt.intent},{ticket:attempt.ticket,intent:{...attempt.intent,claimId:id(90011)}},
    {ticket:attempt.ticket,intent:{...attempt.intent,attempt:4}},{ticket:attempt.ticket,intent:{...attempt.intent,attemptDirectory:f.attemptParent}}])
    await assert.rejects(worker.arm(reservation.permit,supplied),code('INVALID_INPUT'));
  assert.equal(getters,0);assert.equal(await exists(path.join(worker.rootDirectory,'active','launch.json')),null);
  // Structural rejection occurs before the live ticket is consumed. It is still
  // usable once through the exact trusted binding, never via a copied ticket.
  await worker.arm(reservation.permit,attempt);
  assert.equal(await readFile(path.join(worker.rootDirectory,'active','launch.json'),'utf8'),canonical({owner:reservation.owner,intent:attempt.intent}));
  await assert.rejects(worker.releaseBeforeLaunch(reservation.permit),code('INVALID_STATE'));
});

test('copied, foreign and already consumed journal tickets fail closed without allowing prelaunch release',async t=>{
  const f=await fixture(t);
  for(const mode of ['copy','foreign','consumed']){
    const worker=await f.create(),binding=f.binding(),reservation=await f.reserve(worker,binding);
    const using=mode==='foreign'?await f.openJournal():f.journal,attempt=await using.reserve(binding);
    const supplied=mode==='copy'?{ticket:Object.freeze({...attempt.ticket}),intent:attempt.intent}:attempt;
    if(mode==='consumed')f.journal.consumeLaunchTicket(attempt.ticket);
    await assert.rejects(worker.arm(reservation.permit,supplied),code('INVALID_STATE'));
    await assert.rejects(worker.releaseBeforeLaunch(reservation.permit),code('INVALID_STATE'));
    assert.deepEqual(await worker.inspect(),{state:'blocked',owner:reservation.owner});
    assert.equal(await exists(path.join(worker.rootDirectory,'active','completion.json')),null);
  }
});

test('simulated empty native observation commits and reads the real journal before preserving and releasing the slot',async t=>{
  const f=await fixture(t),worker=await f.create(),binding=f.binding(),{reservation,attempt}=await f.armed(worker,binding);
  const completion=await worker.confirmTermination(reservation.permit,empty());
  assert.ok(Object.isFrozen(completion)&&Object.isFrozen(completion.terminal)&&Object.isFrozen(completion.terminal.outcome));
  assert.deepEqual(completion,{owner:reservation.owner,state:'job_empty',terminal:{...attempt.intent,outcome:empty()}});
  const historical=await f.journal.inspect(binding);assert.equal(historical.state,'termination_recorded');assert.deepEqual(historical.terminal,completion.terminal);
  const slot=path.join(f.archive(worker,reservation),'slot');assert.equal(await readFile(path.join(slot,'completion.json'),'utf8'),canonical(completion));
  assert.equal(await exists(path.join(worker.rootDirectory,'active')),null);
  await assert.rejects(worker.confirmTermination(reservation.permit,empty()),code('INVALID_STATE'));
  await assert.rejects(f.journal.reserve({...binding,attempt:2,leaseNonce:id(90003)}),code('BLOCKED'));
  const next=await f.reserve(worker,f.binding());assert.deepEqual(await worker.inspect(),{state:'blocked',owner:next.owner});
  await assert.rejects(worker.confirmTermination(reservation.permit,empty()),code('INVALID_STATE'));
  assert.deepEqual(await worker.inspect(),{state:'blocked',owner:next.owner});
});

test('simulated failed, timed_out and cancelled empty-job observations release capacity without turning into success',async t=>{
  const f=await fixture(t);
  for(const state of ['failed','timed_out','cancelled']){
    const worker=await f.create(),binding=f.binding(),{reservation,attempt}=await f.armed(worker,binding);
    const observation={state,termination:'job_empty',exitCode:null,activeProcesses:0,safeCode:state.toUpperCase()};
    const completion=await worker.confirmTermination(reservation.permit,observation);
    assert.deepEqual(completion,{owner:reservation.owner,state:'job_empty',terminal:{...attempt.intent,outcome:observation}});
    assert.equal(completion.terminal.outcome.state,state);
    assert.equal(Object.hasOwn(completion,'manifest'),false);assert.equal(Object.hasOwn(completion,'verified'),false);
    const slot=path.join(f.archive(worker,reservation),'slot');
    assert.equal(await readFile(path.join(slot,'completion.json'),'utf8'),canonical(completion));
    assert.deepEqual(await worker.inspect(),{state:'idle',owner:null});
    const successor=await f.reserve(worker,f.binding());assert.deepEqual(await worker.inspect(),{state:'blocked',owner:successor.owner});
  }
});

test('simulated unknown containment remains globally blocked across reopen and cannot be upgraded or released',async t=>{
  const f=await fixture(t),worker=await f.create(),binding=f.binding(),{reservation,attempt}=await f.armed(worker,binding);
  const sentinel=path.join(attempt.intent.attemptDirectory,'owned-sentinel.txt');await writeFile(sentinel,'retained simulated unknown',{flag:'wx'});
  assert.deepEqual(await worker.confirmTermination(reservation.permit,unknown()),{state:'blocked',reason:'CONTAINMENT_UNKNOWN'});
  assert.equal((await f.journal.inspect(binding)).reason,'CONTAINMENT_UNKNOWN');
  await assert.rejects(worker.confirmTermination(reservation.permit,empty()),code('INVALID_STATE'));
  await assert.rejects(worker.releaseBeforeLaunch(reservation.permit),code('INVALID_STATE'));
  await worker.close();const reopened=await f.reopen(worker,await f.openJournal());
  assert.deepEqual(await reopened.inspect(),{state:'blocked',owner:reservation.owner});
  await assert.rejects(reopened.reserve({jobId:f.binding().jobId,claimId:id(90004)}),code('BLOCKED'));
  assert.deepEqual(await readdir(path.join(worker.rootDirectory,'history')),[]);assert.equal(await readFile(sentinel,'utf8'),'retained simulated unknown');
});

test('lost returned journal acknowledgement retains admission until explicit identical readback and never upgrades unknown',async t=>{
  const f=await fixture(t);
  for(const simulated of [empty(),unknown()]){
    let loseOnce=true;const real=await f.openJournal();
    // Fixed trusted wrapper delegates all journal persistence to real files,
    // then deliberately loses one returned acknowledgement. No crash is claimed.
    const wrapped={...real,async recordTermination(...args){const committed=await real.recordTermination(...args);
      if(loseOnce){loseOnce=false;throw new Error('Simulated lost committed-journal acknowledgement');}return committed;}};
    const worker=await f.create(wrapped),binding=f.binding(),{reservation}=await f.armed(worker,binding,wrapped);
    await assert.rejects(worker.confirmTermination(reservation.permit,simulated),code('PERSISTENCE_FAILED'));
    assert.deepEqual(await worker.inspect(),{state:'blocked',owner:reservation.owner});
    const persisted=await real.inspect(binding);assert.deepEqual(persisted.terminal.outcome,simulated);
    assert.deepEqual(await readdir(path.join(worker.rootDirectory,'history')),[]);
    const changed=simulated.state==='containment_unknown'?empty():{...empty(),safeCode:'ALTERED'};
    await assert.rejects(worker.confirmTermination(reservation.permit,changed),code('BLOCKED'));
    const recovered=await worker.confirmTermination(reservation.permit,simulated);
    if(simulated.state==='containment_unknown'){
      assert.deepEqual(recovered,{state:'blocked',reason:'CONTAINMENT_UNKNOWN'});
      await assert.rejects(worker.confirmTermination(reservation.permit,empty()),code('INVALID_STATE'));
      await assert.rejects(worker.releaseBeforeLaunch(reservation.permit),code('INVALID_STATE'));
      await worker.close();const reopened=await f.reopen(worker,await f.openJournal());
      assert.deepEqual(await reopened.inspect(),{state:'blocked',owner:reservation.owner});
      assert.deepEqual(await readdir(path.join(worker.rootDirectory,'history')),[]);
    }else{
      assert.equal(recovered.state,'job_empty');assert.deepEqual(recovered.terminal,persisted.terminal);
      assert.equal(await readFile(path.join(f.archive(worker,reservation),'slot','completion.json'),'utf8'),canonical(recovered));
      assert.deepEqual(await worker.inspect(),{state:'idle',owner:null});
    }
  }
});

test('strict reserve and outcome inputs reject unknown properties, symbols and accessors without invoking getters',async t=>{
  const f=await fixture(t),worker=await f.create(),binding=f.binding();let getters=0;
  const input={jobId:binding.jobId,claimId:binding.claimId},accessor={...input};Object.defineProperty(accessor,'jobId',{enumerable:true,get(){getters++;return binding.jobId;}});
  for(const value of [null,[],binding.jobId,{...input,jobId:'../outside'},{...input,claimId:null},{...input,attempt:1},{...input,[Symbol('hidden')]:true},accessor])
    await assert.rejects(worker.reserve(value),code('INVALID_INPUT'));
  assert.equal(getters,0);assert.deepEqual(await worker.inspect(),{state:'idle',owner:null});
  const {reservation}=await f.armed(worker,binding),outcome=empty();Object.defineProperty(outcome,'safeCode',{enumerable:true,get(){getters++;return 'EXITED';}});
  for(const value of [null,[],{...empty(),extra:true},{...empty(),[Symbol('hidden')]:true},outcome,
    {...empty(),activeProcesses:1},{...empty(),termination:'unconfirmed'},{...empty(),exitCode:null},{...empty(),exitCode:-1},
    {...empty(),exitCode:0x100000000},{...empty(),exitCode:0.1},{...empty(),safeCode:'lowercase'},
    {...unknown(),cleanupAllowed:true},{...unknown(),activeProcesses:0}])
    await assert.rejects(worker.confirmTermination(reservation.permit,value),code('INVALID_INPUT'));
  assert.equal(getters,0);assert.equal((await f.journal.inspect(binding)).terminal,null);
  assert.equal(await exists(path.join(worker.rootDirectory,'active','completion.json')),null);
  assert.deepEqual(await readdir(path.join(worker.rootDirectory,'history')),[]);
});

test('reservation and outcome snapshots precede awaits and active I/O admits no queue while close drains',async t=>{
  const f=await fixture(t),worker=await f.create(),binding=f.binding(),input={jobId:binding.jobId,claimId:binding.claimId};
  const pending=f.reserve(worker,input);input.jobId=id(90005);input.claimId=id(90006);
  await assert.rejects(worker.inspect(),code('BUSY'));
  const reserved=await pending;assert.equal(reserved.owner.jobId,binding.jobId);assert.equal(reserved.owner.claimId,binding.claimId);
  const attempt=await f.journal.reserve(binding);await worker.arm(reserved.permit,attempt);
  const observation=empty(),confirming=worker.confirmTermination(reserved.permit,observation);observation.exitCode=7;observation.safeCode='MUTATED';
  await assert.rejects(worker.inspect(),code('BUSY'));const closing=worker.close();
  await assert.rejects(worker.reserve({jobId:f.binding().jobId,claimId:id(90007)}),code('CLOSED'));
  const completion=await confirming;await closing;await worker.close();assert.deepEqual(completion.terminal.outcome,empty());
  await assert.rejects(worker.inspect(),code('CLOSED'));
  // Admission owns no journal lifecycle: its caller can still read the record.
  assert.deepEqual((await f.journal.inspect(binding)).terminal,completion.terminal);
  const reopened=await f.reopen(worker,await f.openJournal());assert.deepEqual(await reopened.inspect(),{state:'idle',owner:null});
});

test('existing archive envelope refuses replacement and permanently consumes the releasing permit',async t=>{
  const f=await fixture(t),worker=await f.create(),reservation=await f.reserve(worker,f.binding()),envelope=f.archive(worker,reservation);
  await mkdir(envelope);const sentinel=path.join(envelope,'owned-sentinel.txt');await writeFile(sentinel,'must not overwrite',{flag:'wx'});
  await assert.rejects(worker.releaseBeforeLaunch(reservation.permit),code('BLOCKED'));
  assert.equal(await readFile(sentinel,'utf8'),'must not overwrite');assert.equal(await exists(path.join(envelope,'slot')),null);
  assert.deepEqual(await worker.inspect(),{state:'blocked',owner:reservation.owner});
  await assert.rejects(worker.releaseBeforeLaunch(reservation.permit),code('INVALID_STATE'));
  // Removing a known fixture collision does not restore the consumed permit.
  await unlink(sentinel);await rmdir(envelope);
  await assert.rejects(worker.releaseBeforeLaunch(reservation.permit),code('INVALID_STATE'));
  assert.deepEqual(await worker.inspect(),{state:'blocked',owner:reservation.owner});
});

test('marker corruption and wrong expected identity fail integrity checks without clearing a reservation',async t=>{
  const f=await fixture(t),worker=await f.create(),reservation=await f.reserve(worker,f.binding()),marker=path.join(worker.rootDirectory,'worker.json'),original=await readFile(marker);
  await assert.rejects(reopenSyntheticWorkerAdmission({rootDirectory:worker.rootDirectory,workerId:id(90008),journal:f.journal}),code('INTEGRITY'));
  await writeFile(marker,Buffer.from(' '+original.toString('utf8')));
  await assert.rejects(worker.inspect(),code('INTEGRITY'));
  await assert.rejects(worker.releaseBeforeLaunch(reservation.permit),code('INTEGRITY'));
  await writeFile(marker,original);
  // Restoring bytes cannot restore this live file snapshot's original mtime.
  await assert.rejects(worker.inspect(),code('INTEGRITY'));
  const reopened=await f.reopen(worker,await f.openJournal());
  assert.deepEqual(await reopened.inspect(),{state:'blocked',owner:reservation.owner});
  assert.deepEqual(await readdir(path.join(worker.rootDirectory,'history')),[]);
});

test('configuration descriptors and bounded canonical owner records reject malformed facts without invoking getters',async t=>{
  const f=await fixture(t);let getters=0;
  const valid={parentDirectory:f.workerParent,journal:f.journal},accessor={...valid};
  Object.defineProperty(accessor,'parentDirectory',{enumerable:true,get(){getters++;return f.workerParent;}});
  for(const value of [null,[],{...valid,parentDirectory:'relative-parent'},{...valid,parentDirectory:path.join(f.parent,'missing')},
    {...valid,extra:true},{...valid,[Symbol('hidden')]:true},accessor])
    await assert.rejects(createSyntheticWorkerAdmission(value),code('INVALID_CONFIGURATION'));
  assert.equal(getters,0);assert.deepEqual(await readdir(f.workerParent),[]);
  const worker=await f.create(),reservation=await f.reserve(worker,f.binding()),location=path.join(worker.rootDirectory,'active','owner.json');
  const original=await readFile(location);
  const malformed=[Buffer.alloc(0),Buffer.alloc(4097,32),Buffer.from(original.toString('utf8').trimEnd()),
    Buffer.from(' '+original.toString('utf8')),Buffer.from(original.toString('utf8').replace('"version":1','"version":1,"version":1')),
    Buffer.from(canonical({...reservation.owner,claimId:id(90009),extra:true}))];
  for(const bytes of malformed){
    await writeFile(location,bytes);await assert.rejects(worker.inspect(),code('INTEGRITY'));
    assert.deepEqual(await readdir(path.join(worker.rootDirectory,'history')),[]);
  }
  await writeFile(location,original);
  const reopened=await f.reopen(worker,await f.openJournal());assert.deepEqual(await reopened.inspect(),{state:'blocked',owner:reservation.owner});
  await assert.rejects(reopened.releaseBeforeLaunch(reservation.permit),code('INVALID_PERMIT'));
});

test('live active identity replacement cannot move a successor or turn preserved owner bytes into a permit',async t=>{
  const f=await fixture(t),worker=await f.create(),reservation=await f.reserve(worker,f.binding()),active=path.join(worker.rootDirectory,'active');
  const preserved=path.join(f.archive(worker,reservation),'slot');await mkdir(f.archive(worker,reservation));await rename(active,preserved);
  await mkdir(active);await writeFile(path.join(active,'owner.json'),canonical(reservation.owner),{flag:'wx'});
  await assert.rejects(worker.releaseBeforeLaunch(reservation.permit),code('INTEGRITY'));
  assert.equal(await exists(path.join(active,'completion.json')),null);
  assert.equal(await readFile(path.join(active,'owner.json'),'utf8'),canonical(reservation.owner));
  const reopened=await f.reopen(worker,await f.openJournal());assert.deepEqual(await reopened.inspect(),{state:'blocked',owner:reservation.owner});
  await assert.rejects(reopened.releaseBeforeLaunch(reservation.permit),code('INVALID_PERMIT'));
  assert.equal(await readFile(path.join(preserved,'owner.json'),'utf8'),canonical(reservation.owner));
});
