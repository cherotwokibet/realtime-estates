'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {ContactChannel,ContactOutcome,ContactPage} from '@realtor/api-client';
import {createEnquiryPreviewClient,EnquiryPreviewError} from '../lib/enquiry-client';
import {prepareContactAttempt,type ContactAttempt} from '../lib/contact-attempt';
import {formatEnquiryTime,fromNairobiInput} from '../lib/enquiry-model';

const channels:Record<ContactChannel,string>={call:'Call',whatsapp:'WhatsApp',email:'Email',in_person:'In person',other:'Other'};
const outcomes:Record<ContactOutcome,string>={connected:'Connected',no_response:'No response',left_message:'Left a message',wrong_contact:'Wrong contact',other:'Other'};
type Props={actor:'admin'|'agent';instanceId:string;enquiryId:string;version:string|null;onGuard:(guard:boolean)=>void;onAccessDenied:(error:unknown)=>void};
export default function EnquiryContacts({actor,instanceId,enquiryId,version,onGuard,onAccessDenied}:Props){
 const client=useMemo(()=>createEnquiryPreviewClient({basePath:`/api/enquiry-preview/${actor}`,instanceId}),[actor,instanceId]);
 const [channel,setChannel]=useState<ContactChannel>('call'),[outcome,setOutcome]=useState<ContactOutcome>('connected');
 const [occurred,setOccurred]=useState(''),[notes,setNotes]=useState(''),[attempt,setAttempt]=useState<ContactAttempt|null>(null);
 const original=useRef<ContactAttempt|null>(null),lock=useRef(false),alive=useRef(true);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[page,setPage]=useState<ContactPage|null>(null);
 const [reading,setReading]=useState(false),[readError,setReadError]=useState(false);
 const generation=useRef(0),reader=useRef<AbortController|null>(null);
 function guard(){onGuard(true);}
 async function refresh(){
  const turn=++generation.current;reader.current?.abort();const controller=new AbortController();reader.current=controller;
  setPage(null);setReadError(false);setReading(true);
  try{const value=await client.contacts(enquiryId,controller.signal);if(alive.current&&turn===generation.current)setPage(value);}
  catch(error){if(alive.current&&turn===generation.current){setReadError(true);if(error instanceof EnquiryPreviewError&&[401,403,404].includes(error.status))onAccessDenied(error);}}
  finally{if(alive.current&&turn===generation.current)setReading(false);}
 }
 useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false;generation.current++;reader.current?.abort();};},[client,enquiryId]);
 async function run(mode:'submit'|'recover'|'replay'){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   let captured=original.current;
   if(mode==='submit'){
    if(captured||!version)throw new EnquiryPreviewError('validation');
    const occurredAt=fromNairobiInput(occurred);
    if(Date.parse(occurredAt)>Date.now())throw new Error('Contact time must be now or in the past.');
    captured=prepareContactAttempt(client,enquiryId,{operationId:crypto.randomUUID(),expectedVersion:version,channel,outcome,occurredAt,notes});
    original.current=captured;setAttempt(captured);guard();
   }
   if(!captured)throw new EnquiryPreviewError('validation');
   await (mode==='submit'?captured.submit():mode==='recover'?captured.recoverOriginal():captured.replayOriginal());
  }catch(e){if(alive.current){
   setError(e instanceof Error?e.message:'Contact request unavailable.');
   if(e instanceof EnquiryPreviewError&&[401,403,404].includes(e.status)){generation.current++;reader.current?.abort();setPage(null);setReading(false);setReadError(true);onAccessDenied(e);}
  }}finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 function discard(){
  if(lock.current||original.current?.status==='uncertain'||original.current?.status==='sending')return;
  original.current=null;setAttempt(null);setNotes('');setOccurred('');setChannel('call');setOutcome('connected');setError('');onGuard(false);
 }
 const uncertain=attempt?.status==='uncertain',receipt=attempt?.receipt;
 return <section className="enq-contacts" aria-label="Contact log">
  <h3>Record completed contact</h3><p className="enq-subtle">Log work already done using fictional details. Saving sends no call, WhatsApp or email and changes no enquiry status or working version.</p>
  <p className="enq-warning">Input and the original save are kept only in this tab. Reloading or closing loses recovery details. Finish this record before switching enquiries or roles.</p>
  <form className="enq-form" onSubmit={e=>{e.preventDefault();void run('submit');}}>
   <fieldset disabled={busy||!!attempt||!version}><legend className="sr-only">Completed contact details</legend>
    <label>Contact channel<select value={channel} onChange={e=>{setChannel(e.target.value as ContactChannel);guard();}}>{Object.entries(channels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
    <label>Contact outcome<select value={outcome} onChange={e=>{setOutcome(e.target.value as ContactOutcome);guard();}}>{Object.entries(outcomes).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
    <label>Contact time · Nairobi (EAT, UTC+03:00)<input type="datetime-local" step="0.001" required value={occurred} onInput={e=>{setOccurred(e.currentTarget.value);guard();}} onChange={e=>{setOccurred(e.target.value);guard();}}/></label>
    <label>Contact notes<textarea rows={4} required value={notes} onChange={e=>{setNotes(e.target.value);guard();}}/><small>{[...notes].length} / 2,000 characters. Original spacing is retained.</small></label>
    <button type="submit" className="enq-primary">Save completed contact</button>
   </fieldset>
  </form>
  <p className="enq-subtle">Working enquiry version: {version??'unavailable'}. Refreshing the contact feed does not adopt a workflow version.</p>
  {error&&<p role="alert" className="enq-error">{error}</p>}
  {busy&&<p role="status">Contact request in progress…</p>}
  {attempt&&<div className="enq-recovery"><h4>{receipt?(receipt.outcome==='applied'?'Contact recorded':'Version conflict · contact not recorded'):uncertain?'Contact result uncertain':attempt.status==='rejected'?'Contact request refused':'Contact request in progress'}</h4>
   <p>Original operation {attempt.command.operationId} · original version {attempt.command.expectedVersion}</p>
   {receipt&&<p>Original result observed version {receipt.observedVersion}. This historical receipt does not update your working version. {receipt.outcome==='conflict'?'Use the current enquiry comparison above before preparing another contact record.':'Refresh the contact feed below to see saved records.'}</p>}
   {uncertain&&<><p>A failed or missing recovery read does not prove the save failed. No automatic retry occurs.</p><button type="button" className="enq-secondary" disabled={busy} onClick={()=>void run('recover')}>Read original contact result</button><button type="button" className="enq-secondary" disabled={busy} onClick={()=>void run('replay')}>Replay exact original contact save</button></>}
   <details><summary>Original contact kept in this tab</summary><pre>{JSON.stringify(attempt.command,null,2)}</pre></details>
  </div>}
  <button type="button" className="enq-secondary" disabled={busy||uncertain} onClick={discard}>{receipt?'Finish and clear local contact input':'Discard local contact input'}</button>
  <div className="enq-section-heading"><h3>Recorded contacts</h3><button type="button" className="enq-secondary" disabled={reading} onClick={()=>void refresh()}>Refresh contact feed</button></div>
  {reading&&<p role="status">Loading contact records…</p>}{readError&&<p role="alert">Contact feed unavailable for current access. Refresh to try a new read.</p>}
  {version&&page&&<><p className="enq-subtle">{page.items.length} records shown · {page.truncated?'older records remain':'end of visible slice'} · latest 25 maximum. Times shown in Nairobi.</p>{!page.items.length&&<p>No contact records in this visible slice.</p>}<ol className="enq-activity">{page.items.map(item=><li key={item.entryId}><strong>{channels[item.channel]} · {outcomes[item.outcome]}</strong><span>Contact time: <time dateTime={item.occurredAt}>{formatEnquiryTime(item.occurredAt)}</time></span><span>Recorded: {formatEnquiryTime(item.recordedAt)} · staff ID {item.actorId}</span><p className="enq-contact-notes">{item.notes}</p></li>)}</ol></>}
 </section>;
}
