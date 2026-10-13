/** Pilot request/proposal contracts only. Authorization and durable replay belong to SQL/API. */
export interface ViewingSlot {readonly startAt:string;readonly endAt:string;readonly timeZone:'Africa/Nairobi'}
export interface ViewingRequestCommand {readonly operationId:string;readonly expectedEnquiryVersion:string;readonly listingId:string;readonly preferredSlots:readonly ViewingSlot[];readonly notes:string}
export interface ViewingProposalCommand {readonly operationId:string;readonly expectedVersion:string;readonly slot:ViewingSlot}
export interface ViewingSchedule {readonly viewingId:string;readonly enquiryId:string;readonly listingId:string;readonly version:string;readonly status:'requested'|'proposed';readonly preferredSlots:readonly ViewingSlot[];readonly proposedSlot:ViewingSlot|null}
export type ViewingProposalPlan=Readonly<{outcome:'applied';reason:null;next:ViewingSchedule}>|Readonly<{outcome:'conflict';reason:'VERSION_CONFLICT';next:null}>|Readonly<{outcome:'refused';reason:'INVALID_STATE'|'SLOT_NOT_FUTURE';next:null}>;
export type ViewingOriginal=Readonly<{kind:'request';command:ViewingRequestCommand}>|Readonly<{kind:'propose';viewingId:string;command:ViewingProposalCommand}>;
export type ViewingRefusalReason='ENQUIRY_CLOSED'|'LISTING_MISMATCH'|'LISTING_UNAVAILABLE'|'INVALID_STATE'|'SLOT_NOT_FUTURE';
export type ViewingReceipt=Readonly<{operationId:string;enquiryId:string;viewingId:string|null;actorId:string;kind:'request'|'propose';expectedVersion:string;observedVersion:string;request:Readonly<{listingId:string;preferredSlots:readonly ViewingSlot[];notes:string}>|Readonly<{slot:ViewingSlot}>;completedAt:string}>&(
 Readonly<{outcome:'applied';reason:null;result:ViewingSchedule}>|Readonly<{outcome:'conflict';reason:'VERSION_CONFLICT';result:null}>|Readonly<{outcome:'refused';reason:ViewingRefusalReason;result:null}>);
export interface ViewingDetail {readonly schedule:ViewingSchedule;readonly notes:string;readonly requestedById:string;readonly assignedAgentId:string|null;readonly createdAt:string;readonly updatedAt:string}
export interface ViewingPage {readonly items:readonly ViewingDetail[];readonly limit:number;readonly truncated:boolean}
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
export function validateViewingSchedule(input:unknown):ViewingSchedule{
 const v=record(input,['viewingId','enquiryId','listingId','version','status','preferredSlots','proposedSlot']);
 if(v.status!=='requested'&&v.status!=='proposed'||v.status==='requested'&&v.proposedSlot!==null||v.status==='proposed'&&v.proposedSlot===null)return fail();
 return Object.freeze({viewingId:uuid(v.viewingId),enquiryId:uuid(v.enquiryId),listingId:uuid(v.listingId),version:version(v.version),status:v.status,preferredSlots:alternatives(v.preferredSlots),proposedSlot:v.proposedSlot===null?null:validateViewingSlot(v.proposedSlot)});
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
 const v=record(input,['schedule','notes','requestedById','assignedAgentId','createdAt','updatedAt']),schedule=validateViewingSchedule(v.schedule),createdAt=instant(v.createdAt),updatedAt=instant(v.updatedAt);
 if(schedule.enquiryId!==uuid(enquiryId)||viewingId!==undefined&&schedule.viewingId!==uuid(viewingId)||createdAt>updatedAt
  ||schedule.status==='requested'&&(schedule.version!=='1'||createdAt!==updatedAt)||schedule.status==='proposed'&&schedule.version!=='2'
  ||schedule.preferredSlots.some(s=>s.startAt<=createdAt)||schedule.proposedSlot!==null&&schedule.proposedSlot.startAt<=updatedAt)return fail();
 return Object.freeze({schedule,notes:privateNotes(v.notes),requestedById:uuid(v.requestedById),assignedAgentId:v.assignedAgentId===null?null:uuid(v.assignedAgentId),createdAt,updatedAt});
}
export function validateViewingPage(input:unknown,enquiryId:string,limit:number):ViewingPage{
 const v=record(input,['items','limit','truncated']);uuid(enquiryId);
 if(!Number.isSafeInteger(limit)||limit<1||limit>25||v.limit!==limit||typeof v.truncated!=='boolean'||!Array.isArray(v.items)||Object.getPrototypeOf(v.items)!==Array.prototype||v.items.length>limit||Reflect.ownKeys(v.items).length!==v.items.length+1||v.truncated&&v.items.length!==limit)return fail();
 const items:ViewingDetail[]=[],seen=new Set<string>();for(let i=0;i<v.items.length;i++){
  const descriptor=Object.getOwnPropertyDescriptor(v.items,String(i));if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))return fail();const current=validateViewingDetail(descriptor.value,enquiryId),previous=items.at(-1),id=current.schedule.viewingId;
  if(seen.has(id)||previous&&(previous.createdAt<current.createdAt||previous.createdAt===current.createdAt&&previous.schedule.viewingId>=id))return fail();seen.add(id);items.push(current);
 }return Object.freeze({items:Object.freeze(items),limit,truncated:v.truncated});
}
