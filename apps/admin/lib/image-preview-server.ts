import 'server-only';
import {ApiClientError,RealtorApiClient} from '@realtor/api-client';
import {assertPreviewRequest,previewConfiguration} from './staff-preview-policy.ts';

const MAX_BYTES=10*1024*1024;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Expires':'0',
  'X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'};
const reply=(status:number,code:string)=>Response.json({error:{code,message:'Private image preview is unavailable.'},submissionUncertain:false},{status,headers});
function failure(error:unknown):Response{
  if(!(error instanceof ApiClientError))return reply(502,'PREVIEW_UNAVAILABLE');
  if(error.kind==='CANCELLED')return reply(499,'CANCELLED');
  if(error.kind==='TIMEOUT')return reply(504,'PREVIEW_UNAVAILABLE');
  if(error.kind==='VALIDATION')return reply(400,'INVALID_INPUT');
  if(error.kind==='HTTP'){
    if(error.status===400)return reply(400,'INVALID_INPUT');
    if(error.status===401)return reply(401,'UNAUTHENTICATED');
    if(error.status===403)return reply(403,'FORBIDDEN');
    if(error.status===404)return reply(404,'NOT_FOUND');
    if(error.status===409)return reply(409,'VERSION_CONFLICT');
    if(error.status===429)return reply(429,'RATE_LIMITED');
    if(error.status===503)return reply(503,'PREVIEW_UNAVAILABLE');
  }
  return reply(502,'PREVIEW_UNAVAILABLE');
}

/** Private, development-only read. No browser credential or selector is forwarded. */
export async function imagePreviewRequest(request:Request,params:{id:string;revision:string;mediaId:string}):Promise<Response>{
  let config:ReturnType<typeof previewConfiguration>;
  try{
    config=previewConfiguration(process.env);
    if(process.env.STAFF_PREVIEW_MEDIA!=='synthetic')throw new Error();
    assertPreviewRequest(request,config.instanceId);
    const origin=request.headers.get('origin');
    if(origin!==null&&origin!==`http://${request.headers.get('host')}`)throw new Error();
  }catch{return reply(403,'PREVIEW_UNAVAILABLE');}
  if(request.method!=='GET')return reply(405,'METHOD_NOT_ALLOWED');

  let listingId:string,mediaId:string,revision:number,version:string;
  try{
    const url=new URL(request.url);
    if(url.search||url.hash||request.url.includes('?')||request.body!==null
      ||!uuid.test(params.id)||!uuid.test(params.mediaId)||!/^[1-9]\d{0,9}$/.test(params.revision)
      ||Number(params.revision)>2147483647
      ||url.pathname!==`/api/staff/drafts/${params.id}/${params.revision}/media/${params.mediaId}/preview`)throw new Error();
    let unsupported=false;
    request.headers.forEach((_,name)=>{
      if(['cookie','content-length','transfer-encoding','content-type','content-encoding','expect','range'].includes(name)
        ||name.startsWith('if-'))unsupported=true;
    });
    if(unsupported)throw new Error();
    const expected=request.headers.get('x-revision-version');
    if(expected===null||!/^[1-9]\d{0,15}$/.test(expected)||BigInt(expected)>9007199254740991n)throw new Error();
    listingId=params.id.toLowerCase();mediaId=params.mediaId.toLowerCase();revision=Number(params.revision);version=expected;
  }catch{return reply(400,'INVALID_INPUT');}
  if(request.signal.aborted)return reply(499,'CANCELLED');

  try{
    const client=new RealtorApiClient({baseUrl:config.origin,privacyNoticeVersion:'synthetic-preview-v1',allowLoopbackHttp:true});
    const image=await client.getStaffMediaPreviewV2(listingId,revision,mediaId,version,
      {bearerToken:config.bearerToken,signal:request.signal,timeoutMs:30000});
    if(request.signal.aborted)return reply(499,'CANCELLED');
    if(image.listingId!==listingId||image.revision!==revision||image.mediaId!==mediaId||image.version!==version
      ||image.mimeType!=='image/webp'||!(image.data instanceof Uint8Array)||image.data.byteLength<20||image.data.byteLength>MAX_BYTES)
      return reply(502,'PREVIEW_UNAVAILABLE');
    // The SDK owns bounded framing/length validation; this copy belongs only to
    // the response. The version header describes the requested validated scope,
    // not an independently echoed upstream version or browser storage proof.
    const data=new Uint8Array(image.data);
    return new Response(data,{status:200,headers:{...headers,'Content-Type':'image/webp',
      'Content-Length':String(data.byteLength),'X-Revision-Version':version}});
  }catch(error){return failure(error);}
}
