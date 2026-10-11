import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {getEventListeners} from 'node:events';
import vm from 'node:vm';
import test from 'node:test';
import {readSyntheticUploadBody,SyntheticUploadBodyError} from '../dist/upload-body.js';

const CAP=10*1024*1024;
const code=expected=>error=>error instanceof SyntheticUploadBodyError&&error.code===expected;
async function* chunks(...values){yield* values;}
async function timely(promise){
  let timer;try{return await Promise.race([promise,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Body reader did not settle.')),2000);})]);}
  finally{clearTimeout(timer);}
}
function blocked(){
  let resolve,reject,started,calls=0,returns=0;
  const waiting=new Promise(ready=>{started=ready;}),pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const source={
    [Symbol.asyncIterator](){return this;},
    next(){calls++;started();return pending;},
    return(){returns++;return new Promise(()=>{});},
  };
  return {source,waiting,resolve,reject,get calls(){return calls;},get returns(){return returns;}};
}
function observed(){
  let factories=0,pulls=0;
  return {source:{[Symbol.asyncIterator](){factories++;return{async next(){pulls++;return{done:true};}};}},get factories(){return factories;},get pulls(){return pulls;}};
}

test('collects exact yielded views, ordinary buffers and cross-realm Uint8Array bytes',async()=>{
  const backing=Buffer.from('prefixPAYLOADsuffix'),view=new Uint8Array(backing.buffer,backing.byteOffset+6,7);
  const foreign=vm.runInNewContext('new Uint8Array([1,2,3])');
  const result=await readSyntheticUploadBody(chunks(view,Buffer.from('!'),foreign),{declaredBytes:11});
  assert.ok(Buffer.isBuffer(result));assert.deepEqual(result,Buffer.concat([Buffer.from('PAYLOAD!'),Buffer.from([1,2,3])]));
  backing.fill(0);foreign.fill(9);assert.deepEqual(result,Buffer.concat([Buffer.from('PAYLOAD!'),Buffer.from([1,2,3])]));
});

test('snapshots each chunk before asking for more and returns no caller-backed memory',async()=>{
  const input=Buffer.from('first'),second=Buffer.from('second');let pulls=0;
  const source={
    [Symbol.asyncIterator](){return this;},
    async next(){
      if(++pulls===1)return{done:false,value:input};
      if(pulls===2){input.fill(0);return{done:false,value:second};}
      second.fill(0);return{done:true};
    },
  };
  const result=await readSyntheticUploadBody(source);assert.equal(result.toString(),'firstsecond');
});

test('one-byte and exact ten-MiB inputs pass with or without a declared length',async()=>{
  assert.deepEqual(await readSyntheticUploadBody(chunks(new Uint8Array([7]))),Buffer.from([7]));
  const maximum=Buffer.alloc(CAP,23),result=await readSyntheticUploadBody(chunks(maximum.subarray(0,123),maximum.subarray(123)),{declaredBytes:CAP});
  assert.equal(result.length,CAP);assert.ok(result.equals(maximum));maximum.fill(0);assert.equal(result[CAP-1],23);
});

test('actual overflow is refused even without Content-Length and stops further pulls',async()=>{
  let pulls=0,returns=0;
  const source={
    [Symbol.asyncIterator](){return this;},
    async next(){pulls++;return{done:false,value:pulls===1?Buffer.alloc(CAP):Buffer.from([1])};},
    async return(){returns++;return{done:true};},
  };
  await assert.rejects(()=>readSyntheticUploadBody(source),code('INPUT_TOO_LARGE'));assert.equal(pulls,2);assert.equal(returns,1);
  await assert.rejects(()=>readSyntheticUploadBody(chunks(Buffer.alloc(CAP+1))),code('INPUT_TOO_LARGE'));
});

test('declared length is exact and empty streams are never accepted',async()=>{
  await assert.rejects(()=>readSyntheticUploadBody(chunks(Buffer.from('ab')),{declaredBytes:3}),code('LENGTH_MISMATCH'));
  await assert.rejects(()=>readSyntheticUploadBody(chunks(Buffer.from('abcd')),{declaredBytes:3}),code('LENGTH_MISMATCH'));
  await assert.rejects(()=>readSyntheticUploadBody(chunks()),code('EMPTY_INPUT'));
  await assert.rejects(()=>readSyntheticUploadBody(chunks(new Uint8Array(0))),code('EMPTY_INPUT'));
  assert.equal((await readSyntheticUploadBody(chunks(new Uint8Array(0),Buffer.from('x'),new Uint8Array(0)))).toString(),'x');
});

test('invalid and oversized declared lengths and timeout values are rejected before iterator admission',async()=>{
  for(const declaredBytes of [0,-1,1.5,'3',null,Infinity,NaN,Number.MAX_SAFE_INTEGER+1]){
    const probe=observed();await assert.rejects(()=>readSyntheticUploadBody(probe.source,{declaredBytes}),code('INVALID_INPUT'));assert.equal(probe.factories,0);assert.equal(probe.pulls,0);
  }
  const large=observed();await assert.rejects(()=>readSyntheticUploadBody(large.source,{declaredBytes:CAP+1}),code('INPUT_TOO_LARGE'));assert.equal(large.factories,0);
  for(const timeoutMs of [0,-1,0.5,30001,'100',null,Infinity,NaN]){
    const probe=observed();await assert.rejects(()=>readSyntheticUploadBody(probe.source,{timeoutMs}),code('INVALID_INPUT'));assert.equal(probe.factories,0);
  }
  assert.equal((await readSyntheticUploadBody(chunks(Buffer.from('x')),{timeoutMs:30000})).toString(),'x');
});

test('options reject unknown, symbol, hidden, inherited, accessor and proxy traps without invoking getters',async()=>{
  let reads=0;const accessor={};Object.defineProperty(accessor,'declaredBytes',{enumerable:true,get(){reads++;return 1;}});
  const hidden={};Object.defineProperty(hidden,'timeoutMs',{value:100,enumerable:false});
  const proxy=new Proxy({timeoutMs:100},{ownKeys(){reads++;throw new Error('trap');},getPrototypeOf(){reads++;throw new Error('trap');}});
  for(const options of [null,[],1,{extra:true},{[Symbol('extra')]:1},Object.create({timeoutMs:100}),accessor,hidden,proxy]){
    const probe=observed();await assert.rejects(()=>readSyntheticUploadBody(probe.source,options),code('INVALID_INPUT'));assert.equal(probe.factories,0);
  }
  assert.equal(reads,0);
  assert.equal((await readSyntheticUploadBody(chunks(Buffer.from('x')),Object.assign(Object.create(null),{declaredBytes:1}))).toString(),'x');
});

test('pre-aborted signals do not inspect or create an iterator and use the native signal getter',async()=>{
  const controller=new AbortController();controller.abort();let inspections=0;
  const source={get [Symbol.asyncIterator](){inspections++;throw new Error('must not inspect');}};
  Object.defineProperty(controller.signal,'aborted',{get(){throw new Error('overridden getter');}});
  await assert.rejects(()=>readSyntheticUploadBody(source,{signal:controller.signal}),code('ABORTED'));assert.equal(inspections,0);
  for(const signal of [{aborted:false},null,new Proxy(new AbortController().signal,{})]){
    const probe=observed();await assert.rejects(()=>readSyntheticUploadBody(probe.source,{signal}),code('INVALID_INPUT'));assert.equal(probe.factories,0);
  }
});

test('abort interrupts a blocked next, requests noncooperative return once and handles late rejection',async()=>{
  const controller=new AbortController(),producer=blocked();
  const pending=readSyntheticUploadBody(producer.source,{signal:controller.signal});await producer.waiting;
  assert.equal(getEventListeners(controller.signal,'abort').length,1);controller.abort();
  await assert.rejects(()=>timely(pending),code('ABORTED'));assert.equal(producer.calls,1);assert.equal(producer.returns,1);
  assert.equal(getEventListeners(controller.signal,'abort').length,0);
  producer.reject(new Error('late next failure'));await new Promise(resolve=>setImmediate(resolve));
});

test('deadline interrupts a stalled next and ignores its later completion',async()=>{
  const producer=blocked();await assert.rejects(()=>timely(readSyntheticUploadBody(producer.source,{timeoutMs:20})),code('TIMED_OUT'));
  assert.equal(producer.calls,1);assert.equal(producer.returns,1);producer.resolve({done:false,value:Buffer.from('too late')});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(producer.calls,1);
});

test('deadline spans the entire stream instead of restarting after each chunk',async()=>{
  let pulls=0,returns=0;
  const source={
    [Symbol.asyncIterator](){return this;},
    async next(){pulls++;await new Promise(resolve=>setTimeout(resolve,15));return{done:false,value:Buffer.from('x')};},
    async return(){returns++;return{done:true};},
  };
  await assert.rejects(()=>timely(readSyntheticUploadBody(source,{timeoutMs:35})),code('TIMED_OUT'));
  assert.ok(pulls>=1&&pulls<=3);assert.equal(returns,1);
  await new Promise(resolve=>setTimeout(resolve,20));
});

test('elapsed deadline also bounds immediately resolved empty chunks without waiting for timer callbacks',async()=>{
  let pulls=0,returns=0;
  const source={
    [Symbol.asyncIterator](){return this;},
    next(){pulls++;return Promise.resolve({done:false,value:new Uint8Array(0)});},
    return(){returns++;return{done:true};},
  };
  await assert.rejects(()=>timely(readSyntheticUploadBody(source,{timeoutMs:15})),code('TIMED_OUT'));
  assert.ok(pulls>0);assert.equal(returns,1);
});

test('invalid chunks, shared buffers and typed-array lookalikes never become upload bytes',async()=>{
  for(const value of ['bytes',[1,2],new DataView(new ArrayBuffer(2)),new Uint16Array([1]),null,undefined,Buffer.from('x').buffer,new Uint8Array(new SharedArrayBuffer(1)),new Proxy(new Uint8Array([1]),{})]){
    await assert.rejects(()=>readSyntheticUploadBody(chunks(value)),code('INVALID_INPUT'));
  }
  const native=new Uint8Array([4,5]);let reads=0;
  Object.defineProperty(native,'buffer',{get(){reads++;throw new Error('caller buffer getter');}});
  Object.defineProperty(native,'byteLength',{get(){reads++;throw new Error('caller length getter');}});
  Object.defineProperty(native,'byteOffset',{get(){reads++;throw new Error('caller offset getter');}});
  assert.deepEqual(await readSyntheticUploadBody(chunks(native)),Buffer.from([4,5]));assert.equal(reads,0);
  const detached=new Uint8Array([6]);structuredClone(detached.buffer,{transfer:[detached.buffer]});
  await assert.rejects(()=>readSyntheticUploadBody(chunks(detached)),code('INVALID_INPUT'));
});

test('producer errors and malformed iteration normalize safely and cancellation failure cannot mask them',async()=>{
  for(const source of [null,{},[],{[Symbol.asyncIterator](){return null;}},{[Symbol.asyncIterator](){return{};}}]){
    await assert.rejects(()=>readSyntheticUploadBody(source),code('INVALID_INPUT'));
  }
  let returns=0;
  const source={
    [Symbol.asyncIterator](){return this;},
    async next(){throw new Error('private producer failure');},
    return(){returns++;return Promise.reject(new Error('private cancellation failure'));},
  };
  await assert.rejects(()=>readSyntheticUploadBody(source),code('READ_FAILED'));assert.equal(returns,1);
  await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(()=>readSyntheticUploadBody({[Symbol.asyncIterator](){throw new Error('factory failure');}}),code('READ_FAILED'));
  await assert.rejects(()=>readSyntheticUploadBody({[Symbol.asyncIterator](){return{next(){return Promise.resolve(3);}};}}),code('READ_FAILED'));
});

test('success removes signal listeners and does not cancel a completed iterator',async()=>{
  const controller=new AbortController();let returns=0,pulls=0;
  const source={
    [Symbol.asyncIterator](){return this;},
    next(){return Promise.resolve(++pulls===1?{done:false,value:Buffer.from('x')}:{done:true});},
    return(){returns++;return{done:true};},
  };
  assert.equal((await readSyntheticUploadBody(source,{signal:controller.signal,timeoutMs:10})).toString(),'x');
  assert.equal(returns,0);assert.equal(getEventListeners(controller.signal,'abort').length,0);controller.abort();
  await new Promise(resolve=>setTimeout(resolve,15));assert.equal(returns,0);
});
