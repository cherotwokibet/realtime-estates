import assert from 'node:assert/strict';
import test from 'node:test';
import {validateViewingOutcomeCommand,planViewingOutcome,validateViewingDetail} from '../dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const at=time=>`2090-01-01T${time}:00.000Z`,slot={startAt:at('09:00'),endAt:at('10:00'),timeZone:'Africa/Nairobi'};
const agreement={channel:'phone',agreedAt:at('08:15'),notes:'Original exact phone evidence.'};
const first={schedule:{viewingId:id(1),enquiryId:id(2),listingId:id(3),version:'3',status:'confirmed',preferredSlots:[],proposedSlot:slot,agreement},notes:'Original viewing interest.',requestedById:id(4),assignedAgentId:id(5),createdAt:at('07:00'),updatedAt:at('08:30'),confirmation:{proposedAt:at('08:00'),recordedAt:at('08:30'),recordedById:id(5)}};
const command={operationId:id(6),expectedVersion:'3',occurredAt:at('10:00'),reason:'  Synthetic attendance outcome.\nPreserve this reason.  '};
const plan=(kind='complete',patch={},now=at('10:30'),current=first)=>planViewingOutcome(current,kind,{...command,...patch},now);
test('completion and no-show plans retain original interest, exact agreement and attribution without mutating input',()=>{
 const original=structuredClone(first);for(const kind of ['complete','no_show']){const value=plan(kind);assert.equal(value.outcome,'applied');assert.equal(value.next.schedule.status,kind==='complete'?'completed':'no_show');assert.equal(value.next.schedule.version,'4');assert.deepEqual(value.next.schedule.agreement,agreement);assert.deepEqual(value.next.confirmation,first.confirmation);assert.equal(value.next.notes,first.notes);assert.equal(value.next.outcome.reason,command.reason);assert.equal(value.next.outcome.occurredAt,command.occurredAt);assert.equal(value.next.outcome.previousUpdatedAt,first.updatedAt);assert.ok(Object.isFrozen(value.next.outcome));assert.notEqual(value.previous,first);assert.throws(()=>validateViewingDetail(value.next,id(2)));}assert.deepEqual(first,original);
});
test('later confirmed cycle outcome keeps its own proposal and agreement rather than first-cycle versions',()=>{
 const current=structuredClone(first);current.schedule.version='5';current.schedule.cycle={number:'2',proposalVersion:'4',proposedAt:at('08:00'),reason:'Synthetic replacement reason.',previousStatus:'confirmed',previousUpdatedAt:at('07:30')};
 const value=plan('no_show',{expectedVersion:'5'},at('10:30'),current);assert.equal(value.next.schedule.version,'6');assert.deepEqual(value.next.schedule.cycle,current.schedule.cycle);assert.deepEqual(value.next.confirmation,current.confirmation);assert.deepEqual(value.previous,current);
});
test('stale viewing version conflicts before execution state and all timing policies',()=>{
 assert.equal(plan('complete',{expectedVersion:'2',occurredAt:at('11:00')},at('08:00')).reason,'VERSION_CONFLICT');
 const requested={...first,schedule:{...first.schedule,version:'1',status:'requested',proposedSlot:null},updatedAt:first.createdAt};delete requested.schedule.agreement;delete requested.confirmation;assert.equal(plan('no_show',{expectedVersion:'2'},at('06:00'),requested).reason,'VERSION_CONFLICT');
});
test('unconfirmed proposals and cancelled confirmed views cannot infer attendance',()=>{
 const proposed=structuredClone(first);proposed.schedule.status='proposed';proposed.schedule.version='2';delete proposed.schedule.agreement;delete proposed.confirmation;assert.equal(plan('complete',{expectedVersion:'2'},at('10:30'),proposed).reason,'INVALID_STATE');
 const ended=structuredClone(first);ended.schedule.version='4';ended.schedule.status='cancelled';ended.schedule.termination={kind:'cancel',fromStatus:'confirmed',reason:'Explicit previous cancellation.',endedAt:at('08:45'),previousUpdatedAt:first.updatedAt};ended.updatedAt=at('08:45');ended.terminationRecord={recordedById:id(5)};assert.equal(plan('no_show',{expectedVersion:'4'},at('10:30'),ended).reason,'INVALID_STATE');
});
test('outcomes require whole slot end, bounded occurrence time and non-regressing execution clock',()=>{
 assert.equal(plan('complete',{},at('08:00')).reason,'RECORD_TIME_IN_FUTURE');assert.equal(plan('complete',{},at('09:59')).reason,'SLOT_NOT_ENDED');assert.equal(plan('no_show',{occurredAt:at('09:59')}).reason,'OUTCOME_BEFORE_SLOT_END');assert.equal(plan('no_show',{occurredAt:at('10:31')}).reason,'OUTCOME_IN_FUTURE');assert.equal(plan('complete',{},at('10:00')).outcome,'applied');
});
test('timeless strict outcome commands preserve raw Unicode reason and reject unsafe versions or caller authority',()=>{
 const raw={...command,reason:'😀'.repeat(1000)};assert.equal([...validateViewingOutcomeCommand(raw).reason].length,1000);assert.ok(Object.isFrozen(validateViewingOutcomeCommand(raw)));
 for(const patch of [{reason:'😀'.repeat(1001)},{reason:' \n '},{reason:'bad\u0000'},{expectedVersion:3},{expectedVersion:'03'},{expectedVersion:String(Number.MAX_SAFE_INTEGER)},{occurredAt:'2090-02-30T10:00:00.000Z'},{occurredAt:'2090-01-01T13:00:00+03:00'},{actorId:id(9)},{kind:'complete'}])assert.throws(()=>validateViewingOutcomeCommand({...command,...patch}));
 assert.equal(validateViewingOutcomeCommand({...command,occurredAt:'1900-01-01T00:00:00.000Z'}).occurredAt,'1900-01-01T00:00:00.000Z');
});
test('outcome validation rejects getters, hidden fields and invalid kinds without invoking user accessors',()=>{
 let calls=0;const accessor={...command};Object.defineProperty(accessor,'reason',{enumerable:true,get(){calls++;return 'bad';}});assert.throws(()=>validateViewingOutcomeCommand(accessor));assert.equal(calls,0);const hidden={...command};Object.defineProperty(hidden,'actorId',{value:id(9)});assert.throws(()=>validateViewingOutcomeCommand(hidden));assert.throws(()=>plan('completed'));const current={...first};Object.defineProperty(current,'schedule',{enumerable:true,get(){calls++;return first.schedule;}});assert.throws(()=>plan('complete',{},at('10:30'),current));assert.equal(calls,0);
});
test('planning evidence is detached from later caller changes and does not replace current read contract',()=>{
 const current=structuredClone(first),raw=structuredClone(command),value=planViewingOutcome(current,'complete',raw,at('10:30'));current.schedule.agreement.notes='Changed';current.confirmation.recordedById=id(9);raw.reason='Changed';assert.equal(value.next.schedule.agreement.notes,agreement.notes);assert.equal(value.next.confirmation.recordedById,id(5));assert.equal(value.next.outcome.reason,command.reason);assert.throws(()=>validateViewingDetail(value.next,id(2)));assert.deepEqual(validateViewingDetail(first,id(2)),first);
});
test('planned saved time advances to outcome recording time while previous confirmation time remains historical',()=>{
 const value=plan('complete');assert.equal(value.next.updatedAt,at('10:30'));assert.equal(value.next.outcome.recordedAt,value.next.updatedAt);assert.equal(value.previous.updatedAt,first.updatedAt);assert.equal(value.next.confirmation.recordedAt,first.confirmation.recordedAt);
});
