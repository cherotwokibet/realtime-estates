import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDurableSyntheticStore, reopenDurableSyntheticStore } from '../dist/durable-store.js';
import { createSyntheticAttemptJournal } from '../dist/attempt-journal.js';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const code=expected=>error=>error?.code===expected;
const json=value=>Buffer.from(JSON.stringify(value)+'\n');
let sequence=1;
// These ordinary objects simulate supervisor observations. They are not native
// process receipts; this file starts no decoder and proves no OS termination.
const empty=()=>({state:'exited',termination:'job_empty',exitCode:0,activeProcesses:0,safeCode:'EXITED'});
const unknown=()=>({state:'containment_unknown',termination:'unconfirmed',cleanupAllowed:false,safeCode:'PROTOCOL_INVALID'});
const ref=(binding,kind)=>({jobId:binding.jobId,objectId:binding.claimId,generationId:binding.leaseNonce,kind});
async function exists(location){try{return await lstat(location);}catch(error){if(error.code==='ENOENT')return null;throw error;}}

async function fixture(t){
  const parent=await mkdtemp(path.join(os.tmpdir(),'realtor-attempt-journal-'));
  const store=await createDurableSyntheticStore(parent),root=store.rootDirectory;
  const attemptParent=path.join(parent,'attempts');await mkdir(attemptParent);
  const stores=new Set([store]),journals=new Set(),jobs=new Set(),attemptParents=new Set([attemptParent]),attemptDirectories=new Set();
  t.after(async()=>{
    for(const journal of journals)await journal.close();
    for(const opened of stores)await opened.close();
    assert.equal(path.dirname(root),parent);
    assert.ok((await lstat(root)).isDirectory()&&!(await lstat(root)).isSymbolicLink());
    assert.deepEqual((await readdir(root)).sort(),['objects','store.json']);
    const objects=path.join(root,'objects');
    assert.ok((await lstat(objects)).isDirectory()&&!(await lstat(objects)).isSymbolicLink());
    for(const name of await readdir(objects))assert.ok(jobs.has(name),`Unknown journal job retained: ${name}`);
    for(const jobId of jobs){
      const job=path.join(objects,jobId),stat=await exists(job);if(!stat)continue;
      assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());
      for(const kind of await readdir(job)){
        assert.ok(['quarantine','output'].includes(kind));const directory=path.join(job,kind),s=await lstat(directory);
        assert.ok(s.isDirectory()&&!s.isSymbolicLink());
        for(const name of await readdir(directory)){
          assert.ok(['data.bin','receipt.json'].includes(name));const file=path.join(directory,name),f=await lstat(file);
          assert.ok(f.isFile()&&!f.isSymbolicLink()&&f.nlink===1);await unlink(file);
        }
        await rmdir(directory);
      }
      await rmdir(job);
    }
    await rmdir(objects);
    const marker=path.join(root,'store.json'),markerStat=await lstat(marker);
    assert.ok(markerStat.isFile()&&!markerStat.isSymbolicLink()&&markerStat.nlink===1);await unlink(marker);await rmdir(root);
    for(const directory of attemptDirectories){
      const stat=await exists(directory);if(!stat)continue;
      assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());
      for(const name of await readdir(directory)){
        assert.equal(name,'owned-sentinel.txt');const file=path.join(directory,name),s=await lstat(file);
        assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1);await unlink(file);
      }
      await rmdir(directory);
    }
    for(const directory of attemptParents){assert.deepEqual(await readdir(directory),[]);await rmdir(directory);}
    assert.deepEqual(await readdir(parent),[]);await rmdir(parent);
  });
  function binding(){const n=sequence++;const value={jobId:id(n),claimId:id(10000+n),attempt:1,leaseNonce:id(20000+n)};jobs.add(value.jobId);return value;}
  function attemptPath(value,where=attemptParent){const location=path.join(where,value.jobId.toLowerCase());attemptDirectories.add(location);return location;}
  function intent(value,where=attemptParent){return {version:1,journalId:store.storeId,...value,attemptDirectory:attemptPath(value,where)};}
  return {parent,root,store,attemptParent,jobs,binding,attemptPath,intent,
    async open(where=attemptParent,existing=undefined){
      const opened=existing??await reopenDurableSyntheticStore(root,store.storeId);stores.add(opened);
      const journal=await createSyntheticAttemptJournal({store:opened,attemptParent:where});journals.add(journal);return journal;
    },
    async secondParent(){const where=path.join(parent,`attempts-${attemptParents.size+1}`);await mkdir(where);attemptParents.add(where);return where;},
    async seed(value,intentBytes,terminalBytes){
      await mkdir(attemptPath(value));
      await store.install(ref(value,'quarantine'),intentBytes);
      if(terminalBytes)await store.install(ref(value,'output'),terminalBytes);
    },
    trackAttempt(location){attemptDirectories.add(location);},
  };
}

test('fresh reservation commits exact intent, issues one opaque ticket and remains unconfirmed before observation',async t=>{
  const f=await fixture(t),binding=f.binding(),journal=await f.open();
  assert.deepEqual(await journal.inspect(binding),{state:'blocked',reason:'UNCONFIRMED',intent:null,terminal:null});
  const reserved=await journal.reserve(binding);f.attemptPath(binding);
  assert.ok(Object.isFrozen(reserved)&&Object.isFrozen(reserved.ticket)&&Object.isFrozen(reserved.intent));
  assert.deepEqual(reserved.ticket,{kind:'synthetic_attempt'});assert.deepEqual(reserved.intent,f.intent(binding));
  assert.ok((await lstat(reserved.intent.attemptDirectory)).isDirectory());
  assert.deepEqual((await f.store.read(ref(binding,'quarantine'))).data,json(reserved.intent));
  assert.deepEqual(await journal.inspect(binding),{state:'blocked',reason:'UNCONFIRMED',intent:reserved.intent,terminal:null});
  await assert.rejects(journal.reserve(binding),code('BLOCKED'));
  assert.deepEqual(await readdir(reserved.intent.attemptDirectory),[]);
});

test('simulated empty-job observation is immutable and restart inspection supplies readback without a launch ticket',async t=>{
  const f=await fixture(t),binding=f.binding(),journal=await f.open(),reserved=await journal.reserve(binding);f.attemptPath(binding);
  const terminal=await journal.recordTermination(reserved.ticket,empty());
  assert.ok(Object.isFrozen(terminal)&&Object.isFrozen(terminal.outcome));
  assert.deepEqual(terminal,{...reserved.intent,outcome:empty()});
  assert.deepEqual(await journal.recordTermination(reserved.ticket,empty()),terminal);
  await assert.rejects(journal.recordTermination(reserved.ticket,{...empty(),safeCode:'ALTERED'}),code('BLOCKED'));
  await journal.close();const reopened=await f.open();
  const result=await reopened.inspect(binding);
  assert.deepEqual(result,{state:'termination_recorded',reason:null,intent:reserved.intent,terminal});
  assert.equal(Object.hasOwn(result,'ticket'),false);assert.equal(Object.hasOwn(result.terminal,'ticket'),false);
  await assert.rejects(reopened.reserve(binding),code('BLOCKED'));
  await assert.rejects(reopened.recordTermination(reserved.ticket,empty()),code('INVALID_TICKET'));
  assert.deepEqual((await f.store.read(ref(binding,'output'))).data,json(terminal));
});

test('simulated unknown containment stays blocked across reopen and cannot be upgraded to empty',async t=>{
  const f=await fixture(t),binding=f.binding(),journal=await f.open(),reserved=await journal.reserve(binding);f.attemptPath(binding);
  await writeFile(path.join(reserved.intent.attemptDirectory,'owned-sentinel.txt'),'retained unknown attempt',{flag:'wx'});
  const terminal=await journal.recordTermination(reserved.ticket,unknown());
  assert.deepEqual(await journal.recordTermination(reserved.ticket,unknown()),terminal);
  await assert.rejects(journal.recordTermination(reserved.ticket,empty()),code('BLOCKED'));
  await journal.close();const reopened=await f.open();
  assert.deepEqual(await reopened.inspect(binding),{state:'blocked',reason:'CONTAINMENT_UNKNOWN',intent:reserved.intent,terminal});
  await assert.rejects(reopened.reserve({...binding,attempt:2,leaseNonce:id(90001)}),code('BLOCKED'));
  assert.equal(await readFile(path.join(reserved.intent.attemptDirectory,'owned-sentinel.txt'),'utf8'),'retained unknown attempt');
});

test('deleted empty attempt directory cannot turn a historical intent into a fresh ticket',async t=>{
  const f=await fixture(t),binding=f.binding(),journal=await f.open(),reserved=await journal.reserve(binding);f.attemptPath(binding);
  // Deliberate fixture tamper, with no decoder ever started.
  assert.deepEqual(await readdir(reserved.intent.attemptDirectory),[]);await rmdir(reserved.intent.attemptDirectory);
  await journal.close();const reopened=await f.open();
  await assert.rejects(reopened.reserve(binding),code('BLOCKED'));
  assert.equal(await exists(reserved.intent.attemptDirectory),null);
  assert.deepEqual((await f.store.read(ref(binding,'quarantine'))).data,json(reserved.intent));
});

test('empty journal reservation and failed second directory reservation remain permanently blocked',async t=>{
  const f=await fixture(t),journal=await f.open();
  const first=f.binding(),job=path.join(f.root,'objects',first.jobId);await mkdir(job);
  await assert.rejects(journal.reserve(first),code('BLOCKED'));
  assert.equal(await exists(f.attemptPath(first)),null);assert.deepEqual(await readdir(job),[]);
  const second=f.binding(),directory=f.attemptPath(second);await mkdir(directory);
  await assert.rejects(journal.reserve(second),code('BLOCKED'));
  const retained=path.join(f.root,'objects',second.jobId);assert.deepEqual(await readdir(retained),[]);
  await rmdir(directory);await journal.close();const reopened=await f.open();
  await assert.rejects(reopened.reserve(second),code('BLOCKED'));
  assert.equal(await exists(directory),null);assert.deepEqual(await readdir(retained),[]);
});

test('simulated lost persistence acknowledgements retain intent or unknown terminal without issuing fresh authority',async t=>{
  const f=await fixture(t);
  for(const phase of ['quarantine','output']){
    const underlying=await reopenDurableSyntheticStore(f.root,f.store.storeId);let loseOnce=true;
    // The fixed fixture delegates every byte operation to real storage and only
    // loses one response afterwards. This is not an actual process/disk crash.
    const storage={storeId:underlying.storeId,rootDirectory:underlying.rootDirectory,
      async install(reference,bytes){const result=await underlying.install(reference,bytes);
        if(loseOnce&&reference.kind===phase){loseOnce=false;throw new Error('Simulated lost storage acknowledgement');}return result;},
      read:reference=>underlying.read(reference),close:()=>underlying.close()};
    const binding=f.binding(),journal=await f.open(f.attemptParent,storage);f.attemptPath(binding);
    if(phase==='quarantine'){
      await assert.rejects(journal.reserve(binding),code('PERSISTENCE_FAILED'));
      const result=await journal.inspect(binding);assert.equal(result.state,'blocked');assert.equal(result.reason,'UNCONFIRMED');
      assert.deepEqual(result.intent,f.intent(binding));assert.equal(Object.hasOwn(result,'ticket'),false);
    }else{
      const reservation=await journal.reserve(binding);
      await assert.rejects(journal.recordTermination(reservation.ticket,unknown()),code('PERSISTENCE_FAILED'));
      assert.equal((await journal.inspect(binding)).reason,'CONTAINMENT_UNKNOWN');
      const recovered=await journal.recordTermination(reservation.ticket,unknown());assert.deepEqual(recovered.outcome,unknown());
      await assert.rejects(journal.recordTermination(reservation.ticket,empty()),code('BLOCKED'));
    }
    await journal.close();const reopened=await f.open();
    const result=await reopened.inspect(binding);assert.equal(result.state,'blocked');
    assert.equal(result.reason,phase==='quarantine'?'UNCONFIRMED':'CONTAINMENT_UNKNOWN');
    await assert.rejects(reopened.reserve(binding),code('BLOCKED'));
    assert.ok((await lstat(f.attemptPath(binding))).isDirectory());
  }
});

test('independent instances with different attempt parents and binding facts reserve one job only once',async t=>{
  const f=await fixture(t),binding=f.binding(),otherParent=await f.secondParent();
  const one=await f.open(),two=await f.open(otherParent),changed={...binding,claimId:id(91001),attempt:2,leaseNonce:id(91002)};
  f.attemptPath(binding);f.attemptPath(changed,otherParent);
  const results=await Promise.allSettled([one.reserve(binding),two.reserve(changed)]);
  assert.equal(results.filter(value=>value.status==='fulfilled').length,1);
  const failure=results.find(value=>value.status==='rejected');
  // A contender can see the other intent's partial bytes or different trusted
  // parent binding. Neither BLOCKED nor INTEGRITY supplies a second ticket.
  const refused=error=>['BLOCKED','INTEGRITY'].includes(error?.code);assert.ok(refused(failure.reason));
  const winner=results.find(value=>value.status==='fulfilled').value;
  assert.ok(Object.isFrozen(winner.ticket));
  assert.equal((await exists(f.attemptPath(binding)))!==null,results[0].status==='fulfilled');
  assert.equal((await exists(f.attemptPath(changed,otherParent)))!==null,results[1].status==='fulfilled');
  await assert.rejects(one.reserve(binding),refused);await assert.rejects(two.reserve(changed),refused);
});

test('forged and copied tickets, unknown binding properties and accessors confer no authority',async t=>{
  const f=await fixture(t),binding=f.binding(),journal=await f.open();let getterCalls=0;
  const accessor={...binding};Object.defineProperty(accessor,'jobId',{enumerable:true,get(){getterCalls++;return binding.jobId;}});
  const invalid=[null,[],binding.jobId,{...binding,jobId:'../outside'},{...binding,claimId:'invalid'},{...binding,leaseNonce:null},
    {...binding,attempt:0},{...binding,attempt:4},{...binding,attempt:1.1},{...binding,attempt:'1'},
    {...binding,attempt:NaN},{...binding,extra:true},{...binding,[Symbol('hidden')]:true},accessor];
  for(const value of invalid){await assert.rejects(journal.reserve(value),code('INVALID_BINDING'));await assert.rejects(journal.inspect(value),code('INVALID_BINDING'));}
  assert.equal(getterCalls,0);assert.deepEqual(await readdir(path.join(f.root,'objects')),[]);
  const reserved=await journal.reserve(binding);f.attemptPath(binding);
  for(const ticket of [null,{},'synthetic_attempt',{...reserved.ticket},Object.create(reserved.ticket)])
    await assert.rejects(journal.recordTermination(ticket,empty()),code('INVALID_TICKET'));
  assert.deepEqual(await readdir(path.join(f.root,'objects',binding.jobId)),['quarantine']);
});

test('outcome union rejects malformed observations before committing a terminal',async t=>{
  const f=await fixture(t),binding=f.binding(),journal=await f.open(),reserved=await journal.reserve(binding);f.attemptPath(binding);let getters=0;
  const accessor={...empty()};Object.defineProperty(accessor,'safeCode',{enumerable:true,get(){getters++;return 'EXITED';}});
  const invalid=[null,[],{...empty(),extra:true},{...empty(),[Symbol('hidden')]:true},accessor,
    {...empty(),activeProcesses:1},{...empty(),activeProcesses:null},{...empty(),termination:'unconfirmed'},
    {...empty(),exitCode:null},{...empty(),exitCode:-1},{...empty(),exitCode:0x100000000},{...empty(),exitCode:0.1},
    {...empty(),safeCode:'lowercase'},{...empty(),safeCode:'A'.repeat(65)},{...unknown(),cleanupAllowed:true},
    {...unknown(),activeProcesses:0},{...unknown(),state:'exited'}];
  for(const value of invalid)await assert.rejects(journal.recordTermination(reserved.ticket,value),code('INVALID_OUTCOME'));
  assert.equal(getters,0);assert.equal(await exists(path.join(f.root,'objects',binding.jobId,'output')),null);
  const upper={...empty(),exitCode:0xffffffff,safeCode:'A'.repeat(64)};
  assert.deepEqual((await journal.recordTermination(reserved.ticket,upper)).outcome,upper);
});

test('binding/outcome snapshots precede awaits, journal admission has no queue and close drains its active operation',async t=>{
  const f=await fixture(t),binding=f.binding(),original={...binding},other=f.binding(),journal=await f.open();
  const pending=journal.reserve(binding);binding.claimId=id(92001);binding.leaseNonce=id(92002);binding.attempt=3;
  f.attemptPath(original);
  await assert.rejects(journal.reserve(other),code('BUSY'));
  const reserved=await pending;assert.deepEqual(reserved.intent,f.intent(original));
  const observation=empty(),recording=journal.recordTermination(reserved.ticket,observation);observation.safeCode='MUTATED';observation.exitCode=9;
  await assert.rejects(journal.inspect(original),code('BUSY'));
  const closing=journal.close();
  await assert.rejects(journal.reserve(other),code('CLOSED'));
  const terminal=await recording;await closing;await journal.close();assert.deepEqual(terminal.outcome,empty());
  await assert.rejects(journal.inspect(original),code('CLOSED'));
  const reopened=await f.open();assert.deepEqual((await reopened.inspect(original)).terminal,terminal);
  assert.equal(await exists(f.attemptPath(other)),null);
});

test('valid storage receipts carrying noncanonical or mismatched intent bytes do not become journal authority',async t=>{
  const f=await fixture(t),cases=[];
  const mutations=[value=>Buffer.from(JSON.stringify(value)),value=>Buffer.from(' '+JSON.stringify(value)+'\n'),
    value=>Buffer.from(JSON.stringify(value).replace('"version":1','"version":1,"version":1')+'\n'),
    value=>Buffer.from(JSON.stringify(value).replace('"attempt":1','"attempt":1.0')+'\n'),
    value=>json({...value,journalId:id(93001)}),value=>json({...value,claimId:id(93002)}),
    value=>json({...value,attempt:4}),value=>json({...value,attemptDirectory:path.dirname(value.attemptDirectory)}),
    value=>json({...value,extra:true}),()=>Buffer.alloc(4097,32)];
  for(const mutate of mutations){const binding=f.binding(),bytes=mutate(f.intent(binding));await f.seed(binding,bytes);cases.push({binding,bytes});}
  const journal=await f.open();
  for(const {binding,bytes} of cases){
    assert.deepEqual((await f.store.read(ref(binding,'quarantine'))).data,bytes); // Generic storage integrity is valid.
    await assert.rejects(journal.inspect(binding),code('INTEGRITY'));
    await assert.rejects(journal.reserve(binding),code('INTEGRITY'));
    assert.deepEqual((await f.store.read(ref(binding,'quarantine'))).data,bytes);
  }
});

test('valid storage receipts with malformed terminal observations remain integrity failures',async t=>{
  const f=await fixture(t),cases=[];
  const mutations=[value=>json({...value,outcome:{...empty(),activeProcesses:1}}),
    value=>json({...value,outcome:{...unknown(),cleanupAllowed:true}}),
    value=>json({...value,leaseNonce:id(94001)}),value=>json({...value,attempt:2}),
    value=>Buffer.from(JSON.stringify(value).replace('"exitCode":0','"exitCode":0e0')+'\n')];
  for(const mutate of mutations){const binding=f.binding(),intent=f.intent(binding),bytes=mutate({...intent,outcome:empty()});await f.seed(binding,json(intent),bytes);cases.push({binding,bytes});}
  const journal=await f.open();
  for(const {binding,bytes} of cases){
    assert.deepEqual((await f.store.read(ref(binding,'output'))).data,bytes);
    await assert.rejects(journal.inspect(binding),code('INTEGRITY'));
    assert.deepEqual((await f.store.read(ref(binding,'output'))).data,bytes);
  }
});

test('live directory replacement refuses a recorded observation and missing terminal receipt stays blocked',async t=>{
  const f=await fixture(t),binding=f.binding(),journal=await f.open(),reserved=await journal.reserve(binding),directory=f.attemptPath(binding);
  const held=directory+'-held';await rename(directory,held);f.trackAttempt(held);await mkdir(directory);
  await assert.rejects(journal.recordTermination(reserved.ticket,empty()),code('INTEGRITY'));
  assert.equal(await exists(path.join(f.root,'objects',binding.jobId,'output')),null);
  assert.deepEqual(await readdir(directory),[]);assert.deepEqual(await readdir(held),[]);
  // Manual partial terminal fixture, not a reproduced process/storage crash.
  const partial=path.join(f.root,'objects',binding.jobId,'output');await mkdir(partial);
  await writeFile(path.join(partial,'data.bin'),'partial terminal bytes',{flag:'wx'});
  const reopened=await f.open();
  assert.deepEqual(await reopened.inspect(binding),{state:'blocked',reason:'UNCONFIRMED',intent:reserved.intent,terminal:null});
  assert.equal(await readFile(path.join(partial,'data.bin'),'utf8'),'partial terminal bytes');
});

test('journal requires a separate existing trusted attempt parent',async t=>{
  const f=await fixture(t);
  for(const attemptParent of ['relative',path.join(f.parent,'missing'),f.root,path.join(f.root,'objects'),f.parent])
    await assert.rejects(createSyntheticAttemptJournal({store:f.store,attemptParent}),code('INVALID_CONFIGURATION'));
  const file=path.join(f.parent,'owned-file-parent');await writeFile(file,'not a directory',{flag:'wx'});
  try{await assert.rejects(createSyntheticAttemptJournal({store:f.store,attemptParent:file}),code('INVALID_CONFIGURATION'));}
  finally{await unlink(file);}
});

test('launch consumption requires a fresh same-instance ticket and never revives observed or historical attempts',async t=>{
  const f=await fixture(t),journal=await f.open(),value=f.binding(),reserved=await journal.reserve(value);f.attemptPath(value);
  assert.throws(()=>journal.consumeLaunchTicket({...reserved.ticket}),code('INVALID_TICKET'));
  assert.deepEqual(journal.consumeLaunchTicket(reserved.ticket),reserved.intent);
  assert.throws(()=>journal.consumeLaunchTicket(reserved.ticket),code('INVALID_TICKET'));
  const terminal=await journal.recordTermination(reserved.ticket,empty());
  assert.deepEqual(terminal.outcome,empty());
  const second=f.binding(),observed=await journal.reserve(second);f.attemptPath(second);
  await journal.recordTermination(observed.ticket,unknown());
  assert.throws(()=>journal.consumeLaunchTicket(observed.ticket),code('INVALID_TICKET'));
  const third=f.binding(),pending=journal.reserve(third);f.attemptPath(third);
  assert.throws(()=>journal.consumeLaunchTicket(reserved.ticket),code('BUSY'));
  const final=await pending;await journal.close();
  assert.throws(()=>journal.consumeLaunchTicket(final.ticket),code('CLOSED'));
  const reopened=await f.open();
  assert.throws(()=>reopened.consumeLaunchTicket(final.ticket),code('INVALID_TICKET'));
  assert.deepEqual((await reopened.inspect(value)).terminal,terminal);
});
