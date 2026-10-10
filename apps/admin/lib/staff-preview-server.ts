import 'server-only';
import {ApiClientError,RealtorApiClient} from '@realtor/api-client';
import {assertPreviewRequest,previewConfiguration,upstreamFailureStatus} from './staff-preview-policy';
import {parseListingJsonV2} from '@realtor/domain';

const reply=(status:number,body:unknown)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff'}});
async function boundedJson(request:Request):Promise<unknown> {
  const reader=request.body?.getReader();if(!reader)throw new Error('Missing body.');
  const chunks:Uint8Array[]=[];let length=0;
  try {while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>128*1024){await reader.cancel();throw new Error('Request too large.');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return parseListingJsonV2(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export async function staffPreviewRequest(request:Request,params:{id:string;revision:string},submit=false):Promise<Response> {
  let config:ReturnType<typeof previewConfiguration>;
  try {config=previewConfiguration(process.env);assertPreviewRequest(request,config.instanceId);}catch{return reply(403,{error:{code:'PREVIEW_UNAVAILABLE',message:'Use the local synthetic staff launcher. Production staff sign-in is not configured.'}});}
  const client=new RealtorApiClient({baseUrl:config.origin,privacyNoticeVersion:'synthetic-preview-v1',allowLoopbackHttp:true});
  const options={bearerToken:config.bearerToken};
  try {
    if(!/^[1-9]\d*$/.test(params.revision))return reply(400,{error:{code:'INVALID_INPUT',message:'Invalid revision.'}});
    const revision=Number(params.revision);
    if(request.method==='GET'&&!submit)return reply(200,await client.getStaffDraftV2(params.id,revision,options));
    const body=await boundedJson(request);
    if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Invalid body.');
    const value=body as Record<string,unknown>;
    if(typeof value.expectedVersion!=='string'||Object.keys(value).some(key=>!['expectedVersion',...(submit?[]:['content'])].includes(key)))throw new Error('Invalid draft envelope.');
    if(submit)return reply(200,await client.submitStaffDraftV2(params.id,revision,{expectedVersion:value.expectedVersion},options));
    return reply(200,await client.saveStaffDraftV2(params.id,revision,{expectedVersion:value.expectedVersion,content:value.content as never},options));
  }catch(error){
    if(error instanceof ApiClientError)return reply(upstreamFailureStatus(error.status,error.kind),{error:{code:error.serverCode??error.kind,message:error.message},submissionUncertain:error.submissionUncertain});
    return reply(400,{error:{code:'INVALID_INPUT',message:'Supply a valid, bounded draft with exact KES amounts.'}});
  }
}
