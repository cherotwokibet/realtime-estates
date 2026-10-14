import assert from 'node:assert/strict';import test from 'node:test';
import {prepareViewingReminderCandidate,evaluateViewingReminder,validateViewingReminderCandidate} from '../dist/index.js';
import {outcomeFixture} from '../test-helpers/viewing-outcome-fixtures.mjs';
const fixture=(later=false)=>{const f=outcomeFixture({later}),current={...f.detail,schedule:f.previous,updatedAt:f.schedule.outcome.previousUpdatedAt};delete current.outcomeRecord;return {f,current};};
const eligibility={enquiryOpen:true,listingAvailable:true},window={dueAt:'2020-01-01T08:35:00.000Z',expiresAt:'2020-01-01T08:50:00.000Z'},now='2020-01-01T08:40:00.000Z';
test('reminder candidate detaches explicit policy and confirmed cycle without mutating private evidence',()=>{
 const {current}=fixture(),before=structuredClone(current),w={...window},candidate=prepareViewingReminderCandidate(current,w);w.dueAt=now;current.schedule.proposedSlot.startAt='2020-01-01T09:01:00.000Z';assert.equal(candidate.slot.startAt,before.schedule.proposedSlot.startAt);assert.equal(candidate.dueAt,window.dueAt);assert.ok(Object.isFrozen(candidate)&&Object.isFrozen(candidate.slot));assert.equal(candidate.cycleNumber,'1');assert.equal(candidate.viewingVersion,'3');
});
test('reminder window waits before due and suppresses at expiry and slot start with inclusive boundaries',()=>{
 const {current}=fixture(),candidate=prepareViewingReminderCandidate(current,window),check=at=>evaluateViewingReminder(candidate,current,eligibility,at);
 assert.deepEqual(check('2020-01-01T08:34:59.999Z'),{state:'waiting',reason:'NOT_DUE'});assert.equal(check(window.dueAt).state,'eligible');assert.equal(check('2020-01-01T08:49:59.999Z').state,'eligible');assert.equal(check(window.expiresAt).reason,'EXPIRED');assert.equal(check(current.schedule.proposedSlot.startAt).reason,'SLOT_STARTED');assert.equal(check('2020-01-01T08:29:59.999Z').reason,'CLOCK_BEFORE_RECORD');
});
test('old confirmation and replacement proposal cannot qualify against later confirmed cycle',()=>{
 const first=fixture(),later=fixture(true),candidate=prepareViewingReminderCandidate(first.current,window);
 assert.equal(evaluateViewingReminder(candidate,later.current,eligibility,now).reason,'VERSION_CHANGED');
 const proposed=structuredClone(later.current);proposed.schedule=later.f.history.items.find(item=>item.schedule.version==='4').schedule;proposed.updatedAt='2020-01-02T08:00:00.000Z';delete proposed.confirmation;
 assert.equal(evaluateViewingReminder(candidate,proposed,eligibility,now).reason,'NOT_CONFIRMED');assert.throws(()=>prepareViewingReminderCandidate(proposed,window));
 const own=prepareViewingReminderCandidate(later.current,{dueAt:'2020-01-02T08:35:00.000Z',expiresAt:'2020-01-02T08:50:00.000Z'});assert.equal(own.cycleNumber,'2');assert.equal(evaluateViewingReminder(own,later.current,eligibility,'2020-01-02T08:40:00.000Z').state,'eligible');
});
test('completed and no-show outcomes suppress old candidates and cannot prepare new ones',()=>{
 for(const kind of ['complete','no_show']){const {current,f}=fixture(),candidate=prepareViewingReminderCandidate(current,window),terminal=outcomeFixture({kind}).detail;assert.equal(evaluateViewingReminder(candidate,terminal,eligibility,now).reason,'NOT_CONFIRMED');assert.throws(()=>prepareViewingReminderCandidate(terminal,window));assert.equal(f.previous.status,'confirmed');}
});
test('reasoned cancellation and decline suppress retained reminder candidates',()=>{
 const {current}=fixture(),candidate=prepareViewingReminderCandidate(current,window);
 const cancelled={...current,updatedAt:now,terminationRecord:{recordedById:current.requestedById},schedule:{...current.schedule,version:'4',status:'cancelled',termination:{kind:'cancel',fromStatus:'confirmed',reason:'Synthetic explicit cancellation.',endedAt:now,previousUpdatedAt:current.updatedAt}}};
 assert.equal(evaluateViewingReminder(candidate,cancelled,eligibility,now).reason,'NOT_CONFIRMED');assert.throws(()=>prepareViewingReminderCandidate(cancelled,window));
 const declined=structuredClone(cancelled);declined.schedule.version='3';declined.schedule.status='declined';declined.schedule.termination={...declined.schedule.termination,kind:'decline',fromStatus:'proposed',previousUpdatedAt:'2020-01-01T08:00:00.000Z'};delete declined.schedule.agreement;delete declined.confirmation;
 assert.equal(evaluateViewingReminder(candidate,declined,eligibility,now).reason,'NOT_CONFIRMED');assert.throws(()=>prepareViewingReminderCandidate(declined,window));
});
test('fresh enquiry closure or unavailable listing suppresses otherwise matching reminders',()=>{
 const {current}=fixture(),candidate=prepareViewingReminderCandidate(current,window);
 assert.equal(evaluateViewingReminder(candidate,current,{...eligibility,enquiryOpen:false},now).reason,'ENQUIRY_CLOSED');assert.equal(evaluateViewingReminder(candidate,current,{...eligibility,listingAvailable:false},now).reason,'LISTING_UNAVAILABLE');
 for(const invalid of [{...eligibility,enquiryOpen:1},{...eligibility,actorId:'forged'},{listingAvailable:true},null])assert.throws(()=>evaluateViewingReminder(candidate,current,invalid,now));
});
test('candidate target,cycle,slot and agreement mismatch fail closed without changing saved states',()=>{
 const {current}=fixture(),candidate=prepareViewingReminderCandidate(current,window),before=structuredClone(current);
 for(const [patch,reason] of [[{viewingId:'00000000-0000-4000-8000-000000000099'},'TARGET_CHANGED'],[{cycleNumber:'2'},'CYCLE_CHANGED'],[{slot:{...candidate.slot,endAt:'2020-01-01T10:01:00.000Z'}},'SLOT_CHANGED'],[{agreedAt:'2020-01-01T08:16:00.000Z'},'AGREEMENT_CHANGED'],[{confirmationRecordedAt:'2020-01-01T08:31:00.000Z'},'AGREEMENT_CHANGED']])assert.equal(evaluateViewingReminder({...candidate,...patch},current,eligibility,now).reason,reason);assert.deepEqual(current,before);
});
test('malformed,ambiguous and executable candidate facts cannot establish eligibility',()=>{
 const {current}=fixture(),candidate=prepareViewingReminderCandidate(current,window);
 for(const patch of [{viewingVersion:'03'},{viewingVersion:3},{cycleNumber:'0'},{dueAt:window.expiresAt},{expiresAt:'2020-01-01T09:00:00.001Z'},{dueAt:'2020-01-01T08:29:00.000Z'},{agreedAt:'2020-01-01T08:31:00.000Z'},{dueAt:'2020-01-01T08:35:00Z'},{tenantId:'forged'}])assert.throws(()=>validateViewingReminderCandidate({...candidate,...patch}));
 let called=false;const accessor={...candidate};Object.defineProperty(accessor,'dueAt',{enumerable:true,get(){called=true;return now;}});assert.throws(()=>validateViewingReminderCandidate(accessor));assert.equal(called,false);
});
test('candidate UUID and version tokens reject trailing line breaks rather than normalizing them',()=>{
 const {current}=fixture(),candidate=prepareViewingReminderCandidate(current,window);
 for(const field of ['enquiryId','viewingId','listingId','viewingVersion','cycleNumber'])for(const suffix of ['\n','\r','\r\n'])assert.throws(()=>validateViewingReminderCandidate({...candidate,[field]:candidate[field]+suffix}));
});
