import assert from 'node:assert/strict';
import test from 'node:test';
import {galleryCommandBody} from '../dist/tests/lib/gallery-preview-policy.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const remove={operationId:id(1),expectedVersion:'9007199254740990',mediaId:id(2)};
test('browser gallery envelopes keep exact string tokens and freeze complete canonical inputs',()=>{
 const result=galleryCommandBody(JSON.stringify(remove),'remove');assert.deepEqual(result,remove);assert.ok(Object.isFrozen(result));
 const order=galleryCommandBody(JSON.stringify({operationId:id(1),expectedVersion:'2',orderedIds:[id(3),id(2)]}),'reorder');assert.deepEqual(order.orderedIds,[id(3),id(2)]);assert.ok(Object.isFrozen(order.orderedIds));
 assert.deepEqual(galleryCommandBody(JSON.stringify({...order,orderedIds:[]}),'reorder').orderedIds,[]);
});
test('duplicate escaped keys, unsupported context and lossy or unsupported token shapes never reach upstream',()=>{
 for(const source of [
  JSON.stringify({...remove,tenantId:id(9)}),JSON.stringify({...remove,expectedVersion:2}),JSON.stringify({...remove,expectedVersion:'02'}),
  JSON.stringify({...remove,expectedVersion:'2e0'}),JSON.stringify({...remove,expectedVersion:'9007199254740991'}),
  JSON.stringify({...remove,operationId:'../elsewhere'}),JSON.stringify({...remove,mediaId:null}),
  `{"operationId":"${id(1)}","expectedVersion":"2","expected\\u0056ersion":"3","mediaId":"${id(2)}"}`,
  'null','[]','{}',
 ])assert.throws(()=>galleryCommandBody(source,'remove'));
});
test('reorder requires bounded unique UUID membership and rejects nested or sparse representations',()=>{
 const base={operationId:id(1),expectedVersion:'2'};
 for(const orderedIds of [[id(2),id(2)],Array.from({length:13},(_,n)=>id(10+n)),[null],[{id:id(2)}],'not-an-array'])assert.throws(()=>galleryCommandBody(JSON.stringify({...base,orderedIds}),'reorder'));
 assert.throws(()=>galleryCommandBody(JSON.stringify({...base,mediaId:id(2),orderedIds:[]}),'reorder'));
});
