import {
  calculateWirePricingV2, kesFromMinor, parseListingJsonV2, validatePricingInputV2, validatePublicLocationV2,
  type PricingDisclosure, type PublicLocationV2,
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
export type { PricingDisclosure, PublicLocationV2 } from '@realtor/domain';
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
export type ClientErrorKind = 'CONFIGURATION' | 'VALIDATION' | 'NETWORK' | 'TIMEOUT' | 'CANCELLED' | 'HTTP' | 'INVALID_RESPONSE' | 'REDIRECT';
export interface ClientErrorDetails {
  readonly status?: number; readonly serverCode?: string; readonly requestId?: string; readonly retryAfterSeconds?: number;
  /** A failed POST can have committed. Retry manually with the SAME key/body, never invent a new key. */
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
  private async request(path:string,method:'GET'|'POST',options:RequestOptions,body?:Record<string,unknown>,key?:string):Promise<unknown>{
    if(options.signal?.aborted)throw new ApiClientError('CANCELLED','Request was cancelled.');
    const controller=new AbortController();let interruption:'CANCELLED'|'TIMEOUT'|undefined;let started=false;
    let rejectInterruption:(reason:ApiClientError)=>void=()=>{};
    const interrupted=new Promise<never>((_,reject)=>{rejectInterruption=reject;});
    const stop=(kind:'CANCELLED'|'TIMEOUT')=>{interruption=kind;controller.abort();rejectInterruption(new ApiClientError(kind,kind==='TIMEOUT'?'Request timed out.':'Request was cancelled.',{submissionUncertain:method==='POST'&&started}));};
    const timer=setTimeout(()=>stop('TIMEOUT'),options.timeoutMs??this.defaultTimeout);
    const cancel=()=>stop('CANCELLED');options.signal?.addEventListener('abort',cancel,{once:true});
    try{
      const operation=(async()=>{
        const headers:Record<string,string>={Accept:'application/json'};
        if(options.bearerToken)headers.Authorization=`Bearer ${options.bearerToken}`;
        if(body){headers['Content-Type']='application/json';headers['Idempotency-Key']=key!;}
        const url=this.apiOrigin+path;started=true;
        const result=await this.transport(url,{method,headers,credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal,...(body?{body:JSON.stringify(body)}:{})});
        if(result.redirected||(result.status>=300&&result.status<400)||(result.url&&new URL(result.url).href!==new URL(url).href))throw new ApiClientError('REDIRECT','API redirects are not permitted.',{submissionUncertain:method==='POST'});
        if(!/^application\/json(?:\s*;[^\r\n]*)?$/i.test(result.headers.get('content-type')??''))throw new ApiClientError('INVALID_RESPONSE','Expected a JSON API response.',{status:result.status,submissionUncertain:method==='POST'});
        const raw=await result.text();if(raw.length>MAX_JSON_CHARACTERS)throw new ApiClientError('INVALID_RESPONSE','API response exceeded the supported size.',{status:result.status,submissionUncertain:method==='POST'});
        let payload:unknown;try{payload=method==='GET'&&path.startsWith('/v2/properties?')?parseListingJsonV2(raw):JSON.parse(raw);}catch{throw new ApiClientError('INVALID_RESPONSE','Malformed API JSON.',{status:result.status,submissionUncertain:method==='POST'});}
        if(!result.ok){
          const envelope=record(payload,['error','requestId'],'INVALID_RESPONSE');const serverError=record(envelope.error,['code','message'],'INVALID_RESPONSE');
          const requestId=uuid(envelope.requestId,'INVALID_RESPONSE','Request ID');
          if(typeof serverError.code!=='string'||typeof serverError.message!=='string')return invalid('INVALID_RESPONSE','Malformed API error.');
          const headerId=result.headers.get('x-request-id');if(headerId!==null&&headerId.toLowerCase()!==requestId)invalid('INVALID_RESPONSE','Conflicting API request reference.');
          const retry=result.headers.get('retry-after');const retryAfterSeconds=retry!==null&&/^\d{1,8}$/.test(retry)?Number(retry):undefined;
          throw new ApiClientError('HTTP','API request could not be completed.',{status:result.status,serverCode:SERVER_CODES.has(serverError.code)?serverError.code:undefined,requestId,...(retryAfterSeconds===undefined?{}:{retryAfterSeconds}),submissionUncertain:method==='POST'&&result.status>=500});
        }
        if(result.status!==(method==='POST'?201:200))throw new ApiClientError('INVALID_RESPONSE','Unexpected API success status.',{status:result.status,submissionUncertain:method==='POST'});
        return payload;
      })();
      return await Promise.race([operation,interrupted]);
    }catch(error){
      if(interruption)throw new ApiClientError(interruption,interruption==='TIMEOUT'?'Request timed out.':'Request was cancelled.',{submissionUncertain:method==='POST'&&started});
      if(error instanceof ApiClientError)throw error;
      throw new ApiClientError('NETWORK','API could not be reached.',{submissionUncertain:method==='POST'&&started});
    }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);}
  }
}
