/** Pilot request/proposal contracts only. Authorization and durable replay belong to SQL/API. */
export interface ViewingSlot {readonly startAt:string;readonly endAt:string;readonly timeZone:'Africa/Nairobi'}
export interface ViewingRequestCommand {readonly operationId:string;readonly expectedEnquiryVersion:string;readonly listingId:string;readonly preferredSlots:readonly ViewingSlot[];readonly notes:string}
export interface ViewingProposalCommand {readonly operationId:string;readonly expectedVersion:string;readonly slot:ViewingSlot}
export interface ViewingSchedule {readonly viewingId:string;readonly enquiryId:string;readonly listingId:string;readonly version:string;readonly status:'requested'|'proposed';readonly preferredSlots:readonly ViewingSlot[];readonly proposedSlot:ViewingSlot|null}
export type ViewingProposalPlan=Readonly<{outcome:'applied';reason:null;next:ViewingSchedule}>|Readonly<{outcome:'conflict';reason:'VERSION_CONFLICT';next:null}>|Readonly<{outcome:'refused';reason:'INVALID_STATE'|'SLOT_NOT_FUTURE';next:null}>;
const fail=():never=>{throw new Error('Invalid viewing scheduling contract.');};
function record(input:unknown,fields:readonly string[]):Record<string,unknown>{
 if(!input||typeof input!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(input)))return fail();
 const keys=Reflect.ownKeys(input);if(keys.length!==fields.length||keys.some(k=>typeof k!=='string'||!fields.includes(k)))return fail();
 const result:Record<string,unknown>={};for(const key of fields){const d=Object.getOwnPropertyDescriptor(input,key);if(!d?.enumerable||!Object.hasOwn(d,'value'))return fail();result[key]=d.value;}return result;
}
function uuid(input:unknown):string{if(typeof input!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input))return fail();return input;}
function version(input:unknown,increment=false):string{if(typeof input!=='string'||!/^[1-9]\d{0,15}$/.test(input)||BigInt(input)>BigInt(Number.MAX_SAFE_INTEGER)-(increment?1n:0n))return fail();return input;}
function instant(input:unknown):string{if(typeof input!=='string'||!/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input)||!Number.isFinite(Date.parse(input))||new Date(input).toISOString()!==input)return fail();return input;}
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
 if(typeof v.notes!=='string'||!v.notes.trim()||[...v.notes].length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ud800-\udfff]/u.test(v.notes))return fail();
 return Object.freeze({operationId:uuid(v.operationId),expectedEnquiryVersion:version(v.expectedEnquiryVersion),listingId:uuid(v.listingId),preferredSlots:alternatives(v.preferredSlots),notes:v.notes});
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
