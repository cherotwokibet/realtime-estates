import {DomainError} from './errors.js';
import {kesFromMinor,type RentalPeriod} from './money.js';
import {calculateWirePricingV2,validatePricingInputV2,validatePublicLocationV2,type PricingInputV2,type PublicLocationV2} from './listing-contract-v2.js';
export type StaffDraftPropertyTypeV2='apartment'|'bedsitter'|'studio'|'bungalow'|'maisonette'|'townhouse'|'villa'|'commercial'|'land';
export interface StaffDraftContentV2 {
 readonly title:string|null;readonly description:string|null;readonly purpose:'rent'|'sale'|null;readonly propertyType:StaffDraftPropertyTypeV2|null;
 readonly currency:'KES';readonly amountMinor:number|null;readonly rentPeriod:RentalPeriod|null;
 readonly bedrooms:number|null;readonly privateBathrooms:number|null;readonly sharedBathrooms:number|null;
 readonly country:'KE';readonly locality:string|null;readonly publicPrecision:'area'|'exact';
 readonly latitude:number|null;readonly longitude:number|null;readonly privateAddress:string|null;
 readonly pricing:PricingInputV2;readonly location:PublicLocationV2;
}
/** Full replacement: omitted base fields become null/defaults rather than a patch. */
export type StaffDraftContentInputV2=Partial<StaffDraftContentV2>&Pick<StaffDraftContentV2,'pricing'|'location'>;
export const STAFF_DRAFT_CONTENT_FIELDS=['title','description','purpose','propertyType','currency','amountMinor','rentPeriod','bedrooms','privateBathrooms','sharedBathrooms','country','locality','publicPrecision','latitude','longitude','privateAddress','pricing','location'] as const;
const DRAFT_TYPES:readonly string[]=['apartment','bedsitter','studio','bungalow','maisonette','townhouse','villa','commercial','land'];
const invalid=(message:string):never=>{throw new DomainError('INVALID_STAFF_DRAFT_CONTENT_V2',message);};
function draftRecord(input:unknown,requireAll:boolean):Record<string,unknown>{
 if(!input||typeof input!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(input)))return invalid('Use a plain draft data record.');
 const out:Record<string,unknown>={};
 for(const key of Reflect.ownKeys(input)){
  if(typeof key!=='string'||!STAFF_DRAFT_CONTENT_FIELDS.includes(key as typeof STAFF_DRAFT_CONTENT_FIELDS[number]))return invalid('Unsupported draft fields.');
  const d=Object.getOwnPropertyDescriptor(input,key);if(!d?.enumerable||!Object.hasOwn(d,'value')||requireAll&&d.value===undefined)return invalid('Use own JSON data fields.');out[key]=d.value;
 }
 return out;
}
function draftText(input:unknown,max:number,label:string):string{
 if(typeof input!=='string')return invalid(label+' is missing or invalid.');const trimmed=input.trim();
 if([...trimmed].length<1||[...trimmed].length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input)||/[\ud800-\udfff]/u.test(input))return invalid(label+' is missing or invalid.');return trimmed;
}
function draftInteger(input:unknown,min:number,max:number):number{if(typeof input!=='number'||!Number.isSafeInteger(input)||input<min||input>max)return invalid('Numeric draft field outside its supported range.');return input;}
/** Detached shared private draft normalization. Incomplete drafts remain incomplete; this does not authorize publication. */
export function normalizeStaffDraftContentV2(input:unknown,requireAll=false):StaffDraftContentV2{
  if(typeof requireAll!=='boolean')return invalid('Invalid normalization mode.');
  const value=draftRecord(input,requireAll);
  if(requireAll&&STAFF_DRAFT_CONTENT_FIELDS.some(field=>!Object.hasOwn(value,field)))return invalid('Incomplete staff response fields.');
  if(requireAll&&(value.currency!=='KES'||value.country!=='KE'||(value.publicPrecision!=='area'&&value.publicPrecision!=='exact')))return invalid('Invalid required staff defaults.');
  const nullableText=(input:unknown,max:number,label:string):string|null=>input==null||(typeof input==='string'&&!input.trim())?null:draftText(input,max,label);
  const nullableCount=(input:unknown):number|null=>input==null?null:draftInteger(input,0,100);
  const nullableCoordinate=(input:unknown,min:number,max:number):number|null=>{
    if(input==null)return null;if(typeof input!=='number'||!Number.isFinite(input)||input<min||input>max)return invalid('Invalid staff coordinates.');return input;
  };
  const title=nullableText(value.title,160,'Title'),description=nullableText(value.description,10000,'Description'),locality=nullableText(value.locality,160,'Locality');
  const purpose=value.purpose??null;if(purpose!==null&&purpose!=='rent'&&purpose!=='sale')return invalid('Invalid purpose.');
  const propertyType=value.propertyType??null;if(propertyType!==null&&(typeof propertyType!=='string'||!DRAFT_TYPES.includes(propertyType)))return invalid('Invalid property type.');
  if((value.currency??'KES')!=='KES'||(value.country??'KE')!=='KE')return invalid('Unsupported currency or country.');
  const amountMinor=value.amountMinor==null?null:draftInteger(value.amountMinor,1,100000000000000);
  const rentPeriod=value.rentPeriod??null;
  if(rentPeriod!==null&&(typeof rentPeriod!=='string'||!['day','week','month','year'].includes(rentPeriod)))return invalid('Invalid rental period.');
  if(purpose==='sale'&&rentPeriod!==null)return invalid('Sale drafts require a null rental period.');
  const bedrooms=nullableCount(value.bedrooms),privateBathrooms=nullableCount(value.privateBathrooms),sharedBathrooms=nullableCount(value.sharedBathrooms);
  if((propertyType==='land'&&bedrooms!==null)||((propertyType==='studio'||propertyType==='bedsitter')&&bedrooms!==null&&bedrooms!==0))return invalid('Rooms do not match the property type.');
  const publicPrecision=value.publicPrecision??'area';if(publicPrecision!=='area'&&publicPrecision!=='exact')return invalid('Invalid public precision.');
  const latitude=nullableCoordinate(value.latitude,-90,90),longitude=nullableCoordinate(value.longitude,-180,180);
  if((latitude===null)!==(longitude===null))return invalid('Staff coordinates must be supplied together.');
  let privateAddress:string|null=null;
  if(value.privateAddress!=null){
    if(typeof value.privateAddress!=='string'||[...value.privateAddress].length>1000||/[\ud800-\udfff]/u.test(value.privateAddress)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.privateAddress))return invalid('Invalid private address.');
    privateAddress=value.privateAddress;
  }
  let pricing:PricingInputV2;let location:PublicLocationV2;
  try{
    pricing=validatePricingInputV2(value.pricing);location=validatePublicLocationV2(value.location);
    if(purpose===null&&pricing.charges.length)throw new Error('Charges need a purpose');
    if(pricing.charges.some(charge=>(purpose!=='rent'&&charge.timing==='per_rental_period')||(charge.classification==='refundable_deposit'&&charge.timing!=='one_off')))throw new Error('Invalid charge purpose or classification');
    // The API allows incomplete drafts; derive/check totals only when the actual base and purpose are supplied.
    if(amountMinor!==null&&purpose!==null&&(purpose==='sale'||rentPeriod!==null))calculateWirePricingV2(kesFromMinor(amountMinor),purpose,rentPeriod as RentalPeriod|null,pricing);
  }catch{return invalid('Invalid staff pricing or location disclosure.');}
  return Object.freeze({title,description,purpose,propertyType:propertyType as StaffDraftPropertyTypeV2|null,currency:'KES',amountMinor,rentPeriod:rentPeriod as RentalPeriod|null,
    bedrooms,privateBathrooms,sharedBathrooms,country:'KE',locality,publicPrecision,latitude,longitude,privateAddress,pricing,location});
}
/** Canonicalize a full replacement without inventing values for unfinished fields. Submission/media rules remain server gates. */
