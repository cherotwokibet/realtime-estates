import {prepareContactAttempt} from '../dist/tests/lib/contact-attempt.js';
import {EnquiryPreviewError} from '../dist/tests/lib/enquiry-client.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createEnquiryPreviewClient} from '../dist/tests/lib/enquiry-client.js';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const enquiry=id(5),operation=id(6),actor=id(1),instance=id(3),now='2026-10-12T12:00:00.000Z';
const command={operationId:operation,expectedVersion:1,channel:'call',outcome:'connected',occurredAt:now,notes:'  Private synthetic note.\nKeep spacing.  '};
const facts={channel:command.channel,outcome:command.outcome,occurredAt:now,notes:command.notes};
const receipt={operationId:operation,enquiryId:enquiry,actorId:actor,expectedVersion:'1',observedVersion:'1',request:facts,outcome:'applied',reason:null,entry:{entryId:operation,actorId:actor,...facts,recordedAt:now},completedAt:now};
const context={params:Promise.resolve({actor:'admin',id:enquiry})};
function request(method='POST',suffix='',body=JSON.stringify(command),extra={}){return new Request(`http://127.0.0.1:3001/api/enquiry-preview/admin/enquiries/${enquiry}/contacts${suffix}`,{method,headers:{host:'127.0.0.1:3001',origin:'http://127.0.0.1:3001','sec-fetch-site':'same-origin','x-preview-instance':instance,...(method==='POST'?{'content-type':'application/json'}:{}),...extra},...(method==='POST'?{body}:{})});}


test('contact attempt retains exact immutable facts and blocks concurrent sends',async()=>{
 let release,calls=0,seen;const input={...command,expectedVersion:'1'},attempt=prepareContactAttempt({recordContact:async(id,original)=>{calls++;seen=original;return new Promise(resolve=>release=resolve);},recoverContact:async()=>receipt},enquiry,input);
 input.notes='edited';assert.equal(attempt.command.notes,command.notes);assert.ok(Object.isFrozen(attempt.command));
 const pending=attempt.submit();assert.equal(attempt.status,'sending');await assert.rejects(attempt.submit());await assert.rejects(attempt.recoverOriginal());assert.equal(calls,1);assert.equal(seen.notes,command.notes);
 release(receipt);assert.deepEqual(await pending,receipt);assert.equal(attempt.status,'received');await assert.rejects(attempt.replayOriginal());assert.equal(calls,1);
});
test('uncertain attempt survives recovery denial and explicitly replays original command',async()=>{
 let calls=0,read=0;const attempt=prepareContactAttempt({recordContact:async(id,original)=>{calls++;assert.equal(original.notes,command.notes);if(calls===1)throw new EnquiryPreviewError('network',0,true);return receipt;},recoverContact:async()=>{read++;throw new EnquiryPreviewError('http',404,false);}},enquiry,{...command,expectedVersion:'1'});
 await assert.rejects(attempt.submit());assert.equal(attempt.status,'uncertain');await assert.rejects(attempt.recoverOriginal());assert.equal(attempt.status,'uncertain');assert.equal(calls,1);assert.equal(read,1);
 assert.deepEqual(await attempt.replayOriginal(),receipt);assert.equal(calls,2);assert.equal(attempt.status,'received');
});
test('conflict receipt is terminal and malformed receipt remains uncertain',async()=>{
 const conflict={...receipt,observedVersion:'2',outcome:'conflict',reason:'VERSION_CONFLICT',entry:null};
 const attempt=prepareContactAttempt({recordContact:async()=>conflict,recoverContact:async()=>conflict},enquiry,{...command,expectedVersion:'1'});
 assert.equal((await attempt.submit()).outcome,'conflict');assert.equal(attempt.status,'received');await assert.rejects(attempt.replayOriginal());
 const malformed=prepareContactAttempt({recordContact:async()=>({...receipt,request:{...facts,notes:'changed'}}),recoverContact:async()=>receipt},enquiry,{...command,expectedVersion:'1'});
 await assert.rejects(malformed.submit());assert.equal(malformed.status,'uncertain');assert.deepEqual(await malformed.recoverOriginal(),receipt);assert.equal(malformed.status,'received');
});
