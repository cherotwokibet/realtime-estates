import type { SyntheticImageManifest } from './index.js';

/** Trusted server infrastructure only. Never pass this pool or credentials to a decoder. */
export interface MediaCoordinatorQuery { query(sql:string,values?:readonly unknown[]):Promise<{readonly rows:readonly Record<string,unknown>[]}> }
export interface MediaCoordinatorClient extends MediaCoordinatorQuery { release(destroy?:boolean):void }
export interface MediaCoordinatorPool { connect():Promise<MediaCoordinatorClient>;end?():Promise<void> }
export class MediaCoordinatorSafetyError extends Error {
  override readonly name='MediaCoordinatorSafetyError';readonly code='UNSAFE_MEDIA_COORDINATOR_ROLE';
  constructor(){super('Media coordinator requires an isolated login with only its reviewed command privileges.');}
}
export class MediaCoordinatorInputError extends Error {
  override readonly name='MediaCoordinatorInputError';readonly code='INVALID_MEDIA_COORDINATOR_INPUT';
  constructor(){super('Media coordinator command input is invalid.');}
}
export class MediaCoordinatorDatabaseError extends Error {
  override readonly name='MediaCoordinatorDatabaseError';readonly code='MEDIA_COORDINATOR_DATABASE_FAILED';
  constructor(readonly commitUncertain:boolean,readonly sqlState?:string){super('Media coordinator database command could not be confirmed.');}
}
export interface MediaCaptureInput {readonly generationId:string;readonly bytes:number;readonly sha256:string}
export interface MediaCaptureReceipt {readonly jobId:string;readonly generationId:string;readonly inputBytes:number;readonly inputSha256:string;readonly capturedAt:string}
export interface MediaProcessingLease {
  readonly jobId:string;readonly claimId:string;readonly attempt:number;readonly leaseNonce:string;readonly leaseExpiresAt:string;
  readonly quarantineId:string;readonly outputId:string;readonly input:MediaCaptureInput;readonly pipeline:'synthetic-codec-v1';
}
export interface MediaSealInput {readonly attempt:number;readonly leaseNonce:string;readonly manifest:SyntheticImageManifest}
export interface MediaVerifiedReceipt {
  readonly jobId:string;readonly attempt:number;readonly leaseNonce:string;readonly outputId:string;readonly manifestSha256:string;
  readonly manifest:SyntheticImageManifest;readonly verifiedAt:string;readonly outcome:'verified';
}
export interface MediaProcessingView {
  readonly jobId:string;readonly state:'registered'|'captured'|'processing'|'verified'|'expired';
  readonly capture:MediaCaptureReceipt|null;readonly lease:MediaProcessingLease|null;readonly verified:MediaVerifiedReceipt|null;
}

const FUNCTIONS=Object.freeze([
  {name:'capture_input',arguments:['uuid','uuid','int8','text']},
  {name:'claim_processing',arguments:['uuid','uuid']},
  {name:'seal_output',arguments:['uuid','int4','uuid','jsonb']},
  {name:'read_processing',arguments:['uuid']},
] as const);
// Catalog lookup avoids resolving app_media through the NOINHERIT login's
// namespace privileges before SET ROLE. Argument types resolve only pg_catalog.
const EXPECTED_OIDS_SQL=`SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app_media' AND (${FUNCTIONS.map(fn=>
  `(p.proname='${fn.name}' AND p.pronargs=${fn.arguments.length} AND ${fn.arguments.map((type,index)=>`p.proargtypes[${index}]='pg_catalog.${type}'::pg_catalog.regtype`).join(' AND ')})`).join(' OR ')})`;
const GUARD_SQL=`SELECT current_user AS "currentUser",session_user AS "sessionUser",
  r.rolcanlogin AS "canLogin",r.rolsuper AS "superuser",r.rolbypassrls AS "bypassRls",r.rolinherit AS "inheritsRoles",
  r.rolcreaterole OR r.rolcreatedb OR r.rolreplication AS "canEscalate",
  pg_catalog.pg_has_role(session_user,'media_coordinator','MEMBER') AS "coordinatorMember",
  pg_catalog.pg_has_role(session_user,'realtor_owner','MEMBER') AS "ownerMember",pg_catalog.pg_has_role(session_user,'api_runtime','MEMBER') AS "apiMember",
  EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members membership JOIN pg_catalog.pg_roles member ON member.oid=membership.member
    WHERE member.rolname=session_user AND membership.admin_option) AS "canDelegateRole",
  EXISTS(SELECT 1 FROM pg_catalog.pg_roles m WHERE m.rolname NOT IN (session_user,'media_coordinator') AND pg_catalog.pg_has_role(session_user,m.oid,'MEMBER')) AS "otherRoleMembership",
  EXISTS(SELECT 1 FROM pg_catalog.pg_roles m WHERE m.rolname<>'media_coordinator' AND pg_catalog.pg_has_role('media_coordinator',m.oid,'MEMBER')) AS "coordinatorOtherMembership",
  NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles m WHERE m.rolname='media_coordinator' AND NOT(m.rolcanlogin OR m.rolsuper OR m.rolbypassrls OR m.rolinherit OR m.rolcreaterole OR m.rolcreatedb OR m.rolreplication)) AS "unsafeCoordinatorRole",
  NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname='app_media' AND pg_catalog.pg_get_userbyid(n.nspowner)='realtor_owner') AS "unsafeSchemaOwner",
  pg_catalog.has_schema_privilege('media_coordinator','app_media','USAGE') AS "coordinatorSchemaUsage",
  EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname IN ('app_private','app_api','app_media') AND
    (pg_catalog.pg_has_role(session_user,n.nspowner,'MEMBER') OR pg_catalog.pg_has_role('media_coordinator',n.nspowner,'MEMBER'))) AS "schemaOwner",
  EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname IN ('app_private','app_api','app_media') AND
    (pg_catalog.has_schema_privilege(session_user,n.oid,'CREATE') OR pg_catalog.has_schema_privilege('media_coordinator',n.oid,'CREATE'))) AS "canCreateInApp",
  EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n,LATERAL pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) acl
    WHERE n.nspname='app_media' AND acl.grantee=0 AND acl.privilege_type IN ('USAGE','CREATE')) AS "publicSchemaPrivilege",
  EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname IN ('app_private','app_api') AND
    (pg_catalog.has_schema_privilege(session_user,n.oid,'USAGE') OR pg_catalog.has_schema_privilege('media_coordinator',n.oid,'USAGE'))) AS "privateSchemaUsage",
  EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('app_private','app_api','app_media') AND
    (pg_catalog.pg_has_role(session_user,c.relowner,'MEMBER') OR pg_catalog.pg_has_role('media_coordinator',c.relowner,'MEMBER'))) AS "tableOwner",
  EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('app_private','app_api','app_media') AND c.relkind IN ('r','p','v','m','f') AND
    (pg_catalog.has_table_privilege(session_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR pg_catalog.has_table_privilege('media_coordinator',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))) AS "tablePrivilege",
  EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('app_private','app_api','app_media') AND c.relkind IN ('r','p','v','m','f') AND
    (pg_catalog.has_any_column_privilege(session_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') OR pg_catalog.has_any_column_privilege('media_coordinator',c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) AS "columnPrivilege",
  EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('app_private','app_api','app_media') AND c.relkind='S' AND
    (pg_catalog.has_sequence_privilege(session_user,c.oid,'USAGE,SELECT,UPDATE') OR pg_catalog.has_sequence_privilege('media_coordinator',c.oid,'USAGE,SELECT,UPDATE'))) AS "sequencePrivilege",
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app_private','app_api') AND
    (pg_catalog.has_function_privilege(session_user,p.oid,'EXECUTE') OR pg_catalog.has_function_privilege('media_coordinator',p.oid,'EXECUTE'))) AS "privateFunctionPrivilege",
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app_media' AND
    (pg_catalog.has_function_privilege(session_user,p.oid,'EXECUTE') OR pg_catalog.has_function_privilege('media_coordinator',p.oid,'EXECUTE')) AND
    p.oid NOT IN (${EXPECTED_OIDS_SQL})) AS "unexpectedFunctionPrivilege",
  ((SELECT pg_catalog.count(*) FROM (${EXPECTED_OIDS_SQL}) expected)<>4 OR EXISTS(SELECT 1 FROM (${EXPECTED_OIDS_SQL}) expected
    WHERE NOT pg_catalog.has_function_privilege('media_coordinator',expected.oid,'EXECUTE'))) AS "missingFunctionPrivilege",
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid IN (${EXPECTED_OIDS_SQL}) AND
    (pg_catalog.pg_get_userbyid(p.proowner)<>'realtor_owner' OR NOT p.prosecdef OR p.prokind<>'f' OR p.prorettype<>'pg_catalog.jsonb'::pg_catalog.regtype OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::pg_catalog.text[])) AS "unsafeFunctionDefinition",
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace,
    LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
    WHERE n.nspname='app_media' AND acl.grantee=0 AND acl.privilege_type='EXECUTE') AS "publicFunctionPrivilege",
  (EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace,
    LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
    JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl.grantee
    WHERE n.nspname='app_media' AND grantee.rolname IN (session_user,'media_coordinator') AND acl.is_grantable)
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n,LATERAL pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) acl
    JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl.grantee
    WHERE n.nspname='app_media' AND grantee.rolname IN (session_user,'media_coordinator') AND acl.is_grantable)) AS "canDelegatePrivilege"
FROM pg_catalog.pg_roles r WHERE r.rolname=session_user`;
const TRUE_FLAGS=['canLogin','coordinatorMember','coordinatorSchemaUsage'] as const;
const FALSE_FLAGS=['superuser','bypassRls','inheritsRoles','canEscalate','ownerMember','apiMember','canDelegateRole','otherRoleMembership','coordinatorOtherMembership','unsafeCoordinatorRole','unsafeSchemaOwner','schemaOwner','canCreateInApp','publicSchemaPrivilege','privateSchemaUsage','tableOwner','tablePrivilege','columnPrivilege','sequencePrivilege','privateFunctionPrivilege','unexpectedFunctionPrivilege','missingFunctionPrivilege','unsafeFunctionDefinition','publicFunctionPrivilege','canDelegatePrivilege'] as const;

/** Rechecked before every short transaction; this does not authenticate a deployment or decoder. */
export async function assertSafeMediaCoordinatorConnection(client:MediaCoordinatorQuery):Promise<void>{
  try{
    const result=await client.query(GUARD_SQL);
    if(!result||!Array.isArray(result.rows)||result.rows.length!==1)throw new MediaCoordinatorSafetyError();
    const row=plain(result.rows[0],['currentUser','sessionUser',...TRUE_FLAGS,...FALSE_FLAGS],()=>{throw new MediaCoordinatorSafetyError();});
    if(typeof row.sessionUser!=='string'||row.sessionUser.length<1||row.sessionUser.length>63||row.currentUser!==row.sessionUser||row.sessionUser==='media_coordinator'||row.sessionUser==='api_runtime'||row.sessionUser==='realtor_owner'||TRUE_FLAGS.some(key=>row[key]!==true)||FALSE_FLAGS.some(key=>row[key]!==false))throw new MediaCoordinatorSafetyError();
  }catch{throw new MediaCoordinatorSafetyError();}
}

type Reject=()=>never;
const badInput:Reject=()=>{throw new MediaCoordinatorInputError();};
const badResponse:Reject=()=>{throw new MediaCoordinatorDatabaseError(false);};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function plain(input:unknown,keys:readonly string[],reject:Reject):Record<string,unknown>{
  if(!input||typeof input!=='object'||(Object.getPrototypeOf(input)!==Object.prototype&&Object.getPrototypeOf(input)!==null))return reject();
  const own=Reflect.ownKeys(input);
  if(own.length!==keys.length||own.some(key=>typeof key!=='string'||!keys.includes(key)||!Object.getOwnPropertyDescriptor(input,key)?.enumerable||!Object.hasOwn(Object.getOwnPropertyDescriptor(input,key)!,'value')))return reject();
  return input as Record<string,unknown>;
}
function uuid(value:unknown,reject:Reject):string{if(typeof value!=='string'||!UUID.test(value))return reject();return value.toLowerCase();}
function hash(value:unknown,reject:Reject):string{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))return reject();return value;}
function bounded(value:unknown,min:number,max:number,reject:Reject):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)return reject();return value;}
function time(value:unknown,reject:Reject):string{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value.slice(0,23)+'Z')return reject();
  return value;
}
function captureInput(value:unknown,reject:Reject):MediaCaptureInput{
  const row=plain(value,['generationId','bytes','sha256'],reject);
  return Object.freeze({generationId:uuid(row.generationId,reject),bytes:bounded(row.bytes,1,10485760,reject),sha256:hash(row.sha256,reject)});
}
function captureReceipt(value:unknown,jobId:string):MediaCaptureReceipt{
  const row=plain(value,['jobId','generationId','inputBytes','inputSha256','capturedAt'],badResponse);
  if(uuid(row.jobId,badResponse)!==jobId)badResponse();
  return Object.freeze({jobId,generationId:uuid(row.generationId,badResponse),inputBytes:bounded(row.inputBytes,1,10485760,badResponse),inputSha256:hash(row.inputSha256,badResponse),capturedAt:time(row.capturedAt,badResponse)});
}
function processingLease(value:unknown,jobId:string):MediaProcessingLease{
  const row=plain(value,['jobId','claimId','attempt','leaseNonce','leaseExpiresAt','quarantineId','outputId','input','pipeline'],badResponse);
  if(uuid(row.jobId,badResponse)!==jobId||row.pipeline!=='synthetic-codec-v1')badResponse();
  const quarantineId=uuid(row.quarantineId,badResponse),outputId=uuid(row.outputId,badResponse);
  if(quarantineId===outputId||quarantineId===jobId||outputId===jobId)badResponse();
  return Object.freeze({jobId,claimId:uuid(row.claimId,badResponse),attempt:bounded(row.attempt,1,3,badResponse),leaseNonce:uuid(row.leaseNonce,badResponse),leaseExpiresAt:time(row.leaseExpiresAt,badResponse),quarantineId,outputId,input:captureInput(row.input,badResponse),pipeline:'synthetic-codec-v1'});
}
const MANIFEST_FIELDS=['pipeline','sourceFormat','inputSha256','inputBytes','format','mimeType','sha256','width','height','bytes','encoder','operations'] as const;
const OPERATIONS=['auto-orient','resize-inside-1920-without-enlargement','strip-metadata','webp-quality-82-effort-4'] as const;
function manifest(value:unknown,reject:Reject):SyntheticImageManifest{
  const row=plain(value,MANIFEST_FIELDS,reject),encoder=plain(row.encoder,['sharp','vips'],reject),operations=row.operations;
  if(row.pipeline!=='synthetic-codec-v1'||typeof row.sourceFormat!=='string'||!['jpeg','png','webp'].includes(row.sourceFormat)||row.format!=='webp'||row.mimeType!=='image/webp'||encoder.sharp!=='0.35.5'||encoder.vips!=='8.18.7'||!Array.isArray(operations)||operations.length!==OPERATIONS.length||Reflect.ownKeys(operations).length!==OPERATIONS.length+1||OPERATIONS.some((value,index)=>{const item=Object.getOwnPropertyDescriptor(operations,String(index));return !item?.enumerable||!Object.hasOwn(item,'value')||item.value!==value;}))return reject();
  return Object.freeze({pipeline:'synthetic-codec-v1',sourceFormat:row.sourceFormat as SyntheticImageManifest['sourceFormat'],inputSha256:hash(row.inputSha256,reject),inputBytes:bounded(row.inputBytes,1,10485760,reject),format:'webp',mimeType:'image/webp',sha256:hash(row.sha256,reject),width:bounded(row.width,1,1920,reject),height:bounded(row.height,1,1920,reject),bytes:bounded(row.bytes,1,10485760,reject),encoder:Object.freeze({sharp:'0.35.5',vips:'8.18.7'}),operations:Object.freeze([...OPERATIONS] as const)});
}
function verifiedReceipt(value:unknown,jobId:string):MediaVerifiedReceipt{
  const row=plain(value,['jobId','attempt','leaseNonce','outputId','manifestSha256','manifest','verifiedAt','outcome'],badResponse);
  if(uuid(row.jobId,badResponse)!==jobId||row.outcome!=='verified')badResponse();
  const outputId=uuid(row.outputId,badResponse);if(outputId===jobId)badResponse();
  return Object.freeze({jobId,attempt:bounded(row.attempt,1,3,badResponse),leaseNonce:uuid(row.leaseNonce,badResponse),outputId,manifestSha256:hash(row.manifestSha256,badResponse),manifest:manifest(row.manifest,badResponse),verifiedAt:time(row.verifiedAt,badResponse),outcome:'verified'});
}
function processingView(value:unknown,jobId:string):MediaProcessingView{
  const row=plain(value,['jobId','state','capture','lease','verified'],badResponse);
  if(uuid(row.jobId,badResponse)!==jobId||typeof row.state!=='string'||!['registered','captured','processing','verified','expired'].includes(row.state))badResponse();
  const capture=row.capture===null?null:captureReceipt(row.capture,jobId),lease=row.lease===null?null:processingLease(row.lease,jobId),verified=row.verified===null?null:verifiedReceipt(row.verified,jobId);
  if((row.state==='registered'&&(capture||lease||verified))||(row.state==='captured'&&(!capture||verified))||(row.state==='processing'&&(!capture||!lease||verified))||(row.state==='verified'&&(!capture||!lease||!verified))||(lease&&!capture)||(verified&&(!capture||!lease))||(row.state!=='verified'&&verified))badResponse();
  if(capture&&lease&&(capture.generationId!==lease.input.generationId||capture.inputBytes!==lease.input.bytes||capture.inputSha256!==lease.input.sha256))badResponse();
  if(verified&&lease&&(verified.attempt!==lease.attempt||verified.leaseNonce!==lease.leaseNonce||verified.outputId!==lease.outputId||verified.manifest.inputBytes!==lease.input.bytes||verified.manifest.inputSha256!==lease.input.sha256))badResponse();
  return Object.freeze({jobId,state:row.state as MediaProcessingView['state'],capture,lease,verified});
}
function sqlState(error:unknown):string|undefined{
  if(error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&/^[0-9A-Z]{5}$/.test(error.code))return error.code;
  return undefined;
}

/** Fixed commands only. No caller-selected SQL, actor context, transaction callback or automatic retry. */
export class MediaCoordinatorDatabase {
  readonly #pool:MediaCoordinatorPool;
  constructor(pool:MediaCoordinatorPool){if(!pool||typeof pool.connect!=='function')throw new MediaCoordinatorInputError();this.#pool=pool;}
  async #checkout():Promise<MediaCoordinatorClient>{try{return await this.#pool.connect();}catch{throw new MediaCoordinatorDatabaseError(false);}}
  async checkConnection():Promise<void>{
    const client=await this.#checkout();let destroy=false;
    try{await assertSafeMediaCoordinatorConnection(client);}catch(error){destroy=true;throw error;}finally{try{client.release(destroy);}catch{throw new MediaCoordinatorDatabaseError(false);}}
  }
  async captureInput(jobId:string,input:MediaCaptureInput):Promise<MediaCaptureReceipt>{
    const job=uuid(jobId,badInput),captured=captureInput(input,badInput);
    return this.#command('SELECT app_media.capture_input($1::uuid,$2::uuid,$3::bigint,$4::text) AS receipt',[job,captured.generationId,captured.bytes,captured.sha256],value=>{
      const result=captureReceipt(value,job);if(result.generationId!==captured.generationId||result.inputBytes!==captured.bytes||result.inputSha256!==captured.sha256)badResponse();return result;
    });
  }
  async claimProcessing(jobId:string,claimId:string):Promise<MediaProcessingLease>{
    const job=uuid(jobId,badInput),claim=uuid(claimId,badInput);
    return this.#command('SELECT app_media.claim_processing($1::uuid,$2::uuid) AS receipt',[job,claim],value=>{const result=processingLease(value,job);if(result.claimId!==claim)badResponse();return result;});
  }
  async sealOutput(jobId:string,input:MediaSealInput):Promise<MediaVerifiedReceipt>{
    const job=uuid(jobId,badInput),row=plain(input,['attempt','leaseNonce','manifest'],badInput),attempt=bounded(row.attempt,1,3,badInput),leaseNonce=uuid(row.leaseNonce,badInput),verifiedManifest=manifest(row.manifest,badInput),encoded=JSON.stringify(verifiedManifest);
    return this.#command('SELECT app_media.seal_output($1::uuid,$2::integer,$3::uuid,$4::jsonb) AS receipt',[job,attempt,leaseNonce,encoded],value=>{
      const result=verifiedReceipt(value,job);if(result.attempt!==attempt||result.leaseNonce!==leaseNonce||JSON.stringify(result.manifest)!==encoded)badResponse();return result;
    });
  }
  async readProcessing(jobId:string):Promise<MediaProcessingView>{
    const job=uuid(jobId,badInput);return this.#command('SELECT app_media.read_processing($1::uuid) AS receipt',[job],value=>processingView(value,job));
  }
  async #command<T>(sql:string,values:readonly unknown[],parse:(value:unknown)=>T):Promise<T>{
    const client=await this.#checkout();let began=false,destroy=false,commitStarted=false;
    try{
      await assertSafeMediaCoordinatorConnection(client);await client.query('BEGIN');began=true;
      await client.query('SET LOCAL ROLE media_coordinator');
      const response=await client.query(sql,values);
      if(!response||!Array.isArray(response.rows)||response.rows.length!==1)badResponse();
      const row=plain(response.rows[0],['receipt'],badResponse),result=parse(row.receipt);
      commitStarted=true;await client.query('COMMIT');began=false;return result;
    }catch(error){
      if(!began||error instanceof MediaCoordinatorSafetyError||commitStarted)destroy=true;
      if(began){try{await client.query('ROLLBACK');}catch{destroy=true;}}
      if(error instanceof MediaCoordinatorSafetyError)throw error;
      throw new MediaCoordinatorDatabaseError(commitStarted,sqlState(error));
    }finally{try{client.release(destroy);}catch{throw new MediaCoordinatorDatabaseError(commitStarted);}}
  }
  async close():Promise<void>{try{await this.#pool.end?.();}catch{throw new MediaCoordinatorDatabaseError(false);}}
}
