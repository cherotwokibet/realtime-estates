import 'server-only';
import {ApiClientError,RealtorApiClient,validateListingCreationCommand} from '@realtor/api-client';
import {previewConfiguration,assertPreviewRequest,upstreamFailureStatus} from './staff-preview-policy.ts';
import {parseCreationJson} from './listing-creation-wire.ts';
const reply=(status:number,value:unknown)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff'}}),uuid=(value:string)=>/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export async function listingCreationPreviewRequest(request:Request,params:{id:string;operationId:string}):Promise<Response>{
 let config:ReturnType<typeof previewConfiguration>;
 try{config=previewConfiguration(process.env);assertPreviewRequest(request,config.instanceId);}catch{return reply(403,{error:{code:'PREVIEW_UNAVAILABLE'},submissionUncertain:false});}
 let dispatchedWrite=false;
 try{
  const url=new URL(request.url);if(!uuid(params.id)||!uuid(params.operationId)||url.search||url.hash||request.url.includes('?'))throw new Error();
  if(request.method!=='POST'&&request.method!=='GET')return reply(405,{error:{code:'METHOD_NOT_ALLOWED'},submissionUncertain:false});
  let forbidden=false;request.headers.forEach((_,name)=>{if(['cookie','content-encoding','expect','range','transfer-encoding','idempotency-key','x-actor-id','x-tenant-id','x-role','x-company-id','x-assigned-agent-id'].includes(name)||name.startsWith('if-'))forbidden=true;});if(forbidden)throw new Error();
  const options={bearerToken:config.bearerToken},client=new RealtorApiClient({baseUrl:config.origin,privacyNoticeVersion:'synthetic-preview-v1',allowLoopbackHttp:true});
  if(request.method==='GET'){if(request.body!==null||request.headers.has('content-type')||request.headers.has('content-length'))throw new Error();return reply(200,await client.getListingCreationSnapshotV2(params.id,params.operationId,options));}
  const declared=request.headers.get('content-length');if(declared!==null&&(!/^(?:0|[1-9]\d*)$/.test(declared)||Number(declared)>128*1024))throw new Error();
  const reader=request.body?.getReader();if(!reader)throw new Error();const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>128*1024){await reader.cancel();throw new Error();}chunks.push(value);}}finally{reader.releaseLock();}
  if(declared!==null&&Number(declared)!==size)throw new Error();const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const input=parseCreationJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!input||typeof input!=='object'||Array.isArray(input)||Reflect.ownKeys(input).some(k=>k!=='slug'&&k!=='content'))throw new Error();
  const command=validateListingCreationCommand({...input,listingId:params.id,operationId:params.operationId});dispatchedWrite=true;return reply(200,await client.createListingV2(command,options));
 }catch(error){if(error instanceof ApiClientError)return reply(upstreamFailureStatus(error.status,error.kind),{error:{code:error.serverCode??error.kind},submissionUncertain:error.submissionUncertain});return reply(dispatchedWrite?502:400,{error:{code:dispatchedWrite?'SERVICE_UNAVAILABLE':'INVALID_INPUT'},submissionUncertain:dispatchedWrite});}
}
