/** Strict viewing lifecycle contracts. Authorization and durable original replay belong to SQL/API. */
export interface ViewingSlot {readonly startAt:string;readonly endAt:string;readonly timeZone:'Africa/Nairobi'}
export interface ViewingRequestCommand {readonly operationId:string;readonly expectedEnquiryVersion:string;readonly listingId:string;readonly preferredSlots:readonly ViewingSlot[];readonly notes:string}
export interface ViewingProposalCommand {readonly operationId:string;readonly expectedVersion:string;readonly slot:ViewingSlot}
export interface PhoneViewingAgreement {readonly channel:'phone';readonly agreedAt:string;readonly notes:string}
export type OpenViewingStatus='requested'|'proposed'|'confirmed';
export interface ViewingSchedule {readonly viewingId:string;readonly enquiryId:string;readonly listingId:string;readonly version:string;readonly status:OpenViewingStatus|'cancelled'|'declined'|'completed'|'no_show';readonly preferredSlots:readonly ViewingSlot[];readonly proposedSlot:ViewingSlot|null;readonly agreement?:PhoneViewingAgreement;readonly termination?:ViewingTerminationFacts;readonly cycle?:ViewingCycle;readonly outcome?:ViewingOutcomeFacts}
export type ViewingProposalPlan=Readonly<{outcome:'applied';reason:null;next:ViewingSchedule}>|Readonly<{outcome:'conflict';reason:'VERSION_CONFLICT';next:null}>|Readonly<{outcome:'refused';reason:'INVALID_STATE'|'SLOT_NOT_FUTURE';next:null}>;
export type ViewingOriginal=Readonly<{kind:'request';command:ViewingRequestCommand}>|Readonly<{kind:'propose';viewingId:string;command:ViewingProposalCommand}>;
export type ViewingRefusalReason='ENQUIRY_CLOSED'|'LISTING_MISMATCH'|'LISTING_UNAVAILABLE'|'INVALID_STATE'|'SLOT_NOT_FUTURE';
export type ViewingReceipt=Readonly<{operationId:string;enquiryId:string;viewingId:string|null;actorId:string;kind:'request'|'propose';expectedVersion:string;observedVersion:string;request:Readonly<{listingId:string;preferredSlots:readonly ViewingSlot[];notes:string}>|Readonly<{slot:ViewingSlot}>;completedAt:string}>&(
 Readonly<{outcome:'applied';reason:null;result:ViewingSchedule}>|Readonly<{outcome:'conflict';reason:'VERSION_CONFLICT';result:null}>|Readonly<{outcome:'refused';reason:ViewingRefusalReason;result:null}>);
export interface ViewingDetail {readonly schedule:ViewingSchedule;readonly notes:string;readonly requestedById:string;readonly assignedAgentId:string|null;readonly createdAt:string;readonly updatedAt:string;readonly confirmation?:Readonly<{proposedAt:string;recordedAt:string;recordedById:string}>;readonly terminationRecord?:Readonly<{recordedById:string}>;readonly outcomeRecord?:Readonly<{recordedById:string}>}
export interface ViewingPage {readonly items:readonly ViewingDetail[];readonly limit:number;readonly truncated:boolean}
export interface ViewingHistoryEntry {readonly kind:'request'|'propose'|'confirm'|'cancel'|'decline'|'reschedule'|'complete'|'no_show';readonly actorId:string;readonly recordedAt:string;readonly schedule:ViewingSchedule}
export interface ViewingHistoryPage {readonly items:readonly ViewingHistoryEntry[];readonly limit:number;readonly truncated:boolean;readonly currentVersion:string}
/** First agreement slice: staff records a completed phone agreement for this exact proposed slot. */
export interface ViewingConfirmationCommand {readonly operationId:string;readonly expectedVersion:string;readonly slot:ViewingSlot;readonly channel:'phone';readonly agreedAt:string;readonly notes:string}
export interface ConfirmedViewingSchedule extends Omit<ViewingSchedule,'status'|'proposedSlot'|'termination'> {readonly status:'confirmed';readonly proposedSlot:ViewingSlot;readonly agreement:Readonly<{channel:'phone';agreedAt:string;notes:string}>}
export type ViewingConfirmationPlan=Readonly<{outcome:'applied';reason:null;next:ConfirmedViewingSchedule}>|Readonly<{outcome:'conflict';reason:'VERSION_CONFLICT';next:null}>|Readonly<{outcome:'refused';reason:'INVALID_STATE'|'PROPOSED_SLOT_MISMATCH'|'SLOT_NOT_FUTURE'|'AGREEMENT_BEFORE_PROPOSAL'|'AGREEMENT_IN_FUTURE';next:null}>;
export type ViewingConfirmationReceipt=Readonly<{operationId:string;enquiryId:string;viewingId:string;actorId:string;kind:'confirm';expectedVersion:string;observedVersion:string;request:Readonly<{slot:ViewingSlot;channel:'phone';agreedAt:string;notes:string}>;completedAt:string}>&(
 Readonly<{outcome:'applied';reason:null;result:ConfirmedViewingSchedule}>|Readonly<{outcome:'conflict';reason:'VERSION_CONFLICT';result:null}>|Readonly<{outcome:'refused';reason:'ENQUIRY_CLOSED'|'LISTING_UNAVAILABLE'|'INVALID_STATE'|'PROPOSED_SLOT_MISMATCH'|'SLOT_NOT_FUTURE'|'AGREEMENT_BEFORE_PROPOSAL'|'AGREEMENT_IN_FUTURE';result:null}>);
export type ViewingTerminationKind='cancel'|'decline';
export interface ViewingTerminationCommand {readonly operationId:string;readonly expectedVersion:string;readonly reason:string}
export type ViewingOutcomeKind='complete'|'no_show';
export interface ViewingOutcomeFacts {readonly kind:ViewingOutcomeKind;readonly fromStatus:'confirmed';readonly reason:string;readonly occurredAt:string;readonly recordedAt:string;readonly previousUpdatedAt:string}
export type ViewingOutcomeReceipt=Readonly<{operationId:string;enquiryId:string;viewingId:string;actorId:string;kind:ViewingOutcomeKind;expectedVersion:string;observedVersion:string;request:Readonly<{occurredAt:string;reason:string}>;completedAt:string}>&(
 Readonly<{outcome:'applied';reason:null;result:ViewingSchedule&Readonly<{status:'completed'|'no_show';outcome:ViewingOutcomeFacts}>}>|
 Readonly<{outcome:'conflict';reason:'VERSION_CONFLICT';result:null}>|
 Readonly<{outcome:'refused';reason:'INVALID_STATE'|'RECORD_TIME_IN_FUTURE'|'SLOT_NOT_ENDED'|'OUTCOME_BEFORE_SLOT_END'|'OUTCOME_IN_FUTURE';result:null}>);

export interface ViewingOutcomeCommand {readonly operationId:string;readonly expectedVersion:string;readonly occurredAt:string;readonly reason:string}
/** Planning-only outcome projection. Existing persisted read contracts intentionally reject it. */
export interface ViewingOutcomeProjection extends Omit<ViewingDetail,'schedule'> {
 readonly schedule:Omit<ViewingSchedule,'status'|'termination'>&Readonly<{status:'completed'|'no_show'}>;
 readonly outcome:Readonly<{kind:ViewingOutcomeKind;fromStatus:'confirmed';reason:string;occurredAt:string;recordedAt:string;previousUpdatedAt:string}>;
}
export type ViewingOutcomePlan=Readonly<{outcome:'applied';reason:null;next:ViewingOutcomeProjection;previous:ViewingDetail}>|
 Readonly<{outcome:'conflict';reason:'VERSION_CONFLICT';next:null;previous:null}>|
 Readonly<{outcome:'refused';reason:'INVALID_STATE'|'RECORD_TIME_IN_FUTURE'|'SLOT_NOT_ENDED'|'OUTCOME_BEFORE_SLOT_END'|'OUTCOME_IN_FUTURE';next:null;previous:null}>;
export interface ViewingCycle {readonly number:string;readonly proposalVersion:string;readonly proposedAt:string;readonly reason:string;readonly previousStatus:'proposed'|'confirmed';readonly previousUpdatedAt:string}
export interface ViewingRescheduleCommand {readonly operationId:string;readonly expectedVersion:string;readonly slot:ViewingSlot;readonly reason:string}
/** Planning projection for the first replacement slot; not the current persisted read DTO. */
export interface FirstRescheduledViewingProposal {
 readonly viewingId:string;readonly enquiryId:string;readonly listingId:string;readonly version:string;
 readonly status:'proposed';readonly cycleNumber:'2';readonly proposedSlot:ViewingSlot;readonly proposedAt:string;
 readonly preferredSlots:readonly ViewingSlot[];
 readonly reschedule:Readonly<{reason:string;fromStatus:'proposed'|'confirmed';previousUpdatedAt:string}>;
}
export type FirstViewingReschedulePlan=Readonly<{outcome:'applied';reason:null;next:FirstRescheduledViewingProposal;previous:ViewingDetail}>|
 Readonly<{outcome:'conflict';reason:'VERSION_CONFLICT';next:null;previous:null}>|
 Readonly<{outcome:'refused';reason:'INVALID_STATE'|'RECORD_TIME_IN_FUTURE'|'SLOT_UNCHANGED'|'SLOT_NOT_FUTURE';next:null;previous:null}>;
export interface ViewingTerminationFacts {readonly kind:ViewingTerminationKind;readonly fromStatus:OpenViewingStatus;readonly reason:string;readonly endedAt:string;readonly previousUpdatedAt:string}
export interface TerminatedViewingSchedule extends Omit<ViewingSchedule,'status'|'termination'> {readonly status:'cancelled'|'declined';readonly termination:ViewingTerminationFacts}
export type ViewingTerminationPlan=Readonly<{outcome:'applied';reason:null;next:TerminatedViewingSchedule}>|Readonly<{outcome:'conflict';reason:'VERSION_CONFLICT';next:null}>|Readonly<{outcome:'refused';reason:'INVALID_STATE'|'RECORD_TIME_IN_FUTURE';next:null}>;
const fail=():never=>{throw new Error('Invalid viewing scheduling contract.');};
function record(input:unknown,fields:readonly string[]):Record<string,unknown>{
 if(!input||typeof input!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(input)))return fail();
 const keys=Reflect.ownKeys(input);if(keys.length!==fields.length||keys.some(k=>typeof k!=='string'||!fields.includes(k)))return fail();
 const result:Record<string,unknown>={};for(const key of fields){const d=Object.getOwnPropertyDescriptor(input,key);if(!d?.enumerable||!Object.hasOwn(d,'value'))return fail();result[key]=d.value;}return result;
}
function uuid(input:unknown):string{if(typeof input!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input))return fail();return input;}
function version(input:unknown,increment=false):string{if(typeof input!=='string'||!/^[1-9]\d{0,15}$/.test(input)||BigInt(input)>BigInt(Number.MAX_SAFE_INTEGER)-(increment?1n:0n))return fail();return input;}
function instant(input:unknown):string{if(typeof input!=='string'||!/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input)||!Number.isFinite(Date.parse(input))||new Date(input).toISOString()!==input)return fail();return input;}
function privateNotes(input:unknown):string{if(typeof input!=='string'||!input.trim()||[...input].length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ud800-\udfff]/u.test(input))return fail();return input;}
export function validateViewingSlot(input:unknown):ViewingSlot{
 const v=record(input,['startAt','endAt','timeZone']),startAt=instant(v.startAt),endAt=instant(v.endAt),duration=Date.parse(endAt)-Date.parse(startAt);
 if(v.timeZone!=='Africa/Nairobi'||duration<15*60*1000||duration>4*60*60*1000)return fail();
 return Object.freeze({startAt,endAt,timeZone:'Africa/Nairobi'});
}
function alternatives(input:unknown):readonly ViewingSlot[]{
 if(!Array.isArray(input)||Object.getPrototypeOf(input)!==Array.prototype||input.length>3||Reflect.ownKeys(input).length!==input.length+1)return fail();
 const result:ViewingSlot[]=[];for(let i=0;i<input.length;i++){const d=Object.getOwnPropertyDescriptor(input,String(i));if(!d?.enumerable||!Object.hasOwn(d,'value'))return fail();const slot=validateViewingSlot(d.value);
  if(result.some(other=>slot.startAt<other.endAt&&other.startAt<slot.endAt))return fail();result.push(slot);
 }return Object.freeze(result);
}
/** Timeless: replay/recovery must not reject an original command merely because time passed. */
export function validateViewingRequestCommand(input:unknown):ViewingRequestCommand{
 const v=record(input,['operationId','expectedEnquiryVersion','listingId','preferredSlots','notes']);
 return Object.freeze({operationId:uuid(v.operationId),expectedEnquiryVersion:version(v.expectedEnquiryVersion),listingId:uuid(v.listingId),preferredSlots:alternatives(v.preferredSlots),notes:privateNotes(v.notes)});
}
export function validateViewingProposalCommand(input:unknown):ViewingProposalCommand{
 const v=record(input,['operationId','expectedVersion','slot']);return Object.freeze({operationId:uuid(v.operationId),expectedVersion:version(v.expectedVersion,true),slot:validateViewingSlot(v.slot)});
}
/** Timeless contract: original confirmation recovery must not expire with its viewing slot. */
export function validateViewingConfirmationCommand(input:unknown):ViewingConfirmationCommand{
 const value=record(input,['operationId','expectedVersion','slot','channel','agreedAt','notes']);
 if(value.channel!=='phone')return fail();
 return Object.freeze({operationId:uuid(value.operationId),expectedVersion:version(value.expectedVersion,true),slot:validateViewingSlot(value.slot),channel:'phone',agreedAt:instant(value.agreedAt),notes:privateNotes(value.notes)});
}
/** Time-independent original reason; kind is an explicit operation, never caller authority. */
export function validateViewingTerminationCommand(input:unknown):ViewingTerminationCommand{
 const value=record(input,['operationId','expectedVersion','reason']),reason=terminationReason(value.reason);
 return Object.freeze({operationId:uuid(value.operationId),expectedVersion:version(value.expectedVersion,true),reason});
}
/** Timeless command: occurrence policy is evaluated on a fresh execution, never original recovery. */
export function validateViewingOutcomeCommand(input:unknown):ViewingOutcomeCommand{
 const value=record(input,['operationId','expectedVersion','occurredAt','reason']);
 return Object.freeze({operationId:uuid(value.operationId),expectedVersion:version(value.expectedVersion,true),occurredAt:instant(value.occurredAt),reason:terminationReason(value.reason)});
}
/** Provisional conservative policy: both outcomes are recorded only after the entire slot ends.
 * No attendance inference, authorization, SQL write, receipt, notification or reminder mutation. */
export function planViewingOutcome(input:ViewingDetail,kind:ViewingOutcomeKind,commandInput:ViewingOutcomeCommand,now:string):ViewingOutcomePlan{
 if(kind!=='complete'&&kind!=='no_show'||!input||typeof input!=='object')return fail();
 const descriptor=Object.getOwnPropertyDescriptor(input,'schedule');if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))return fail();
 const schedule=validateViewingSchedule(descriptor.value),current=validateViewingDetail(input,schedule.enquiryId),command=validateViewingOutcomeCommand(commandInput),clock=instant(now);
 const refused=(reason:Extract<ViewingOutcomePlan,{outcome:'refused'}>['reason']):ViewingOutcomePlan=>Object.freeze({outcome:'refused',reason,next:null,previous:null});
 if(command.expectedVersion!==schedule.version)return Object.freeze({outcome:'conflict',reason:'VERSION_CONFLICT',next:null,previous:null});
 if(schedule.status!=='confirmed'||!schedule.proposedSlot||!schedule.agreement||!current.confirmation)return refused('INVALID_STATE');
 if(clock<current.updatedAt)return refused('RECORD_TIME_IN_FUTURE');
 if(clock<schedule.proposedSlot.endAt)return refused('SLOT_NOT_ENDED');
 if(command.occurredAt<schedule.proposedSlot.endAt)return refused('OUTCOME_BEFORE_SLOT_END');
 if(command.occurredAt>clock)return refused('OUTCOME_IN_FUTURE');
 const next:ViewingOutcomeProjection=Object.freeze({...current,updatedAt:clock,schedule:Object.freeze({...schedule,status:kind==='complete'?'completed':'no_show',version:String(BigInt(schedule.version)+1n)}),
  outcome:Object.freeze({kind,fromStatus:'confirmed',reason:command.reason,occurredAt:command.occurredAt,recordedAt:clock,previousUpdatedAt:current.updatedAt})});
 return Object.freeze({outcome:'applied',reason:null,next,previous:current});
}
/** First cancel/decline plan only. No deletion, stored receipt, authorization or reminder dispatch. */
export function planViewingTermination(input:ViewingDetail,kind:ViewingTerminationKind,commandInput:ViewingTerminationCommand,now:string):ViewingTerminationPlan{
 if(kind!=='cancel'&&kind!=='decline'||!input||typeof input!=='object')return fail();
 const descriptor=Object.getOwnPropertyDescriptor(input,'schedule');if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))return fail();
 const schedule=validateViewingSchedule(descriptor.value),current=validateViewingDetail(input,schedule.enquiryId),command=validateViewingTerminationCommand(commandInput),clock=instant(now);
 if(command.expectedVersion!==schedule.version)return Object.freeze({outcome:'conflict',reason:'VERSION_CONFLICT',next:null});
 if(schedule.status!=='requested'&&schedule.status!=='proposed'&&schedule.status!=='confirmed')return Object.freeze({outcome:'refused',reason:'INVALID_STATE',next:null});
 if(kind==='decline'&&schedule.status==='confirmed')return Object.freeze({outcome:'refused',reason:'INVALID_STATE',next:null});
 if(clock<current.updatedAt)return Object.freeze({outcome:'refused',reason:'RECORD_TIME_IN_FUTURE',next:null});
 return Object.freeze({outcome:'applied',reason:null,next:Object.freeze({...schedule,status:kind==='cancel'?'cancelled':'declined',version:String(BigInt(schedule.version)+1n),termination:Object.freeze({kind,fromStatus:schedule.status,reason:command.reason,endedAt:clock,previousUpdatedAt:current.updatedAt})})});
}
/** Pure first execution plan only. Does not authorize, store a receipt, confirm in SQL or send anything. */
export function planViewingConfirmation(input:ViewingDetail,proposal:ViewingConfirmationCommand,now:string):ViewingConfirmationPlan{
 if(!input||typeof input!=='object')return fail();const descriptor=Object.getOwnPropertyDescriptor(input,'schedule');if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))return fail();
 const schedule=validateViewingSchedule(descriptor.value);
 const current=validateViewingDetail(input,schedule.enquiryId),command=validateViewingConfirmationCommand(proposal),clock=instant(now);
 if(command.expectedVersion!==current.schedule.version)return Object.freeze({outcome:'conflict',reason:'VERSION_CONFLICT',next:null});
 if(current.schedule.status!=='proposed')return Object.freeze({outcome:'refused',reason:'INVALID_STATE',next:null});
 if(JSON.stringify(command.slot)!==JSON.stringify(current.schedule.proposedSlot))return Object.freeze({outcome:'refused',reason:'PROPOSED_SLOT_MISMATCH',next:null});
 if(command.slot.startAt<=clock)return Object.freeze({outcome:'refused',reason:'SLOT_NOT_FUTURE',next:null});
 if(command.agreedAt<current.updatedAt)return Object.freeze({outcome:'refused',reason:'AGREEMENT_BEFORE_PROPOSAL',next:null});
 if(command.agreedAt>clock)return Object.freeze({outcome:'refused',reason:'AGREEMENT_IN_FUTURE',next:null});
 return Object.freeze({outcome:'applied',reason:null,next:Object.freeze({...current.schedule,version:String(BigInt(current.schedule.version)+1n),status:'confirmed',proposedSlot:command.slot,agreement:Object.freeze({channel:'phone',agreedAt:command.agreedAt,notes:command.notes})})});
}
function terminationReason(input:unknown):string{const reason=privateNotes(input);if([...reason].length>1000)return fail();return reason;}
/** Timeless exact original facts; first execution time checks belong to the plan/storage operation. */
export function validateViewingRescheduleCommand(input:unknown):ViewingRescheduleCommand{
 const v=record(input,['operationId','expectedVersion','slot','reason']);
 return Object.freeze({operationId:uuid(v.operationId),expectedVersion:version(v.expectedVersion,true),slot:validateViewingSlot(v.slot),reason:terminationReason(v.reason)});
}
/** Pure first-cycle replacement only. Retain old evidence separately; the new slot has no agreement. */
export function planFirstViewingReschedule(input:ViewingDetail,proposal:ViewingRescheduleCommand,now:string):FirstViewingReschedulePlan{
 if(!input||typeof input!=='object')return fail();const descriptor=Object.getOwnPropertyDescriptor(input,'schedule');if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))return fail();
 const schedule=validateViewingSchedule(descriptor.value),current=validateViewingDetail(input,schedule.enquiryId),command=validateViewingRescheduleCommand(proposal),clock=instant(now);
 if(command.expectedVersion!==schedule.version)return Object.freeze({outcome:'conflict',reason:'VERSION_CONFLICT',next:null,previous:null});
 if(schedule.status!=='proposed'&&schedule.status!=='confirmed')return Object.freeze({outcome:'refused',reason:'INVALID_STATE',next:null,previous:null});
 if(schedule.version!==(schedule.status==='proposed'?'2':'3'))return fail();
 if(clock<current.updatedAt)return Object.freeze({outcome:'refused',reason:'RECORD_TIME_IN_FUTURE',next:null,previous:null});
 if(JSON.stringify(command.slot)===JSON.stringify(schedule.proposedSlot))return Object.freeze({outcome:'refused',reason:'SLOT_UNCHANGED',next:null,previous:null});
 if(command.slot.startAt<=clock)return Object.freeze({outcome:'refused',reason:'SLOT_NOT_FUTURE',next:null,previous:null});
 const next:FirstRescheduledViewingProposal=Object.freeze({viewingId:schedule.viewingId,enquiryId:schedule.enquiryId,listingId:schedule.listingId,
  version:String(BigInt(schedule.version)+1n),status:'proposed',cycleNumber:'2',proposedSlot:command.slot,proposedAt:clock,preferredSlots:schedule.preferredSlots,
  reschedule:Object.freeze({reason:command.reason,fromStatus:schedule.status,previousUpdatedAt:current.updatedAt})});
 return Object.freeze({outcome:'applied',reason:null,next,previous:current});
}
function viewingCycle(input:unknown):ViewingCycle{
 const v=record(input,['number','proposalVersion','proposedAt','reason','previousStatus','previousUpdatedAt']),number=version(v.number),proposalVersion=version(v.proposalVersion),proposedAt=instant(v.proposedAt),previousUpdatedAt=instant(v.previousUpdatedAt);
 if(BigInt(number)<2n||BigInt(proposalVersion)<BigInt(number)+1n||BigInt(proposalVersion)>2n*BigInt(number)||!['proposed','confirmed'].includes(v.previousStatus as string)||previousUpdatedAt>proposedAt)return fail();
 const priorProposal=BigInt(proposalVersion)-(v.previousStatus==='confirmed'?2n:1n);if(priorProposal<BigInt(number)||priorProposal>2n*(BigInt(number)-1n))return fail();
 return Object.freeze({number,proposalVersion,proposedAt,previousUpdatedAt,reason:terminationReason(v.reason),previousStatus:v.previousStatus as 'proposed'|'confirmed'});
}
function terminationFacts(input:unknown,status:unknown):ViewingTerminationFacts{
 const v=record(input,['kind','fromStatus','reason','endedAt','previousUpdatedAt']);
 if(!['cancel','decline'].includes(v.kind as string)||!['requested','proposed','confirmed'].includes(v.fromStatus as string)
  ||status!==(v.kind==='cancel'?'cancelled':'declined')||v.kind==='decline'&&v.fromStatus==='confirmed')return fail();
 const endedAt=instant(v.endedAt),previousUpdatedAt=instant(v.previousUpdatedAt);if(previousUpdatedAt>endedAt)return fail();
 return Object.freeze({kind:v.kind as ViewingTerminationKind,fromStatus:v.fromStatus as OpenViewingStatus,reason:terminationReason(v.reason),endedAt,previousUpdatedAt});
}
function outcomeFacts(input:unknown,status:unknown):ViewingOutcomeFacts{
 const v=record(input,['kind','fromStatus','reason','occurredAt','recordedAt','previousUpdatedAt']);
 if(!['complete','no_show'].includes(v.kind as string)||v.fromStatus!=='confirmed'||status!==(v.kind==='complete'?'completed':'no_show'))return fail();
 const occurredAt=instant(v.occurredAt),recordedAt=instant(v.recordedAt),previousUpdatedAt=instant(v.previousUpdatedAt);
 if(occurredAt>recordedAt||previousUpdatedAt>recordedAt)return fail();
 return Object.freeze({kind:v.kind as ViewingOutcomeKind,fromStatus:'confirmed',reason:terminationReason(v.reason),occurredAt,recordedAt,previousUpdatedAt});
}
export function validateViewingSchedule(input:unknown):ViewingSchedule{
 if(!input||typeof input!=='object')return fail();const descriptor=Object.getOwnPropertyDescriptor(input,'status');if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))return fail();
 const cycleDescriptor=Object.getOwnPropertyDescriptor(input,'cycle');if(cycleDescriptor&&(!cycleDescriptor.enumerable||!Object.hasOwn(cycleDescriptor,'value')))return fail();const cycle=cycleDescriptor?viewingCycle(cycleDescriptor.value):undefined;
 const confirmed=descriptor.value==='confirmed',ended=descriptor.value==='cancelled'||descriptor.value==='declined';let termination:ViewingTerminationFacts|undefined;
 if(ended){const facts=Object.getOwnPropertyDescriptor(input,'termination');if(!facts?.enumerable||!Object.hasOwn(facts,'value'))return fail();termination=terminationFacts(facts.value,descriptor.value);}
 const attended=descriptor.value==='completed'||descriptor.value==='no_show';let outcome:ViewingOutcomeFacts|undefined;
 if(attended){const facts=Object.getOwnPropertyDescriptor(input,'outcome');if(!facts?.enumerable||!Object.hasOwn(facts,'value'))return fail();outcome=outcomeFacts(facts.value,descriptor.value);}
 const hasAgreement=confirmed||attended||termination?.fromStatus==='confirmed';
 const v=record(input,['viewingId','enquiryId','listingId','version','status','preferredSlots','proposedSlot',...(hasAgreement?['agreement']:[]),...(ended?['termination']:[]),...(attended?['outcome']:[]),...(cycle?['cycle']:[])]),slotRequired=v.status!=='requested'&&termination?.fromStatus!=='requested';
 if(!['requested','proposed','confirmed','cancelled','declined','completed','no_show'].includes(v.status as string)||slotRequired&&v.proposedSlot===null||!slotRequired&&v.proposedSlot!==null||confirmed&&v.version!==String(BigInt(cycle?.proposalVersion??'2')+1n))return fail();
 if(cycle&&(v.status==='requested'||termination?.fromStatus==='requested'||v.status==='proposed'&&v.version!==cycle.proposalVersion))return fail();
 if(termination&&v.version!==(cycle?String(BigInt(cycle.proposalVersion)+(termination.fromStatus==='confirmed'?2n:1n)):({requested:'2',proposed:'3',confirmed:'4'}[termination.fromStatus])))return fail();
 if(outcome&&v.version!==String(BigInt(cycle?.proposalVersion??'2')+2n))return fail();
 const base={viewingId:uuid(v.viewingId),enquiryId:uuid(v.enquiryId),listingId:uuid(v.listingId),version:version(v.version),status:v.status as ViewingSchedule['status'],preferredSlots:alternatives(v.preferredSlots),proposedSlot:v.proposedSlot===null?null:validateViewingSlot(v.proposedSlot),...(termination?{termination}:{}),...(outcome?{outcome}:{}),...(cycle?{cycle}:{})};
 if(cycle&&(!base.proposedSlot||base.proposedSlot.startAt<=cycle.proposedAt||termination&&termination.previousUpdatedAt<cycle.proposedAt))return fail();
 if(termination&&base.proposedSlot!==null&&base.proposedSlot.startAt<=termination.previousUpdatedAt)return fail();
 if(outcome&&(!base.proposedSlot||base.proposedSlot.startAt<=outcome.previousUpdatedAt||base.proposedSlot.endAt>outcome.occurredAt||cycle&&outcome.previousUpdatedAt<cycle.proposedAt))return fail();
 if(!hasAgreement)return Object.freeze(base);
 const agreement=validatePhoneViewingAgreement(v.agreement);if(base.proposedSlot===null||cycle&&agreement.agreedAt<cycle.proposedAt||agreement.agreedAt>=base.proposedSlot.startAt||termination&&agreement.agreedAt>termination.previousUpdatedAt||outcome&&agreement.agreedAt>outcome.previousUpdatedAt)return fail();
 return Object.freeze({...base,agreement});
}
export function validatePhoneViewingAgreement(input:unknown):PhoneViewingAgreement{
 const value=record(input,['channel','agreedAt','notes']);if(value.channel!=='phone')return fail();
 return Object.freeze({channel:'phone',agreedAt:instant(value.agreedAt),notes:privateNotes(value.notes)});
}
/** First execution only, after server authorization and original-receipt lookup. */
export function viewingRequestHasFutureAlternatives(input:ViewingRequestCommand,now:string):boolean{
 const command=validateViewingRequestCommand(input),clock=instant(now);return command.preferredSlots.every(slot=>slot.startAt>clock);
}
/** Pure requested→proposed plan. Does not save, authorize, send, confirm or recover a receipt. */
export function planViewingProposal(input:ViewingSchedule,proposal:ViewingProposalCommand,now:string):ViewingProposalPlan{
 const current=validateViewingSchedule(input),command=validateViewingProposalCommand(proposal),clock=instant(now);
 if(command.expectedVersion!==current.version)return Object.freeze({outcome:'conflict',reason:'VERSION_CONFLICT',next:null});
 if(current.status!=='requested')return Object.freeze({outcome:'refused',reason:'INVALID_STATE',next:null});
 if(command.slot.startAt<=clock)return Object.freeze({outcome:'refused',reason:'SLOT_NOT_FUTURE',next:null});
 return Object.freeze({outcome:'applied',reason:null,next:validateViewingSchedule({...current,version:String(BigInt(current.version)+1n),status:'proposed',proposedSlot:command.slot})});
}
export function validateViewingOriginal(input:unknown):ViewingOriginal{
 if(!input||typeof input!=='object')return fail();
 const kind=Object.getOwnPropertyDescriptor(input,'kind');if(!kind?.enumerable||!Object.hasOwn(kind,'value'))return fail();
 if(kind.value==='request'){const v=record(input,['kind','command']);return Object.freeze({kind:'request',command:validateViewingRequestCommand(v.command)});}
 if(kind.value==='propose'){const v=record(input,['kind','viewingId','command']);return Object.freeze({kind:'propose',viewingId:uuid(v.viewingId),command:validateViewingProposalCommand(v.command)});}
 return fail();
}
/** Strict original-facts comparison: an invalid successful write reply remains uncertain. */
export function validateViewingReceipt(input:unknown,enquiryId:string,originalInput:ViewingOriginal):ViewingReceipt{
 const original=validateViewingOriginal(originalInput),v=record(input,['operationId','enquiryId','viewingId','actorId','kind','expectedVersion','observedVersion','request','outcome','reason','result','completedAt']);
 const operationId=uuid(v.operationId),enquiry=uuid(v.enquiryId),viewingId=v.viewingId===null?null:uuid(v.viewingId),actorId=uuid(v.actorId),expectedVersion=version(v.expectedVersion),observedVersion=version(v.observedVersion),completedAt=instant(v.completedAt);
 if(operationId!==original.command.operationId||enquiry!==uuid(enquiryId)||v.kind!==original.kind||expectedVersion!==(original.kind==='request'?original.command.expectedEnquiryVersion:original.command.expectedVersion)||original.kind==='propose'&&viewingId!==original.viewingId)return fail();
 let request:ViewingReceipt['request'];
 if(original.kind==='request'){
  const facts=record(v.request,['listingId','preferredSlots','notes']),validated=validateViewingRequestCommand({...facts,operationId,expectedEnquiryVersion:expectedVersion});
  if(validated.listingId!==original.command.listingId||validated.notes!==original.command.notes||JSON.stringify(validated.preferredSlots)!==JSON.stringify(original.command.preferredSlots))return fail();
  request=Object.freeze({listingId:validated.listingId,preferredSlots:validated.preferredSlots,notes:validated.notes});
 }else{
  const facts=record(v.request,['slot']),slot=validateViewingSlot(facts.slot);if(JSON.stringify(slot)!==JSON.stringify(original.command.slot))return fail();request=Object.freeze({slot});
 }
 const base={operationId,enquiryId:enquiry,viewingId,actorId,kind:original.kind,expectedVersion,observedVersion,request,completedAt};
 if(v.outcome==='conflict'){
  if(v.reason!=='VERSION_CONFLICT'||v.result!==null||expectedVersion===observedVersion||original.kind==='request'&&viewingId!==null)return fail();
  return Object.freeze({...base,outcome:'conflict',reason:'VERSION_CONFLICT',result:null});
 }
 if(v.outcome==='refused'){
  if(typeof v.reason!=='string'||!['ENQUIRY_CLOSED','LISTING_MISMATCH','LISTING_UNAVAILABLE','INVALID_STATE','SLOT_NOT_FUTURE'].includes(v.reason)||v.result!==null||expectedVersion!==observedVersion||original.kind==='request'&&(viewingId!==null||v.reason==='INVALID_STATE'))return fail();
  if(v.reason==='SLOT_NOT_FUTURE'&&(original.kind==='request'?original.command.preferredSlots.every(s=>s.startAt>completedAt):original.command.slot.startAt>completedAt))return fail();
  return Object.freeze({...base,outcome:'refused',reason:v.reason as ViewingRefusalReason,result:null});
 }
 if(v.outcome!=='applied'||v.reason!==null||expectedVersion!==observedVersion||viewingId===null)return fail();
 const result=validateViewingSchedule(v.result);if(result.viewingId!==viewingId||result.enquiryId!==enquiry)return fail();
 if(original.kind==='request'){
  if(result.status!=='requested'||result.version!=='1'||result.listingId!==original.command.listingId||JSON.stringify(result.preferredSlots)!==JSON.stringify(original.command.preferredSlots)||original.command.preferredSlots.some(s=>s.startAt<=completedAt))return fail();
 }else if(expectedVersion!=='1'||result.version!=='2'||result.status!=='proposed'||JSON.stringify(result.proposedSlot)!==JSON.stringify(original.command.slot)||original.command.slot.startAt<=completedAt)return fail();
 return Object.freeze({...base,outcome:'applied',reason:null,result});
}
export function validateViewingDetail(input:unknown,enquiryId:string,viewingId?:string):ViewingDetail{
 if(!input||typeof input!=='object')return fail();const descriptor=Object.getOwnPropertyDescriptor(input,'schedule');if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))return fail();
 const schedule=validateViewingSchedule(descriptor.value),hasAgreement=!!schedule.agreement,ended=!!schedule.termination,attended=!!schedule.outcome;
 const v=record(input,['schedule','notes','requestedById','assignedAgentId','createdAt','updatedAt',...(hasAgreement?['confirmation']:[]),...(ended?['terminationRecord']:[]),...(attended?['outcomeRecord']:[])]),createdAt=instant(v.createdAt),updatedAt=instant(v.updatedAt);
 if(schedule.enquiryId!==uuid(enquiryId)||viewingId!==undefined&&schedule.viewingId!==uuid(viewingId)||createdAt>updatedAt
  ||schedule.status==='requested'&&(schedule.version!=='1'||createdAt!==updatedAt)||schedule.status==='proposed'&&schedule.version!==(schedule.cycle?.proposalVersion??'2')
  ||schedule.preferredSlots.some(slot=>slot.startAt<=createdAt))return fail();
 const previous=schedule.termination?.previousUpdatedAt??schedule.outcome?.previousUpdatedAt??updatedAt;
 if(schedule.cycle&&(schedule.cycle.previousUpdatedAt<createdAt||schedule.cycle.proposedAt>previous||schedule.status==='proposed'&&updatedAt!==schedule.cycle.proposedAt))return fail();
 if(schedule.proposedSlot!==null&&schedule.proposedSlot.startAt<=previous)return fail();
 if(schedule.termination&&(schedule.termination.endedAt!==updatedAt||previous<createdAt||schedule.termination.fromStatus==='requested'&&previous!==createdAt))return fail();
 if(schedule.outcome&&(schedule.outcome.recordedAt!==updatedAt||previous<createdAt))return fail();
 const base={schedule,notes:privateNotes(v.notes),requestedById:uuid(v.requestedById),assignedAgentId:v.assignedAgentId===null?null:uuid(v.assignedAgentId),createdAt,updatedAt};
 let confirmation:ViewingDetail['confirmation'];
 if(hasAgreement){const metadata=record(v.confirmation,['proposedAt','recordedAt','recordedById']),proposedAt=instant(metadata.proposedAt),recordedAt=instant(metadata.recordedAt),recordedById=uuid(metadata.recordedById);
  if(schedule.cycle&&proposedAt!==schedule.cycle.proposedAt||!schedule.agreement||recordedAt!==previous||proposedAt<createdAt||proposedAt>schedule.agreement.agreedAt||schedule.agreement.agreedAt>recordedAt)return fail();
  confirmation=Object.freeze({proposedAt,recordedAt,recordedById});
 }
 let terminationRecord:ViewingDetail['terminationRecord'];if(ended){const metadata=record(v.terminationRecord,['recordedById']);terminationRecord=Object.freeze({recordedById:uuid(metadata.recordedById)});}
 let outcomeRecord:ViewingDetail['outcomeRecord'];if(attended){const metadata=record(v.outcomeRecord,['recordedById']);outcomeRecord=Object.freeze({recordedById:uuid(metadata.recordedById)});}
 return Object.freeze({...base,...(confirmation?{confirmation}:{}),...(terminationRecord?{terminationRecord}:{}),...(outcomeRecord?{outcomeRecord}:{})});
}
/** Dedicated confirmation receipt preserves existing request/proposal original contracts. */
export function validateViewingConfirmationReceipt(input:unknown,enquiryId:string,viewingId:string,commandInput:ViewingConfirmationCommand):ViewingConfirmationReceipt{
 const command=validateViewingConfirmationCommand(commandInput),v=record(input,['operationId','enquiryId','viewingId','actorId','kind','expectedVersion','observedVersion','request','outcome','reason','result','completedAt']);
 const operationId=uuid(v.operationId),enquiry=uuid(v.enquiryId),viewing=uuid(v.viewingId),actorId=uuid(v.actorId),expectedVersion=version(v.expectedVersion),observedVersion=version(v.observedVersion),completedAt=instant(v.completedAt);
 if(operationId!==command.operationId||enquiry!==uuid(enquiryId)||viewing!==uuid(viewingId)||v.kind!=='confirm'||expectedVersion!==command.expectedVersion)return fail();
 const facts=record(v.request,['slot','channel','agreedAt','notes']),request=validateViewingConfirmationCommand({...facts,operationId,expectedVersion});
 if(JSON.stringify(request.slot)!==JSON.stringify(command.slot)||request.channel!==command.channel||request.agreedAt!==command.agreedAt||request.notes!==command.notes)return fail();
 const base={operationId,enquiryId:enquiry,viewingId:viewing,actorId,kind:'confirm' as const,expectedVersion,observedVersion,request:Object.freeze({slot:request.slot,channel:request.channel,agreedAt:request.agreedAt,notes:request.notes}),completedAt};
 if(v.outcome==='conflict'){if(v.reason!=='VERSION_CONFLICT'||v.result!==null||expectedVersion===observedVersion)return fail();return Object.freeze({...base,outcome:'conflict',reason:'VERSION_CONFLICT',result:null});}
 if(v.outcome==='refused'){
  if(v.result!==null||expectedVersion!==observedVersion||typeof v.reason!=='string'||!['ENQUIRY_CLOSED','LISTING_UNAVAILABLE','INVALID_STATE','PROPOSED_SLOT_MISMATCH','SLOT_NOT_FUTURE','AGREEMENT_BEFORE_PROPOSAL','AGREEMENT_IN_FUTURE'].includes(v.reason))return fail();
  if(v.reason==='SLOT_NOT_FUTURE'&&request.slot.startAt>completedAt||v.reason==='AGREEMENT_IN_FUTURE'&&request.agreedAt<=completedAt)return fail();
  return Object.freeze({...base,outcome:'refused',reason:v.reason as Extract<ViewingConfirmationReceipt,{outcome:'refused'}>['reason'],result:null});
 }
 if(v.outcome!=='applied'||v.reason!==null||expectedVersion!==observedVersion||request.agreedAt>completedAt||request.slot.startAt<=completedAt)return fail();
 const result=validateViewingSchedule(v.result);
 if(result.status!=='confirmed'||expectedVersion!==(result.cycle?.proposalVersion??'2')||result.version!==String(BigInt(expectedVersion)+1n)||result.viewingId!==viewing||result.enquiryId!==enquiry||JSON.stringify(result.proposedSlot)!==JSON.stringify(command.slot)||JSON.stringify(result.agreement)!==JSON.stringify({channel:command.channel,agreedAt:command.agreedAt,notes:command.notes}))return fail();
 return Object.freeze({...base,outcome:'applied',reason:null,result:result as ConfirmedViewingSchedule});
}
export type ViewingTerminationReceipt=Readonly<{operationId:string;enquiryId:string;viewingId:string;actorId:string;kind:ViewingTerminationKind;expectedVersion:string;observedVersion:string;request:Readonly<{reason:string}>;completedAt:string}>&(
 Readonly<{outcome:'applied';reason:null;result:TerminatedViewingSchedule}>|Readonly<{outcome:'conflict';reason:'VERSION_CONFLICT';result:null}>|Readonly<{outcome:'refused';reason:'INVALID_STATE'|'RECORD_TIME_IN_FUTURE';result:null}>);
export function validateViewingTerminationReceipt(input:unknown,enquiryId:string,viewingId:string,kind:ViewingTerminationKind,commandInput:ViewingTerminationCommand):ViewingTerminationReceipt{
 if(kind!=='cancel'&&kind!=='decline')return fail();
 const command=validateViewingTerminationCommand(commandInput),v=record(input,['operationId','enquiryId','viewingId','actorId','kind','expectedVersion','observedVersion','request','outcome','reason','result','completedAt']);
 const operationId=uuid(v.operationId),enquiry=uuid(v.enquiryId),viewing=uuid(v.viewingId),actorId=uuid(v.actorId),expectedVersion=version(v.expectedVersion),observedVersion=version(v.observedVersion),completedAt=instant(v.completedAt),facts=record(v.request,['reason']),reason=terminationReason(facts.reason);
 if(operationId!==command.operationId||enquiry!==uuid(enquiryId)||viewing!==uuid(viewingId)||v.kind!==kind||expectedVersion!==command.expectedVersion||reason!==command.reason)return fail();
 const base={operationId,enquiryId:enquiry,viewingId:viewing,actorId,kind,expectedVersion,observedVersion,request:Object.freeze({reason}),completedAt};
 if(v.outcome==='conflict'){if(v.reason!=='VERSION_CONFLICT'||v.result!==null||expectedVersion===observedVersion)return fail();return Object.freeze({...base,outcome:'conflict',reason:'VERSION_CONFLICT',result:null});}
 if(v.outcome==='refused'){if(v.result!==null||expectedVersion!==observedVersion||!['INVALID_STATE','RECORD_TIME_IN_FUTURE'].includes(v.reason as string))return fail();return Object.freeze({...base,outcome:'refused',reason:v.reason as 'INVALID_STATE'|'RECORD_TIME_IN_FUTURE',result:null});}
 if(v.outcome!=='applied'||v.reason!==null||expectedVersion!==observedVersion)return fail();const result=validateViewingSchedule(v.result),terminal=result.termination;
 if(!terminal||result.viewingId!==viewing||result.enquiryId!==enquiry||terminal.kind!==kind||terminal.reason!==reason||terminal.endedAt!==completedAt
  ||expectedVersion!==(result.cycle?String(BigInt(result.cycle.proposalVersion)+(terminal.fromStatus==='confirmed'?1n:0n)):({requested:'1',proposed:'2',confirmed:'3'}[terminal.fromStatus]))||result.version!==String(BigInt(expectedVersion)+1n))return fail();
 return Object.freeze({...base,outcome:'applied',reason:null,result:result as TerminatedViewingSchedule});
}
export type ViewingRescheduleReceipt=Readonly<{operationId:string;enquiryId:string;viewingId:string;actorId:string;kind:'reschedule';expectedVersion:string;observedVersion:string;request:Readonly<{slot:ViewingSlot;reason:string}>;completedAt:string}>&(
 Readonly<{outcome:'applied';reason:null;result:ViewingSchedule&Readonly<{status:'proposed';cycle:ViewingCycle}>}>|
 Readonly<{outcome:'conflict';reason:'VERSION_CONFLICT';result:null}>|
 Readonly<{outcome:'refused';reason:'ENQUIRY_CLOSED'|'LISTING_UNAVAILABLE'|'INVALID_STATE'|'RECORD_TIME_IN_FUTURE'|'SLOT_UNCHANGED'|'SLOT_NOT_FUTURE';result:null}>);
export function validateViewingRescheduleReceipt(input:unknown,enquiryId:string,viewingId:string,commandInput:ViewingRescheduleCommand):ViewingRescheduleReceipt{
 const command=validateViewingRescheduleCommand(commandInput),v=record(input,['operationId','enquiryId','viewingId','actorId','kind','expectedVersion','observedVersion','request','outcome','reason','result','completedAt']);
 const operationId=uuid(v.operationId),enquiry=uuid(v.enquiryId),viewing=uuid(v.viewingId),actorId=uuid(v.actorId),expectedVersion=version(v.expectedVersion),observedVersion=version(v.observedVersion),completedAt=instant(v.completedAt),facts=record(v.request,['slot','reason']);
 const slot=validateViewingSlot(facts.slot),reason=terminationReason(facts.reason);
 if(v.kind!=='reschedule'||operationId!==command.operationId||enquiry!==uuid(enquiryId)||viewing!==uuid(viewingId)||expectedVersion!==command.expectedVersion||JSON.stringify(slot)!==JSON.stringify(command.slot)||reason!==command.reason)return fail();
 const base={operationId,enquiryId:enquiry,viewingId:viewing,actorId,kind:'reschedule' as const,expectedVersion,observedVersion,request:Object.freeze({slot,reason}),completedAt};
 if(v.outcome==='conflict'){if(v.reason!=='VERSION_CONFLICT'||v.result!==null||expectedVersion===observedVersion)return fail();return Object.freeze({...base,outcome:'conflict',reason:'VERSION_CONFLICT',result:null});}
 if(v.outcome==='refused'){if(v.result!==null||expectedVersion!==observedVersion||!['ENQUIRY_CLOSED','LISTING_UNAVAILABLE','INVALID_STATE','RECORD_TIME_IN_FUTURE','SLOT_UNCHANGED','SLOT_NOT_FUTURE'].includes(v.reason as string)||v.reason==='SLOT_NOT_FUTURE'&&slot.startAt>completedAt)return fail();return Object.freeze({...base,outcome:'refused',reason:v.reason as Extract<ViewingRescheduleReceipt,{outcome:'refused'}>['reason'],result:null});}
 if(v.outcome!=='applied'||v.reason!==null||expectedVersion!==observedVersion)return fail();const result=validateViewingSchedule(v.result);
 if(result.status!=='proposed'||!result.cycle||result.viewingId!==viewing||result.enquiryId!==enquiry||result.version!==String(BigInt(expectedVersion)+1n)
  ||JSON.stringify(result.proposedSlot)!==JSON.stringify(slot)||result.cycle.reason!==reason||result.cycle.proposedAt!==completedAt||slot.startAt<=completedAt)return fail();
 return Object.freeze({...base,outcome:'applied',reason:null,result:result as ViewingSchedule&Readonly<{status:'proposed';cycle:ViewingCycle}>});
}
export function validateViewingPage(input:unknown,enquiryId:string,limit:number):ViewingPage{
 const v=record(input,['items','limit','truncated']);uuid(enquiryId);
 if(!Number.isSafeInteger(limit)||limit<1||limit>25||v.limit!==limit||typeof v.truncated!=='boolean'||!Array.isArray(v.items)||Object.getPrototypeOf(v.items)!==Array.prototype||v.items.length>limit||Reflect.ownKeys(v.items).length!==v.items.length+1||v.truncated&&v.items.length!==limit)return fail();
 const items:ViewingDetail[]=[],seen=new Set<string>();for(let i=0;i<v.items.length;i++){
  const descriptor=Object.getOwnPropertyDescriptor(v.items,String(i));if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))return fail();const current=validateViewingDetail(descriptor.value,enquiryId),previous=items.at(-1),id=current.schedule.viewingId;
  if(seen.has(id)||previous&&(previous.createdAt<current.createdAt||previous.createdAt===current.createdAt&&previous.schedule.viewingId>=id))return fail();seen.add(id);items.push(current);
 }return Object.freeze({items:Object.freeze(items),limit,truncated:v.truncated});
}
/** Current staff history projection, separate from requester-private original command receipts. */
export function validateViewingHistoryPage(input:unknown,enquiryId:string,viewingId:string,limit:number):ViewingHistoryPage{
 const v=record(input,['items','limit','truncated','currentVersion']),enquiry=uuid(enquiryId),viewing=uuid(viewingId),currentVersion=version(v.currentVersion);
 if(!Number.isSafeInteger(limit)||limit<1||limit>25||v.limit!==limit||typeof v.truncated!=='boolean'
  ||!Array.isArray(v.items)||Object.getPrototypeOf(v.items)!==Array.prototype||Reflect.ownKeys(v.items).length!==v.items.length+1
  ||v.items.length!==Math.min(limit,Number(currentVersion))||v.truncated!==(BigInt(currentVersion)>BigInt(limit)))return fail();
 const items:ViewingHistoryEntry[]=[];
 for(let i=0;i<v.items.length;i++){
  const d=Object.getOwnPropertyDescriptor(v.items,String(i));if(!d?.enumerable||!Object.hasOwn(d,'value'))return fail();
  const item=record(d.value,['kind','actorId','recordedAt','schedule']),schedule=validateViewingSchedule(item.schedule),actorId=uuid(item.actorId),recordedAt=instant(item.recordedAt);
  if(!['request','propose','confirm','cancel','decline','reschedule','complete','no_show'].includes(item.kind as string)||schedule.viewingId!==viewing||schedule.enquiryId!==enquiry
   ||schedule.version!==String(BigInt(currentVersion)-BigInt(i))||schedule.status!==({request:'requested',propose:'proposed',confirm:'confirmed',cancel:'cancelled',decline:'declined',reschedule:'proposed',complete:'completed',no_show:'no_show'}[item.kind as ViewingHistoryEntry['kind']]))return fail();
  if(item.kind==='request'&&(schedule.version!=='1'||schedule.cycle)||item.kind==='propose'&&(schedule.version!=='2'||schedule.cycle)||item.kind==='confirm'&&schedule.version!==String(BigInt(schedule.cycle?.proposalVersion??'2')+1n)
   ||item.kind==='reschedule'&&(!schedule.cycle||schedule.version!==schedule.cycle.proposalVersion||schedule.cycle.proposedAt!==recordedAt))return fail();
  if(schedule.status==='proposed'||schedule.status==='confirmed'){if(!schedule.proposedSlot||schedule.proposedSlot.startAt<=recordedAt)return fail();}
  if(schedule.cycle&&schedule.cycle.proposedAt>recordedAt||schedule.outcome&&schedule.outcome.recordedAt!==recordedAt)return fail();
  if(schedule.agreement&&!schedule.termination&&schedule.agreement.agreedAt>recordedAt||schedule.termination&&schedule.termination.endedAt!==recordedAt)return fail();
  const newer=items.at(-1);
  if(newer){
   if(newer.recordedAt<recordedAt||newer.schedule.listingId!==schedule.listingId||JSON.stringify(newer.schedule.preferredSlots)!==JSON.stringify(schedule.preferredSlots))return fail();
   if(newer.kind==='reschedule'){const cycle=newer.schedule.cycle;if(!cycle||!['proposed','confirmed'].includes(schedule.status)||cycle.previousStatus!==schedule.status||cycle.previousUpdatedAt!==recordedAt
     ||cycle.number!==String(BigInt(schedule.cycle?.number??'1')+1n)||JSON.stringify(newer.schedule.proposedSlot)===JSON.stringify(schedule.proposedSlot)||newer.schedule.agreement)return fail();}
   else if(JSON.stringify(newer.schedule.cycle)!==JSON.stringify(schedule.cycle))return fail();
   if(newer.schedule.termination){if(newer.schedule.termination.fromStatus!==schedule.status||newer.schedule.termination.previousUpdatedAt!==recordedAt
     ||JSON.stringify(newer.schedule.proposedSlot)!==JSON.stringify(schedule.proposedSlot)||JSON.stringify(newer.schedule.agreement)!==JSON.stringify(schedule.agreement))return fail();}
   else if(newer.schedule.outcome&&(schedule.status!=='confirmed'||newer.schedule.outcome.previousUpdatedAt!==recordedAt||JSON.stringify(newer.schedule.proposedSlot)!==JSON.stringify(schedule.proposedSlot)||JSON.stringify(newer.schedule.agreement)!==JSON.stringify(schedule.agreement)))return fail();
   else if(newer.kind==='confirm'&&(schedule.status!=='proposed'||JSON.stringify(newer.schedule.proposedSlot)!==JSON.stringify(schedule.proposedSlot)||!newer.schedule.agreement||newer.schedule.agreement.agreedAt<recordedAt))return fail();
   else if(newer.kind==='propose'&&schedule.status!=='requested')return fail();
  }
  items.push(Object.freeze({kind:item.kind as ViewingHistoryEntry['kind'],actorId,recordedAt,schedule}));
 }
 return Object.freeze({items:Object.freeze(items),limit,truncated:v.truncated,currentVersion});
}

/** Exact historical outcome receipt; current authorization and fresh execution policy live in SQL. */
export function validateViewingOutcomeReceipt(input:unknown,enquiryId:string,viewingId:string,kind:ViewingOutcomeKind,commandInput:ViewingOutcomeCommand):ViewingOutcomeReceipt{
 if(kind!=='complete'&&kind!=='no_show')return fail();const command=validateViewingOutcomeCommand(commandInput);
 const v=record(input,['operationId','enquiryId','viewingId','actorId','kind','expectedVersion','observedVersion','request','outcome','reason','result','completedAt']);
 const operationId=uuid(v.operationId),enquiry=uuid(v.enquiryId),viewing=uuid(v.viewingId),actorId=uuid(v.actorId),expectedVersion=version(v.expectedVersion),observedVersion=version(v.observedVersion),completedAt=instant(v.completedAt),request=record(v.request,['occurredAt','reason']);
 const occurredAt=instant(request.occurredAt),reason=terminationReason(request.reason);
 if(operationId!==command.operationId||enquiry!==uuid(enquiryId)||viewing!==uuid(viewingId)||v.kind!==kind||expectedVersion!==command.expectedVersion||occurredAt!==command.occurredAt||reason!==command.reason)return fail();
 const base={operationId,enquiryId:enquiry,viewingId:viewing,actorId,kind,expectedVersion,observedVersion,completedAt,request:Object.freeze({occurredAt,reason})};
 if(v.outcome==='conflict'){if(v.reason!=='VERSION_CONFLICT'||expectedVersion===observedVersion||v.result!==null)return fail();return Object.freeze({...base,outcome:'conflict',reason:'VERSION_CONFLICT',result:null});}
 if(v.outcome==='refused'){if(expectedVersion!==observedVersion||v.result!==null||!['INVALID_STATE','RECORD_TIME_IN_FUTURE','SLOT_NOT_ENDED','OUTCOME_BEFORE_SLOT_END','OUTCOME_IN_FUTURE'].includes(v.reason as string)||v.reason==='OUTCOME_IN_FUTURE'&&occurredAt<=completedAt)return fail();return Object.freeze({...base,outcome:'refused',reason:v.reason as Extract<ViewingOutcomeReceipt,{outcome:'refused'}>['reason'],result:null});}
 if(v.outcome!=='applied'||v.reason!==null||expectedVersion!==observedVersion)return fail();const result=validateViewingSchedule(v.result);
 if(!result.outcome||result.viewingId!==viewing||result.enquiryId!==enquiry||result.version!==String(BigInt(expectedVersion)+1n)||result.outcome.kind!==kind||result.outcome.reason!==reason||result.outcome.occurredAt!==occurredAt||result.outcome.recordedAt!==completedAt)return fail();
 return Object.freeze({...base,outcome:'applied',reason:null,result:result as Extract<ViewingOutcomeReceipt,{outcome:'applied'}>['result']});
}
