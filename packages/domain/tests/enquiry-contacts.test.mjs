import test from 'node:test';
import assert from 'node:assert/strict';
import {validateContactCommand,validateContactReceipt,validateContactPage} from '../dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const facts={channel:'call',outcome:'no_response',occurredAt:'2026-10-12T06:00:00.000Z',notes:'  Raw fictional notes\nPreserve them.  '};
const command=(extra={})=>({operationId:id(1),expectedVersion:'9',...facts,...extra});
const entry=(extra={})=>({entryId:id(1),actorId:id(2),recordedAt:'2026-10-13T06:00:00.000Z',...facts,...extra});
const receipt=(extra={})=>({operationId:id(1),enquiryId:id(3),actorId:id(2),expectedVersion:'9',observedVersion:'9',request:{...facts},outcome:'applied',reason:null,entry:entry(),completedAt:entry().recordedAt,...extra});
test('contact contracts preserve raw Unicode facts and immutable original receipt',()=>{
 const input=validateContactCommand(command({notes:'😀'.repeat(2000)}));assert.equal([...input.notes].length,2000);assert.ok(Object.isFrozen(input));const saved=validateContactReceipt(receipt(),id(3),id(1),command());assert.equal(saved.request.notes,facts.notes);assert.ok(Object.isFrozen(saved.entry)&&Object.isFrozen(saved.request));
});
test('contact receipts reject wrong original facts, forged actors, impossible outcomes and private field additions',()=>{
 for(const value of [receipt({actorId:id(8)}),receipt({observedVersion:'10'}),receipt({request:{...facts,notes:'Changed'}}),receipt({entry:entry({recordedAt:'2026-10-11T06:00:00.000Z'})}),receipt({entry:{...entry(),tenantId:id(8)}}),receipt({outcome:'conflict',reason:'VERSION_CONFLICT',entry:null})])assert.throws(()=>validateContactReceipt(value,id(3),id(1),command()));
 const conflict=receipt({outcome:'conflict',reason:'VERSION_CONFLICT',entry:null,observedVersion:'10'});assert.equal(validateContactReceipt(conflict,id(3),id(1),command()).entry,null);assert.throws(()=>validateContactReceipt(conflict,id(3),id(1),command({notes:'Different'})));
});
test('contact validation refuses unsafe raw notes, unsupported context and noncanonical versions/times',()=>{
 for(const value of [command({notes:'\u00a0'}),command({notes:'bad\u0001'}),command({notes:'\ud800'}),command({notes:'😀'.repeat(2001)}),command({actorId:id(2)}),command({expectedVersion:'09'}),command({expectedVersion:'9007199254740992'}),command({occurredAt:'2026-02-30T06:00:00.000Z'}),command({occurredAt:'0000-01-01T00:00:00.000Z'}),command({channel:'sms'})])assert.throws(()=>validateContactCommand(value));
});
test('contact feed validates recorded-time order,bounds,duplicates and immutable private entries',()=>{
 const page={items:[entry()],limit:1,truncated:true};assert.ok(Object.isFrozen(validateContactPage(page,1).items));for(const value of [{...page,truncated:'yes'},{...page,items:[entry(),entry()]},{...page,items:[entry({expectedVersion:'9'})]}])assert.throws(()=>validateContactPage(value,1));
 assert.deepEqual(validateContactPage({items:[],limit:50,truncated:false},50).items,[]);
});
