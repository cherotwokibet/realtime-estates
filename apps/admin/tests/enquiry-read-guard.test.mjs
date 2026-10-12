import assert from 'node:assert/strict';
import test from 'node:test';
import {createEnquiryReadGuard} from '../dist/tests/lib/enquiry-read-guard.js';

function deferred(){let resolve;const promise=new Promise(complete=>{resolve=complete;});return {promise,resolve};}
const contexts=['queue','detail','current comparison','staff directory'];

test('captured reads remain valid until invalidation and retired captures never revive',()=>{
  const guard=createEnquiryReadGuard();assert.equal(Object.isFrozen(guard),true);
  const first=guard.capture(),sibling=guard.capture();assert.equal(first(),true);assert.equal(sibling(),true);
  guard.invalidate();assert.equal(first(),false);assert.equal(sibling(),false);
  const later=guard.capture();assert.equal(later(),true);assert.equal(first(),false);
  guard.invalidate();guard.invalidate();assert.equal(later(),false);assert.equal(first(),false);
  assert.equal(guard.capture()(),true);
});

for(const context of contexts)test(`${context}: delayed transport ignoring abort cannot apply private success after denial`,async()=>{
  const guard=createEnquiryReadGuard(),controller=new AbortController(),pending=deferred(),applied=[];
  const current=guard.capture();
  // This deliberately uncooperative transport never reads controller.signal.
  // Cancellation alone cannot keep its already-scheduled success from arriving.
  const work=(async()=>{const value=await pending.promise;if(current())applied.push(value);})();
  controller.abort();guard.invalidate();pending.resolve({context,private:'Synthetic contact only'});
  await work;assert.equal(controller.signal.aborted,true);assert.deepEqual(applied,[]);
});

test('a denial retires all concurrent read contexts while explicit later reads can succeed',async()=>{
  const guard=createEnquiryReadGuard(),applied=[];
  const reads=contexts.map(context=>{const pending=deferred(),current=guard.capture();return {context,pending,
    work:(async()=>{const value=await pending.promise;if(current())applied.push({context,value});})()};});
  guard.invalidate();
  const fresh=deferred(),current=guard.capture(),freshWork=(async()=>{const value=await fresh.promise;if(current())applied.push({context:'fresh authorized detail',value});})();
  fresh.resolve('Synthetic new authorized snapshot');await freshWork;
  for(const read of reads)read.pending.resolve('Synthetic old private snapshot');
  await Promise.all(reads.map(read=>read.work));
  assert.deepEqual(applied,[{context:'fresh authorized detail',value:'Synthetic new authorized snapshot'}]);
});

test('workspace teardown retires outstanding reads without affecting a separate workspace guard',async()=>{
  const previous=createEnquiryReadGuard(),replacement=createEnquiryReadGuard(),pending=deferred(),applied=[];
  const oldCurrent=previous.capture(),newCurrent=replacement.capture();
  const work=(async()=>{await pending.promise;if(oldCurrent())applied.push('old workspace');if(newCurrent())applied.push('replacement workspace');})();
  previous.invalidate();pending.resolve();await work;assert.deepEqual(applied,['replacement workspace']);
});
