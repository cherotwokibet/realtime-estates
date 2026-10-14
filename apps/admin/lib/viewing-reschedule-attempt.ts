import {validateViewingRescheduleCommand,validateViewingRescheduleReceipt,type ViewingRescheduleCommand,type ViewingRescheduleReceipt} from '@realtor/api-client';
import {EnquiryPreviewError,type EnquiryPreviewClient} from './enquiry-client.ts';
export interface ViewingRescheduleAttempt {
 readonly enquiryId:string;readonly original:Readonly<{kind:'reschedule';viewingId:string;command:ViewingRescheduleCommand}>;
 readonly status:'ready'|'sending'|'uncertain'|'received'|'rejected';readonly receipt:ViewingRescheduleReceipt|null;
 submit(signal?:AbortSignal):Promise<ViewingRescheduleReceipt>;
 recoverOriginal(signal?:AbortSignal):Promise<ViewingRescheduleReceipt>;
 replayOriginal(signal?:AbortSignal):Promise<ViewingRescheduleReceipt>;
}
/** Retain this exact selected viewing version, new slot and raw reason only in memory. */
export function prepareViewingRescheduleAttempt(client:Pick<EnquiryPreviewClient,'rescheduleViewing'|'recoverViewingReschedule'>,id:string,target:string,input:ViewingRescheduleCommand):ViewingRescheduleAttempt{
 let command:ViewingRescheduleCommand;
 const valid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
 try{if(!valid(id)||!valid(target))throw new Error();command=validateViewingRescheduleCommand(input);}catch{throw new EnquiryPreviewError('validation');}
 const enquiryId=id.toLowerCase(),viewingId=target.toLowerCase(),original=Object.freeze({kind:'reschedule' as const,viewingId,command}),save=client.rescheduleViewing.bind(client),recover=client.recoverViewingReschedule.bind(client);
 let status:ViewingRescheduleAttempt['status']='ready',receipt:ViewingRescheduleReceipt|null=null;
 async function run(mode:'submit'|'recover'|'replay',signal?:AbortSignal):Promise<ViewingRescheduleReceipt>{
  if(signal!==undefined&&!(signal instanceof AbortSignal)||status!==(mode==='submit'?'ready':'uncertain'))throw new EnquiryPreviewError('validation');
  const wasUncertain=status==='uncertain';status='sending';
  try{const value=await (mode==='recover'?recover:save)(enquiryId,viewingId,command,signal);
   try{receipt=validateViewingRescheduleReceipt(value,enquiryId,viewingId,command);}catch{throw new EnquiryPreviewError('response',200,mode!=='recover');}
   status='received';return receipt;
  }catch(error){status=wasUncertain||!(error instanceof EnquiryPreviewError)||error.uncertain?'uncertain':'rejected';throw error;}
 }
 return Object.freeze({enquiryId,original,get status(){return status;},get receipt(){return receipt;},submit:(signal?:AbortSignal)=>run('submit',signal),recoverOriginal:(signal?:AbortSignal)=>run('recover',signal),replayOriginal:(signal?:AbortSignal)=>run('replay',signal)});
}
