import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStaffDraftContentV2} from '@realtor/api-client';
import {
  createRemoveCommand,createReorderCommand,galleryOrder,matchGalleryReceipt,
  moveGalleryPhoto,sameGalleryOrder,workspaceMatchesReceipt,
} from '../dist/tests/lib/gallery-model.js';

const id=number=>`00000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
const listingId=id(10),operationId=id(20),first=id(1),legacy=id(2),third=id(3);
const content=validateStaffDraftContentV2({title:'Synthetic gallery studio',description:'Synthetic gallery model fixture.',purpose:'rent',propertyType:'studio',amountMinor:2000000,rentPeriod:'month',bedrooms:0,locality:'Synthetic area',pricing:{declaration:'not_declared',charges:[]},location:{county:null,town:null,area:null}});
function workspace({version='7',state='draft',photos}={}){
  return {listingId,draft:{revision:1,state,version,content:structuredClone(content)},photos:photos??[
    {id:first,position:0,altText:'Synthetic first photo',accepted:true,provenance:'sealed'},
    {id:legacy,position:1,altText:'Synthetic legacy photo',accepted:false,provenance:'legacy'},
    {id:third,position:2,altText:'Synthetic third photo',accepted:true,provenance:'sealed'},
  ]};
}
const order=[first,legacy,third];
function receipt(overrides={}){
  return {kind:'remove_media',operationId,listingId,revision:1,expectedVersion:'7',version:'8',outcome:'applied',reason:null,
    mediaId:first,orderedIds:[legacy,third],completedAt:'2026-10-11T16:00:00.000Z',...overrides};
}

test('gallery reads include legacy rows and snapshot the complete server order without mutating the workspace',()=>{
  const source=workspace(),before=structuredClone(source),read=galleryOrder(source);
  assert.deepEqual(read,order);assert.ok(Object.isFrozen(read));assert.deepEqual(source,before);
  source.photos[0].id=id(90);source.photos.reverse();assert.deepEqual(read,order);
  assert.deepEqual(galleryOrder(workspace({photos:[]})),[]);
});

test('remove requests retain exact resource, version and target in an immutable snapshot',()=>{
  const source=workspace(),command=createRemoveCommand(source,first,operationId);
  assert.deepEqual(command,{kind:'remove_media',operationId,listingId,revision:1,expectedVersion:'7',mediaId:first});
  assert.ok(Object.isFrozen(command));source.draft.version='8';source.photos.splice(0,1);
  assert.equal(command.expectedVersion,'7');assert.equal(command.mediaId,first);
  assert.throws(()=>{command.expectedVersion='8';},TypeError);
});

test('removal requires a current member, current draft and contiguous positions without silently repairing sparse rows',()=>{
  assert.throws(()=>createRemoveCommand(workspace(),id(90),operationId),/no longer/);
  const sparse=workspace();sparse.photos[1].position=4;sparse.photos[2].position=8;
  assert.throws(()=>createRemoveCommand(sparse,first,operationId),/repair/);
  for(const state of ['pending','approved','rejected'])assert.throws(()=>createRemoveCommand(workspace({state}),first,operationId),/Only a saved draft/);
  for(const operation of [listingId,first,legacy,third])assert.throws(()=>createRemoveCommand(workspace(),first,operation),/new operation/);
  assert.throws(()=>createRemoveCommand(workspace(),first,'invalid'),/identifier/);
});

test('photo command versions remain canonical exact strings and refuse nonincrementable or malformed tokens',()=>{
  const command=createRemoveCommand(workspace({version:'9007199254740990'}),first,operationId);
  assert.equal(command.expectedVersion,'9007199254740990');
  for(const version of ['9007199254740991','9007199254740992','07','7.0','7e0','0','-1',7]){
    assert.throws(()=>createRemoveCommand(workspace({version}),first,operationId));
    assert.throws(()=>createReorderCommand(workspace({version}),order,operationId));
  }
});

test('reorder snapshots every member including legacy and permits explicit identical order or sparse repair',()=>{
  const source=workspace(),input=[third,first,legacy],command=createReorderCommand(source,input,operationId);
  assert.deepEqual(command,{kind:'reorder_media',operationId,listingId,revision:1,expectedVersion:'7',orderedIds:[third,first,legacy]});
  assert.ok(Object.isFrozen(command));assert.ok(Object.isFrozen(command.orderedIds));
  input.reverse();source.photos.reverse();source.draft.version='9';assert.deepEqual(command.orderedIds,[third,first,legacy]);
  const sparse=workspace();sparse.photos[0].position=2;sparse.photos[1].position=5;sparse.photos[2].position=11;
  assert.deepEqual(createReorderCommand(sparse,order,operationId).orderedIds,order);
  assert.deepEqual(createReorderCommand(workspace(),order,operationId).orderedIds,order);
  assert.deepEqual(createReorderCommand(workspace({photos:[]}),[],operationId).orderedIds,[]);
  assert.throws(()=>command.orderedIds.push(first),TypeError);
});

test('full-set ordering rejects omitted, duplicate, foreign, sparse, accessor and oversized request arrays',()=>{
  for(const input of [[first,third],[first,first,third],[first,legacy,id(90)],[],null,new Array(3),[...order,...Array.from({length:10},(_,index)=>id(index+100))]]){
    assert.throws(()=>createReorderCommand(workspace(),input,operationId));
  }
  let reads=0;const accessor=[...order];Object.defineProperty(accessor,'1',{get(){reads++;return legacy;}});
  assert.throws(()=>createReorderCommand(workspace(),accessor,operationId),/accessors/);assert.equal(reads,0);
  const extra=[...order];extra.unrelated=true;assert.throws(()=>createReorderCommand(workspace(),extra,operationId),/additional fields/);
  assert.throws(()=>createReorderCommand(workspace({state:'pending'}),order,operationId),/Only a saved draft/);
});

test('move controls are stable, bounded and immutable and cannot silently omit a photo',()=>{
  const source=[...order];assert.deepEqual(moveGalleryPhoto(source,legacy,'up'),[legacy,first,third]);
  assert.deepEqual(moveGalleryPhoto(source,legacy,'down'),[first,third,legacy]);assert.deepEqual(source,order);
  assert.deepEqual(moveGalleryPhoto(source,first,'up'),order);assert.deepEqual(moveGalleryPhoto(source,third,'down'),order);
  assert.ok(Object.isFrozen(moveGalleryPhoto(source,legacy,'up')));
  assert.throws(()=>moveGalleryPhoto(source,id(90),'up'),/not in/);assert.throws(()=>moveGalleryPhoto(source,first,'sideways'),/earlier/);
  assert.equal(sameGalleryOrder(order,[...order]),true);assert.equal(sameGalleryOrder(order,[third,legacy,first]),false);assert.equal(sameGalleryOrder(order,order.slice(1)),false);
  assert.equal(sameGalleryOrder(new Array(3),order),false);assert.equal(sameGalleryOrder(new Array(3),new Array(3)),false);
});

test('original remove receipt recovery checks exact kind, version, operation, resource and target',()=>{
  const command=createRemoveCommand(workspace(),first,operationId),original=receipt();
  assert.deepEqual(matchGalleryReceipt(command,original),original);
  for(const changed of [
    {operationId:id(21)},{listingId:id(11)},{revision:2},{expectedVersion:'6',version:'7'},
    {mediaId:legacy,orderedIds:[first,third]},{kind:'reorder_media',mediaId:null,orderedIds:order},
    {outcome:'noop',version:'7'},{reason:'VERSION_CONFLICT'},{version:'8.0'},{unknown:true},
  ])assert.throws(()=>matchGalleryReceipt(command,receipt(changed)));
  const rejected=receipt({version:'9',outcome:'rejected',reason:'REVISION_NOT_DRAFT',orderedIds:order});
  assert.deepEqual(matchGalleryReceipt(command,rejected),rejected);
});

test('reorder recovery always binds the full original requested order, including conflict and rejection results',()=>{
  const requested=[third,legacy,first],command=createReorderCommand(workspace(),requested,operationId);
  const applied=receipt({kind:'reorder_media',mediaId:null,orderedIds:requested});
  assert.deepEqual(matchGalleryReceipt(command,applied),applied);
  const noop={...applied,outcome:'noop',version:'7'},conflict={...applied,outcome:'conflict',reason:'VERSION_CONFLICT',version:'9'},rejected={...applied,outcome:'rejected',reason:'MEDIA_SET_CHANGED',version:'7'};
  for(const result of [noop,conflict,rejected]){
    assert.deepEqual(matchGalleryReceipt(command,result),result);
    assert.throws(()=>matchGalleryReceipt(command,{...result,orderedIds:order}),/original photo command/);
  }
  assert.throws(()=>matchGalleryReceipt(command,{...applied,mediaId:first}));
});

test('historical removal is independent of current gallery and later edits never match its recorded version',()=>{
  const command=createRemoveCommand(workspace(),first,operationId),original=matchGalleryReceipt(command,receipt());
  const current=workspace({version:'8',photos:[
    {id:legacy,position:0,altText:'Synthetic legacy photo',accepted:false,provenance:'legacy'},
    {id:third,position:1,altText:'Synthetic third photo',accepted:true,provenance:'sealed'},
  ]});
  const before=structuredClone(current);
  assert.equal(workspaceMatchesReceipt(current,original),true);assert.deepEqual(current,before);
  current.draft.version='9';current.draft.content.title='Later content edit';
  assert.equal(workspaceMatchesReceipt(current,original),false);assert.deepEqual(matchGalleryReceipt(command,original),original);
  assert.equal(command.expectedVersion,'7');assert.deepEqual(original.orderedIds,[legacy,third]);
  assert.equal(workspaceMatchesReceipt(workspace(),original),false);
});

test('current comparison requires matching resource, exact version and order and never treats failures as gallery proof',()=>{
  const ordered=[third,first,legacy],command=createReorderCommand(workspace(),ordered,operationId);
  const original=matchGalleryReceipt(command,receipt({kind:'reorder_media',mediaId:null,orderedIds:ordered}));
  const current=workspace({version:'8',photos:ordered.map((photo,index)=>({...workspace().photos.find(item=>item.id===photo),position:index}))});
  assert.equal(workspaceMatchesReceipt(current,original),true);
  assert.equal(workspaceMatchesReceipt(workspace({version:'8'}),original),false);
  assert.equal(workspaceMatchesReceipt({...current,listingId:id(11)},original),false);
  assert.equal(workspaceMatchesReceipt({...current,draft:{...current.draft,revision:2}},original),false);
  for(const failure of [receipt({outcome:'conflict',reason:'VERSION_CONFLICT',version:'8',orderedIds:order}),receipt({outcome:'rejected',reason:'MEDIA_SET_CHANGED',version:'8',orderedIds:order})]){
    assert.equal(workspaceMatchesReceipt(workspace({version:'8'}),failure),false);
  }
  const noop=receipt({kind:'reorder_media',mediaId:null,orderedIds:order,outcome:'noop',version:'7'});
  assert.equal(workspaceMatchesReceipt(workspace(),noop),true);
  assert.equal(workspaceMatchesReceipt(workspace({version:'8'}),noop),false);
  assert.equal(workspaceMatchesReceipt(workspace(),{...noop,version:'7.0'}),false);
});
