export interface EnquiryActivityEvent {
 readonly eventId:string;readonly kind:'received'|'assign'|'transition'|'reschedule';readonly actorId:string|null;
 readonly occurredAt:string;readonly version:string;readonly status:string;readonly assignedAgentId:string|null;readonly nextActionAt:string|null;
}
export interface EnquiryActivityPage {readonly items:readonly EnquiryActivityEvent[];readonly limit:number;readonly truncated:boolean;readonly coverage:'capture-and-v2-operations';readonly currentVersion:string}
const fail=():never=>{throw new Error('Invalid enquiry activity.');};
function object(input:unknown,fields:readonly string[]):Record<string,unknown>{
 if(!input||typeof input!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(input)))return fail();
 const keys=Reflect.ownKeys(input);if(keys.length!==fields.length||keys.some(k=>typeof k!=='string'||!fields.includes(k)))return fail();
 const result:Record<string,unknown>={};for(const key of fields){const d=Object.getOwnPropertyDescriptor(input,key);if(!d?.enumerable||!Object.hasOwn(d,'value'))return fail();result[key]=d.value;}return result;
}
function uuid(input:unknown):string{if(typeof input!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input))return fail();return input;}
function version(input:unknown):string{if(typeof input!=='string'||! /^[1-9]\d{0,15}$/.test(input)||BigInt(input)>9007199254740991n)return fail();return input;}
function time(input:unknown):string{if(typeof input!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input)||!Number.isFinite(Date.parse(input))||new Date(input).toISOString()!==input)return fail();return input;}
/** Strict minimal projection; rejects hidden fields, impossible order and invented full-history coverage. */
export function validateEnquiryActivityPage(input:unknown,expectedLimit:number):EnquiryActivityPage{
 if(!Number.isSafeInteger(expectedLimit)||expectedLimit<1||expectedLimit>100)return fail();
 const page=object(input,['items','limit','truncated','coverage','currentVersion']);
 if(page.limit!==expectedLimit||typeof page.truncated!=='boolean'||page.coverage!=='capture-and-v2-operations'||!Array.isArray(page.items)||Object.getPrototypeOf(page.items)!==Array.prototype||page.items.length<1||page.items.length>expectedLimit||Reflect.ownKeys(page.items).length!==page.items.length+1||page.truncated&&page.items.length!==expectedLimit)return fail();
 const currentVersion=version(page.currentVersion);let previous=BigInt(currentVersion)+1n;
 const items:EnquiryActivityEvent[]=[];
 for(let i=0;i<page.items.length;i++){
  const d=Object.getOwnPropertyDescriptor(page.items,String(i));if(!d||!Object.hasOwn(d,'value'))return fail();
  const e=object(d.value,['eventId','kind','actorId','occurredAt','version','status','assignedAgentId','nextActionAt']);
  const eventId=uuid(e.eventId),v=version(e.version),occurredAt=time(e.occurredAt),actorId=e.actorId===null?null:uuid(e.actorId),assignedAgentId=e.assignedAgentId===null?null:uuid(e.assignedAgentId),nextActionAt=e.nextActionAt===null?null:time(e.nextActionAt);
  if(typeof e.kind!=='string'||typeof e.status!=='string'||!['received','assign','transition','reschedule'].includes(String(e.kind))||!['new','assigned','contacted','qualified','closed_won','closed_lost','spam'].includes(String(e.status))||BigInt(v)>=previous)return fail();previous=BigInt(v);
  if((['contacted','qualified'].includes(String(e.status)))!==(nextActionAt!==null))return fail();
  if(e.kind==='received'?(v!=='1'||e.status!=='new'||assignedAgentId!==null):(v==='1'||actorId===null))return fail();
  if(e.kind==='assign'&&(assignedAgentId===null||e.status==='new')||e.kind==='reschedule'&&!['contacted','qualified'].includes(String(e.status)))return fail();
  items.push(Object.freeze({eventId,kind:e.kind as EnquiryActivityEvent['kind'],actorId,occurredAt,version:v,status:e.status as string,assignedAgentId,nextActionAt}));
 }
 return Object.freeze({items:Object.freeze(items),limit:expectedLimit,truncated:page.truncated,coverage:'capture-and-v2-operations',currentVersion});
}
