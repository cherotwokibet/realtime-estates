import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {startStaffPreview,STAFF_PREVIEW_FIXTURES} from './staff-preview.mjs';
test('actual signed local preview exposes atomic gallery, exact commands and historical recovery without upload authority',async()=>{
 const preview=await startStaffPreview({port:0});
 const base=`/v2/staff/listings/${preview.listingId}/revisions/1`;
 const call=(path,method='GET',body)=>fetch(preview.origin+path,{method,headers:{Authorization:`Bearer ${preview.bearerToken}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
  const initial=await (await call(base+'/workspace')).json();assert.equal(initial.draft.version,'2');assert.equal(initial.photos.length,4);assert.match(initial.photos[0].altText,/photo 1/);
  assert.equal((await call(base+'/workspace','POST',{})).status,405);assert.equal((await call(base+'/media-reorders','GET')).status,405);
  assert.equal((await call(base+'/media-operations')).status,404);assert.equal((await call(base+'/workspace/'+randomUUID())).status,404);
  assert.equal((await call(base+'/workspace?tenantId=other')).status,400);
  assert.equal((await call(`/v2/staff/listings/${STAFF_PREVIEW_FIXTURES.realtimePeerListingId}/revisions/1/workspace`)).status,404);
  const orderedIds=initial.photos.map(photo=>photo.id).reverse(),operationId=randomUUID();
  const response=await call(base+'/media-reorders','POST',{operationId,orderedIds,expectedVersion:2});assert.equal(response.status,200);const reordered=await response.json();assert.equal(reordered.version,'3');assert.equal(reordered.outcome,'applied');
  const after=await (await call(base+'/workspace')).json();assert.equal(after.draft.version,'3');assert.deepEqual(after.photos.map(photo=>photo.id),orderedIds);assert.deepEqual(after.draft.content,initial.draft.content);
  const removeId=randomUUID(),removed=await call(base+'/media-removals','POST',{operationId:removeId,mediaId:orderedIds[0],expectedVersion:3});assert.equal(removed.status,200);const receipt=await removed.json();assert.equal(receipt.version,'4');
  assert.deepEqual(await (await call(base+'/media-operations/'+removeId)).json(),receipt);
  assert.deepEqual(await (await call(base+'/media-operations/'+operationId)).json(),reordered,'Read original order, never the later removed set.');
  const final=await (await call(base+'/workspace')).json();assert.equal(final.photos.length,3);assert.equal(final.draft.version,'4');
  assert.equal((await call(base+'/media-attachments','POST',{})).status,404);assert.equal((await call(base+'/finalize','POST',{})).status,404);
 }finally{await preview.close();}
});
