import test from 'node:test';
import assert from 'node:assert/strict';
import {validateViewingConfirmationCommand,planViewingConfirmation} from '../dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const slot=()=>({startAt:'2026-10-15T09:00:00.000Z',endAt:'2026-10-15T10:00:00.000Z',timeZone:'Africa/Nairobi'});
const current=()=>({schedule:{viewingId:id(1),enquiryId:id(2),listingId:id(3),version:'2',status:'proposed',preferredSlots:[],proposedSlot:slot()},notes:'Original viewing interest.',requestedById:id(4),assignedAgentId:id(5),createdAt:'2026-10-13T18:00:00.000Z',updatedAt:'2026-10-14T06:00:00.000Z'});
const command=()=>({operationId:id(6),expectedVersion:'2',slot:slot(),channel:'phone',agreedAt:'2026-10-14T07:00:00.000Z',notes:'  Fictional phone agreement for this exact slot.\nRetain original.  '});
const now='2026-10-14T08:00:00.000Z';
test('confirmation command retains immutable exact phone evidence and rejects caller authority/token shortcuts',()=>{
 const raw=command(),validated=validateViewingConfirmationCommand(raw);raw.notes='changed';raw.slot.startAt='invalid';assert.equal(validated.notes,command().notes);assert.deepEqual(validated.slot,slot());assert.ok(Object.isFrozen(validated)&&Object.isFrozen(validated.slot));
 for(const field of ['actorId','companyId','assignedAgentId','confirmed','customerToken','customerId'])assert.throws(()=>validateViewingConfirmationCommand({...command(),[field]:id(9)}));
 for(const channel of ['email','whatsapp','customer_token','in_person',null])assert.throws(()=>validateViewingConfirmationCommand({...command(),channel}));
});
test('confirmation evidence is timeless for recovery but strictly validates version,instant and nonblank bounded notes',()=>{
 assert.doesNotThrow(()=>validateViewingConfirmationCommand({...command(),agreedAt:'2000-01-01T00:00:00.000Z'}));
 for(const patch of [{expectedVersion:2},{expectedVersion:'02'},{expectedVersion:'9007199254740991'},{agreedAt:'2026-02-30T00:00:00.000Z'},{agreedAt:'2026-10-14T10:00:00+03:00'},{notes:' '},{notes:'x'.repeat(2001)},{notes:'bad\u0000text'}])assert.throws(()=>validateViewingConfirmationCommand({...command(),...patch}));
});
test('exact current proposal with completed phone agreement plans version three without modifying original interest or slot',()=>{
 const original=current(),result=planViewingConfirmation(original,command(),now);assert.equal(result.outcome,'applied');assert.equal(result.next.status,'confirmed');assert.equal(result.next.version,'3');assert.deepEqual(result.next.proposedSlot,slot());assert.equal(result.next.agreement.notes,command().notes);assert.equal(original.schedule.status,'proposed');assert.equal(original.schedule.version,'2');assert.ok(Object.isFrozen(result.next.agreement));
});
test('stale confirmation conflicts before later time rules and requested interest cannot confirm itself',()=>{
 assert.equal(planViewingConfirmation(current(),{...command(),expectedVersion:'1'},'2026-10-16T00:00:00.000Z').reason,'VERSION_CONFLICT');
 const requested=current();requested.schedule={...requested.schedule,status:'requested',version:'1',proposedSlot:null};requested.updatedAt=requested.createdAt;
 assert.equal(planViewingConfirmation(requested,{...command(),expectedVersion:'1'},now).reason,'INVALID_STATE');
});
test('phone agreement cannot transfer to a different proposed time or precede the current proposal',()=>{
 const changed=slot();changed.startAt='2026-10-15T09:15:00.000Z';assert.equal(planViewingConfirmation(current(),{...command(),slot:changed},now).reason,'PROPOSED_SLOT_MISMATCH');
 assert.equal(planViewingConfirmation(current(),{...command(),agreedAt:'2026-10-14T05:59:59.999Z'},now).reason,'AGREEMENT_BEFORE_PROPOSAL');
 assert.equal(planViewingConfirmation(current(),{...command(),agreedAt:current().updatedAt},now).outcome,'applied');
});
test('first confirmation refuses future agreement or started slot and accepts agreement recorded at current time',()=>{
 assert.equal(planViewingConfirmation(current(),{...command(),agreedAt:'2026-10-14T08:00:00.001Z'},now).reason,'AGREEMENT_IN_FUTURE');
 assert.equal(planViewingConfirmation(current(),command(),slot().startAt).reason,'SLOT_NOT_FUTURE');
 assert.equal(planViewingConfirmation(current(),{...command(),agreedAt:now},now).outcome,'applied');
});
test('confirmation planning refuses getters and hidden fields without executing caller code',()=>{
 let touched=false;const input=current();Object.defineProperty(input,'schedule',{enumerable:true,get(){touched=true;return current().schedule;}});
 assert.throws(()=>planViewingConfirmation(input,command(),now));assert.equal(touched,false);
 const proposal=command();Object.defineProperty(proposal,'notes',{enumerable:true,get(){touched=true;return 'invented agreement';}});assert.throws(()=>validateViewingConfirmationCommand(proposal));assert.equal(touched,false);
 assert.throws(()=>planViewingConfirmation({...current(),customerId:id(9)},command(),now));
});
