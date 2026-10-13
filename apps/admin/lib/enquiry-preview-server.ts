import 'server-only';
import {validateContactCommand,type ContactCommand,handleSyntheticEnquiry,ApiClientError,RealtorApiClient,type EnquiryOperationInputV2} from '@realtor/api-client';
import {assertPreviewRequest} from './staff-preview-policy.ts';

type Actor='admin'|'agent';
type Action='list'|'detail'|'assignees'|'command'|'operation'|'activity'|'contacts'|'contact-record'|'contact-recover';
type Environment=Readonly<Record<string,string|undefined>>;
type Scope=Readonly<{actorId:string;role:Actor;instanceId:string}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES=8192,BODY_TIMEOUT_MS=15000;
const HEADERS={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Expires':'0',
  'X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'};
const MESSAGE='The synthetic enquiry preview request could not be completed.';
const reply=(status:number,code:string,submissionUncertain=false)=>Response.json({error:{code,message:MESSAGE},submissionUncertain},{status,headers:HEADERS});
class BoundaryError extends Error {constructor(readonly status:number,readonly code:string){super(code);}}

function configuration(actor:unknown,env:Environment){
  if((actor!=='admin'&&actor!=='agent')||env.NODE_ENV!=='development'||env.STAFF_ENQUIRY_PREVIEW_MODE!=='synthetic-v1')throw new Error('Unavailable synthetic scope.');
  const origin=new URL(env.STAFF_PREVIEW_API_ORIGIN??'');
  if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||origin.pathname!=='/'||origin.username||origin.password||origin.search||origin.hash)throw new Error('Invalid local origin.');
  const scopes=Object.fromEntries((['admin','agent'] as const).map(role=>{
    const prefix=`STAFF_ENQUIRY_${role.toUpperCase()}`,bearerToken=env[`${prefix}_TOKEN`],actorId=env[`${prefix}_ID`],instanceId=env[`${prefix}_INSTANCE`];
    if(!bearerToken||bearerToken.length>8192||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(bearerToken)
      ||!actorId||!UUID.test(actorId)||!instanceId||!UUID.test(instanceId))throw new Error('Unavailable synthetic identity.');
    return [role,Object.freeze({role,actorId:actorId.toLowerCase(),instanceId:instanceId.toLowerCase(),bearerToken})];
  })) as Record<Actor,Scope&Readonly<{bearerToken:string}>>;
  if(scopes.admin.actorId===scopes.agent.actorId||scopes.admin.instanceId===scopes.agent.instanceId||scopes.admin.bearerToken===scopes.agent.bearerToken)throw new Error('Synthetic roles must have separate fixed scopes.');
  return Object.freeze({...scopes[actor],origin:origin.origin});
}

/** Safe page metadata only. These fixed development roles never select a production identity. */
export function getEnquiryPreviewScope(actor:unknown,env:Environment=process.env):Scope{
  const {actorId,role,instanceId}=configuration(actor,env);return Object.freeze({actorId,role,instanceId});
}

function failure(error:unknown,writeDispatched:boolean):Response{
  if(error instanceof BoundaryError)return reply(error.status,error.code);
  if(!(error instanceof ApiClientError))return reply(502,'PREVIEW_UNAVAILABLE',writeDispatched);
  const uncertain=writeDispatched&&error.submissionUncertain;
  if(error.kind==='CANCELLED')return reply(499,'CANCELLED',uncertain);
  if(error.kind==='TIMEOUT')return reply(504,'PREVIEW_UNAVAILABLE',uncertain);
  if(error.kind==='VALIDATION')return reply(400,'INVALID_INPUT');
  if(error.kind==='HTTP'){
    const codes:Readonly<Record<number,readonly string[]>>={400:['INVALID_INPUT','INVALID_JSON'],401:['UNAUTHENTICATED'],403:['FORBIDDEN'],404:['NOT_FOUND'],405:['METHOD_NOT_ALLOWED'],409:['CONFLICT'],413:['BODY_TOO_LARGE'],415:['JSON_REQUIRED'],422:['INVALID_STATE'],429:['RATE_LIMITED'],503:['SERVICE_UNAVAILABLE']};
    if(error.status!==undefined&&codes[error.status]?.includes(error.serverCode??''))return reply(error.status,error.serverCode!,uncertain);
  }
  return reply(502,'PREVIEW_UNAVAILABLE',uncertain);
}

function requestShape(request:Request,params:{actor:string;id?:string;operationId?:string},action:Action):number|undefined{
  const contact=action==='contact-record'||action==='contact-recover',bodyAction=action==='command'||contact;
  const url=new URL(request.url),base=`/api/enquiry-preview/${params.actor}`;
  if(url.hash||request.url.includes('#')||[params.id,params.operationId].some(value=>value!==undefined&&!UUID.test(value)))throw new BoundaryError(400,'INVALID_INPUT');
  const path=action==='list'?`${base}/enquiries`:action==='assignees'?`${base}/assignees`:
    action==='contacts'||action==='contact-record'?`${base}/enquiries/${params.id}/contacts`:action==='contact-recover'?`${base}/enquiries/${params.id}/contacts/recover`:action==='activity'?`${base}/enquiries/${params.id}/activity`:action==='detail'?`${base}/enquiries/${params.id}`:action==='command'?`${base}/enquiries/${params.id}/operations`:`${base}/enquiries/${params.id}/operations/${params.operationId}`;
  if(url.pathname!==path||(['list','assignees'].includes(action)?params.id!==undefined||params.operationId!==undefined:!params.id)
    ||(action==='operation'?!params.operationId:params.operationId!==undefined))throw new BoundaryError(400,'INVALID_INPUT');
  if(params.actor==='agent'&&action==='assignees')throw new BoundaryError(403,'FORBIDDEN');
  let limit:number|undefined;
  if(action==='list'||action==='assignees'||action==='activity'||action==='contacts'){
    if(request.url.includes('?')&&!/^\?limit=[1-9]\d{0,2}$/.test(url.search))throw new BoundaryError(400,'INVALID_INPUT');
    limit=url.search?Number(url.search.slice(7)):action==='contacts'?25:action==='assignees'?100:50;
    if(limit<1||limit>(action==='contacts'?25:100))throw new BoundaryError(400,'INVALID_INPUT');
  }else if(url.search||request.url.includes('?'))throw new BoundaryError(400,'INVALID_INPUT');
  let forbidden=false;
  request.headers.forEach((_,name)=>{
    if(['cookie','content-encoding','expect','range','transfer-encoding','x-actor-id','x-tenant-id','x-role','x-actor','x-tenant','x-revision-version'].includes(name)||name.startsWith('if-'))forbidden=true;
    if(!bodyAction&&['content-length','content-type'].includes(name))forbidden=true;
  });
  if(forbidden||(!bodyAction&&request.body!==null))throw new BoundaryError(400,'INVALID_INPUT');
  if(bodyAction){
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??''))throw new BoundaryError(400,'INVALID_INPUT');
    const length=request.headers.get('content-length');
    if(length!==null&&(!/^[1-9]\d{0,4}$/.test(length)||Number(length)>(contact?16384:MAX_BYTES)))throw new BoundaryError(400,'INVALID_INPUT');
  }
  return limit;
}

async function commandBody(request:Request):Promise<EnquiryOperationInputV2>;
async function commandBody(request:Request,contact:true):Promise<ContactCommand>;
async function commandBody(request:Request,contact=false):Promise<EnquiryOperationInputV2|ContactCommand>{
  if(request.signal.aborted)throw new BoundaryError(499,'CANCELLED');
  const reader=request.body?.getReader();if(!reader)throw new BoundaryError(400,'INVALID_INPUT');
  const maximum=contact?16384:MAX_BYTES,bytes=new Uint8Array(maximum),started=performance.now();let size=0,stop:BoundaryError|undefined;
  let rejectStop:(error:BoundaryError)=>void=()=>{};
  const stopped=new Promise<never>((_,reject)=>{rejectStop=reject;});
  void stopped.catch(()=>undefined);
  const cancel=()=>{try{void reader.cancel().catch(()=>undefined);}catch{/* Do not wait for transport cleanup. */}};
  const interrupt=(status:number,code:string)=>{if(stop)return;stop=new BoundaryError(status,code);cancel();rejectStop(stop);};
  const aborted=()=>interrupt(499,'CANCELLED'),timer=setTimeout(()=>interrupt(504,'PREVIEW_UNAVAILABLE'),BODY_TIMEOUT_MS);
  request.signal.addEventListener('abort',aborted,{once:true});
  try{
    for(;;){
      if(request.signal.aborted)aborted();if(performance.now()-started>=BODY_TIMEOUT_MS)interrupt(504,'PREVIEW_UNAVAILABLE');if(stop)throw stop;
      const item=await Promise.race([reader.read(),stopped]);if(stop)throw stop;
      if(item.done)break;
      if(!(item.value instanceof Uint8Array)||item.value.byteLength===0||item.value.byteLength>maximum-size)throw new BoundaryError(400,'INVALID_INPUT');
      bytes.set(item.value,size);size+=item.value.byteLength;
    }
    const declared=request.headers.get('content-length');
    if(size===0||(declared!==null&&size!==Number(declared)))throw new BoundaryError(400,'INVALID_INPUT');
    const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)),value:unknown=JSON.parse(source);
    // Consume whole strings and decode object keys, so escaped duplicates and
    // fractional/exponent versions cannot be rounded into a different command.
    const tokens=source.match(/"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g)??[],containers:(Set<string>|null)[]=[];
    for(let index=0;index<tokens.length;index++){
      const token=tokens[index]!;
      if(token==='{')containers.push(new Set());else if(token==='[')containers.push(null);else if(token==='}'||token===']')containers.pop();
      else if(token.startsWith('"')&&tokens[index+1]===':'){
        const keys=containers.at(-1),key=JSON.parse(token) as string;
        if(!keys||keys.has(key))throw new BoundaryError(400,'INVALID_INPUT');keys.add(key);
        if(key==='expectedVersion'&&!/^[1-9]\d*$/.test(tokens[index+2]??''))throw new BoundaryError(400,'INVALID_INPUT');
      }
    }
    const fields=contact?['operationId','expectedVersion','channel','outcome','occurredAt','notes']:['operationId','kind','expectedVersion','assignedAgentId','status','nextActionAt','reason'];
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==fields.length||fields.some(field=>!Object.hasOwn(value,field)))throw new BoundaryError(400,'INVALID_INPUT');
    const record=value as Record<string,unknown>,version=record.expectedVersion;
    if(typeof version!=='number'||!Number.isSafeInteger(version)||version<1||version>Number.MAX_SAFE_INTEGER-(contact?0:1))throw new BoundaryError(400,'INVALID_INPUT');
    if(contact)return validateContactCommand({...record,expectedVersion:String(version)});
    return Object.freeze({...record,expectedVersion:String(version)}) as unknown as EnquiryOperationInputV2;
  }catch(error){if(error instanceof BoundaryError)throw error;throw new BoundaryError(400,'INVALID_INPUT');}
  finally{clearTimeout(timer);request.signal.removeEventListener('abort',aborted);cancel();try{reader.releaseLock();}catch{/* A pending cancelled read must not delay this result. */}}
}

/** Trusted fixed-role development BFF. It never forwards a browser credential or retries a command. */
export async function enquiryPreviewRequest(request:Request,params:{actor:string;id?:string;operationId?:string},action:Action):Promise<Response>{
  let config:ReturnType<typeof configuration>;
  try{
    config=configuration(params.actor,process.env);assertPreviewRequest(request,config.instanceId);
    const origin=request.headers.get('origin');if(origin!==null&&origin!==`http://${request.headers.get('host')}`)throw new Error();
  }catch{return reply(403,'PREVIEW_UNAVAILABLE');}
  if(request.method!==(['command','contact-record','contact-recover'].includes(action)?'POST':'GET'))return reply(405,'METHOD_NOT_ALLOWED');
  let writeDispatched=false;
  try{
    const limit=requestShape(request,params,action);
    if(request.signal.aborted)throw new BoundaryError(499,'CANCELLED');
    const command=action==='command'?await commandBody(request):undefined;
    const contact=['contact-record','contact-recover'].includes(action)?await commandBody(request,true):undefined;
    const client=new RealtorApiClient({baseUrl:config.origin,privacyNoticeVersion:'synthetic-preview-v1',allowLoopbackHttp:true}),options={bearerToken:config.bearerToken,signal:request.signal,timeoutMs:30000};
    let result:unknown;
    if(action==='list')result=await client.listStaffEnquiriesV2({...options,limit});
    else if(action==='assignees')result=await client.listEnquiryAssigneesV2({...options,limit});
    else if(action==='contacts')result=await client.listContactsV2(params.id!,{...options,limit});
    else if(action==='contact-recover')result=await client.getContactReceiptV2(params.id!,contact!,options);
    else if(action==='contact-record'){writeDispatched=true;result=await client.recordContactV2(params.id!,contact!,options);}
    else if(action==='activity')result=await client.listEnquiryActivityV2(params.id!,{...options,limit});
    else if(action==='detail')result=await client.getStaffEnquiryV2(params.id!,options);
    else if(action==='operation')result=await client.getEnquiryOperationV2(params.id!,params.operationId!,options);
    else{writeDispatched=true;result=await client.applyEnquiryOperationV2(params.id!,command!,options);}
    return Response.json(result,{status:200,headers:HEADERS});
  }catch(error){return failure(error,writeDispatched);}
}

/** Fixed synthetic staff identity remains server-only; browser cannot choose upstream credentials. */
export async function staffCapturePreviewRequest(request:Request,actor:string):Promise<Response>{
  let scope:ReturnType<typeof configuration>;
  try{scope=configuration(actor,process.env);}catch{return reply(403,'PREVIEW_UNAVAILABLE');}
  return handleSyntheticEnquiry(request,{apiOrigin:scope.origin,noticeVersion:'synthetic-staff-notice-v1',
    staff:{actor:scope.role,bearerToken:scope.bearerToken},authorize:incoming=>assertPreviewRequest(incoming,scope.instanceId)});
}
