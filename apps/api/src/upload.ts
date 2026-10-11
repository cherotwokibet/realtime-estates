import {randomUUID} from 'node:crypto';
import {createSyntheticUploadService,SyntheticUploadServiceError,type SyntheticUploadResource,type SyntheticUploadServiceResult} from '@realtor/media/upload-service';
import {SyntheticUploadBodyError} from '@realtor/media/upload-body';
import type {SyntheticUploadRequests} from '@realtor/media/upload-request';
import type {SyntheticOneAttemptProcessor} from '@realtor/media/one-attempt';
import {createTenantResolver,parseBearerHeader,type TenantConfiguration,type VerifiedIdentity} from './auth.js';
import type {TransactionDatabase} from './database.js';

const UUID='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const ID=new RegExp(`^${UUID}$`);
const ROUTE=new RegExp(`^/v2/staff/listings/(${UUID})/revisions/([1-9]\\d*)/media-jobs/(${UUID})/uploads/(${UUID})$`);
export interface DevelopmentUploadApiOptions {
  readonly tenant:TenantConfiguration;
  readonly database:TransactionDatabase;
  /** Fixed server verifier. Request identity/tenant/roles are never posted fields. */
  readonly verifyBearer:(bearer:string)=>Promise<VerifiedIdentity>;
  readonly requests:SyntheticUploadRequests;
  readonly createProcessor:()=>Promise<SyntheticOneAttemptProcessor>;
}
export interface DevelopmentUploadApi {
  handle(request:Request,source:AsyncIterable<Uint8Array>):Promise<Response>;
  close():Promise<void>;
}
class UploadHttpError extends Error {
  constructor(readonly status:number,readonly code:string){super(code);}
}
function response(status:number,payload:unknown,correlationId:string):Response {
  return new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Request-Id':correlationId}});
}
function denied():never {throw new SyntheticUploadServiceError('NOT_AUTHORIZED');}
function projection(value:SyntheticUploadServiceResult,resource:SyntheticUploadResource):Record<string,unknown> {
  if(value.uploadId!==resource.uploadId||value.jobId!==resource.jobId||value.listingId!==resource.listingId||value.revision!==resource.revision||!['verified','processing','blocked','native_failed'].includes(value.state))throw new UploadHttpError(503,'SERVICE_UNAVAILABLE');
  return {uploadId:resource.uploadId,jobId:resource.jobId,listingId:resource.listingId,revision:resource.revision,state:value.state};
}
/** Explicit trusted composition for loopback synthetic development; not enabled in the default server. */
export function createDevelopmentUploadApi(options:DevelopmentUploadApiOptions):DevelopmentUploadApi {
  if(process.env.NODE_ENV==='production')throw new Error('The synthetic upload adapter is development-only.');
  const resolveTenant=createTenantResolver([options.tenant]);
  const tenantId=options.tenant.tenantId.toLowerCase();
  if(!ID.test(tenantId)||typeof options.verifyBearer!=='function')throw new Error('Invalid trusted upload configuration.');
  const database=options.database,verify=options.verifyBearer;
  const service=createSyntheticUploadService({requests:options.requests,createProcessor:options.createProcessor,
    async authorize(resource,purpose){
      try {
        const row=await database.transaction({tenantId,actorId:resource.actorId,correlationId:randomUUID()},async query=>{
          const result=await query.query(purpose==='new'
            ? 'SELECT app_api.preflight_media_upload($1::uuid,$2::integer,$3::uuid) AS receipt'
            : 'SELECT app_api.read_media_job($1::uuid) AS receipt',purpose==='new'?[resource.listingId,resource.revision,resource.jobId]:[resource.jobId]);
          return result.rows[0]?.receipt;
        });
        if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('Invalid preflight result.');
        const facts=row as Record<string,unknown>;
        if(facts.jobId!==resource.jobId||facts.listingId!==resource.listingId||facts.revision!==resource.revision)denied();
        if(purpose==='history'&&facts.kind!=='register_media_upload')throw new Error('Invalid history result.');
      } catch(error) {
        if(error instanceof SyntheticUploadServiceError)throw error;
        const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
        if(['42501','P0002','23514','40001'].includes(code))denied();
        throw new SyntheticUploadServiceError('BLOCKED');
      }
    },
  });
  return Object.freeze({
    async handle(request:Request,source:AsyncIterable<Uint8Array>):Promise<Response>{
      const correlationId=randomUUID();
      try {
        const url=new URL(request.url),match=ROUTE.exec(url.pathname);
        if(!match||url.search||url.hash)throw new UploadHttpError(404,'NOT_FOUND');
        try {if(resolveTenant(url.host).tenantId.toLowerCase()!==tenantId)throw new Error();}
        catch {throw new UploadHttpError(404,'NOT_FOUND');}
        if(!['GET','PUT'].includes(request.method))throw new UploadHttpError(405,'METHOD_NOT_ALLOWED');
        const revision=Number(match[2]);
        if(!Number.isSafeInteger(revision)||revision>2147483647)throw new UploadHttpError(400,'INVALID_UPLOAD');
        let actorId:string;
        try {actorId=(await verify(parseBearerHeader(request.headers.get('authorization')??undefined))).actorId;if(!ID.test(actorId))throw new Error();}
        catch {throw new UploadHttpError(401,'UNAUTHENTICATED');}
        const resource=Object.freeze({tenantId,actorId:actorId.toLowerCase(),listingId:match[1]!.toLowerCase(),revision,jobId:match[3]!.toLowerCase(),uploadId:match[4]!.toLowerCase()});
        if(request.method==='GET'){
          if(request.headers.has('transfer-encoding')||!['0',null].includes(request.headers.get('content-length')))throw new UploadHttpError(400,'INVALID_UPLOAD');
          return response(200,projection(await service.read(resource),resource),correlationId);
        }
        if(request.headers.has('expect'))throw new UploadHttpError(417,'EXPECTATION_FAILED');
        if(request.headers.get('content-type')?.toLowerCase()!=='application/octet-stream'||(request.headers.has('content-encoding')&&request.headers.get('content-encoding')?.toLowerCase()!=='identity'))throw new UploadHttpError(415,'BINARY_REQUIRED');
        const length=request.headers.get('content-length');
        if(length!==null&&(!/^(?:0|[1-9]\d*)$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>10485760))throw new UploadHttpError(413,'BODY_TOO_LARGE');
        const result=await service.upload(resource,source,{signal:request.signal,...(length===null?{}:{declaredBytes:Number(length)})});
        return response(200,projection(result,resource),correlationId);
      }catch(error){
        let status=503,code='SERVICE_UNAVAILABLE';
        if(error instanceof UploadHttpError){status=error.status;code=error.code;}
        else if(error instanceof SyntheticUploadServiceError){
          if(error.code==='NOT_AUTHORIZED'){status=404;code='NOT_FOUND';}
          else if(error.code==='BUSY'){status=409;code='UPLOAD_BUSY';}
          else if(error.code==='BLOCKED'){status=409;code='UPLOAD_UNCONFIRMED';}
          else if(error.code==='INVALID_INPUT'){status=400;code='INVALID_UPLOAD';}
        }else if(error instanceof SyntheticUploadBodyError){
          status=error.code==='INPUT_TOO_LARGE'?413:error.code==='TIMED_OUT'?408:400;
          code=error.code==='INPUT_TOO_LARGE'?'BODY_TOO_LARGE':error.code==='TIMED_OUT'?'UPLOAD_TIMEOUT':error.code==='ABORTED'?'UPLOAD_ABORTED':'INVALID_UPLOAD';
        }
        return response(status,{error:code},correlationId);
      }
    },
    close:()=>service.close(),
  });
}
