/**
 * Independently authored local staff fixture, never a provider/login implementation.
 * Ephemeral RS256 keys, loopback JWKS, disposable PGlite and synthetic metadata only.
 * Fabricated sealed SQL provenance is not actual workflow/decoder/native/storage proof.
 * Tokens/private keys are never logged, persisted or returned from an HTTP endpoint.
 */
import {randomUUID} from 'node:crypto';
import {applyTestMigrations} from '../../../database/test-helpers/migrations.mjs';
import {seedSyntheticSealedMedia} from '../../../database/test-helpers/synthetic-sealed-media.mjs';
import {createServer} from 'node:http';
import {exportJWK,generateKeyPair,SignJWT} from 'jose';
import {PGlite} from '@electric-sql/pglite';
import {createIdentityVerifier,parseBearerHeader} from '../dist/auth.js';
import {createApiService} from '../dist/service.js';
import {DatabaseSafetyError,PostgresTransactionDatabase} from '../dist/database.js';
import {createDevelopmentServer} from '../dist/http.js';

const id=number=>`00000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
export const STAFF_PREVIEW_FIXTURES=Object.freeze({
  realtimeListingId:id(400),realtimePeerListingId:id(401),realtimePausedReviewListingId:id(402),sampleListingId:id(500),samplePausedReviewListingId:id(502),revision:1,initialVersion:'2',
});
const COMPANIES=Object.freeze({
  'realtime-estates':Object.freeze({id:id(1),admin:id(10),agent:id(11),peer:id(12),customer:id(13),revoked:id(14),listing:id(400),name:'Synthetic Realtime Staff Preview'}),
  'sample-homes':Object.freeze({id:id(2),admin:id(20),agent:id(21),peer:id(22),customer:id(23),revoked:id(24),listing:id(500),name:'Synthetic Sample Staff Preview'}),
});
const LIFETIME_SECONDS=1800;
const AUDIENCE='synthetic-realtor-staff-preview';
class StaffPreviewConfigurationError extends Error {}
function configuration({tenantSlug='realtime-estates',port=4101,actor='agent',seedAcceptedMedia=true,seedPendingReviews=false}={}){
  if(process.env.NODE_ENV==='production')throw new StaffPreviewConfigurationError('Staff preview refuses NODE_ENV=production.');
  if(typeof tenantSlug!=='string'||!Object.hasOwn(COMPANIES,tenantSlug))throw new StaffPreviewConfigurationError('Choose the configured realtime-estates or sample-homes synthetic company.');
  if(!Number.isSafeInteger(port)||port<0||port>65535)throw new StaffPreviewConfigurationError('Staff preview port must be an integer from 0 through 65535.');
  if(!['agent','admin','customer','revoked-agent','other-company-agent','other-company-admin'].includes(actor))throw new StaffPreviewConfigurationError('Choose an explicitly defined synthetic actor.');
  if(typeof seedAcceptedMedia!=='boolean')throw new StaffPreviewConfigurationError('Synthetic accepted-metadata fixture flag must be boolean.');
  if(typeof seedPendingReviews!=='boolean'||(seedPendingReviews&&!seedAcceptedMedia))throw new StaffPreviewConfigurationError('Pending review fixtures require the explicit accepted-metadata fixture.');
  return {tenantSlug,port,actor,seedAcceptedMedia,seedPendingReviews};
}
function syntheticContent(title='Synthetic staff monthly studio'){
  return {
    title,description:'Synthetic staff editor fixture only. No real property, owner evidence or prospect is represented.',
    purpose:'rent',propertyType:'studio',currency:'KES',amountMinor:2000000,rentPeriod:'month',bedrooms:0,
    privateBathrooms:1,sharedBathrooms:null,country:'KE',locality:'Synthetic Nairobi area',publicPrecision:'area',latitude:null,longitude:null,
    privateAddress:'PRIVATE SYNTHETIC STAFF FIXTURE ADDRESS',
    pricing:{declaration:'complete',charges:[
      {id:'service',name:'Monthly service fee',amountStatus:'known',amountMinor:100000,timing:'per_rental_period',classification:'fee',mandatory:true},
      {id:'deposit',name:'Refundable security deposit',amountStatus:'known',amountMinor:2000000,timing:'one_off',classification:'refundable_deposit',mandatory:true},
      {id:'preparation',name:'One-off preparation fee',amountStatus:'known',amountMinor:50000,timing:'one_off',classification:'fee',mandatory:true},
    ]},
    location:{county:'Nairobi',town:'Synthetic Nairobi town',area:'Synthetic preview area'},
  };
}
async function bootstrapAs(db,company,actor,operation){
  await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');
  try{
    await db.query(`SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),set_config('realtor.correlation_id','synthetic-staff-preview-seed',true)`,[company.id,actor]);
    const result=await operation();await db.exec('COMMIT');return result;
  }catch(error){await db.exec('ROLLBACK');throw error;}
}
async function seed(db,seedAcceptedMedia,seedPendingReviews){
  await applyTestMigrations(db);
  for(const [slug,company] of Object.entries(COMPANIES)){
    await db.query('INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,$2,$3)',[company.id,slug,company.name]);
    for(const [actor,role,active] of [[company.admin,'admin',true],[company.agent,'agent',true],[company.peer,'agent',true],[company.customer,'customer',true],[company.revoked,'agent',false]])await db.query(`INSERT INTO app_private.memberships(tenant_id,user_id,role,active,revoked_at) VALUES($1,$2,$3,$4,CASE WHEN $4 THEN NULL ELSE now() END)`,[company.id,actor,role,active]);
  }
  const fixtures=[
    {company:COMPANIES['realtime-estates'],listing:STAFF_PREVIEW_FIXTURES.realtimeListingId,assigned:COMPANIES['realtime-estates'].agent,title:'Synthetic staff monthly studio'},
    {company:COMPANIES['realtime-estates'],listing:STAFF_PREVIEW_FIXTURES.realtimePeerListingId,assigned:COMPANIES['realtime-estates'].peer,title:'Synthetic peer-assigned studio'},
    {company:COMPANIES['sample-homes'],listing:STAFF_PREVIEW_FIXTURES.sampleListingId,assigned:COMPANIES['sample-homes'].agent,title:'Synthetic other-company draft'},
  ];
  if(seedPendingReviews)fixtures.push(
    {company:COMPANIES['realtime-estates'],listing:STAFF_PREVIEW_FIXTURES.realtimePausedReviewListingId,assigned:COMPANIES['realtime-estates'].agent,title:'Synthetic paused review studio',paused:true},
    {company:COMPANIES['sample-homes'],listing:STAFF_PREVIEW_FIXTURES.samplePausedReviewListingId,assigned:COMPANIES['sample-homes'].agent,title:'Synthetic other-company paused review',paused:true},
  );
  for(const fixture of fixtures){
    const {company,listing,assigned,title}=fixture;
    await bootstrapAs(db,company,company.admin,()=>db.query('SELECT app_api.create_listing($1,$2,$3)',[listing,`synthetic-staff-${listing.slice(-3)}`,assigned]));
    await bootstrapAs(db,company,assigned,()=>db.query('SELECT app_api.save_draft_v2($1,1,0,$2::jsonb)',[listing,JSON.stringify(syntheticContent(title))]));
    if(seedAcceptedMedia)for(let position=0;position<4;position++)await seedSyntheticSealedMedia(db,{tenantId:company.id,listingId:listing,
      mediaId:id(Number(listing.slice(-3))*10+position),position,altText:`Synthetic photo ${position+1} — SQL-only accepted metadata; image bytes unavailable`});
    if(seedPendingReviews&&listing!==STAFF_PREVIEW_FIXTURES.realtimePeerListingId){
      await bootstrapAs(db,company,assigned,()=>db.query("SELECT app_api.confirm_availability($1,1,'available')",[listing]));
      await bootstrapAs(db,company,assigned,()=>db.query('SELECT app_api.submit_revision($1,1,2)',[listing]));
      if(fixture.paused)await bootstrapAs(db,company,company.admin,()=>db.query("SELECT app_api.set_publication($1,2,'paused')",[listing]));
    }
  }
}
function runtimePool(db){
  let tail=Promise.resolve();let closed=false;
  return {
    async connect(){
      if(closed)throw new DatabaseSafetyError();
      let unlock;const next=new Promise(resolve=>{unlock=resolve;});const previous=tail;tail=next;await previous;
      if(closed){unlock();throw new DatabaseSafetyError();}
      let released=false;
      return {query:(sql,args)=>db.query(sql,args?[...args]:[]),release(){if(!released){released=true;unlock();}}};
    },
    async end(){closed=true;await tail;await db.close();},
  };
}
function json(status,payload,extra={}){
  return new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Synthetic-Staff-Preview':'true',...extra}});
}
function failure(status,code,message,extra={}){
  const requestId=randomUUID();return json(status,{error:{code,message},requestId},{'X-Request-Id':requestId,...extra});
}
async function listen(server,port){
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const address=server.address();if(!address||typeof address==='string')throw new StaffPreviewConfigurationError('Expected a loopback TCP listener.');
  return `http://127.0.0.1:${address.port}`;
}
async function closeServer(server){
  if(!server?.listening)return;
  await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeIdleConnections();});
}

/** Token is handed only to the calling development launcher, never an HTTP login route. */
export async function startStaffPreview(options={}){
  const {tenantSlug,port,actor,seedAcceptedMedia,seedPendingReviews}=configuration(options);
  const company=COMPANIES[tenantSlug],other=COMPANIES[tenantSlug==='realtime-estates'?'sample-homes':'realtime-estates'];
  const actorId=actor==='agent'?company.agent:actor==='admin'?company.admin:actor==='customer'?company.customer:actor==='revoked-agent'?company.revoked:actor==='other-company-admin'?other.admin:other.agent;
  const db=new PGlite();let database;let apiServer;let jwksServer;
  try{
    await seed(db,seedAcceptedMedia,seedPendingReviews);
    await db.exec('CREATE ROLE synthetic_staff_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT api_runtime TO synthetic_staff_login; SET SESSION AUTHORIZATION synthetic_staff_login;');
    database=new PostgresTransactionDatabase(runtimePool(db));await database.checkConnection();
    const {publicKey,privateKey}=await generateKeyPair('RS256');
    const kid=randomUUID(),keys={keys:[{...await exportJWK(publicKey),kid,alg:'RS256',use:'sig'}]};
    let issuer;
    jwksServer=createServer({maxHeaderSize:8192},(incoming,outgoing)=>{
      const allowed=issuer&&incoming.headers.host===new URL(issuer).host;
      const acceptableOrigin=incoming.headers.origin===undefined||incoming.headers.origin===issuer;
      if(!allowed||!acceptableOrigin||incoming.method!=='GET'||incoming.url!=='/.well-known/jwks.json'||(incoming.headers['content-length']!==undefined&&incoming.headers['content-length']!=='0')||incoming.headers['transfer-encoding']){
        outgoing.writeHead(404,{'Cache-Control':'no-store',Connection:'close'});outgoing.end();incoming.resume();return;
      }
      outgoing.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});outgoing.end(JSON.stringify(keys));
    });
    jwksServer.requestTimeout=5000;jwksServer.headersTimeout=5000;jwksServer.keepAliveTimeout=1000;jwksServer.maxHeadersCount=20;
    issuer=await listen(jwksServer,0);
    const verify=createIdentityVerifier({issuer,audience:AUDIENCE,jwksUrl:issuer+'/.well-known/jwks.json',allowLoopbackHttpForTests:true});
    const now=Math.floor(Date.now()/1000),expiresAt=new Date((now+LIFETIME_SECONDS)*1000).toISOString();
    const bearerToken=await new SignJWT({synthetic:true}).setProtectedHeader({alg:'RS256',kid,typ:'JWT'}).setIssuer(issuer).setAudience(AUDIENCE).setSubject(actorId).setIssuedAt(now).setExpirationTime(now+LIFETIME_SECONDS).sign(privateKey);
    await verify(bearerToken); // Exercise the real loopback JWKS resolver before handing off.
    const service=createApiService({database,tenantId:company.id,privacyNoticeVersion:'synthetic-staff-notice-v1',verifyAuthorization:request=>verify(parseBearerHeader(request.headers.get('authorization')??undefined))});
    let origin;let allowedHosts=new Set();
    apiServer=createDevelopmentServer(async request=>{
      const url=new URL(request.url),requestOrigin=request.headers.get('origin');
      if(!allowedHosts.has(url.host)||!allowedHosts.has(request.headers.get('host')??''))return failure(404,'NOT_FOUND','Staff preview host is unavailable.');
      if(requestOrigin!==null&&requestOrigin!==origin)return failure(403,'FORBIDDEN','Staff preview origin is unavailable.');
      if(request.headers.has('cookie'))return failure(400,'INVALID_INPUT','Staff preview does not accept cookie credentials.');
      const reviewQueue=url.pathname==='/v2/staff/reviews';
      if(url.search&&(!reviewQueue||[...url.searchParams.keys()].some(key=>key!=='limit')||url.searchParams.getAll('limit').length>1))return failure(400,'INVALID_INPUT','Staff preview does not accept query-selected context.');
      if(url.pathname==='/health'&&request.method==='GET')return json(200,{status:'synthetic-staff-preview',synthetic:true,persistentStorage:false,authentication:'ephemeral-local-RS256',productionReady:false,tenantSlug,acceptedMediaMetadataOnly:seedAcceptedMedia,tokenExpiresAt:expiresAt});
      const route=/^\/v2\/staff\/listings\/[0-9a-f-]{36}\/drafts\/1(\/submit)?$/i.exec(url.pathname);
      const reviewRoute=/^\/v2\/staff\/reviews\/[0-9a-f-]{36}\/revisions\/1(\/decision)?$/i.exec(url.pathname);
      const mediaRoute=/^\/v2\/staff\/listings\/[0-9a-f-]{36}\/revisions\/1\/(media-registrations|media-jobs)(?:\/([0-9a-f-]{36}))?$/i.exec(url.pathname);
      const galleryRoute=/^\/v2\/staff\/listings\/[0-9a-f-]{36}\/revisions\/1\/(workspace|media-removals|media-reorders|media-operations)(?:\/([0-9a-f-]{36}))?$/i.exec(url.pathname);
      if(!route&&!reviewRoute&&!reviewQueue&&!mediaRoute&&!galleryRoute)return failure(404,'NOT_FOUND','Staff preview route is unavailable.');
      if(mediaRoute&&mediaRoute[1]==='media-jobs'&&!mediaRoute[2])return failure(404,'NOT_FOUND','Staff preview route is unavailable.');
      if(galleryRoute&&((galleryRoute[1]==='media-operations')!==!!galleryRoute[2]))return failure(404,'NOT_FOUND','Staff preview route is unavailable.');
      const allowedMethods=galleryRoute?(['workspace','media-operations'].includes(galleryRoute[1])?['GET']:['POST']):mediaRoute?(mediaRoute[2]?['GET']:['POST']):reviewQueue?['GET']:reviewRoute?(reviewRoute[1]?['POST']:['GET']):route[1]?['POST']:['GET','PUT'];
      if(!allowedMethods.includes(request.method))return failure(405,'METHOD_NOT_ALLOWED','Method is unavailable for the staff fixture.',{Allow:allowedMethods.join(', ')});
      if(request.method!=='GET'&&!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??''))return failure(415,'JSON_REQUIRED','Use application/json.');
      const response=await service(request);response.headers.set('X-Synthetic-Staff-Preview','true');return response;
    });
    origin=await listen(apiServer,port);allowedHosts=new Set([new URL(origin).host,`localhost:${new URL(origin).port}`]);
    let closing;
    const close=()=>closing??=(async()=>{
      try{await Promise.all([closeServer(apiServer),closeServer(jwksServer)]);}finally{await database.close();}
    })();
    const preview={origin,listingId:company.listing,revision:1,tenantSlug,expiresAt,acceptedMediaMetadataOnly:seedAcceptedMedia,pendingReviewFixtures:seedPendingReviews,close};
    // Avoid incidental console/JSON dumps of a whole return object exposing its token.
    Object.defineProperty(preview,'bearerToken',{value:bearerToken,enumerable:false,writable:false,configurable:false});
    return Object.freeze(preview);
  }catch(error){
    try{await Promise.all([closeServer(apiServer),closeServer(jwksServer)]);}finally{if(database)await database.close();else await db.close();}
    throw error;
  }
}
