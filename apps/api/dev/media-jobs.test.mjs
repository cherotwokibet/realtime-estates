import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {startStaffPreview,STAFF_PREVIEW_FIXTURES} from './staff-preview.mjs';

test('real loopback RS256/JWKS media registration HTTP journey recovers immutable receipts after saves and submission',async()=>{
 const preview=await startStaffPreview({port:0});
 const prefix=`/v2/staff/listings/${preview.listingId}/revisions/1`,path=prefix+'/media-registrations',draft=`/v2/staff/listings/${preview.listingId}/drafts/1`;
 const call=(p,{method='GET',body,token=preview.bearerToken,headers={}}={})=>fetch(preview.origin+p,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const read=async p=>{const r=await call(p);assert.equal(r.status,200);return r.json();};
 try{
  const before=await read(draft),body={registrationId:randomUUID(),expectedVersion:Number(before.version),altText:'Synthetic studio living room'};
  assert.equal((await call(path,{method:'POST',body,token:null})).status,401);
  const registered=await call(path,{method:'POST',body});assert.equal(registered.status,200);assert.equal(registered.headers.get('x-synthetic-staff-preview'),'true');assert.equal(registered.headers.get('cache-control'),'no-store');
  const receipt=await registered.json();assert.equal(receipt.operationId,body.registrationId);assert.notEqual(receipt.jobId,body.registrationId);assert.equal(receipt.expectedVersion,before.version);assert.equal(receipt.outcome,'registered');assert.equal(Date.parse(receipt.expiresAt)-Date.parse(receipt.registeredAt),86400000);
  assert.deepEqual(await read(draft),before,'Registration cannot increment draft version or accept media.');
  assert.deepEqual(await read(path+'/'+body.registrationId),receipt);
  const state=await read(prefix+'/media-jobs/'+receipt.jobId);assert.equal(state.state,'registered');assert.equal('outcome' in state,false);
  for(const privateKey of ['actorId','tenantId','quarantineId','outputId','uploadUrl','sha256','manifest'])assert.equal(privateKey in receipt,false);
  const next={...before.content,title:'Synthetic title changed after registration'};
  assert.equal((await call(draft,{method:'PUT',body:{expectedVersion:Number(before.version),content:next}})).status,200);
  const replay=await call(path,{method:'POST',body});assert.equal(replay.status,200);assert.deepEqual(await replay.json(),receipt);
  assert.equal((await call(path,{method:'POST',body:{...body,altText:'Changed retry'}})).status,409);
  assert.equal((await call(path,{method:'POST',body:{...body,registrationId:randomUUID()}})).status,409);
  const current=await read(draft);assert.equal(current.version,'3');assert.equal((await call(draft+'/submit',{method:'POST',body:{expectedVersion:3}})).status,200);
  assert.deepEqual(await read(path+'/'+body.registrationId),receipt);
  assert.equal((await call(path,{method:'POST',body:{...body,registrationId:randomUUID(),expectedVersion:4}})).status,422);
  const mismatched=path.replace(preview.listingId,STAFF_PREVIEW_FIXTURES.realtimePeerListingId)+'/'+body.registrationId;
  assert.equal((await call(mismatched)).status,404);
  assert.equal((await call(path+'?tenantId=forged',{method:'POST',body})).status,400);
  assert.equal((await call(path,{method:'POST',body,headers:{Origin:'https://untrusted.invalid'}})).status,403);
  assert.equal((await call(path,{method:'POST',body,headers:{Cookie:'unexpected=credential'}})).status,400);
 }finally{await preview.close();}
});
