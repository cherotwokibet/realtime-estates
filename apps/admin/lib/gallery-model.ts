import {
  validateMediaOperationReceiptV2, validateStaffDraftWorkspaceV2,
  type MediaOperationReceiptV2, type StaffDraftWorkspaceV2,
} from '@realtor/api-client';

interface GalleryCommandFacts {
  readonly operationId:string;
  readonly listingId:string;
  readonly revision:number;
  readonly expectedVersion:string;
}
/** Retain this exact request until its original result has been recovered. */
export type GalleryCommand=GalleryCommandFacts&(
  | Readonly<{kind:'remove_media';mediaId:string}>
  | Readonly<{kind:'reorder_media';orderedIds:readonly string[]}>);

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function photoId(value:unknown):string {
  if(typeof value!=='string'||!UUID.test(value))throw new Error('Use a valid photo or operation identifier.');
  return value.toLowerCase();
}
function snapshotOrder(input:readonly string[]):readonly string[] {
  if(!Array.isArray(input)||Object.getPrototypeOf(input)!==Array.prototype||input.length>12)throw new Error('Supply the complete photo order, with at most twelve photos.');
  const descriptors=Object.getOwnPropertyDescriptors(input);
  if(Reflect.ownKeys(input).length!==input.length+1)throw new Error('Supply a dense photo order without additional fields.');
  const ids:string[]=[];
  for(let index=0;index<input.length;index++){
    const descriptor=descriptors[String(index)];
    if(!descriptor||!Object.hasOwn(descriptor,'value'))throw new Error('Supply a dense photo order without accessors.');
    ids.push(photoId(descriptor.value));
  }
  if(new Set(ids).size!==ids.length)throw new Error('Each photo must appear exactly once.');
  return Object.freeze(ids);
}
function workspaceSnapshot(workspace:StaffDraftWorkspaceV2):StaffDraftWorkspaceV2 {
  return validateStaffDraftWorkspaceV2(workspace,workspace.listingId,workspace.draft.revision);
}
function commandFacts(workspace:StaffDraftWorkspaceV2,operationId:string):GalleryCommandFacts {
  if(workspace.draft.state!=='draft')throw new Error('Only a saved draft can change its photos.');
  if(!/^[1-9]\d*$/.test(workspace.draft.version)||BigInt(workspace.draft.version)>9007199254740990n)throw new Error('This draft version cannot accept another photo command.');
  const id=photoId(operationId);
  if(id===workspace.listingId||workspace.photos.some(photo=>photo.id===id))throw new Error('Use a new operation identifier for this photo command.');
  return Object.freeze({operationId:id,listingId:workspace.listingId,revision:workspace.draft.revision,expectedVersion:workspace.draft.version});
}
/** Server order includes legacy rows. Historical receipts never supply this read model. */
export function galleryOrder(workspace:StaffDraftWorkspaceV2):readonly string[] {
  return Object.freeze(workspaceSnapshot(workspace).photos.map(photo=>photo.id));
}
export function sameGalleryOrder(left:readonly string[],right:readonly string[]):boolean {
  if(left.length!==right.length)return false;
  for(let index=0;index<left.length;index++)if(typeof left[index]!=='string'||left[index]!==right[index])return false;
  return true;
}
export function moveGalleryPhoto(order:readonly string[],id:string,direction:'up'|'down'):readonly string[] {
  const result=[...snapshotOrder(order)],target=photoId(id),index=result.indexOf(target);
  if(index<0)throw new Error('This photo is not in the current order.');
  if(direction!=='up'&&direction!=='down')throw new Error('Choose an earlier or later photo position.');
  const next=index+(direction==='up'?-1:1);
  if(next>=0&&next<result.length){const adjacent=result[next]!;result[next]=target;result[index]=adjacent;}
  return Object.freeze(result);
}
export function createRemoveCommand(workspace:StaffDraftWorkspaceV2,mediaId:string,operationId:string):GalleryCommand&{readonly kind:'remove_media'} {
  const saved=workspaceSnapshot(workspace),facts=commandFacts(saved,operationId),target=photoId(mediaId);
  if(!saved.photos.some(photo=>photo.id===target))throw new Error('This photo is no longer in the saved gallery.');
  if(saved.photos.some((photo,index)=>photo.position!==index))throw new Error('Save the complete photo order to repair its positions before removing a photo.');
  return Object.freeze({...facts,kind:'remove_media',mediaId:target});
}
export function createReorderCommand(workspace:StaffDraftWorkspaceV2,orderedIds:readonly string[],operationId:string):GalleryCommand&{readonly kind:'reorder_media'} {
  const saved=workspaceSnapshot(workspace),facts=commandFacts(saved,operationId),order=snapshotOrder(orderedIds);
  if(order.length!==saved.photos.length||saved.photos.some(photo=>!order.includes(photo.id)))throw new Error('Include every saved photo exactly once, including legacy photos.');
  return Object.freeze({...facts,kind:'reorder_media',orderedIds:order});
}
/** This proves only the original operation. It does not adopt its version or replace the current gallery. */
export function matchGalleryReceipt(command:GalleryCommand,input:unknown):MediaOperationReceiptV2 {
  const receipt=validateMediaOperationReceiptV2(input,command.listingId,command.revision,command.operationId);
  if(receipt.kind!==command.kind||receipt.expectedVersion!==command.expectedVersion
    ||(command.kind==='remove_media'&&(receipt.kind!=='remove_media'||receipt.mediaId!==command.mediaId))
    ||(command.kind==='reorder_media'&&!sameGalleryOrder(receipt.orderedIds,command.orderedIds)))throw new Error('The recovered result does not match the original photo command.');
  return receipt;
}
/** Display comparison only. A matching historical result never authorizes a subsequent write. */
export function workspaceMatchesReceipt(workspace:StaffDraftWorkspaceV2,receipt:MediaOperationReceiptV2):boolean {
  if(receipt.outcome!=='applied'&&receipt.outcome!=='noop')return false;
  try{
    const saved=validateStaffDraftWorkspaceV2(workspace,receipt.listingId,receipt.revision);
    const original=validateMediaOperationReceiptV2(receipt,receipt.listingId,receipt.revision,receipt.operationId);
    return saved.draft.version===original.version&&sameGalleryOrder(saved.photos.map(photo=>photo.id),original.orderedIds);
  }catch{return false;}
}
