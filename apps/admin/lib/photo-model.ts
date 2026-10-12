import {validateMediaRegistrationReceiptV2,validateMediaUploadStatusV2,validateMediaAttachIntentV2,validateStaffDraftWorkspaceV2,type MediaRegistrationReceiptV2,type MediaUploadStatusV2,type MediaAttachIntentV2,type StaffDraftWorkspaceV2} from '@realtor/api-client';

export interface PhotoCommand {readonly listingId:string;readonly revision:number;readonly expectedVersion:string;readonly altText:string;readonly registrationId:string;readonly uploadId:string;readonly operationId:string}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createPhotoCommand(workspace:StaffDraftWorkspaceV2,altText:string,registrationId:string,uploadId:string,operationId:string):PhotoCommand {
  const saved=validateStaffDraftWorkspaceV2(workspace,workspace.listingId,workspace.draft.revision);
  if(saved.draft.state!=='draft'||saved.photos.length>=12)throw new Error('Choose a saved draft with room for another photo.');
  if(!/^[1-9]\d*$/.test(saved.draft.version)||BigInt(saved.draft.version)>9007199254740990n)throw new Error('This draft version cannot accept another photo.');
  if(typeof altText!=='string'||altText!==altText.trim()||!altText||[...altText].length>300||/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(altText))throw new Error('Describe the photo in 1–300 characters without control characters.');
  const ids=[registrationId,uploadId,operationId].map(value=>{if(typeof value!=='string'||!UUID.test(value))throw new Error('Use valid original photo identifiers.');return value.toLowerCase();});
  if(new Set(ids).size!==3||ids.some(value=>value===saved.listingId||saved.photos.some(photo=>photo.id===value)))throw new Error('Photo request identifiers must be distinct.');
  return Object.freeze({listingId:saved.listingId,revision:saved.draft.revision,expectedVersion:saved.draft.version,altText,registrationId:ids[0]!,uploadId:ids[1]!,operationId:ids[2]!});
}
export function matchPhotoRegistration(command:PhotoCommand,input:unknown):MediaRegistrationReceiptV2 {
  const result=validateMediaRegistrationReceiptV2(input,command.listingId,command.revision,command.registrationId,{registrationId:command.registrationId,expectedVersion:command.expectedVersion,altText:command.altText});
  if([command.listingId,command.uploadId,command.operationId].includes(result.jobId))throw new Error('The job must have its own original identifier.');return result;
}
export function matchPhotoStatus(command:PhotoCommand,registration:MediaRegistrationReceiptV2,input:unknown):MediaUploadStatusV2 {
  matchPhotoRegistration(command,registration);
  return validateMediaUploadStatusV2(input,command.listingId,command.revision,registration.jobId,command.uploadId);
}
export function matchPhotoAttachment(command:PhotoCommand,registration:MediaRegistrationReceiptV2,input:unknown):MediaAttachIntentV2 {
  matchPhotoRegistration(command,registration);
  const result=validateMediaAttachIntentV2(input,command.listingId,command.revision,command.operationId,{operationId:command.operationId,jobId:registration.jobId,expectedVersion:command.expectedVersion});
  if(result.altText!==command.altText)throw new Error('The attachment description differs from the original photo.');return result;
}
