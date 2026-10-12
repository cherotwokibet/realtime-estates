import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStaffDraftContentV2} from '@realtor/api-client';
import {createPhotoCommand,matchPhotoRegistration,matchPhotoStatus,matchPhotoAttachment} from '../dist/tests/lib/photo-model.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const content=validateStaffDraftContentV2({title:'Synthetic photo studio',description:'Synthetic photo fixture.',purpose:'rent',propertyType:'studio',amountMinor:2000000,rentPeriod:'month',bedrooms:0,locality:'Synthetic area',pricing:{declaration:'not_declared',charges:[]},location:{county:null,town:null,area:null}});
const saved=()=>({listingId:id(1),draft:{revision:1,state:'draft',version:'7',content},photos:[]});
const command=()=>createPhotoCommand(saved(),'Synthetic living room',id(2),id(3),id(4));
const registration=()=>({kind:'register_media_upload',operationId:id(2),jobId:id(5),listingId:id(1),revision:1,expectedVersion:'7',altText:'Synthetic living room',registeredAt:'2026-10-12T00:00:00.000Z',expiresAt:'2026-10-13T00:00:00.000Z',outcome:'registered'});
const intent=()=>({kind:'attach_media',operationId:id(4),jobId:id(5),listingId:id(1),revision:1,expectedVersion:'7',altText:'Synthetic living room',status:'ready',receipt:null});
test('photo preparation freezes the original saved version and distinct identities',()=>{
  const workspace=saved(),result=command();workspace.draft.version='8';assert.equal(result.expectedVersion,'7');assert.ok(Object.isFrozen(result));
  for(const state of ['pending','approved','rejected'])assert.throws(()=>createPhotoCommand({...saved(),draft:{...saved().draft,state}},result.altText,id(2),id(3),id(4)));
  for(const version of ['07','0','9007199254740991'])assert.throws(()=>createPhotoCommand({...saved(),draft:{...saved().draft,version}},result.altText,id(2),id(3),id(4)));
  for(const ids of [[id(2),id(2),id(4)],[id(1),id(3),id(4)],['bad',id(3),id(4)]])assert.throws(()=>createPhotoCommand(saved(),result.altText,...ids));
});
test('photo description and capacity refuse invalid preparation before transport',()=>{
  for(const alt of ['',' x','x ',String.fromCharCode(127),'a'.repeat(301),'\ud800'])assert.throws(()=>createPhotoCommand(saved(),alt,id(2),id(3),id(4)));
  assert.equal(createPhotoCommand(saved(),'🛋'.repeat(300),id(2),id(3),id(4)).altText.length,600);
  const workspace=saved();workspace.photos=Array.from({length:12},(_,n)=>({id:id(n+20),position:n,altText:'Synthetic',accepted:true,provenance:'sealed'}));assert.throws(()=>createPhotoCommand(workspace,'Synthetic',id(2),id(3),id(4)),/room/);
});
test('recovered preparation must match original description version operation and resource',()=>{
  assert.deepEqual(matchPhotoRegistration(command(),registration()),registration());
  for(const patch of [{operationId:id(8)},{listingId:id(8)},{revision:2},{expectedVersion:'8'},{altText:'Other'},{jobId:id(3)},{jobId:id(4)},{jobId:id(1)}])assert.throws(()=>matchPhotoRegistration(command(),{...registration(),...patch}));
});
test('upload status binds the original resource job and upload without adopting a version',()=>{
  const status={listingId:id(1),revision:1,jobId:id(5),uploadId:id(3),state:'verified'};assert.deepEqual(matchPhotoStatus(command(),registration(),status),status);
  for(const patch of [{listingId:id(8)},{revision:2},{jobId:id(8)},{uploadId:id(8)},{state:'attached'},{version:'8'}])assert.throws(()=>matchPhotoStatus(command(),registration(),{...status,...patch}));
});
test('attachment recovery binds the original job version operation and description',()=>{
  assert.deepEqual(matchPhotoAttachment(command(),registration(),intent()),intent());
  for(const patch of [{listingId:id(8)},{revision:2},{jobId:id(8)},{operationId:id(8)},{expectedVersion:'8'},{altText:'Other'},{status:'applied'}])assert.throws(()=>matchPhotoAttachment(command(),registration(),{...intent(),...patch}));
  const applied={...intent(),status:'applied',receipt:{kind:'attach_media',operationId:id(4),jobId:id(5),listingId:id(1),revision:1,expectedVersion:'7',version:'8',outcome:'applied',reason:null,mediaId:id(9),position:0,completedAt:'2026-10-12T00:01:00.000Z'}};
  assert.deepEqual(matchPhotoAttachment(command(),registration(),applied),applied);
});
