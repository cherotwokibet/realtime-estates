import assert from 'node:assert/strict';
import {request} from 'node:http';
import test from 'node:test';
import {STAFF_PREVIEW_FIXTURES,startStaffPreview} from './staff-preview.mjs';

const draftPath=(preview,listingId=preview.listingId)=>`/v2/staff/listings/${listingId}/drafts/${preview.revision}`;
const reviewPath=(preview,listingId=preview.listingId)=>`/v2/staff/reviews/${listingId}/revisions/${preview.revision}`;
const call=(preview,path=draftPath(preview),{method='GET',body,token=preview.bearerToken,headers={}}={})=>fetch(preview.origin+path,{
  method,headers:{...(token?{Authorization:`Bearer ${token}`}:{}) ,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},
  ...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)}),
});
async function read(preview){const response=await call(preview);assert.equal(response.status,200);return response.json();}
const hostProbe=(preview,absolute=false)=>new Promise((resolve,reject)=>{
  const path=draftPath(preview),outgoing=request(preview.origin+path,{...(absolute?{path:preview.origin+path}:{}),headers:{Host:'untrusted.example.invalid'}},incoming=>{incoming.resume();incoming.once('end',()=>resolve(incoming.statusCode));});
  outgoing.once('error',reject);outgoing.end();
});

test('staff preview refuses production and unsafe/undefined synthetic configuration before opening listeners',async()=>{
  for(const options of [{tenantSlug:'constructor'},{tenantSlug:'unconfigured'},{port:-1},{port:65536},{port:1.5},{actor:'admin-by-request'},{seedAcceptedMedia:'true'},{seedPendingReviews:'true'},{seedPendingReviews:true,seedAcceptedMedia:false}])await assert.rejects(()=>startStaffPreview(options));
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
  try{await assert.rejects(()=>startStaffPreview({port:0}),/refuses NODE_ENV=production/);}
  finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});

test('signed staff listing queue remains read-only,company scoped and assignment scoped with strict bounded projection',async()=>{
 for(const actor of ['agent','admin','customer','revoked-agent','other-company-admin']){
  const preview=await startStaffPreview({port:0,actor});try{
   const path='/v2/staff/listings?limit=25',response=await call(preview,path);
   if(['customer','revoked-agent','other-company-admin'].includes(actor)){assert.equal(response.status,403);continue;}
   assert.equal(response.status,200);const page=await response.json();assert.equal(page.limit,25);assert.equal(page.items.length,actor==='agent'?1:2);assert.equal(page.items.some(x=>x.listingId===STAFF_PREVIEW_FIXTURES.sampleListingId),false);assert.equal(JSON.stringify(page).includes('privateAddress'),false);assert.equal(JSON.stringify(page).includes(preview.bearerToken),false);
   assert.equal((await call(preview,path,{token:null})).status,401);assert.equal((await call(preview,'/v2/staff/listings',{method:'POST',body:{}})).status,405);assert.equal((await call(preview,'/v2/staff/listings?limit=51')).status,400);assert.equal((await call(preview,'/v2/staff/listings?tenantId=other')).status,400);
  }finally{await preview.close();}
 }
});

test('actual RS256/JWKS staff HTTP journey verifies identity, saves/reloads, conflicts safely and submits only to pending review',async()=>{
  const preview=await startStaffPreview({port:0});
  try{
    assert.match(preview.origin,/^http:\/\/127\.0\.0\.1:\d+$/);assert.equal(preview.listingId,STAFF_PREVIEW_FIXTURES.realtimeListingId);
    assert.equal(Object.isFrozen(preview),true);assert.equal(Object.getOwnPropertyDescriptor(preview,'bearerToken').enumerable,false);assert.equal(JSON.stringify(preview).includes(preview.bearerToken),false);
    const claims=JSON.parse(Buffer.from(preview.bearerToken.split('.')[1],'base64url').toString('utf8'));assert.equal(claims.exp-claims.iat,1800);assert.equal(claims.synthetic,true);assert.equal('role' in claims,false);assert.equal('tenantId' in claims,false);
    assert.equal((await call(preview,undefined,{token:null})).status,401);
    const parts=preview.bearerToken.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
    const counterfeit=await call(preview,undefined,{token:parts.join('.')});assert.equal(counterfeit.status,401);assert.equal((await counterfeit.json()).error.code,'UNAUTHENTICATED');
    const healthResponse=await fetch(preview.origin+'/health'),healthText=await healthResponse.text();assert.equal(healthText.includes(preview.bearerToken),false);
    const health=JSON.parse(healthText);assert.equal(health.authentication,'ephemeral-local-RS256');assert.equal(health.productionReady,false);assert.equal(health.acceptedMediaMetadataOnly,true);
    const [first,second]=await Promise.all([read(preview),read(preview)]);
    assert.equal(first.version,'2');assert.equal(first.state,'draft');assert.deepEqual(second,first);
    assert.equal(first.content.amountMinor,2000000);assert.equal(first.content.pricing.charges.length,3);assert.equal(first.content.location.county,'Nairobi');
    const updated=structuredClone(first.content);updated.title='Synthetic saved staff studio';updated.amountMinor=2000001;updated.location.area='Synthetic changed area';
    updated.pricing.charges.push({id:'optional-quote',name:'Optional amount to confirm',amountStatus:'quote_required',amountMinor:null,timing:'one_off',classification:'fee',mandatory:false});
    const saved=await call(preview,undefined,{method:'PUT',body:{expectedVersion:Number(first.version),content:updated}});assert.equal(saved.status,200);assert.deepEqual(await saved.json(),{version:'3'});
    const reloaded=await read(preview);assert.equal(reloaded.version,'3');assert.deepEqual(reloaded.content,updated);
    const stale=await call(preview,undefined,{method:'PUT',body:{expectedVersion:Number(second.version),content:{...updated,title:'Stale overwrite must fail'}}});assert.equal(stale.status,409);assert.equal((await stale.json()).error.code,'CONFLICT');assert.deepEqual(await read(preview),reloaded);
    for(const foreignId of [STAFF_PREVIEW_FIXTURES.realtimePeerListingId,STAFF_PREVIEW_FIXTURES.sampleListingId]){
      assert.equal((await call(preview,draftPath(preview,foreignId))).status,404);
      assert.equal((await call(preview,draftPath(preview,foreignId),{method:'PUT',body:{expectedVersion:2,content:updated}})).status,404);
    }
    const invalid=await call(preview,undefined,{method:'PUT',body:{expectedVersion:3,content:{...updated,pricing:{...updated.pricing,privateNote:'forged'}}}});assert.equal(invalid.status,400);assert.deepEqual(await read(preview),reloaded);
    assert.equal(await hostProbe(preview),404);assert.equal(await hostProbe(preview,true),404);
    assert.equal((await call(preview,undefined,{headers:{Origin:'https://untrusted.example.invalid'}})).status,403);
    assert.equal((await call(preview,undefined,{headers:{Cookie:'synthetic=guard'}})).status,400);
    assert.equal((await call(preview,draftPath(preview)+'?tenantId=other')).status,400);
    assert.equal((await call(preview,'/v2/properties')).status,404);
    assert.equal((await call(preview,'/v2/staff/reviews')).status,403);
    assert.equal((await call(preview,reviewPath(preview))).status,403);
    assert.equal((await call(preview,'/v1/enquiries',{method:'POST',body:{}})).status,404);
    assert.equal((await call(preview,undefined,{method:'DELETE'})).status,405);
    assert.equal((await call(preview,undefined,{method:'PUT',body:'{}',headers:{'Content-Type':'text/plain'}})).status,415);
    assert.equal((await call(preview,undefined,{method:'PUT',body:' '.repeat(128*1024+1)})).status,413);
    assert.deepEqual(await read(preview),reloaded,'Guard failures cannot change the draft.');
    const submitted=await call(preview,draftPath(preview)+'/submit',{method:'POST',body:{expectedVersion:3}});assert.equal(submitted.status,200);assert.deepEqual(await submitted.json(),{version:'4'});
    const pending=await read(preview);assert.equal(pending.state,'pending');assert.equal(pending.version,'4');assert.deepEqual(pending.content,updated);
    assert.equal((await call(preview,draftPath(preview)+'/submit',{method:'POST',body:{expectedVersion:3}})).status,409);
    const pendingEdit=await call(preview,undefined,{method:'PUT',body:{expectedVersion:4,content:{...updated,title:'Pending overwrite must fail'}}});assert.equal(pendingEdit.status,422);assert.equal((await pendingEdit.json()).error.code,'INVALID_STATE');assert.deepEqual(await read(preview),pending);
    const finalHealth=await (await fetch(preview.origin+'/health')).json();assert.equal(finalHealth.productionReady,false);assert.equal(finalHealth.persistentStorage,false);
  }finally{await preview.close();}
});

test('actual authenticated HTTP v2 draft saves and reloads valid Unicode above 64 KiB, rejecting more than 128 KiB without mutation',async()=>{
  const preview=await startStaffPreview({port:0});
  try{
    const initial=await read(preview),content=structuredClone(initial.content);
    content.description='😀'.repeat(10000);
    content.pricing={declaration:'complete',charges:Array.from({length:32},(_,index)=>({
      id:`${index}-`+'😀'.repeat(60),name:'😀'.repeat(160),amountStatus:'known',amountMinor:1,
      timing:'one_off',classification:'fee',mandatory:false,
    }))};
    const body=JSON.stringify({expectedVersion:Number(initial.version),content}),size=Buffer.byteLength(body);
    assert.ok(size>64*1024 && size<=128*1024,`Expected a valid v2 body between 64 and 128 KiB, got ${size} UTF-8 bytes.`);
    const saved=await call(preview,undefined,{method:'PUT',body});
    assert.equal(saved.status,200);assert.deepEqual(await saved.json(),{version:'3'});
    const reloaded=await read(preview);assert.equal(reloaded.version,'3');assert.deepEqual(reloaded.content,content);
    // Trailing JSON whitespace keeps the content valid; only the transport byte cap rejects it.
    const oversized=JSON.stringify({expectedVersion:3,content});
    const rejected=await call(preview,undefined,{method:'PUT',body:oversized+' '.repeat(128*1024+1-Buffer.byteLength(oversized))});
    assert.equal(rejected.status,413);assert.deepEqual(await read(preview),reloaded);
    const submitBody=JSON.stringify({expectedVersion:3})+' '.repeat(4097-JSON.stringify({expectedVersion:3}).length);
    const submitRejected=await call(preview,draftPath(preview)+'/submit',{method:'POST',body:submitBody});
    assert.equal(submitRejected.status,413);assert.equal((await submitRejected.json()).error.code,'BODY_TOO_LARGE');
    assert.deepEqual(await read(preview),reloaded,'The service keeps the existing 4 KiB submit limit.');
  }finally{await preview.close();}
});

test('genuinely signed synthetic customer, revoked and other-company actors fail current database membership authorization',async()=>{
  for(const actor of ['customer','revoked-agent','other-company-agent','other-company-admin']){
    const preview=await startStaffPreview({port:0,actor});
    try{
      const response=await call(preview);assert.equal(response.status,403,actor);assert.equal((await response.json()).error.code,'FORBIDDEN');
      const save=await call(preview,undefined,{method:'PUT',body:{expectedVersion:2,content:{pricing:{declaration:'not_declared',charges:[]},location:{county:null,town:null,area:null}}}});assert.equal(save.status,403,actor);
      assert.equal((await call(preview,draftPath(preview)+'/submit',{method:'POST',body:{expectedVersion:2}})).status,403,actor);
      assert.equal((await call(preview,'/v2/staff/reviews')).status,403,actor);
      assert.equal((await call(preview,reviewPath(preview))).status,403,actor);
      assert.equal((await call(preview,reviewPath(preview)+'/decision',{method:'POST',body:{expectedVersion:2,decision:'approve',reason:null}})).status,403,actor);
    }finally{await preview.close();}
  }
});

test('signed local admin reviews two isolated pending fixtures and reads back exact approve/reject results without exposing a login or media-write route',async()=>{
  const preview=await startStaffPreview({port:0,actor:'admin',seedPendingReviews:true});
  try{
    assert.equal(preview.pendingReviewFixtures,true);
    assert.equal((await call(preview,'/v2/staff/reviews',{token:null})).status,401);
    const queued=await call(preview,'/v2/staff/reviews?limit=100');assert.equal(queued.status,200);
    const queue=await queued.json();assert.equal(queue.items.length,2);
    assert.deepEqual(new Set(queue.items.map(row=>row.listingId)),new Set([preview.listingId,STAFF_PREVIEW_FIXTURES.realtimePausedReviewListingId]));
    assert.ok(queue.items.every(row=>row.version==='3'&&row.state==='pending'&&row.acceptedPhotoCount===4));
    assert.equal((await call(preview,'/v2/staff/reviews?tenantId=other')).status,400);
    assert.equal((await call(preview,reviewPath(preview,STAFF_PREVIEW_FIXTURES.sampleListingId))).status,404);
    const beforeResponse=await call(preview,reviewPath(preview));assert.equal(beforeResponse.status,200);
    const before=await beforeResponse.json();assert.equal(before.listingVersion,'2');assert.equal(before.publicationStatus,'unpublished');assert.equal(before.photos.length,4);
    assert.equal(before.content.privateAddress,'PRIVATE SYNTHETIC STAFF FIXTURE ADDRESS');
    const approveBody={expectedVersion:3,decision:'approve',reason:null};
    const approved=await call(preview,reviewPath(preview)+'/decision',{method:'POST',body:approveBody});assert.equal(approved.status,200);assert.deepEqual(await approved.json(),{version:'4',state:'approved'});
    const readback=await (await call(preview,reviewPath(preview))).json();assert.equal(readback.state,'approved');assert.equal(readback.version,'4');assert.equal(readback.listingVersion,'3');assert.equal(readback.publicationStatus,'published');assert.equal(readback.publishedRevision,1);assert.deepEqual(readback.content,before.content);
    assert.equal((await call(preview,reviewPath(preview)+'/decision',{method:'POST',body:approveBody})).status,409);
    const pausedPath=reviewPath(preview,STAFF_PREVIEW_FIXTURES.realtimePausedReviewListingId),reason='Synthetic private reject reason; changes required.';
    assert.equal((await call(preview,pausedPath+'/decision',{method:'POST',body:{expectedVersion:3,decision:'reject',reason:' '}})).status,400);
    const rejected=await call(preview,pausedPath+'/decision',{method:'POST',body:{expectedVersion:3,decision:'reject',reason}});assert.equal(rejected.status,200);assert.deepEqual(await rejected.json(),{version:'4',state:'rejected'});
    const rejectedDetail=await (await call(preview,pausedPath)).json();assert.equal(rejectedDetail.state,'rejected');assert.equal(rejectedDetail.decisionReason,reason);assert.equal(rejectedDetail.publicationStatus,'paused');assert.equal(rejectedDetail.listingVersion,'3');
    assert.deepEqual((await (await call(preview,'/v2/staff/reviews')).json()).items,[]);
    assert.equal((await call(preview,'/v2/properties')).status,404);assert.equal((await call(preview,'/login')).status,404);
    assert.equal((await call(preview,'/v2/staff/media',{method:'POST',body:{accepted:true}})).status,404);
    assert.equal(JSON.stringify(readback).includes(preview.bearerToken),false);
  }finally{await preview.close();}
});

test('trusted Sample Homes startup reads its assigned draft without exposing the Realtime fixture',async()=>{
  const preview=await startStaffPreview({tenantSlug:'sample-homes',port:0});
  try{
    assert.equal(preview.listingId,STAFF_PREVIEW_FIXTURES.sampleListingId);assert.equal((await read(preview)).content.title,'Synthetic other-company draft');
    assert.equal((await call(preview,draftPath(preview,STAFF_PREVIEW_FIXTURES.realtimeListingId))).status,404);
  }finally{await preview.close();}
});

test('without explicit synthetic accepted-media metadata, actual SQL submission is rejected and draft/version are retained',async()=>{
  const preview=await startStaffPreview({port:0,seedAcceptedMedia:false});
  try{
    const before=await read(preview);assert.equal(preview.acceptedMediaMetadataOnly,false);
    const response=await call(preview,draftPath(preview)+'/submit',{method:'POST',body:{expectedVersion:2}});assert.equal(response.status,422);assert.equal((await response.json()).error.code,'INVALID_STATE');
    assert.deepEqual(await read(preview),before);assert.equal(before.state,'draft');assert.equal(before.version,'2');
  }finally{await preview.close();}
});
