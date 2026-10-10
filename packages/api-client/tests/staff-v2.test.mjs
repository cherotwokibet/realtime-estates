import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiClientError,RealtorApiClient,validateStaffDraftContentV2} from '../dist/index.js';

const ID='00000000-0000-4000-8000-000000000100';
const REFERENCE='00000000-0000-4000-8000-000000000500';
const pricing={declaration:'incomplete',charges:[{id:'service',name:'Service quote',amountStatus:'quote_required',amountMinor:null,timing:'per_rental_period',classification:'fee',mandatory:true}]};
const location={county:'Synthetic County',town:null,area:'Synthetic Area'};
const content={title:'Synthetic staff draft',description:'Synthetic client draft test, never real inventory.',purpose:'rent',propertyType:'studio',currency:'KES',amountMinor:2000001,rentPeriod:'month',bedrooms:0,privateBathrooms:1,sharedBathrooms:null,country:'KE',locality:'Synthetic locality',publicPrecision:'area',latitude:-1.3,longitude:36.7,privateAddress:'PRIVATE SYNTHETIC ADDRESS',pricing,location};
const draft=(patch={})=>({revision:2,state:'draft',version:'2',content,...patch});
const json=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json'}});
const client=fetch=>new RealtorApiClient({baseUrl:'https://staff.example.invalid',privacyNoticeVersion:'synthetic-v1',fetch});
const options={bearerToken:'synthetic-staff'};
const reject=(operation,kind,uncertain)=>assert.rejects(operation,error=>error instanceof ApiClientError&&error.kind===kind&&(uncertain===undefined||error.submissionUncertain===uncertain));
const writes=[
  {method:'PUT',call:(api,opts=options)=>api.saveStaffDraftV2(ID,2,{expectedVersion:'2',content},opts)},
  {method:'POST',call:(api,opts=options)=>api.submitStaffDraftV2(ID,2,{expectedVersion:'2'},opts)},
];

test('staff canonical content supports incomplete full replacements and preserves private/coarse coordinates without invented values',()=>{
  const partial=validateStaffDraftContentV2({title:' ',pricing:{declaration:'not_declared',charges:[]},location:{county:null,town:null,area:null}});
  for(const field of ['title','description','purpose','propertyType','amountMinor','rentPeriod','bedrooms','privateBathrooms','sharedBathrooms','locality','latitude','longitude','privateAddress'])assert.equal(partial[field],null,field);
  assert.equal(partial.currency,'KES');assert.equal(partial.country,'KE');assert.equal(partial.publicPrecision,'area');
  const complete=validateStaffDraftContentV2(content);
  assert.deepEqual(complete,content);assert.equal(complete.latitude,-1.3);assert.equal(complete.privateAddress,content.privateAddress);
  for(const value of [partial,partial.pricing,partial.location,complete,complete.pricing.charges[0]])assert.ok(Object.isFrozen(value));
  const legacyIncomplete=validateStaffDraftContentV2({...content,rentPeriod:null});assert.equal(legacyIncomplete.rentPeriod,null);
});

test('every staff call requires its own bearer and never retains it for public or later requests',async()=>{
  const calls=[];const api=client(async(url,init)=>{calls.push({url,init});return url.includes('/v1/properties')?json({items:[],limit:50}):json(draft());});
  for(const opts of [{},{bearerToken:''},{bearerToken:'bad\r\nvalue'},undefined])await reject(()=>api.getStaffDraftV2(ID,2,opts),'VALIDATION');
  for(const operation of writes)await reject(()=>operation.call(api,{}),'VALIDATION');
  assert.equal(calls.length,0);
  await api.getStaffDraftV2(ID,2,{bearerToken:'synthetic-one'});await api.getStaffDraftV2(ID,2,{bearerToken:'synthetic-two'});await api.listProperties();
  assert.equal(calls[0].init.headers.Authorization,'Bearer synthetic-one');assert.equal(calls[1].init.headers.Authorization,'Bearer synthetic-two');assert.equal(calls[2].init.headers.Authorization,undefined);
  assert.equal(calls[0].url,`https://staff.example.invalid/v2/staff/listings/${ID}/drafts/2`);
});

test('staff GET requires an exact immutable envelope and complete canonical fields while allowing unfinished drafts',async()=>{
  const empty=validateStaffDraftContentV2({pricing:{declaration:'not_declared',charges:[]},location:{county:null,town:null,area:null}});
  const result=await client(async()=>json(draft({content:empty}))).getStaffDraftV2(ID,2,options);
  assert.equal(result.content.amountMinor,null);assert.equal(result.version,'2');assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.content));
  for(const patch of [{revision:3},{state:'published'},{state:{}},{version:2},{version:'02'},{version:'2e0'},{version:'0'},{tenantId:ID},{content:{...content,role:'admin'}},{content:{...content,currency:null}},{content:{...content,location:{...location,privateAddress:'PRIVATE'}}},{state:'pending',content:empty}]){
    await reject(()=>client(async()=>json(draft(patch))).getStaffDraftV2(ID,2,options),'INVALID_RESPONSE',false);
  }
  const missing={...content};delete missing.privateAddress;
  await reject(()=>client(async()=>json(draft({content:missing}))).getStaffDraftV2(ID,2,options),'INVALID_RESPONSE');
});

test('staff PUT and submit POST send exact version numbers, no idempotency header, and expect HTTP 200 receipts',async()=>{
  for(const operation of writes){
    let seen;const receipt=await operation.call(client(async(url,init)=>{seen={url,init};return json({version:'3'});}));
    assert.deepEqual(receipt,{version:'3'});assert.ok(Object.isFrozen(receipt));assert.equal(seen.init.method,operation.method);
    assert.equal(seen.init.credentials,'omit');assert.equal(seen.init.cache,'no-store');assert.equal(seen.init.redirect,'error');
    assert.equal(seen.init.headers.Authorization,'Bearer synthetic-staff');assert.equal(seen.init.headers['Idempotency-Key'],undefined);
    assert.equal(seen.init.headers['Content-Type'],'application/json');
    const body=JSON.parse(seen.init.body);assert.equal(body.expectedVersion,2);
    if(operation.method==='PUT'){assert.deepEqual(body.content,content);assert.equal(seen.url.endsWith('/drafts/2'),true);}
    else {assert.deepEqual(body,{expectedVersion:2});assert.equal(seen.url.endsWith('/drafts/2/submit'),true);}
    await reject(()=>operation.call(client(async()=>json({version:'3'},201))),'INVALID_RESPONSE',true);
  }
});

test('staff validation rejects unknown grants, invalid cents/charges and contradictory fields before transport',async()=>{
  let calls=0;const api=client(async()=>{calls++;return json({version:'3'});});
  for(const patch of [{tenantId:ID},{role:'admin'},{amountMinor:1.5},{amountMinor:0},{amountMinor:100000000000001},{propertyType:'land',bedrooms:0},{purpose:'sale',rentPeriod:'month'},{latitude:null,longitude:36.7},{pricing:{declaration:'complete',charges:[{...pricing.charges[0],amountStatus:'known',amountMinor:0}]}},{location:{...location,county:' '}}]){
    await reject(()=>api.saveStaffDraftV2(ID,2,{expectedVersion:'2',content:{...content,...patch}},options),'VALIDATION',false);
  }
  await reject(()=>api.saveStaffDraftV2(ID,2,{expectedVersion:'2',content,actorId:ID},options),'VALIDATION');
  await reject(()=>api.submitStaffDraftV2(ID,2,{expectedVersion:'2',role:'admin'},options),'VALIDATION');
  assert.equal(calls,0);
});

test('staff version strings retain PostgreSQL bigint precision but reject unsafe write conversion and malformed paths',async()=>{
  const huge='9223372036854775807';
  assert.equal((await client(async()=>json(draft({version:huge}))).getStaffDraftV2(ID,2,options)).version,huge);
  let calls=0;const api=client(async()=>{calls++;return json({version:'3'});});
  for(const expectedVersion of ['02','2.0','2e0',' 2','-1','9007199254740992',huge,'9223372036854775808',2])await reject(()=>api.saveStaffDraftV2(ID,2,{expectedVersion,content},options),'VALIDATION');
  await reject(()=>api.submitStaffDraftV2(ID,2,{expectedVersion:'0'},options),'VALIDATION');
  for(const [listingId,revision] of [['not-a-uuid',2],[ID,0],[ID,1.5],[ID,2147483648]])await reject(()=>api.getStaffDraftV2(listingId,revision,options),'VALIDATION');
  assert.equal(calls,0);
  let body;await client(async(_,init)=>{body=JSON.parse(init.body);return json({version:'2'});}).saveStaffDraftV2(ID,1,{expectedVersion:'0',content},options);
  assert.equal(body.expectedVersion,0);
});

test('staff authorization and stale-version HTTP failures remain distinct, safe and definite without retries',async()=>{
  for(const [status,code] of [[401,'UNAUTHENTICATED'],[403,'FORBIDDEN'],[409,'CONFLICT']]){
    for(const operation of writes){let calls=0;const api=client(async()=>{calls++;return json({error:{code,message:'PRIVATE synthetic bearer/contact/server detail'},requestId:REFERENCE},status);});
      await assert.rejects(()=>operation.call(api),error=>{assert.equal(error.kind,'HTTP');assert.equal(error.status,status);assert.equal(error.serverCode,code);assert.equal(error.submissionUncertain,false);assert.equal(error.message.includes('PRIVATE'),false);return true;});
      assert.equal(calls,1);
    }
  }
});

test('staff write transport failures, invalid receipts and server failures are uncertain and never auto-retried',async()=>{
  for(const operation of writes){
    for(const [transport,kind] of [[async()=>{throw new Error('PRIVATE transport detail');},'NETWORK'],[async()=>json({version:3}),'INVALID_RESPONSE'],[async()=>json({version:'3',tenantId:ID}),'INVALID_RESPONSE'],[async()=>new Response(null,{status:302}),'REDIRECT'],[async()=>json({error:{code:'SERVICE_UNAVAILABLE',message:'PRIVATE'},requestId:REFERENCE},503),'HTTP']]){
      let calls=0;await reject(()=>operation.call(client(async(...args)=>{calls++;return transport(...args);})),kind,true);assert.equal(calls,1);
    }
  }
});

test('staff pre-cancellation sends nothing while a started save/submit timeout remains uncertain',async()=>{
  for(const operation of writes){
    const controller=new AbortController();controller.abort();let calls=0;
    await reject(()=>operation.call(client(async()=>{calls++;return json({version:'3'});}),{...options,signal:controller.signal}),'CANCELLED',false);assert.equal(calls,0);
    await reject(()=>operation.call(client(async()=>new Promise(()=>{})),{...options,timeoutMs:5}),'TIMEOUT',true);
  }
});

test('staff GET uses exact v2 JSON money parsing and preserves quote-required null amounts and null locations',async()=>{
  const result=await client(async()=>json(draft({content:{...content,location:{county:null,town:null,area:null}}}))).getStaffDraftV2(ID,2,options);
  assert.equal(result.content.pricing.charges[0].amountMinor,null);assert.deepEqual(result.content.location,{county:null,town:null,area:null});
  const raw=JSON.stringify(draft()).replace('"amountMinor":2000001','"amountMinor":2000001.00000000001');
  await reject(()=>client(async()=>new Response(raw,{headers:{'Content-Type':'application/json'}})).getStaffDraftV2(ID,2,options),'INVALID_RESPONSE',false);
});
