import {validateViewingDetail,validateViewingSchedule,validateViewingSlot,type ViewingDetail,type ViewingSlot} from './viewing-scheduling.js';

/** Internal planning facts only. This is not a browser command, authorization or permission to send. */
export interface ViewingReminderCandidate {
 readonly enquiryId:string;readonly viewingId:string;readonly listingId:string;readonly viewingVersion:string;
 readonly cycleNumber:string;readonly slot:ViewingSlot;readonly confirmationRecordedAt:string;readonly agreedAt:string;
 readonly dueAt:string;readonly expiresAt:string;
}
export type ViewingReminderDecision=Readonly<{state:'eligible';reason:null}>|Readonly<{state:'waiting';reason:'NOT_DUE'}>|Readonly<{state:'suppressed';reason:'TARGET_CHANGED'|'NOT_CONFIRMED'|'VERSION_CHANGED'|'CYCLE_CHANGED'|'SLOT_CHANGED'|'AGREEMENT_CHANGED'|'ENQUIRY_CLOSED'|'LISTING_UNAVAILABLE'|'CLOCK_BEFORE_RECORD'|'EXPIRED'|'SLOT_STARTED'}>;
const invalid=():never=>{throw new Error('Invalid viewing reminder planning facts.');};
function record(input:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!input||typeof input!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(input))||Reflect.ownKeys(input).length!==keys.length)return invalid();
 const result:Record<string,unknown>={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(input,key);if(!d?.enumerable||!Object.hasOwn(d,'value'))return invalid();result[key]=d.value;}return result;
}
function instant(input:unknown):string{if(typeof input!=='string'||!/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input)||!Number.isFinite(Date.parse(input))||new Date(input).toISOString()!==input)return invalid();return input;}
function uuid(input:unknown):string{if(typeof input!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input))return invalid();return input;}
function version(input:unknown):string{if(typeof input!=='string'||!/^[1-9]\d{0,15}$/.test(input)||BigInt(input)>BigInt(Number.MAX_SAFE_INTEGER))return invalid();return input;}
function detail(input:unknown):ViewingDetail{
 if(!input||typeof input!=='object')return invalid();const d=Object.getOwnPropertyDescriptor(input,'schedule');if(!d?.enumerable||!Object.hasOwn(d,'value'))return invalid();
 const schedule=validateViewingSchedule(d.value);return validateViewingDetail(input,schedule.enquiryId);
}
export function validateViewingReminderCandidate(input:unknown):ViewingReminderCandidate{
 const v=record(input,['enquiryId','viewingId','listingId','viewingVersion','cycleNumber','slot','confirmationRecordedAt','agreedAt','dueAt','expiresAt']);
 const slot=validateViewingSlot(v.slot),confirmationRecordedAt=instant(v.confirmationRecordedAt),agreedAt=instant(v.agreedAt),dueAt=instant(v.dueAt),expiresAt=instant(v.expiresAt);
 if(agreedAt>confirmationRecordedAt||confirmationRecordedAt>dueAt||dueAt>=expiresAt||expiresAt>slot.startAt)return invalid();
 return Object.freeze({enquiryId:uuid(v.enquiryId),viewingId:uuid(v.viewingId),listingId:uuid(v.listingId),viewingVersion:version(v.viewingVersion),cycleNumber:version(v.cycleNumber),slot,confirmationRecordedAt,agreedAt,dueAt,expiresAt});
}
/** An explicit trusted policy supplies the window. No default cadence, recipient or provider is invented. */
export function prepareViewingReminderCandidate(input:ViewingDetail,window:Readonly<{dueAt:string;expiresAt:string}>):ViewingReminderCandidate{
 const current=detail(input),s=current.schedule,w=record(window,['dueAt','expiresAt']);
 if(s.status!=='confirmed'||!s.proposedSlot||!s.agreement||!current.confirmation)return invalid();
 return validateViewingReminderCandidate({enquiryId:s.enquiryId,viewingId:s.viewingId,listingId:s.listingId,viewingVersion:s.version,cycleNumber:s.cycle?.number??'1',slot:s.proposedSlot,confirmationRecordedAt:current.confirmation.recordedAt,agreedAt:s.agreement.agreedAt,dueAt:w.dueAt,expiresAt:w.expiresAt});
}
/** Planning-only recheck against fresh authoritative facts. Future dispatch must repeat this atomically
 * with current tenant/access/recipient/consent, durable deduplication and provider delivery policy. */
export function evaluateViewingReminder(candidateInput:ViewingReminderCandidate,currentInput:ViewingDetail,eligibilityInput:Readonly<{enquiryOpen:boolean;listingAvailable:boolean}>,now:string):ViewingReminderDecision{
 const candidate=validateViewingReminderCandidate(candidateInput),current=detail(currentInput),s=current.schedule,eligibility=record(eligibilityInput,['enquiryOpen','listingAvailable']),clock=instant(now);
 if(typeof eligibility.enquiryOpen!=='boolean'||typeof eligibility.listingAvailable!=='boolean')return invalid();
 const suppress=(reason:Extract<ViewingReminderDecision,{state:'suppressed'}>['reason']):ViewingReminderDecision=>Object.freeze({state:'suppressed',reason});
 if(candidate.enquiryId!==s.enquiryId||candidate.viewingId!==s.viewingId||candidate.listingId!==s.listingId)return suppress('TARGET_CHANGED');
 if(s.status!=='confirmed'||!s.proposedSlot||!s.agreement||!current.confirmation)return suppress('NOT_CONFIRMED');
 if(candidate.viewingVersion!==s.version)return suppress('VERSION_CHANGED');
 if(candidate.cycleNumber!==(s.cycle?.number??'1'))return suppress('CYCLE_CHANGED');
 if(candidate.slot.startAt!==s.proposedSlot.startAt||candidate.slot.endAt!==s.proposedSlot.endAt||candidate.slot.timeZone!==s.proposedSlot.timeZone)return suppress('SLOT_CHANGED');
 if(candidate.confirmationRecordedAt!==current.confirmation.recordedAt||candidate.agreedAt!==s.agreement.agreedAt)return suppress('AGREEMENT_CHANGED');
 if(!eligibility.enquiryOpen)return suppress('ENQUIRY_CLOSED');if(!eligibility.listingAvailable)return suppress('LISTING_UNAVAILABLE');
 if(clock<current.updatedAt)return suppress('CLOCK_BEFORE_RECORD');if(clock>=s.proposedSlot.startAt)return suppress('SLOT_STARTED');if(clock>=candidate.expiresAt)return suppress('EXPIRED');
 if(clock<candidate.dueAt)return Object.freeze({state:'waiting',reason:'NOT_DUE'});
 return Object.freeze({state:'eligible',reason:null});
}
