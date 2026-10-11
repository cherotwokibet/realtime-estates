import {
  calculateWirePricingV2, kesFromMinor, parseListingJsonV2, validatePricingInputV2, validatePublicLocationV2,
  type PricingDisclosure, type PricingInputV2, type PublicLocationV2,
} from '@realtor/domain';

/** Narrow, explicitly validated public API contracts. Identity and tenant selection remain server concerns. */
export interface PublicPhoto { readonly key: string; readonly alt: string }
export type PropertyType = 'apartment' | 'bedsitter' | 'studio' | 'bungalow' | 'maisonette' | 'townhouse' | 'villa' | 'commercial' | 'land';
export interface PublicProperty {
  readonly id: string; readonly slug: string; readonly revision: number; readonly title: string; readonly description: string;
  readonly purpose: 'rent' | 'sale'; readonly propertyType: PropertyType; readonly currency: 'KES'; readonly amountMinor: number;
  readonly rentPeriod: 'day' | 'week' | 'month' | 'year' | null;
  readonly bedrooms: number | null; readonly privateBathrooms: number | null; readonly sharedBathrooms: number | null;
  readonly country: 'KE'; readonly locality: string; readonly publicPrecision: 'area' | 'exact';
  readonly latitude: number | null; readonly longitude: number | null; readonly photos: readonly PublicPhoto[];
}
export interface PropertyPage { readonly items: readonly PublicProperty[]; readonly limit: number }
/** V2 derives known subtotals from validated inputs; undeclared or quote-required costs stay unresolved. */
export interface PublicPropertyV2 extends PublicProperty {
  readonly pricing: PricingDisclosure;
  readonly location: PublicLocationV2;
}
export interface PropertyPageV2 { readonly items: readonly PublicPropertyV2[]; readonly limit: number }
export type { PricingDisclosure, PricingInputV2, PricingChargeV2, PublicLocationV2 } from '@realtor/domain';
export interface StaffDraftContentV2 {
  readonly title:string|null;readonly description:string|null;readonly purpose:'rent'|'sale'|null;readonly propertyType:PropertyType|null;
  readonly currency:'KES';readonly amountMinor:number|null;readonly rentPeriod:PublicProperty['rentPeriod'];
  readonly bedrooms:number|null;readonly privateBathrooms:number|null;readonly sharedBathrooms:number|null;
  readonly country:'KE';readonly locality:string|null;readonly publicPrecision:'area'|'exact';
  readonly latitude:number|null;readonly longitude:number|null;readonly privateAddress:string|null;
  readonly pricing:PricingInputV2;readonly location:PublicLocationV2;
}
/** Save is full replacement: omitted base fields become null/defaults, not a partial patch. */
export type StaffDraftContentInputV2=Partial<StaffDraftContentV2>&Pick<StaffDraftContentV2,'pricing'|'location'>;
export interface StaffDraftV2 {
  readonly revision:number;readonly state:'draft'|'pending'|'approved'|'rejected';readonly version:string;readonly content:StaffDraftContentV2;
}
export interface StaffVersionReceipt {readonly version:string}
export interface StaffDraftSaveV2 {readonly expectedVersion:string;readonly content:StaffDraftContentInputV2}
export interface StaffDraftSubmitV2 {readonly expectedVersion:string}
export interface ReviewMetadataV2 {
  readonly listingId:string;readonly slug:string;readonly revision:number;readonly version:string;readonly listingVersion:string;
  readonly publicationStatus:'unpublished'|'published'|'paused'|'archived';readonly publishedRevision:number|null;
  readonly availability:'available'|'reserved'|'rented'|'sold'|'withdrawn';readonly lastAvailabilityConfirmedAt:string|null;readonly acceptedPhotoCount:number;
}
export interface ReviewSummaryV2 extends ReviewMetadataV2 {
  readonly state:'pending';readonly title:string;readonly purpose:'rent'|'sale';readonly propertyType:PropertyType;
  readonly amountMinor:number;readonly rentPeriod:PublicProperty['rentPeriod'];readonly submittedAt:string;readonly submittedBy:string;
}
export interface ReviewPageV2 {readonly items:readonly ReviewSummaryV2[];readonly limit:number}
export interface ReviewDetailV2 extends ReviewMetadataV2 {
  readonly state:StaffDraftV2['state'];readonly title:string|null;readonly purpose:'rent'|'sale'|null;readonly propertyType:PropertyType|null;
  readonly amountMinor:number|null;readonly rentPeriod:PublicProperty['rentPeriod'];readonly submittedAt:string|null;readonly submittedBy:string|null;
  readonly decidedAt:string|null;readonly decidedBy:string|null;readonly decisionReason:string|null;
  readonly content:StaffDraftContentV2;readonly photos:readonly PublicPhoto[];
}
export interface ReviewDecisionInputV2 {readonly expectedVersion:string;readonly decision:'approve'|'reject';readonly reason:string|null}
export interface ReviewDecisionReceiptV2 {readonly version:string;readonly state:'approved'|'rejected'}
/** Registration creates private job metadata only; it grants no upload or attachment capability. */
export interface MediaRegistrationInputV2 {readonly registrationId:string;readonly expectedVersion:string;readonly altText:string}
export interface MediaRegistrationFactsV2 {
  readonly kind:'register_media_upload';readonly operationId:string;readonly jobId:string;readonly listingId:string;
  readonly revision:number;readonly expectedVersion:string;readonly altText:string;readonly registeredAt:string;readonly expiresAt:string;
}
/** A historical immutable result; expiry or later draft changes do not rewrite this receipt. */
export interface MediaRegistrationReceiptV2 extends MediaRegistrationFactsV2 {readonly outcome:'registered'}
/** Current bounded job projection, separate from the historical registration result. */
export interface MediaJobV2 extends MediaRegistrationFactsV2 {readonly state:'registered'|'expired'}
export interface MediaAttachIntentInputV2 {readonly operationId:string;readonly jobId:string;readonly expectedVersion:string}
export interface MediaAttachFactsV2 {
  readonly kind:'attach_media';readonly operationId:string;readonly jobId:string;readonly listingId:string;readonly revision:number;readonly expectedVersion:string;
}
export type MediaAttachFailureReasonV2='VERSION_CONFLICT'|'ASSIGNMENT_CHANGED'|'REVISION_NOT_DRAFT'|'JOB_EXPIRED'|'DUPLICATE_OUTPUT'|'CAPACITY_REACHED'|'JOB_ALREADY_ATTACHED'|'PROVENANCE_CHANGED';
export type MediaAttachReceiptV2=MediaAttachFactsV2&(
  | Readonly<{version:string;outcome:'applied';reason:null;mediaId:string;position:number;completedAt:string}>
  | Readonly<{version:string;outcome:'conflict'|'rejected'|'expired';reason:MediaAttachFailureReasonV2;mediaId:null;position:null;completedAt:string}>);
/** Ready is an acknowledgement only. Applied media exists only in the immutable terminal receipt. */
export type MediaAttachIntentV2=MediaAttachFactsV2&Readonly<{altText:string}>&(
  | Readonly<{status:'ready';receipt:null}>
  | Readonly<{status:'applied'|'conflict'|'rejected'|'expired';receipt:MediaAttachReceiptV2}>);
export interface EnquiryInput {
  readonly listingId?: string | null; readonly name: string; readonly phone?: string | null; readonly email?: string | null;
  readonly message: string; readonly origin: 'web' | 'mobile'; readonly noticeVersion: string; readonly noticeAcknowledged: true;
}
export interface EnquiryReceipt { readonly id: string }
export interface RequestOptions {
  /** Raw bearer token for this call only. Never put credentials in baseUrl or a public brand configuration. */
  readonly bearerToken?: string; readonly signal?: AbortSignal; readonly timeoutMs?: number;
}
export interface EnquiryRequestOptions extends RequestOptions { readonly idempotencyKey: string }
export interface StaffRequestOptions extends RequestOptions {readonly bearerToken:string}
export type ClientErrorKind = 'CONFIGURATION' | 'VALIDATION' | 'NETWORK' | 'TIMEOUT' | 'CANCELLED' | 'HTTP' | 'INVALID_RESPONSE' | 'REDIRECT';
export interface ClientErrorDetails {
  readonly status?: number; readonly serverCode?: string; readonly requestId?: string; readonly retryAfterSeconds?: number;
  /** A failed write can have committed. Enquiries use their original key; staff writes require reconciliation before retry. */
  readonly submissionUncertain?: boolean;
}
export class ApiClientError extends Error {
  readonly kind: ClientErrorKind;
  readonly status: number | undefined;
  readonly serverCode: string | undefined;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly submissionUncertain: boolean;
  constructor(kind: ClientErrorKind, message: string, details: ClientErrorDetails = {}) {
    super(message);this.name='ApiClientError';this.kind=kind;this.status=details.status;this.serverCode=details.serverCode;
    this.requestId=details.requestId;this.retryAfterSeconds=details.retryAfterSeconds;this.submissionUncertain=details.submissionUncertain??false;
  }
}
export interface ApiClientOptions {
  readonly baseUrl: string;
  readonly privacyNoticeVersion: string;
  /** Explicitly opt into HTTP on localhost/127.0.0.1/[::1] for local development only. */
  readonly allowLoopbackHttp?: boolean;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES:readonly string[]=['apartment','bedsitter','studio','bungalow','maisonette','townhouse','villa','commercial','land'];
const RESIDENTIAL:readonly string[]=['apartment','bedsitter','studio','bungalow','maisonette','townhouse','villa'];
const PUBLIC_FIELDS=['id','slug','revision','title','description','purpose','propertyType','currency','amountMinor','rentPeriod','bedrooms','privateBathrooms','sharedBathrooms','country','locality','publicPrecision','latitude','longitude','photos'] as const;
const STAFF_CONTENT_FIELDS=['title','description','purpose','propertyType','currency','amountMinor','rentPeriod','bedrooms','privateBathrooms','sharedBathrooms','country','locality','publicPrecision','latitude','longitude','privateAddress','pricing','location'] as const;
const REVIEW_FIELDS=['listingId','slug','revision','state','version','listingVersion','title','purpose','propertyType','amountMinor','rentPeriod','submittedAt','submittedBy','publicationStatus','publishedRevision','availability','lastAvailabilityConfirmedAt','acceptedPhotoCount'] as const;
const MAX_JSON_CHARACTERS=3*1024*1024;
const SERVER_CODES=new Set(['INVALID_INPUT','NOTICE_ACKNOWLEDGEMENT_REQUIRED','UNAUTHENTICATED','FORBIDDEN','NOT_FOUND','METHOD_NOT_ALLOWED','CONFLICT','BODY_TOO_LARGE','JSON_REQUIRED','INVALID_JSON','INVALID_STATE','RATE_LIMITED','SERVICE_UNAVAILABLE']);
const invalid=(kind:'VALIDATION'|'INVALID_RESPONSE'|'CONFIGURATION',message:string):never=>{throw new ApiClientError(kind,message);};
function record(input:unknown,fields:readonly string[],kind:'VALIDATION'|'INVALID_RESPONSE'|'CONFIGURATION'):Record<string,unknown>{
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!fields.includes(key)))return invalid(kind,'Unsupported or malformed fields.');
  return input as Record<string,unknown>;
}
function text(input:unknown,max:number,kind:'VALIDATION'|'INVALID_RESPONSE'|'CONFIGURATION',label:string,codePointBound=false):string{
  if(typeof input!=='string')return invalid(kind,`${label} is missing or invalid.`);
  const trimmed=input.trim();const length=codePointBound?[...trimmed].length:trimmed.length;
  if(length<1||length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input)||(codePointBound&&/[\ud800-\udfff]/u.test(input)))return invalid(kind,`${label} is missing or invalid.`);
  return trimmed;
}
function uuid(input:unknown,kind:'VALIDATION'|'INVALID_RESPONSE',label:string):string{
  if(typeof input!=='string'||!UUID.test(input))return invalid(kind,`${label} must be a UUID.`);return input.toLowerCase();
}
function integer(input:unknown,min:number,max:number,kind:'VALIDATION'|'INVALID_RESPONSE',label:string):number{
  if(typeof input!=='number'||!Number.isSafeInteger(input)||input<min||input>max)return invalid(kind,`${label} is outside its supported range.`);return input;
}
function count(input:unknown):number|null{return input===null?null:integer(input,0,100,'INVALID_RESPONSE','Room count');}
function coordinate(input:unknown,min:number,max:number):number|null{
  if(input===null)return null;if(typeof input!=='number'||!Number.isFinite(input)||input<min||input>max)return invalid('INVALID_RESPONSE','Invalid coordinates.');return input;
}
function timeout(input:unknown,kind:'VALIDATION'|'CONFIGURATION'):number{
  if(typeof input!=='number'||!Number.isSafeInteger(input)||input<1||input>120000)return invalid(kind,'Timeout must be 1–120000 milliseconds.');return input;
}
function origin(options:ApiClientOptions):string{
  if(typeof options.baseUrl!=='string'||options.baseUrl.trim()!==options.baseUrl)return invalid('CONFIGURATION','Use an absolute API origin.');
  let url:URL;try{url=new URL(options.baseUrl);}catch{return invalid('CONFIGURATION','Use an absolute API origin.');}
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/')return invalid('CONFIGURATION','API origin cannot contain credentials, a path, query or fragment.');
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&options.allowLoopbackHttp===true&&loopback))return invalid('CONFIGURATION','Use HTTPS; local HTTP requires explicit loopback development opt-in.');
  return url.origin;
}
function publicProperty(input:unknown,codePointDisplayBounds=false):PublicProperty{
  const value=record(input,PUBLIC_FIELDS,'INVALID_RESPONSE');
  const id=uuid(value.id,'INVALID_RESPONSE','Property ID');
  const slug=text(value.slug,160,'INVALID_RESPONSE','Property slug');if(!/^[a-z\d]+(?:-[a-z\d]+)*$/.test(slug))return invalid('INVALID_RESPONSE','Invalid property slug.');
  const revision=integer(value.revision,1,2147483647,'INVALID_RESPONSE','Revision');
  const title=text(value.title,160,'INVALID_RESPONSE','Title',codePointDisplayBounds),description=text(value.description,10000,'INVALID_RESPONSE','Description',codePointDisplayBounds);
  if(value.purpose!=='rent'&&value.purpose!=='sale')return invalid('INVALID_RESPONSE','Invalid purpose.');
  if(typeof value.propertyType!=='string'||!TYPES.includes(value.propertyType))return invalid('INVALID_RESPONSE','Invalid property type.');
  if(value.currency!=='KES'||value.country!=='KE')return invalid('INVALID_RESPONSE','Unsupported currency or country.');
  const amountMinor=integer(value.amountMinor,1,100000000000000,'INVALID_RESPONSE','Price');
  if((value.purpose==='sale'&&value.rentPeriod!==null)||(value.purpose==='rent'&&(typeof value.rentPeriod!=='string'||!['day','week','month','year'].includes(value.rentPeriod))))return invalid('INVALID_RESPONSE','Invalid rental period.');
  const bedrooms=count(value.bedrooms),privateBathrooms=count(value.privateBathrooms),sharedBathrooms=count(value.sharedBathrooms);
  if((value.propertyType==='land'&&bedrooms!==null)||(RESIDENTIAL.includes(value.propertyType)&&bedrooms===null)||(['studio','bedsitter'].includes(value.propertyType)&&bedrooms!==0))return invalid('INVALID_RESPONSE','Rooms do not match the property type.');
  const locality=text(value.locality,160,'INVALID_RESPONSE','Locality',codePointDisplayBounds);
  if(value.publicPrecision!=='area'&&value.publicPrecision!=='exact')return invalid('INVALID_RESPONSE','Invalid public precision.');
  const latitude=coordinate(value.latitude,-90,90),longitude=coordinate(value.longitude,-180,180);
  if((latitude===null)!==(longitude===null)||(value.publicPrecision==='area'&&latitude!==null))return invalid('INVALID_RESPONSE','Unexpected precise or incomplete coordinates.');
  if(!Array.isArray(value.photos)||value.photos.length<4||value.photos.length>12)return invalid('INVALID_RESPONSE','Expected 4–12 reviewed photos.');
  const keys=new Set<string>();
  const photos=value.photos.map(inputPhoto=>{
    const photo=record(inputPhoto,['key','alt'],'INVALID_RESPONSE');
    const key=text(photo.key,1024,'INVALID_RESPONSE','Photo key');
    if(!/^[A-Za-z\d][A-Za-z\d/_-]*\.(?:webp|jpg|png)$/.test(key)||keys.has(key))return invalid('INVALID_RESPONSE','Unsafe or repeated photo key.');
    keys.add(key);return Object.freeze({key,alt:text(photo.alt,300,'INVALID_RESPONSE','Photo description',codePointDisplayBounds)});
  });
  return Object.freeze({id,slug,revision,title,description,purpose:value.purpose,propertyType:value.propertyType as PropertyType,currency:'KES',amountMinor,
    rentPeriod:value.rentPeriod as PublicProperty['rentPeriod'],bedrooms,privateBathrooms,sharedBathrooms,country:'KE',locality,publicPrecision:value.publicPrecision,latitude,longitude,photos:Object.freeze(photos)});
}
function publicPropertyV2(input:unknown):PublicPropertyV2{
  const value=record(input,[...PUBLIC_FIELDS,'pricing','location'],'INVALID_RESPONSE');
  const {pricing:rawPricing,location:rawLocation,...baseInput}=value;
  const base=publicProperty(baseInput,true);
  try{
    const pricingInput=validatePricingInputV2(rawPricing);
    const pricing=calculateWirePricingV2(kesFromMinor(base.amountMinor),base.purpose,base.rentPeriod,pricingInput);
    const location=validatePublicLocationV2(rawLocation);
    return Object.freeze({...base,pricing,location});
  }catch{
    return invalid('INVALID_RESPONSE','Invalid public pricing or location disclosure.');
  }
}
function staffVersion(input:unknown,kind:'VALIDATION'|'INVALID_RESPONSE',allowNew=false):string{
  if(typeof input!=='string'||!/^(?:0|[1-9]\d{0,18})$/.test(input)||BigInt(input)>9223372036854775807n||(!allowNew&&input==='0'))return invalid(kind,'Use a canonical decimal version string.');
  return input;
}
function expectedStaffVersion(input:unknown,allowNew:boolean):number{
  const version=staffVersion(input,'VALIDATION',allowNew);
  if(BigInt(version)>BigInt(Number.MAX_SAFE_INTEGER))return invalid('VALIDATION','This version cannot be sent safely by the current API contract.');
  return Number(version);
}
function staffContent(input:unknown,kind:'VALIDATION'|'INVALID_RESPONSE',requireAll=false):StaffDraftContentV2{
  const value=record(input,STAFF_CONTENT_FIELDS,kind);
  if(requireAll&&STAFF_CONTENT_FIELDS.some(field=>!Object.hasOwn(value,field)))return invalid(kind,'Incomplete staff response fields.');
  if(requireAll&&(value.currency!=='KES'||value.country!=='KE'||(value.publicPrecision!=='area'&&value.publicPrecision!=='exact')))return invalid(kind,'Invalid required staff defaults.');
  const nullableText=(input:unknown,max:number,label:string):string|null=>input==null||(typeof input==='string'&&!input.trim())?null:text(input,max,kind,label,true);
  const nullableCount=(input:unknown):number|null=>input==null?null:integer(input,0,100,kind,'Room count');
  const nullableCoordinate=(input:unknown,min:number,max:number):number|null=>{
    if(input==null)return null;if(typeof input!=='number'||!Number.isFinite(input)||input<min||input>max)return invalid(kind,'Invalid staff coordinates.');return input;
  };
  const title=nullableText(value.title,160,'Title'),description=nullableText(value.description,10000,'Description'),locality=nullableText(value.locality,160,'Locality');
  const purpose=value.purpose??null;if(purpose!==null&&purpose!=='rent'&&purpose!=='sale')return invalid(kind,'Invalid purpose.');
  const propertyType=value.propertyType??null;if(propertyType!==null&&(typeof propertyType!=='string'||!TYPES.includes(propertyType)))return invalid(kind,'Invalid property type.');
  if((value.currency??'KES')!=='KES'||(value.country??'KE')!=='KE')return invalid(kind,'Unsupported currency or country.');
  const amountMinor=value.amountMinor==null?null:integer(value.amountMinor,1,100000000000000,kind,'Price');
  const rentPeriod=value.rentPeriod??null;
  if(rentPeriod!==null&&(typeof rentPeriod!=='string'||!['day','week','month','year'].includes(rentPeriod)))return invalid(kind,'Invalid rental period.');
  if(purpose==='sale'&&rentPeriod!==null)return invalid(kind,'Sale drafts require a null rental period.');
  const bedrooms=nullableCount(value.bedrooms),privateBathrooms=nullableCount(value.privateBathrooms),sharedBathrooms=nullableCount(value.sharedBathrooms);
  if((propertyType==='land'&&bedrooms!==null)||((propertyType==='studio'||propertyType==='bedsitter')&&bedrooms!==null&&bedrooms!==0))return invalid(kind,'Rooms do not match the property type.');
  const publicPrecision=value.publicPrecision??'area';if(publicPrecision!=='area'&&publicPrecision!=='exact')return invalid(kind,'Invalid public precision.');
  const latitude=nullableCoordinate(value.latitude,-90,90),longitude=nullableCoordinate(value.longitude,-180,180);
  if((latitude===null)!==(longitude===null))return invalid(kind,'Staff coordinates must be supplied together.');
  let privateAddress:string|null=null;
  if(value.privateAddress!=null){
    if(typeof value.privateAddress!=='string'||[...value.privateAddress].length>1000||/[\ud800-\udfff]/u.test(value.privateAddress)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.privateAddress))return invalid(kind,'Invalid private address.');
    privateAddress=value.privateAddress;
  }
  let pricing:PricingInputV2;let location:PublicLocationV2;
  try{
    pricing=validatePricingInputV2(value.pricing);location=validatePublicLocationV2(value.location);
    if(purpose===null&&pricing.charges.length)throw new Error('Charges need a purpose');
    if(pricing.charges.some(charge=>(purpose!=='rent'&&charge.timing==='per_rental_period')||(charge.classification==='refundable_deposit'&&charge.timing!=='one_off')))throw new Error('Invalid charge purpose or classification');
    // The API allows incomplete drafts; derive/check totals only when the actual base and purpose are supplied.
    if(amountMinor!==null&&purpose!==null&&(purpose==='sale'||rentPeriod!==null))calculateWirePricingV2(kesFromMinor(amountMinor),purpose,rentPeriod as PublicProperty['rentPeriod'],pricing);
  }catch{return invalid(kind,'Invalid staff pricing or location disclosure.');}
  return Object.freeze({title,description,purpose,propertyType:propertyType as PropertyType|null,currency:'KES',amountMinor,rentPeriod:rentPeriod as PublicProperty['rentPeriod'],
    bedrooms,privateBathrooms,sharedBathrooms,country:'KE',locality,publicPrecision,latitude,longitude,privateAddress,pricing,location});
}
/** Canonicalize a full replacement without inventing values for unfinished fields. Submission/media rules remain server gates. */
export function validateStaffDraftContentV2(input:unknown):StaffDraftContentV2{return staffContent(input,'VALIDATION');}
function staffDraft(input:unknown,revision:number):StaffDraftV2{
  const value=record(input,['revision','state','version','content'],'INVALID_RESPONSE');
  if(integer(value.revision,1,2147483647,'INVALID_RESPONSE','Revision')!==revision)return invalid('INVALID_RESPONSE','Unexpected staff revision.');
  if(typeof value.state!=='string'||!['draft','pending','approved','rejected'].includes(value.state))return invalid('INVALID_RESPONSE','Invalid staff revision state.');
  const version=staffVersion(value.version,'INVALID_RESPONSE'),content=staffContent(value.content,'INVALID_RESPONSE',true);
  if(value.state!=='draft'&&(content.title===null||content.description===null||content.purpose===null||content.propertyType===null||content.amountMinor===null||content.locality===null||(content.purpose==='rent'&&content.rentPeriod===null)||(RESIDENTIAL.includes(content.propertyType)&&content.bedrooms===null)))return invalid('INVALID_RESPONSE','Incomplete reviewed staff revision.');
  return Object.freeze({revision,state:value.state as StaffDraftV2['state'],version,content});
}
function staffPath(listingId:unknown,revision:unknown):string{
  return `/v2/staff/listings/${uuid(listingId,'VALIDATION','Listing ID')}/drafts/${integer(revision,1,2147483647,'VALIDATION','Revision')}`;
}
function staffOptions(options:StaffRequestOptions,extra:readonly string[]=[]):void{
  requestOptions(options,extra);if(typeof options.bearerToken!=='string'||!options.bearerToken)return invalid('VALIDATION','A bearer token is required for each staff call.');
}
function timestamp(input:unknown,nullable=false):string|null{
  if(nullable&&input===null)return null;
  if(typeof input!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input))return invalid('INVALID_RESPONSE','Invalid review timestamp.');
  const parsed=new Date(input);if(!Number.isFinite(parsed.getTime())||parsed.toISOString()!==input)return invalid('INVALID_RESPONSE','Invalid review timestamp.');return input;
}
function decisionReason(input:unknown,kind:'VALIDATION'|'INVALID_RESPONSE'):string{
  if(typeof input!=='string'||input!==input.trim()||[...input].length<1||[...input].length>1000||/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(input))return invalid(kind,'Provide a trimmed rejection reason within the supported length.');
  return input;
}
function reviewMetadata(value:Record<string,unknown>):ReviewMetadataV2{
  const slug=text(value.slug,160,'INVALID_RESPONSE','Listing slug');if(!/^[a-z\d]+(?:-[a-z\d]+)*$/.test(slug))return invalid('INVALID_RESPONSE','Invalid listing slug.');
  const publicationStatus=value.publicationStatus,availability=value.availability;
  if(typeof publicationStatus!=='string'||!['unpublished','published','paused','archived'].includes(publicationStatus))return invalid('INVALID_RESPONSE','Invalid publication status.');
  if(typeof availability!=='string'||!['available','reserved','rented','sold','withdrawn'].includes(availability))return invalid('INVALID_RESPONSE','Invalid availability.');
  return Object.freeze({listingId:uuid(value.listingId,'INVALID_RESPONSE','Listing ID'),slug,revision:integer(value.revision,1,2147483647,'INVALID_RESPONSE','Revision'),
    version:staffVersion(value.version,'INVALID_RESPONSE'),listingVersion:staffVersion(value.listingVersion,'INVALID_RESPONSE'),
    publicationStatus:publicationStatus as ReviewMetadataV2['publicationStatus'],publishedRevision:value.publishedRevision===null?null:integer(value.publishedRevision,1,2147483647,'INVALID_RESPONSE','Published revision'),
    availability:availability as ReviewMetadataV2['availability'],lastAvailabilityConfirmedAt:timestamp(value.lastAvailabilityConfirmedAt,true),acceptedPhotoCount:integer(value.acceptedPhotoCount,0,12,'INVALID_RESPONSE','Accepted photo count')});
}
function reviewFields(value:Record<string,unknown>,state:StaffDraftV2['state']){
  const nullable=state==='draft';
  const title=nullable&&value.title===null?null:text(value.title,160,'INVALID_RESPONSE','Review title',true);
  const purpose=value.purpose;if(purpose!=='rent'&&purpose!=='sale'&&!(nullable&&purpose===null))return invalid('INVALID_RESPONSE','Invalid review purpose.');
  const propertyType=value.propertyType;if(!(nullable&&propertyType===null)&&(typeof propertyType!=='string'||!TYPES.includes(propertyType)))return invalid('INVALID_RESPONSE','Invalid review property type.');
  const amountMinor=nullable&&value.amountMinor===null?null:integer(value.amountMinor,1,100000000000000,'INVALID_RESPONSE','Review price');
  const rentPeriod=value.rentPeriod;
  if(rentPeriod!==null&&(typeof rentPeriod!=='string'||!['day','week','month','year'].includes(rentPeriod)))return invalid('INVALID_RESPONSE','Invalid review rental period.');
  if((purpose==='sale'&&rentPeriod!==null)||(!nullable&&purpose==='rent'&&rentPeriod===null))return invalid('INVALID_RESPONSE','Invalid review rental period.');
  const submittedAt=timestamp(value.submittedAt,nullable),submittedBy=nullable&&value.submittedBy===null?null:uuid(value.submittedBy,'INVALID_RESPONSE','Submitted actor');
  if((submittedAt===null)!==(submittedBy===null))return invalid('INVALID_RESPONSE','Incomplete submission metadata.');
  return {title,purpose:purpose as ReviewDetailV2['purpose'],propertyType:propertyType as PropertyType|null,amountMinor,rentPeriod:rentPeriod as PublicProperty['rentPeriod'],submittedAt,submittedBy};
}
function reviewSummary(input:unknown):ReviewSummaryV2{
  const value=record(input,REVIEW_FIELDS,'INVALID_RESPONSE');if(REVIEW_FIELDS.some(field=>!Object.hasOwn(value,field))||value.state!=='pending')return invalid('INVALID_RESPONSE','Invalid pending review fields.');
  const fields=reviewFields(value,'pending');
  return Object.freeze({...reviewMetadata(value),...fields,state:'pending'}) as ReviewSummaryV2;
}
function reviewDetail(input:unknown,listingId:string,revision:number):ReviewDetailV2{
  const fields=[...REVIEW_FIELDS,'decidedAt','decidedBy','decisionReason','content','photos'];
  const value=record(input,fields,'INVALID_RESPONSE');if(fields.some(field=>!Object.hasOwn(value,field)))return invalid('INVALID_RESPONSE','Incomplete review detail.');
  const draft=staffDraft({revision:value.revision,state:value.state,version:value.version,content:value.content},revision);
  const metadata=reviewMetadata(value);if(metadata.listingId!==listingId.toLowerCase())return invalid('INVALID_RESPONSE','Unexpected review listing.');
  const base=reviewFields(value,draft.state);
  for(const field of ['title','purpose','propertyType','amountMinor','rentPeriod'] as const)if(base[field]!==draft.content[field])return invalid('INVALID_RESPONSE','Conflicting review content.');
  const decidedAt=timestamp(value.decidedAt,true),decidedBy=value.decidedBy===null?null:uuid(value.decidedBy,'INVALID_RESPONSE','Decision actor');
  if((decidedAt===null)!==(decidedBy===null)||(['approved','rejected'].includes(draft.state)!==(decidedAt!==null)))return invalid('INVALID_RESPONSE','Invalid decision metadata.');
  let reason:string|null=null;
  if(draft.state==='rejected')reason=decisionReason(value.decisionReason,'INVALID_RESPONSE');
  else if(value.decisionReason!==null)return invalid('INVALID_RESPONSE','Unexpected decision reason.');
  if(!Array.isArray(value.photos)||value.photos.length!==metadata.acceptedPhotoCount)return invalid('INVALID_RESPONSE','Conflicting accepted photo metadata.');
  const keys=new Set<string>();const photos=value.photos.map(input=>{
    const photo=record(input,['key','alt'],'INVALID_RESPONSE'),key=text(photo.key,1024,'INVALID_RESPONSE','Photo key');
    if(!/^[A-Za-z\d][A-Za-z\d/_-]*\.(?:webp|jpg|png)$/.test(key)||keys.has(key))return invalid('INVALID_RESPONSE','Unsafe or repeated photo key.');
    keys.add(key);return Object.freeze({key,alt:text(photo.alt,300,'INVALID_RESPONSE','Photo description',true)});
  });
  return Object.freeze({...metadata,...base,state:draft.state,decidedAt,decidedBy,decisionReason:reason,content:draft.content,photos:Object.freeze(photos)});
}
function reviewPath(listingId:unknown,revision:unknown):string{
  return `/v2/staff/reviews/${uuid(listingId,'VALIDATION','Listing ID')}/revisions/${integer(revision,1,2147483647,'VALIDATION','Revision')}`;
}
function mediaPath(listingId:unknown,revision:unknown):string{
  return `/v2/staff/listings/${uuid(listingId,'VALIDATION','Listing ID')}/revisions/${integer(revision,1,2147483647,'VALIDATION','Revision')}`;
}
function mediaAltText(input:unknown,kind:'VALIDATION'|'INVALID_RESPONSE'):string{
  if(typeof input!=='string'||input!==input.trim()||[...input].length<1||[...input].length>300||/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(input))return invalid(kind,'Provide a trimmed photo description within the supported length.');
  return input;
}
function mediaVersion(input:unknown):string{
  const value=staffVersion(input,'INVALID_RESPONSE');
  if(BigInt(value)>BigInt(Number.MAX_SAFE_INTEGER))return invalid('INVALID_RESPONSE','Unsupported registration version.');
  return value;
}
function mediaFacts(value:Record<string,unknown>,listingId:string,revision:number):MediaRegistrationFactsV2{
  if(value.kind!=='register_media_upload'||uuid(value.listingId,'INVALID_RESPONSE','Listing ID')!==listingId.toLowerCase()||integer(value.revision,1,2147483647,'INVALID_RESPONSE','Revision')!==revision)return invalid('INVALID_RESPONSE','Unexpected media resource.');
  const registeredAt=timestamp(value.registeredAt),expiresAt=timestamp(value.expiresAt);
  if(registeredAt===null||expiresAt===null||Date.parse(expiresAt)-Date.parse(registeredAt)!==86400000)return invalid('INVALID_RESPONSE','Invalid registration expiry.');
  const operationId=uuid(value.operationId,'INVALID_RESPONSE','Registration ID'),jobId=uuid(value.jobId,'INVALID_RESPONSE','Job ID');
  if(operationId===jobId)return invalid('INVALID_RESPONSE','Registration and job identities must differ.');
  return Object.freeze({kind:'register_media_upload',operationId,jobId,
    listingId:listingId.toLowerCase(),revision,expectedVersion:mediaVersion(value.expectedVersion),altText:mediaAltText(value.altText,'INVALID_RESPONSE'),registeredAt,expiresAt});
}
const MEDIA_FACT_FIELDS=['kind','operationId','jobId','listingId','revision','expectedVersion','altText','registeredAt','expiresAt'] as const;
function mediaRegistration(input:unknown,listingId:string,revision:number,registrationId:string,request?:MediaRegistrationInputV2):MediaRegistrationReceiptV2{
  const fields=[...MEDIA_FACT_FIELDS,'outcome'],value=record(input,fields,'INVALID_RESPONSE');
  if(fields.some(field=>!Object.hasOwn(value,field))||value.outcome!=='registered')return invalid('INVALID_RESPONSE','Invalid registration receipt.');
  const facts=mediaFacts(value,listingId,revision);
  if(facts.operationId!==registrationId.toLowerCase()||(request&&(facts.expectedVersion!==request.expectedVersion||facts.altText!==request.altText)))return invalid('INVALID_RESPONSE','Conflicting registration receipt.');
  return Object.freeze({...facts,outcome:'registered'});
}
function mediaJob(input:unknown,listingId:string,revision:number,jobId:string):MediaJobV2{
  const fields=[...MEDIA_FACT_FIELDS,'state'],value=record(input,fields,'INVALID_RESPONSE');
  if(fields.some(field=>!Object.hasOwn(value,field))||(value.state!=='registered'&&value.state!=='expired'))return invalid('INVALID_RESPONSE','Invalid media job.');
  const facts=mediaFacts(value,listingId,revision);if(facts.jobId!==jobId.toLowerCase())return invalid('INVALID_RESPONSE','Unexpected media job.');
  return Object.freeze({...facts,state:value.state});
}
function attachRecord(input:unknown,fields:readonly string[],kind:'VALIDATION'|'INVALID_RESPONSE'):Record<string,unknown>{
  if(!input||typeof input!=='object'||(Object.getPrototypeOf(input)!==Object.prototype&&Object.getPrototypeOf(input)!==null))return invalid(kind,'Malformed attachment fields.');
  const own=Reflect.ownKeys(input),value:Record<string,unknown>={};if(own.length!==fields.length)return invalid(kind,'Malformed attachment fields.');
  for(const key of own){if(typeof key!=='string'||!fields.includes(key))return invalid(kind,'Malformed attachment fields.');const field=Object.getOwnPropertyDescriptor(input,key);if(!field?.enumerable||!Object.hasOwn(field,'value'))return invalid(kind,'Malformed attachment fields.');value[key]=field.value;}return value;
}
const ATTACH_FACT_FIELDS=['kind','operationId','jobId','listingId','revision','expectedVersion'] as const;
const ATTACH_REASONS={conflict:['VERSION_CONFLICT','ASSIGNMENT_CHANGED'],rejected:['REVISION_NOT_DRAFT','DUPLICATE_OUTPUT','CAPACITY_REACHED','JOB_ALREADY_ATTACHED','PROVENANCE_CHANGED'],expired:['JOB_EXPIRED']} as const;
function mediaAttachIntent(input:unknown,listingId:string,revision:number,operationId:string,request?:MediaAttachIntentInputV2):MediaAttachIntentV2{
  const value=attachRecord(input,[...ATTACH_FACT_FIELDS,'altText','status','receipt'],'INVALID_RESPONSE');
  const jobId=uuid(value.jobId,'INVALID_RESPONSE','Job ID'),expectedVersion=mediaVersion(value.expectedVersion);
  if(value.kind!=='attach_media'||uuid(value.operationId,'INVALID_RESPONSE','Operation ID')!==operationId||jobId===operationId||uuid(value.listingId,'INVALID_RESPONSE','Listing ID')!==listingId.toLowerCase()||integer(value.revision,1,2147483647,'INVALID_RESPONSE','Revision')!==revision||BigInt(expectedVersion)>BigInt(Number.MAX_SAFE_INTEGER-1)||(request&&(request.jobId!==jobId||request.expectedVersion!==expectedVersion)))return invalid('INVALID_RESPONSE','Conflicting attachment intent.');
  const facts=Object.freeze({kind:'attach_media' as const,operationId,jobId,listingId:listingId.toLowerCase(),revision,expectedVersion}),altText=mediaAltText(value.altText,'INVALID_RESPONSE');
  if(value.status==='ready'){if(value.receipt!==null)return invalid('INVALID_RESPONSE','Ready intent cannot carry a receipt.');return Object.freeze({...facts,altText,status:'ready',receipt:null});}
  if(!['applied','conflict','rejected','expired'].includes(value.status as string))return invalid('INVALID_RESPONSE','Invalid attachment status.');
  const raw=attachRecord(value.receipt,[...ATTACH_FACT_FIELDS,'version','outcome','reason','mediaId','position','completedAt'],'INVALID_RESPONSE');
  if(ATTACH_FACT_FIELDS.some(field=>raw[field]!==facts[field])||raw.outcome!==value.status)return invalid('INVALID_RESPONSE','Conflicting attachment receipt.');
  const version=mediaVersion(raw.version),completedAt=timestamp(raw.completedAt);if(completedAt===null)return invalid('INVALID_RESPONSE','Invalid attachment timestamp.');
  let receipt:MediaAttachReceiptV2;
  if(value.status==='applied'){
    if(raw.reason!==null||BigInt(version)!==BigInt(expectedVersion)+1n)return invalid('INVALID_RESPONSE','Invalid applied attachment.');
    const mediaId=uuid(raw.mediaId,'INVALID_RESPONSE','Media ID');if(mediaId===operationId||mediaId===jobId)return invalid('INVALID_RESPONSE','Conflicting attachment media identity.');
    receipt=Object.freeze({...facts,version,outcome:'applied',reason:null,mediaId,position:integer(raw.position,0,11,'INVALID_RESPONSE','Photo position'),completedAt});
  }else{
    const status=value.status as 'conflict'|'rejected'|'expired';if(raw.mediaId!==null||raw.position!==null||!ATTACH_REASONS[status].includes(raw.reason as never))return invalid('INVALID_RESPONSE','Invalid attachment failure.');
    receipt=Object.freeze({...facts,version,outcome:status,reason:raw.reason as MediaAttachFailureReasonV2,mediaId:null,position:null,completedAt});
  }
  return Object.freeze({...facts,altText,status:value.status as 'applied'|'conflict'|'rejected'|'expired',receipt});
}
function assertMediaJsonTokens(source:string):void{
  // The existing v2 parser checks syntax and money tokens. Media projections also
  // reject decoded duplicate keys and revision tokens before numeric rounding.
  const tokens=source.match(/"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g)??[];
  const containers:(Set<string>|null)[]=[];
  for(let index=0;index<tokens.length;index++){
    const token=tokens[index]!;
    if(token==='{')containers.push(new Set());else if(token==='[')containers.push(null);else if(token==='}'||token===']')containers.pop();
    else if(token.startsWith('"')&&tokens[index+1]===':'){
      const keys=containers.at(-1),key=JSON.parse(token) as string;
      if(!keys||keys.has(key))throw new Error('Duplicate media response key.');keys.add(key);
      if(key==='revision'&&!/^[1-9]\d*$/.test(tokens[index+2]??''))throw new Error('Invalid media revision token.');
      if(key==='position'&&!/^(?:null|0|[1-9]\d*)$/.test(tokens[index+2]??''))throw new Error('Invalid media position token.');
    }
  }
}
function uncertainWriteError(error:unknown):never{
  if(error instanceof ApiClientError&&error.kind==='INVALID_RESPONSE'&&!error.submissionUncertain)throw new ApiClientError(error.kind,error.message,{status:error.status,submissionUncertain:true});
  throw error;
}
function requestOptions(input:RequestOptions,extra:readonly string[]=[]):void{
  record(input,['bearerToken','signal','timeoutMs',...extra],'VALIDATION');
  if(input.bearerToken!==undefined&&(typeof input.bearerToken!=='string'||input.bearerToken.length>8192||! /^[A-Za-z\d\-._~+/]+=*$/.test(input.bearerToken)))invalid('VALIDATION','Invalid bearer token.');
  if(input.signal!==undefined&&(!(input.signal instanceof AbortSignal)))invalid('VALIDATION','Use a valid cancellation signal.');
  if(input.timeoutMs!==undefined)timeout(input.timeoutMs,'VALIDATION');
}
function enquiryBody(input:EnquiryInput,currentNotice:string):Record<string,unknown>{
  const value=record(input,['listingId','name','phone','email','message','origin','noticeVersion','noticeAcknowledged'],'VALIDATION');
  const listingId=value.listingId==null?null:uuid(value.listingId,'VALIDATION','Listing ID');
  const name=text(value.name,160,'VALIDATION','Name'),message=text(value.message,2000,'VALIDATION','Message');
  const noticeVersion=text(value.noticeVersion,100,'VALIDATION','Privacy notice version');
  if(noticeVersion!==currentNotice||value.noticeAcknowledged!==true)return invalid('VALIDATION','Acknowledge the current enquiry privacy notice.');
  if(value.origin!=='web'&&value.origin!=='mobile')return invalid('VALIDATION','Choose web or mobile enquiry origin.');
  const phone=value.phone==null?null:text(value.phone,40,'VALIDATION','Phone');
  const email=value.email==null?null:text(value.email,254,'VALIDATION','Email').toLowerCase();
  if((!phone&&!email)||(email!==null&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))return invalid('VALIDATION','Provide a phone number or valid email.');
  return {listingId,name,phone,email,message,origin:value.origin,noticeVersion,noticeAcknowledged:true};
}

export class RealtorApiClient {
  private readonly apiOrigin:string;
  private readonly currentNotice:string;
  private readonly defaultTimeout:number;
  private readonly transport:typeof globalThis.fetch;
  constructor(options:ApiClientOptions){
    record(options,['baseUrl','privacyNoticeVersion','allowLoopbackHttp','timeoutMs','fetch'],'CONFIGURATION');
    if(options.allowLoopbackHttp!==undefined&&typeof options.allowLoopbackHttp!=='boolean')invalid('CONFIGURATION','Development HTTP opt-in must be boolean.');
    this.apiOrigin=origin(options);this.currentNotice=text(options.privacyNoticeVersion,100,'CONFIGURATION','Configured privacy notice version');
    this.defaultTimeout=timeout(options.timeoutMs??10000,'CONFIGURATION');
    if(options.fetch!==undefined&&typeof options.fetch!=='function')invalid('CONFIGURATION','A Fetch-compatible transport is required.');
    if(!options.fetch&&typeof globalThis.fetch!=='function')invalid('CONFIGURATION','A Fetch-compatible transport is required.');
    this.transport=options.fetch??globalThis.fetch.bind(globalThis);
  }
  async listProperties(options:RequestOptions&{readonly limit?:number}={}):Promise<PropertyPage>{
    requestOptions(options,['limit']);const limit=integer(options.limit??50,1,100,'VALIDATION','Limit');
    const data=record(await this.request(`/v1/properties?limit=${limit}`,'GET',options),['items','limit'],'INVALID_RESPONSE');
    if(data.limit!==limit||!Array.isArray(data.items)||data.items.length>limit)return invalid('INVALID_RESPONSE','Invalid property page.');
    return Object.freeze({items:Object.freeze(data.items.map(input=>publicProperty(input))),limit});
  }
  async listPropertiesV2(options:RequestOptions&{readonly limit?:number}={}):Promise<PropertyPageV2>{
    requestOptions(options,['limit']);const limit=integer(options.limit??50,1,100,'VALIDATION','Limit');
    const data=record(await this.request(`/v2/properties?limit=${limit}`,'GET',options),['items','limit'],'INVALID_RESPONSE');
    if(data.limit!==limit||!Array.isArray(data.items)||data.items.length>limit)return invalid('INVALID_RESPONSE','Invalid property page.');
    return Object.freeze({items:Object.freeze(data.items.map(publicPropertyV2)),limit});
  }
  async getStaffDraftV2(listingId:string,revision:number,options:StaffRequestOptions):Promise<StaffDraftV2>{
    staffOptions(options);const path=staffPath(listingId,revision);
    return staffDraft(await this.request(path,'GET',options),revision);
  }
  async saveStaffDraftV2(listingId:string,revision:number,input:StaffDraftSaveV2,options:StaffRequestOptions):Promise<StaffVersionReceipt>{
    staffOptions(options);const path=staffPath(listingId,revision);
    const value=record(input,['expectedVersion','content'],'VALIDATION');
    const expectedVersion=expectedStaffVersion(value.expectedVersion,true),content=validateStaffDraftContentV2(value.content);
    try{
      const data=record(await this.request(path,'PUT',options,{expectedVersion,content}),['version'],'INVALID_RESPONSE');
      return Object.freeze({version:staffVersion(data.version,'INVALID_RESPONSE')});
    }catch(error){return uncertainWriteError(error);}
  }
  async submitStaffDraftV2(listingId:string,revision:number,input:StaffDraftSubmitV2,options:StaffRequestOptions):Promise<StaffVersionReceipt>{
    staffOptions(options);const path=staffPath(listingId,revision)+'/submit';
    const value=record(input,['expectedVersion'],'VALIDATION');const expectedVersion=expectedStaffVersion(value.expectedVersion,false);
    try{
      const data=record(await this.request(path,'POST',options,{expectedVersion}),['version'],'INVALID_RESPONSE');
      return Object.freeze({version:staffVersion(data.version,'INVALID_RESPONSE')});
    }catch(error){return uncertainWriteError(error);}
  }
  async listReviewsV2(options:StaffRequestOptions&{readonly limit?:number}):Promise<ReviewPageV2>{
    staffOptions(options,['limit']);const limit=integer(options.limit??50,1,100,'VALIDATION','Limit');
    const data=record(await this.request(`/v2/staff/reviews?limit=${limit}`,'GET',options),['items','limit'],'INVALID_RESPONSE');
    if(data.limit!==limit||!Array.isArray(data.items)||data.items.length>limit)return invalid('INVALID_RESPONSE','Invalid review page.');
    const keys=new Set<string>();const items=data.items.map(input=>{
      const item=reviewSummary(input),key=`${item.listingId}:${item.revision}`;if(keys.has(key))return invalid('INVALID_RESPONSE','Repeated review revision.');keys.add(key);return item;
    });
    return Object.freeze({items:Object.freeze(items),limit});
  }
  async getReviewV2(listingId:string,revision:number,options:StaffRequestOptions):Promise<ReviewDetailV2>{
    staffOptions(options);const path=reviewPath(listingId,revision);
    return reviewDetail(await this.request(path,'GET',options),listingId,revision);
  }
  async decideReviewV2(listingId:string,revision:number,input:ReviewDecisionInputV2,options:StaffRequestOptions):Promise<ReviewDecisionReceiptV2>{
    staffOptions(options);const path=reviewPath(listingId,revision)+'/decision',value=record(input,['expectedVersion','decision','reason'],'VALIDATION');
    const expectedVersion=expectedStaffVersion(value.expectedVersion,false);const decision=value.decision;
    if(decision!=='approve'&&decision!=='reject')return invalid('VALIDATION','Choose approve or reject.');
    const reason=decision==='reject'?decisionReason(value.reason,'VALIDATION'):value.reason===null?null:invalid('VALIDATION','Approval requires a null reason.');
    try{
      const receipt=record(await this.request(path,'POST',options,{expectedVersion,decision,reason}),['version','state'],'INVALID_RESPONSE');
      const state=decision==='approve'?'approved':'rejected';if(receipt.state!==state)return invalid('INVALID_RESPONSE','Unexpected decision receipt state.');
      return Object.freeze({version:staffVersion(receipt.version,'INVALID_RESPONSE'),state});
    }catch(error){return uncertainWriteError(error);}
  }
  /** Supply and retain the original UUID/body for explicit retry; no automatic retry or version refresh occurs. */
  async registerMediaUploadV2(listingId:string,revision:number,input:MediaRegistrationInputV2,options:StaffRequestOptions):Promise<MediaRegistrationReceiptV2>{
    staffOptions(options);const path=mediaPath(listingId,revision)+'/media-registrations',value=record(input,['registrationId','expectedVersion','altText'],'VALIDATION');
    const registrationId=uuid(value.registrationId,'VALIDATION','Registration ID'),expectedVersion=expectedStaffVersion(value.expectedVersion,false),altText=mediaAltText(value.altText,'VALIDATION');
    const canonical=Object.freeze({registrationId,expectedVersion:String(expectedVersion),altText});
    try{return mediaRegistration(await this.request(path,'POST',options,{registrationId,expectedVersion,altText}),listingId,revision,registrationId,canonical);}
    catch(error){return uncertainWriteError(error);}
  }
  async getMediaRegistrationV2(listingId:string,revision:number,registrationId:string,options:StaffRequestOptions):Promise<MediaRegistrationReceiptV2>{
    staffOptions(options);const path=mediaPath(listingId,revision),id=uuid(registrationId,'VALIDATION','Registration ID');
    return mediaRegistration(await this.request(`${path}/media-registrations/${id}`,'GET',options),listingId,revision,id);
  }
  async getMediaJobV2(listingId:string,revision:number,jobId:string,options:StaffRequestOptions):Promise<MediaJobV2>{
    staffOptions(options);const path=mediaPath(listingId,revision),id=uuid(jobId,'VALIDATION','Job ID');
    return mediaJob(await this.request(`${path}/media-jobs/${id}`,'GET',options),listingId,revision,id);
  }
  /** Retain the original UUID/job/version; explicit replay never adopts a newer version or finalizes media. */
  async createMediaAttachIntentV2(listingId:string,revision:number,input:MediaAttachIntentInputV2,options:StaffRequestOptions):Promise<MediaAttachIntentV2>{
    staffOptions(options);const path=mediaPath(listingId,revision)+'/media-attach-intents',value=attachRecord(input,['operationId','jobId','expectedVersion'],'VALIDATION');
    const operationId=uuid(value.operationId,'VALIDATION','Operation ID'),jobId=uuid(value.jobId,'VALIDATION','Job ID'),expectedVersion=expectedStaffVersion(value.expectedVersion,false);
    if(operationId===jobId||expectedVersion>Number.MAX_SAFE_INTEGER-1)return invalid('VALIDATION','Unsupported attachment identity or version.');
    const canonical=Object.freeze({operationId,jobId,expectedVersion:String(expectedVersion)});
    try{return mediaAttachIntent(await this.request(path,'POST',options,{operationId,jobId,expectedVersion}),listingId,revision,operationId,canonical);}catch(error){return uncertainWriteError(error);}
  }
  async getMediaAttachIntentV2(listingId:string,revision:number,operationId:string,options:StaffRequestOptions):Promise<MediaAttachIntentV2>{
    staffOptions(options);const path=mediaPath(listingId,revision),id=uuid(operationId,'VALIDATION','Operation ID');
    return mediaAttachIntent(await this.request(`${path}/media-attach-intents/${id}`,'GET',options),listingId,revision,id);
  }
  async submitEnquiry(input:EnquiryInput,options:EnquiryRequestOptions):Promise<EnquiryReceipt>{
    requestOptions(options,['idempotencyKey']);const key=uuid(options.idempotencyKey,'VALIDATION','Idempotency key');
    const body=enquiryBody(input,this.currentNotice);
    try{
      const data=record(await this.request('/v1/enquiries','POST',options,body,key),['id'],'INVALID_RESPONSE');
      return Object.freeze({id:uuid(data.id,'INVALID_RESPONSE','Receipt ID')});
    }catch(error){
      if(error instanceof ApiClientError&&error.kind==='INVALID_RESPONSE'&&!error.submissionUncertain)throw new ApiClientError(error.kind,error.message,{status:error.status,submissionUncertain:true});
      throw error;
    }
  }
  private async request(path:string,method:'GET'|'POST'|'PUT',options:RequestOptions,body?:Record<string,unknown>,key?:string):Promise<unknown>{
    const writes=method!=='GET';
    const expectedStatus=path==='/v1/enquiries'&&method==='POST'?201:200;
    if(options.signal?.aborted)throw new ApiClientError('CANCELLED','Request was cancelled.');
    const controller=new AbortController();let interruption:'CANCELLED'|'TIMEOUT'|undefined;let started=false;
    let rejectInterruption:(reason:ApiClientError)=>void=()=>{};
    const interrupted=new Promise<never>((_,reject)=>{rejectInterruption=reject;});
    const stop=(kind:'CANCELLED'|'TIMEOUT')=>{interruption=kind;controller.abort();rejectInterruption(new ApiClientError(kind,kind==='TIMEOUT'?'Request timed out.':'Request was cancelled.',{submissionUncertain:writes&&started}));};
    const timer=setTimeout(()=>stop('TIMEOUT'),options.timeoutMs??this.defaultTimeout);
    const cancel=()=>stop('CANCELLED');options.signal?.addEventListener('abort',cancel,{once:true});
    try{
      const operation=(async()=>{
        const headers:Record<string,string>={Accept:'application/json'};
        if(options.bearerToken)headers.Authorization=`Bearer ${options.bearerToken}`;
        if(body){headers['Content-Type']='application/json';if(key!==undefined)headers['Idempotency-Key']=key;}
        const url=this.apiOrigin+path;started=true;
        const result=await this.transport(url,{method,headers,credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal,...(body?{body:JSON.stringify(body)}:{})});
        if(result.redirected||(result.status>=300&&result.status<400)||(result.url&&new URL(result.url).href!==new URL(url).href))throw new ApiClientError('REDIRECT','API redirects are not permitted.',{submissionUncertain:writes});
        if(!/^application\/json(?:\s*;[^\r\n]*)?$/i.test(result.headers.get('content-type')??''))throw new ApiClientError('INVALID_RESPONSE','Expected a JSON API response.',{status:result.status,submissionUncertain:writes});
        const raw=await result.text();if(raw.length>MAX_JSON_CHARACTERS)throw new ApiClientError('INVALID_RESPONSE','API response exceeded the supported size.',{status:result.status,submissionUncertain:writes});
        let payload:unknown;try{
          if(/^\/v2\/staff\/listings\/[^/]+\/revisions\/[^/]+\/(?:media-registrations|media-jobs|media-attach-intents)(?:\/[^/]+)?$/.test(path))assertMediaJsonTokens(raw);
          payload=path.startsWith('/v2/')?parseListingJsonV2(raw):JSON.parse(raw);
        }catch{throw new ApiClientError('INVALID_RESPONSE','Malformed API JSON.',{status:result.status,submissionUncertain:writes});}
        if(!result.ok){
          const envelope=record(payload,['error','requestId'],'INVALID_RESPONSE');const serverError=record(envelope.error,['code','message'],'INVALID_RESPONSE');
          const requestId=uuid(envelope.requestId,'INVALID_RESPONSE','Request ID');
          if(typeof serverError.code!=='string'||typeof serverError.message!=='string')return invalid('INVALID_RESPONSE','Malformed API error.');
          const headerId=result.headers.get('x-request-id');if(headerId!==null&&headerId.toLowerCase()!==requestId)invalid('INVALID_RESPONSE','Conflicting API request reference.');
          const retry=result.headers.get('retry-after');const retryAfterSeconds=retry!==null&&/^\d{1,8}$/.test(retry)?Number(retry):undefined;
          throw new ApiClientError('HTTP','API request could not be completed.',{status:result.status,serverCode:SERVER_CODES.has(serverError.code)?serverError.code:undefined,requestId,...(retryAfterSeconds===undefined?{}:{retryAfterSeconds}),submissionUncertain:writes&&result.status>=500});
        }
        if(result.status!==expectedStatus)throw new ApiClientError('INVALID_RESPONSE','Unexpected API success status.',{status:result.status,submissionUncertain:writes});
        return payload;
      })();
      return await Promise.race([operation,interrupted]);
    }catch(error){
      if(interruption)throw new ApiClientError(interruption,interruption==='TIMEOUT'?'Request timed out.':'Request was cancelled.',{submissionUncertain:writes&&started});
      if(error instanceof ApiClientError)throw error;
      throw new ApiClientError('NETWORK','API could not be reached.',{submissionUncertain:writes&&started});
    }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);}
  }
}
