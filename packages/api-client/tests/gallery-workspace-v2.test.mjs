import assert from 'node:assert/strict';
import test from 'node:test';
import {ApiClientError,RealtorApiClient,validateStaffDraftContentV2,validateStaffDraftWorkspaceV2,validateMediaOperationReceiptV2} from '../dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const listing=id(100),operation=id(200),options={bearerToken:'synthetic-agent'};
const content=validateStaffDraftContentV2({pricing:{declaration:'not_declared',charges:[]},location:{county:null,town:null,area:null}});
const draft={revision:2,state:'draft',version:'7',content};
const photo=(n,position=n)=>({id:id(300+n),position,altText:`Synthetic photo ${n}`,accepted:true,provenance:'sealed'});
const workspace=(patch={})=>({listingId:listing,draft,photos:[photo(0,0),{...photo(1,3),provenance:'legacy',accepted:false,altText:'  old synthetic label  '},photo(2,11)],...patch});
const json=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json'}});
const client=fetch=>new RealtorApiClient({baseUrl:'https://synthetic.invalid',privacyNoticeVersion:'synthetic-v1',fetch});
const invalid=error=>error instanceof ApiClientError&&error.kind==='INVALID_RESPONSE'&&!error.submissionUncertain;
const validation=error=>error instanceof ApiClientError&&error.kind==='VALIDATION'&&!error.submissionUncertain;

test('workspace SDK reads one exact authorized current snapshot and freezes complete sparse metadata',async()=>{
 let seen;const result=await client(async(url,init)=>{seen={url,init};return json(workspace());}).getStaffDraftWorkspaceV2(listing,2,options);
 assert.deepEqual(result,workspace());for(const value of [result,result.draft,result.draft.content,result.draft.content.pricing,result.photos,...result.photos])assert.ok(Object.isFrozen(value));
 assert.equal(seen.url,`https://synthetic.invalid/v2/staff/listings/${listing}/revisions/2/workspace`);assert.equal(seen.init.method,'GET');assert.equal(seen.init.headers.Authorization,'Bearer synthetic-agent');assert.equal(seen.init.body,undefined);assert.equal(seen.init.cache,'no-store');assert.equal(seen.init.redirect,'error');assert.equal(seen.init.credentials,'omit');
});
test('workspace pure parser preserves bounded legacy text and accepts empty/full galleries without inventing content',()=>{
 for(const photos of [[],Array.from({length:12},(_,n)=>photo(n)),[{...photo(0,11),provenance:'legacy',accepted:false,altText:'  old\tlabel  '}]]){const result=validateStaffDraftWorkspaceV2(workspace({photos,draft:{...draft,version:'9223372036854775807'}}),listing,2);assert.deepEqual(result.photos,photos);assert.equal(result.draft.content.title,null);assert.equal(result.draft.version,'9223372036854775807');}
});
test('workspace exact envelope, content and photo descriptors reject unknown/private fields',()=>{
 const values=[workspace({tenantId:listing}),workspace({listingId:id(101)}),workspace({draft:{...draft,revision:3}}),workspace({draft:{...draft,role:'admin'}}),workspace({draft:{...draft,content:{...content,storageKey:'PRIVATE'}}}),workspace({photos:[{...photo(0),jobId:operation}]})];
 for(const key of ['listingId','draft','photos']){const missing=workspace();delete missing[key];values.push(missing);}
 for(const key of ['id','position','altText','accepted','provenance']){const missing=photo(0);delete missing[key];values.push(workspace({photos:[missing]}));}
 for(const value of values)assert.throws(()=>validateStaffDraftWorkspaceV2(value,listing,2),invalid);
 let touched=false;const getter={...photo(0)};Object.defineProperty(getter,'altText',{enumerable:true,get(){touched=true;return 'PRIVATE';}});assert.throws(()=>validateStaffDraftWorkspaceV2(workspace({photos:[getter]}),listing,2),invalid);assert.equal(touched,false);
 assert.throws(()=>validateStaffDraftWorkspaceV2(Object.assign(Object.create(workspace()),{}),listing,2),invalid);
});
test('workspace metadata refuses duplicate IDs/positions, unknown provenance and impossible sealed rows',()=>{
 for(const photos of [null,{},Array.from({length:13},(_,n)=>photo(n)),[photo(0),photo(0,1)],[photo(0),{...photo(0,1),id:photo(0).id.toUpperCase()}],[photo(0),photo(1,0)],[photo(0,2),photo(1,1)],[photo(0,-1)],[photo(0,12)],[photo(0,0.5)],[{...photo(0),id:'bad'}],[{...photo(0),accepted:'true'}],[{...photo(0),accepted:false}],[{...photo(0),provenance:'unknown'}],[{...photo(0),altText:' untrimmed sealed '}],[{...photo(0),altText:''}],[{...photo(0),provenance:'legacy',altText:' '.repeat(4097)+'X'}]])assert.throws(()=>validateStaffDraftWorkspaceV2(workspace({photos}),listing,2),invalid);
 const sparse=Array(1);assert.throws(()=>validateStaffDraftWorkspaceV2(workspace({photos:sparse}),listing,2),invalid);
 const getter=[photo(0)];let touched=false;Object.defineProperty(getter,0,{enumerable:true,get(){touched=true;return photo(0);}});assert.throws(()=>validateStaffDraftWorkspaceV2(workspace({photos:getter}),listing,2),invalid);assert.equal(touched,false);
 const extra=[photo(0)];extra.hidden='PRIVATE';assert.throws(()=>validateStaffDraftWorkspaceV2(workspace({photos:extra}),listing,2),invalid);
});
test('workspace transport rejects rounded revision/position tokens, duplicate decoded keys and malformed content',async()=>{
 const original=JSON.stringify(workspace());
 for(const raw of [original.replace('"revision":2','"revision":2.00000000000000001'),original.replace('"position":0','"position":0e0'),original.replace('"position":0','"position":0.00000000000000001'),original.replace('"listingId":',`"listingId":"${listing}","list\\u0069ngId":`),original.replace('"accepted":true','"accepted":true,"accepted":false')])await assert.rejects(()=>client(async()=>new Response(raw,{headers:{'Content-Type':'application/json'}})).getStaffDraftWorkspaceV2(listing,2,options),invalid);
 for(const patch of [{version:'07'},{version:7},{state:'published'},{content:{...content,amountMinor:1.5}},{content:{...content,location:{county:null,town:null,area:null,privateAddress:'PRIVATE'}}}])await assert.rejects(()=>client(async()=>json(workspace({draft:{...draft,...patch}}))).getStaffDraftWorkspaceV2(listing,2,options),invalid);
});
test('workspace per-call authentication, path bounds and pure validator argument bounds fail before transport',async()=>{
 let calls=0;const api=client(async()=>{calls++;return json(workspace());});
 for(const opts of [undefined,{}, {bearerToken:''},{bearerToken:'bad\r\nvalue'},{bearerToken:'synthetic',tenantId:listing}])await assert.rejects(()=>api.getStaffDraftWorkspaceV2(listing,2,opts),validation);
 for(const [idValue,revision] of [['bad',2],[listing,0],[listing,1.5],[listing,2147483648]]){await assert.rejects(()=>api.getStaffDraftWorkspaceV2(idValue,revision,options),validation);assert.throws(()=>validateStaffDraftWorkspaceV2(workspace(),idValue,revision),validation);}
 assert.equal(calls,0);const seen=[];const fresh=client(async(url,init)=>{seen.push(init.headers.Authorization);return json(workspace());});await fresh.getStaffDraftWorkspaceV2(listing,2,{bearerToken:'synthetic-one'});await fresh.getStaffDraftWorkspaceV2(listing,2,{bearerToken:'synthetic-two'});assert.deepEqual(seen,['Bearer synthetic-one','Bearer synthetic-two']);
});
test('workspace read network/HTTP failure is definite and never invokes a write or automatic retry',async()=>{
 for(const [transport,kind] of [[async()=>{throw new Error('PRIVATE');},'NETWORK'],[async()=>json({error:{code:'FORBIDDEN',message:'PRIVATE'},requestId:id(500)},403),'HTTP'],[async()=>json(workspace(),201),'INVALID_RESPONSE']]){let calls=0;await assert.rejects(()=>client(async(...args)=>{calls++;return transport(...args);}).getStaffDraftWorkspaceV2(listing,2,options),error=>error.kind===kind&&!error.submissionUncertain&&!error.message.includes('PRIVATE'));assert.equal(calls,1);}
});
test('pure gallery receipt validator enforces exact historical identity and kind without transport state',()=>{
 const receipt={kind:'remove_media',operationId:operation,listingId:listing,revision:2,expectedVersion:'7',version:'8',outcome:'applied',reason:null,mediaId:id(301),orderedIds:[id(302)],completedAt:'2026-10-11T01:02:03.123Z'};
 const result=validateMediaOperationReceiptV2(receipt,listing,2,operation);assert.deepEqual(result,receipt);assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.orderedIds));
 for(const patch of [{operationId:id(201)},{listingId:id(101)},{revision:3},{orderedIds:[id(301)]},{jobId:id(400)}])assert.throws(()=>validateMediaOperationReceiptV2({...receipt,...patch},listing,2,operation),invalid);
 for(const args of [['bad',2,operation],[listing,0,operation],[listing,2,'bad']])assert.throws(()=>validateMediaOperationReceiptV2(receipt,...args),validation);
});
