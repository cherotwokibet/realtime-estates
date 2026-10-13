import {validateViewingTerminationCommand,validateViewingTerminationReceipt,type ViewingTerminationCommand,type ViewingTerminationKind,type ViewingTerminationReceipt} from '@realtor/api-client';
import {validateViewingConfirmationCommand,validateViewingConfirmationReceipt,type ViewingConfirmationCommand,type ViewingConfirmationReceipt} from '@realtor/api-client';
import {validateViewingProperties,type ViewingPropertyPage} from './viewing-properties.ts';
import {validateContactCommand,validateContactReceipt,validateContactPage,type ContactCommand,type ContactReceipt,type ContactPage} from '@realtor/api-client';
import {validateViewingOriginal,validateViewingReceipt,validateViewingDetail,validateViewingPage,type ViewingOriginal,type ViewingReceipt,type ViewingDetail,type ViewingPage} from '@realtor/api-client';
import {validateEnquiryActivityPage,type EnquiryActivityPage,validateStaffEnquiryInput,type StaffEnquiryInput,type EnquiryReceipt,validateStaffEnquirySummaryV2,validateStaffEnquiryDetailV2,validateEnquiryOperationReceiptV2,type StaffEnquiryPageV2,type StaffEnquiryDetailV2,type EnquiryAssigneePageV2,type EnquiryOperationInputV2,type EnquiryOperationReceiptV2} from '@realtor/api-client';
import {validateEnquiryCommand} from './enquiry-model.ts';

export type EnquiryPreviewErrorKind='validation'|'network'|'timeout'|'cancelled'|'response'|'http';
/** Status 0 means no usable HTTP status; text is deliberately independent of upstream diagnostics. */
export class EnquiryPreviewError extends Error {
  constructor(readonly kind:EnquiryPreviewErrorKind,readonly status=0,readonly uncertain=false){
    super(kind==='validation'?'Check the enquiry fields before continuing.':kind==='timeout'?'The enquiry request timed out.':kind==='cancelled'?'The enquiry request was cancelled.':kind==='http'?'The enquiry service could not complete this request.':'The enquiry response could not be confirmed.');this.name='EnquiryPreviewError';
  }
}
export interface CaptureAttempt {readonly input:StaffEnquiryInput;readonly key:string;readonly status:"ready"|"sending"|"uncertain"|"received"|"rejected";readonly receipt:EnquiryReceipt|null;submit(signal?:AbortSignal):Promise<EnquiryReceipt>;retryOriginal(signal?:AbortSignal):Promise<EnquiryReceipt>}
export interface EnquiryPreviewClient {
  terminateViewing(id:string,viewingId:string,kind:ViewingTerminationKind,input:ViewingTerminationCommand,signal?:AbortSignal):Promise<ViewingTerminationReceipt>;
  recoverViewingTermination(id:string,viewingId:string,kind:ViewingTerminationKind,input:ViewingTerminationCommand,signal?:AbortSignal):Promise<ViewingTerminationReceipt>;
  confirmViewing(id:string,viewingId:string,input:ViewingConfirmationCommand,signal?:AbortSignal):Promise<ViewingConfirmationReceipt>;
  recoverViewingConfirmation(id:string,viewingId:string,input:ViewingConfirmationCommand,signal?:AbortSignal):Promise<ViewingConfirmationReceipt>;
  viewingProperties(signal?:AbortSignal):Promise<ViewingPropertyPage>;
  viewings(id:string,signal?:AbortSignal):Promise<ViewingPage>;
  viewing(id:string,viewingId:string,signal?:AbortSignal):Promise<ViewingDetail>;
  saveViewing(id:string,original:ViewingOriginal,signal?:AbortSignal):Promise<ViewingReceipt>;
  recoverViewing(id:string,original:ViewingOriginal,signal?:AbortSignal):Promise<ViewingReceipt>;
  contacts(id:string,signal?:AbortSignal):Promise<ContactPage>;
  recordContact(id:string,input:ContactCommand,signal?:AbortSignal):Promise<ContactReceipt>;
  recoverContact(id:string,input:ContactCommand,signal?:AbortSignal):Promise<ContactReceipt>;
  prepareCapture(input:StaffEnquiryInput,key:string):CaptureAttempt;
  activity(id:string,signal?:AbortSignal):Promise<EnquiryActivityPage>;
  list(signal?:AbortSignal):Promise<StaffEnquiryPageV2>;
  detail(id:string,signal?:AbortSignal):Promise<StaffEnquiryDetailV2>;
  assignees(signal?:AbortSignal):Promise<EnquiryAssigneePageV2>;
  apply(id:string,command:EnquiryOperationInputV2,signal?:AbortSignal):Promise<EnquiryOperationReceiptV2>;
  recover(id:string,command:EnquiryOperationInputV2,signal?:AbortSignal):Promise<EnquiryOperationReceiptV2>;
}
interface Configuration {readonly basePath:string;readonly instanceId:string;readonly fetch?:typeof globalThis.fetch;readonly timeoutMs?:number}
const MAX_BYTES=512*1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_STATUS:Readonly<Record<string,readonly number[]>>=Object.freeze({INVALID_INPUT:[400],INVALID_JSON:[400],UNAUTHENTICATED:[401],FORBIDDEN:[403],PREVIEW_UNAVAILABLE:[403,502,504],NOT_FOUND:[404],METHOD_NOT_ALLOWED:[405],CONFLICT:[409],BODY_TOO_LARGE:[413],JSON_REQUIRED:[415],INVALID_STATE:[422],RATE_LIMITED:[429],SERVICE_UNAVAILABLE:[503],CANCELLED:[499]});
const arrayPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const bufferGetter=Object.getOwnPropertyDescriptor(arrayPrototype,'buffer')!.get!;
const offsetGetter=Object.getOwnPropertyDescriptor(arrayPrototype,'byteOffset')!.get!;
const lengthGetter=Object.getOwnPropertyDescriptor(arrayPrototype,'byteLength')!.get!;
const tagGetter=Object.getOwnPropertyDescriptor(arrayPrototype,Symbol.toStringTag)!.get!;
const backingLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!;
const responseFailure=():never=>{throw new EnquiryPreviewError('response');};
function own(input:unknown,fields:readonly string[]):Record<string,unknown>{
  if(!input||typeof input!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(input)))return responseFailure();
  const keys=Reflect.ownKeys(input);if(keys.length!==fields.length||keys.some(key=>typeof key!=='string'||!fields.includes(key)))return responseFailure();
  const result:Record<string,unknown>={};for(const key of fields){const value=Object.getOwnPropertyDescriptor(input,key);if(!value?.enumerable||!Object.hasOwn(value,'value'))return responseFailure();result[key]=value.value;}return result;
}
function selectedId(input:unknown):string{if(typeof input!=='string'||!UUID.test(input))throw new EnquiryPreviewError('validation');return input.toLowerCase();}
function rows(input:unknown,maximum:number):readonly unknown[]{
  if(!Array.isArray(input)||Object.getPrototypeOf(input)!==Array.prototype||input.length>maximum||Reflect.ownKeys(input).length!==input.length+1)return responseFailure();
  const result:unknown[]=[];for(let index=0;index<input.length;index++){const value=Object.getOwnPropertyDescriptor(input,String(index));if(!value?.enumerable||!Object.hasOwn(value,'value'))return responseFailure();result.push(value.value);}return result;
}
function page(input:unknown,limit:number):Record<string,unknown>&{items:readonly unknown[];truncated:boolean}{
  const value=own(input,['items','limit','truncated']),items=rows(value.items,limit);
  if(value.limit!==limit||typeof value.truncated!=='boolean'||value.truncated&&items.length!==limit)return responseFailure();return {...value,items,truncated:value.truncated};
}
function enquiryPage(input:unknown):StaffEnquiryPageV2{
  const value=page(input,50),items=value.items.map(validateStaffEnquirySummaryV2);
  if(new Set(items.map(item=>item.id)).size!==items.length)return responseFailure();return Object.freeze({items:Object.freeze(items),limit:50,truncated:value.truncated});
}
function directoryPage(input:unknown):EnquiryAssigneePageV2{
  const value=page(input,100),items=value.items.map(input=>{const row=own(input,['userId','role']);if(typeof row.userId!=='string'||!UUID.test(row.userId)||row.role!=='agent'&&row.role!=='admin')return responseFailure();return Object.freeze({userId:row.userId.toLowerCase(),role:row.role});});
  if(new Set(items.map(item=>item.userId)).size!==items.length)return responseFailure();return Object.freeze({items:Object.freeze(items),limit:100,truncated:value.truncated});
}
function decode(source:string):unknown{
  const tokens=source.match(/"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g)??[],containers:(Set<string>|null)[]=[];
  for(let index=0;index<tokens.length;index++){
    const token=tokens[index]!;if(token==='{')containers.push(new Set());else if(token==='[')containers.push(null);else if(token==='}'||token===']')containers.pop();
    else if(token.startsWith('"')&&tokens[index+1]===':'){
      const keys=containers.at(-1),key=JSON.parse(token) as string;if(!keys||keys.has(key))return responseFailure();keys.add(key);
      if(key==='limit'&&!/^[1-9]\d*$/.test(tokens[index+2]??''))return responseFailure();
      if(key==='contactedRevision'&&!/^(?:null|[1-9]\d*)$/.test(tokens[index+2]??''))return responseFailure();
    }
  }
  return JSON.parse(source) as unknown;
}
function chunkView(input:unknown):Uint8Array<ArrayBuffer>{
  if(!ArrayBuffer.isView(input)||tagGetter.call(input)!=='Uint8Array')return responseFailure();
  const buffer=bufferGetter.call(input) as ArrayBuffer;backingLength.call(buffer);
  return new Uint8Array(buffer,offsetGetter.call(input) as number,lengthGetter.call(input) as number);
}
function disposeBody(response:Response):void{try{void response.body?.cancel().catch(()=>undefined);}catch{/* Cleanup cannot confer success. */}}
/** Fixed actor route, bounded decoded JSON, per-call cancellation and no automatic retry. */
export function createEnquiryPreviewClient(input:Configuration):EnquiryPreviewClient{
  let config:Record<string,unknown>;
  try{
    const keys=Reflect.ownKeys(input);if(keys.some(key=>typeof key!=='string'||!['basePath','instanceId','fetch','timeoutMs'].includes(key)))throw new Error();
    config=own(input,keys as string[]);
    if(typeof config.basePath!=='string'||!/^\/api\/enquiry-preview\/(?:admin|agent)$/.test(config.basePath)||typeof config.instanceId!=='string'||!UUID.test(config.instanceId)||config.fetch!==undefined&&typeof config.fetch!=='function')throw new Error();
  }catch{throw new EnquiryPreviewError('validation');}
  const basePath=config.basePath as string,instanceId=config.instanceId as string,transport=(config.fetch??((path:RequestInfo|URL,init?:RequestInit)=>globalThis.fetch(path,init))) as typeof globalThis.fetch;
  const configuredTimeout=config.timeoutMs===undefined?20000:config.timeoutMs;
  if(typeof configuredTimeout!=='number'||!Number.isSafeInteger(configuredTimeout)||configuredTimeout<1||configuredTimeout>30000)throw new EnquiryPreviewError('validation');
  const timeoutMs:number=configuredTimeout;
  async function request<T>(path:string,method:'GET'|'POST',signal:AbortSignal|undefined,parse:(value:unknown)=>T,body?:Record<string,unknown>,captureKey?:string,readOnly=false):Promise<T>{
    if(signal!==undefined&&!(signal instanceof AbortSignal))throw new EnquiryPreviewError('validation');
    if(signal?.aborted)throw new EnquiryPreviewError('cancelled');
    const writes=method==='POST'&&!readOnly,controller=new AbortController(),deadline=performance.now()+timeoutMs;
    let dispatched=false,interruption:EnquiryPreviewError|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    let rejectStop:(error:EnquiryPreviewError)=>void=()=>undefined;
    const stopped=new Promise<never>((_,reject)=>{rejectStop=reject;});
    const stop=(kind:'timeout'|'cancelled')=>{if(interruption)return;interruption=new EnquiryPreviewError(kind,0,writes&&dispatched);controller.abort();rejectStop(interruption);};
    const check=()=>{if(interruption)throw interruption;if(signal?.aborted){stop('cancelled');throw interruption;}if(performance.now()>=deadline){stop('timeout');throw interruption;}};
    const cancel=()=>stop('cancelled'),timer=setTimeout(()=>stop('timeout'),timeoutMs);signal?.addEventListener('abort',cancel,{once:true});
    try{
      const operation=(async()=>{
        check();dispatched=true;
        const pending=transport(path,{method,signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error',headers:{Accept:'application/json','X-Preview-Instance':instanceId,...(captureKey?{'Idempotency-Key':captureKey}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
        void pending.then(response=>{if(interruption)disposeBody(response);},()=>undefined);
        let response:Response;try{response=await Promise.race([pending,stopped]);}catch(error){if(interruption)throw interruption;throw new EnquiryPreviewError('network',0,writes);}
        try{
          check();
          if(response.redirected||response.status>=300&&response.status<400||response.headers.has('content-range'))return responseFailure();
          if(response.url){const actual=new URL(response.url);if(actual.pathname+actual.search!==path||actual.hash||actual.username||actual.password||typeof location!=='undefined'&&actual.origin!==location.origin)return responseFailure();}
          if(!/^application\/json(?:\s*;[^\r\n]*)?$/i.test(response.headers.get('content-type')??''))return responseFailure();
          // Fetch exposes decoded bytes. A standard compressed Content-Length counts wire
          // bytes, so only identity lengths can be compared to the decoded collector.
          const encoding=response.headers.get('content-encoding');if(encoding!==null&&!['identity','gzip','br','deflate'].includes(encoding.toLowerCase()))return responseFailure();
          const declared=response.headers.get('content-length');let expected:number|undefined;
          if(declared!==null){if(!/^[1-9]\d*$/.test(declared)||Number(declared)>MAX_BYTES)return responseFailure();if(encoding===null||encoding.toLowerCase()==='identity')expected=Number(declared);}
          reader=response.body?.getReader();if(!reader)return responseFailure();
          const bytes=new Uint8Array(MAX_BYTES);let length=0;
          for(;;){check();const item=await Promise.race([reader.read(),stopped]);check();if(item.done===true)break;if(item.done!==false)return responseFailure();
            const view=chunkView(item.value);if(view.byteLength>MAX_BYTES-length||expected!==undefined&&view.byteLength>expected-length)return responseFailure();
            if(view.byteLength){bytes.set(view,length);length+=view.byteLength;}
          }
          if(length===0||expected!==undefined&&length!==expected)return responseFailure();
          const payload=decode(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length)));check();
          if(response.status!==(captureKey?201:200)){
            if(response.status<400||response.status>599)return responseFailure();
            const value=own(payload,captureKey?['error','requestId']:['error','submissionUncertain']),error=own(value.error,['code','message']);
            if(captureKey)selectedId(value.requestId);
            if((!captureKey&&typeof value.submissionUncertain!=='boolean')||typeof error.code!=='string'||!Object.hasOwn(ERROR_STATUS,error.code)||!ERROR_STATUS[error.code]!.includes(response.status)||typeof error.message!=='string'||error.message.length<1||error.message.length>1024)return responseFailure();
            throw new EnquiryPreviewError('http',response.status,writes&&(value.submissionUncertain===true||response.status>=500||response.status===499));
          }
          const result=parse(payload);check();return result;
        }catch(error){
          if(interruption)throw interruption;
          if(error instanceof EnquiryPreviewError&&error.kind==='http')throw error;
          throw new EnquiryPreviewError('response',response.status,writes);
        }finally{
          if(reader){try{void Promise.resolve(reader.cancel()).catch(()=>undefined);}catch{/* A pending stream can already be cancelled. */}try{reader.releaseLock();}catch{/* A pending read may still own its lock. */}}
          else disposeBody(response);
        }
      })();
      return await Promise.race([operation,stopped]);
    }catch(error){
      if(interruption)throw interruption;if(error instanceof EnquiryPreviewError)throw error;throw new EnquiryPreviewError('network',0,writes&&dispatched);
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  const command=(value:EnquiryOperationInputV2)=>{try{return validateEnquiryCommand(value);}catch{throw new EnquiryPreviewError('validation');}};
  const contactCommand=(input:ContactCommand)=>{try{return validateContactCommand(input);}catch{throw new EnquiryPreviewError('validation');}};
  const viewingOriginal=(input:ViewingOriginal)=>{try{return validateViewingOriginal(input);}catch{throw new EnquiryPreviewError('validation');}};
  const confirmationCommand=(input:ViewingConfirmationCommand)=>{try{return validateViewingConfirmationCommand(input);}catch{throw new EnquiryPreviewError('validation');}};
  const viewingWire=(original:ViewingOriginal)=>({...original,command:original.kind==='request'?{...original.command,expectedEnquiryVersion:Number(original.command.expectedEnquiryVersion)}:{...original.command,expectedVersion:Number(original.command.expectedVersion)}});
  const terminalCommand=(kind:ViewingTerminationKind,input:ViewingTerminationCommand)=>{try{if(kind!=='cancel'&&kind!=='decline')throw new Error();return validateViewingTerminationCommand(input);}catch{throw new EnquiryPreviewError('validation');}};
  const terminalRequest=(recover:boolean,id:string,viewingId:string,kind:ViewingTerminationKind,input:ViewingTerminationCommand,signal?:AbortSignal)=>{const selected=selectedId(id),viewing=selectedId(viewingId),original=terminalCommand(kind,input);return request(`${basePath}/enquiries/${selected}/viewings/${viewing}/${kind==='cancel'?'cancellations':'declines'}${recover?'/recover':''}`,'POST',signal,value=>validateViewingTerminationReceipt(value,selected,viewing,kind,original),{...original,expectedVersion:Number(original.expectedVersion)},undefined,recover);};
  return Object.freeze({
    terminateViewing:(id:string,viewingId:string,kind:ViewingTerminationKind,input:ViewingTerminationCommand,signal?:AbortSignal)=>terminalRequest(false,id,viewingId,kind,input,signal),
    recoverViewingTermination:(id:string,viewingId:string,kind:ViewingTerminationKind,input:ViewingTerminationCommand,signal?:AbortSignal)=>terminalRequest(true,id,viewingId,kind,input,signal),
    confirmViewing:(id:string,viewingId:string,input:ViewingConfirmationCommand,signal?:AbortSignal)=>{const selected=selectedId(id),viewing=selectedId(viewingId),original=confirmationCommand(input);return request(`${basePath}/enquiries/${selected}/viewings/${viewing}/confirmations`,'POST',signal,value=>validateViewingConfirmationReceipt(value,selected,viewing,original),{...original,expectedVersion:Number(original.expectedVersion)});},
    recoverViewingConfirmation:(id:string,viewingId:string,input:ViewingConfirmationCommand,signal?:AbortSignal)=>{const selected=selectedId(id),viewing=selectedId(viewingId),original=confirmationCommand(input);return request(`${basePath}/enquiries/${selected}/viewings/${viewing}/confirmations/recover`,'POST',signal,value=>validateViewingConfirmationReceipt(value,selected,viewing,original),{...original,expectedVersion:Number(original.expectedVersion)},undefined,true);},
    viewingProperties:(signal?:AbortSignal)=>request(`${basePath}/viewing-properties?limit=25`,'GET',signal,value=>validateViewingProperties(value)),
    viewings:(id:string,signal?:AbortSignal)=>{const selected=selectedId(id);return request(`${basePath}/enquiries/${selected}/viewings?limit=25`,'GET',signal,value=>validateViewingPage(value,selected,25));},
    viewing:(id:string,viewingId:string,signal?:AbortSignal)=>{const selected=selectedId(id),viewing=selectedId(viewingId);return request(`${basePath}/enquiries/${selected}/viewings/${viewing}`,'GET',signal,value=>validateViewingDetail(value,selected,viewing));},
    saveViewing:(id:string,input:ViewingOriginal,signal?:AbortSignal)=>{const selected=selectedId(id),original=viewingOriginal(input),wire=viewingWire(original);return request(original.kind==='request'?`${basePath}/enquiries/${selected}/viewings`:`${basePath}/enquiries/${selected}/viewings/${original.viewingId}/proposals`,'POST',signal,value=>validateViewingReceipt(value,selected,original),wire.command);},
    recoverViewing:(id:string,input:ViewingOriginal,signal?:AbortSignal)=>{const selected=selectedId(id),original=viewingOriginal(input);return request(`${basePath}/enquiries/${selected}/viewings/recover`,'POST',signal,value=>validateViewingReceipt(value,selected,original),viewingWire(original),undefined,true);},
    contacts:(id:string,signal?:AbortSignal)=>request(`${basePath}/enquiries/${selectedId(id)}/contacts?limit=25`,'GET',signal,value=>validateContactPage(value,25)),
    recordContact:async(id:string,input:ContactCommand,signal?:AbortSignal)=>{const selected=selectedId(id),original=contactCommand(input);return request(`${basePath}/enquiries/${selected}/contacts`,'POST',signal,value=>validateContactReceipt(value,selected,original.operationId,original),{...original,expectedVersion:Number(original.expectedVersion)});},
    recoverContact:async(id:string,input:ContactCommand,signal?:AbortSignal)=>{const selected=selectedId(id),original=contactCommand(input);return request(`${basePath}/enquiries/${selected}/contacts/recover`,'POST',signal,value=>validateContactReceipt(value,selected,original.operationId,original),{...original,expectedVersion:Number(original.expectedVersion)},undefined,true);},
    prepareCapture:(input:StaffEnquiryInput,key:string):CaptureAttempt=>{
      let captured:StaffEnquiryInput,body:Record<string,unknown>,originalKey:string;
      try{originalKey=selectedId(key);captured=Object.freeze({...own(input,Reflect.ownKeys(input) as string[])}) as unknown as StaffEnquiryInput;body={...validateStaffEnquiryInput(captured,'synthetic-staff-notice-v1')};}catch{throw new EnquiryPreviewError('validation');}
      let status:CaptureAttempt['status']='ready',receipt:EnquiryReceipt|null=null;
      const run=async(replay:boolean,signal?:AbortSignal)=>{
        if(signal!==undefined&&!(signal instanceof AbortSignal)||status!==(replay?'uncertain':'ready'))throw new EnquiryPreviewError('validation');
        const uncertain=status==='uncertain';status='sending';
        try{receipt=await request(`${basePath}/capture`,'POST',signal,value=>{const result=own(value,['id']);return Object.freeze({id:selectedId(result.id)});},body,originalKey);status='received';return receipt;}
        catch(error){status=uncertain||!(error instanceof EnquiryPreviewError)||error.uncertain?'uncertain':'rejected';throw error;}
      };
      return Object.freeze({input:captured,key:originalKey,get status(){return status;},get receipt(){return receipt;},submit:(signal?:AbortSignal)=>run(false,signal),retryOriginal:(signal?:AbortSignal)=>run(true,signal)});
    },
    activity:(id:string,signal?:AbortSignal)=>request(`${basePath}/enquiries/${selectedId(id)}/activity?limit=50`,'GET',signal,value=>validateEnquiryActivityPage(value,50)),
    list:(signal?:AbortSignal)=>request(`${basePath}/enquiries?limit=50`,'GET',signal,enquiryPage),
    detail:async(id:string,signal?:AbortSignal)=>{const selected=selectedId(id);return request(`${basePath}/enquiries/${selected}`,'GET',signal,value=>validateStaffEnquiryDetailV2(value,selected));},
    assignees:(signal?:AbortSignal)=>request(`${basePath}/assignees?limit=100`,'GET',signal,directoryPage),
    apply:async(id:string,input:EnquiryOperationInputV2,signal?:AbortSignal)=>{const selected=selectedId(id),original=command(input);return request(`${basePath}/enquiries/${selected}/operations`,'POST',signal,value=>validateEnquiryOperationReceiptV2(value,selected,original.operationId,original),{...original,expectedVersion:Number(original.expectedVersion)});},
    recover:async(id:string,input:EnquiryOperationInputV2,signal?:AbortSignal)=>{const selected=selectedId(id),original=command(input);return request(`${basePath}/enquiries/${selected}/operations/${original.operationId}`,'GET',signal,value=>validateEnquiryOperationReceiptV2(value,selected,original.operationId,original));},
  });
}
