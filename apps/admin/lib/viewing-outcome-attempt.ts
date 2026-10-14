import {validateViewingOutcomeCommand,validateViewingOutcomeReceipt,type ViewingOutcomeKind,type ViewingOutcomeCommand,type ViewingOutcomeReceipt} from '@realtor/api-client';
import {EnquiryPreviewError,type EnquiryPreviewClient} from './enquiry-client.ts';
export interface ViewingOutcomeAttempt {
 readonly enquiryId:string;readonly original:Readonly<{kind:ViewingOutcomeKind;viewingId:string;command:ViewingOutcomeCommand}>;
 readonly status:'ready'|'sending'|'uncertain'|'received'|'rejected';readonly receipt:ViewingOutcomeReceipt|null;
 submit(signal?:AbortSignal):Promise<ViewingOutcomeReceipt>;
 recoverOriginal(signal?:AbortSignal):Promise<ViewingOutcomeReceipt>;
 replayOriginal(signal?:AbortSignal):Promise<ViewingOutcomeReceipt>;
}
/** Retain this exact selected viewing version and raw outcome reason and occurrence only in memory. */
export function prepareViewingOutcomeAttempt(client:Pick<EnquiryPreviewClient,'recordViewingOutcome'|'recoverViewingOutcome'>,id:string,target:string,kind:ViewingOutcomeKind,input:ViewingOutcomeCommand):ViewingOutcomeAttempt{
 let command:ViewingOutcomeCommand;
 const valid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
 try{if(!valid(id)||!valid(target))throw new Error();if(kind!=='complete'&&kind!=='no_show')throw new Error();command=validateViewingOutcomeCommand(input);}catch{throw new EnquiryPreviewError('validation');}
 const enquiryId=id.toLowerCase(),viewingId=target.toLowerCase(),original=Object.freeze({kind,viewingId,command}),save=client.recordViewingOutcome.bind(client),recover=client.recoverViewingOutcome.bind(client);
 let status:ViewingOutcomeAttempt['status']='ready',receipt:ViewingOutcomeReceipt|null=null;
 async function run(mode:'submit'|'recover'|'replay',signal?:AbortSignal):Promise<ViewingOutcomeReceipt>{
  if(signal!==undefined&&!(signal instanceof AbortSignal)||status!==(mode==='submit'?'ready':'uncertain'))throw new EnquiryPreviewError('validation');
  const wasUncertain=status==='uncertain';status='sending';
  try{const value=await (mode==='recover'?recover:save)(enquiryId,viewingId,kind,command,signal);
   try{receipt=validateViewingOutcomeReceipt(value,enquiryId,viewingId,kind,command);}catch{throw new EnquiryPreviewError('response',200,mode!=='recover');}
   status='received';return receipt;
  }catch(error){status=wasUncertain||!(error instanceof EnquiryPreviewError)||error.uncertain?'uncertain':'rejected';throw error;}
 }
 return Object.freeze({enquiryId,original,get status(){return status;},get receipt(){return receipt;},submit:(signal?:AbortSignal)=>run('submit',signal),recoverOriginal:(signal?:AbortSignal)=>run('recover',signal),replayOriginal:(signal?:AbortSignal)=>run('replay',signal)});
}
