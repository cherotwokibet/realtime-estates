'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {ViewingDetail,ViewingPage,ViewingSlot} from '@realtor/api-client';
import {createEnquiryPreviewClient,EnquiryPreviewError} from '../lib/enquiry-client';
import {prepareViewingAttempt,type ViewingAttempt} from '../lib/viewing-attempt';
import {formatEnquiryTime,fromNairobiInput} from '../lib/enquiry-model';
import type {EnquiryReadGuard} from '../lib/enquiry-read-guard';

type Props={actor:'admin'|'agent';instanceId:string;enquiryId:string;version:string|null;listingId:string|null;onGuard:(value:boolean)=>void;onAccessDenied:(error:unknown)=>void;readGuard:EnquiryReadGuard};
export default function EnquiryViewings({actor,instanceId,enquiryId,version,listingId,onGuard,onAccessDenied,readGuard}:Props){
 const client=useMemo(()=>createEnquiryPreviewClient({basePath:`/api/enquiry-preview/${actor}`,instanceId}),[actor,instanceId]);
 const [notes,setNotes]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState('');
 const [selected,setSelected]=useState<ViewingDetail|null>(null),[attempt,setAttempt]=useState<ViewingAttempt|null>(null);
 const original=useRef<ViewingAttempt|null>(null),lock=useRef(false),alive=useRef(true);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[page,setPage]=useState<ViewingPage|null>(null);
 const [reading,setReading]=useState(false),[readError,setReadError]=useState(false);
 const generation=useRef(0),reader=useRef<AbortController|null>(null);
 function deny(error:unknown){if(error instanceof EnquiryPreviewError&&[401,403,404].includes(error.status)){generation.current++;reader.current?.abort();setPage(null);setReading(false);setReadError(true);onAccessDenied(error);}}
 async function refresh(){
  const turn=++generation.current;reader.current?.abort();const controller=new AbortController();reader.current=controller;const mayApply=readGuard.capture();
  setPage(null);setReadError(false);setReading(true);
  try{const value=await client.viewings(enquiryId,controller.signal);if(alive.current&&turn===generation.current&&mayApply())setPage(value);}
  catch(error){if(alive.current&&turn===generation.current){setReadError(true);deny(error);}}
  finally{if(alive.current&&turn===generation.current)setReading(false);}
 }
 useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false;generation.current++;reader.current?.abort();};},[client,enquiryId]);
 function slot():ViewingSlot{
  const value={startAt:fromNairobiInput(start),endAt:fromNairobiInput(end),timeZone:'Africa/Nairobi' as const};
  if(Date.parse(value.startAt)<=Date.now())throw new Error('Choose a future viewing time.');
  const duration=Date.parse(value.endAt)-Date.parse(value.startAt);
  if(duration<15*60*1000||duration>4*60*60*1000)throw new Error('Choose a duration from 15 minutes to 4 hours.');
  return value;
 }
 async function run(mode:'submit'|'recover'|'replay'){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   let captured=original.current;
   if(mode==='submit'){
    if(captured||!version||!selected&&!listingId)throw new EnquiryPreviewError('validation');
    captured=prepareViewingAttempt(client,enquiryId,selected
     ?{kind:'propose',viewingId:selected.schedule.viewingId,command:{operationId:crypto.randomUUID(),expectedVersion:selected.schedule.version,slot:slot()}}
     :{kind:'request',command:{operationId:crypto.randomUUID(),expectedEnquiryVersion:version,listingId:listingId!,notes,preferredSlots:start||end?[slot()]:[]}});
    original.current=captured;setAttempt(captured);onGuard(true);
   }
   if(!captured)throw new EnquiryPreviewError('validation');
   await (mode==='submit'?captured.submit():mode==='recover'?captured.recoverOriginal():captured.replayOriginal());
  }catch(error){if(alive.current){setError(error instanceof Error?error.message:'Viewing request unavailable.');deny(error);}}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 function clear(){
  if(lock.current||original.current?.status==='uncertain'||original.current?.status==='sending')return;
  original.current=null;setAttempt(null);setSelected(null);setNotes('');setStart('');setEnd('');setError('');onGuard(false);
 }
 function choose(item:ViewingDetail){if(lock.current||original.current||notes||start||end||selected)return;setSelected(item);onGuard(true);}
 const uncertain=attempt?.status==='uncertain',receipt=attempt?.receipt;
 return <section className="enq-contacts" aria-label="Viewing scheduling">
  <h3>{selected?'Propose a viewing time':'Request a viewing'}</h3>
  <p className="enq-subtle">Synthetic scheduling preview. A proposal awaits customer agreement. Saving sends no invitation and does not confirm an appointment or reserve staff time.</p>
  <p className="enq-warning">Input and original operations stay only in this tab. Closing or reloading loses recovery details. Finish or clear this work before switching enquiries or roles.</p>
  {version&&!listingId&&!selected&&<p>New requests currently require a property-linked enquiry. General enquiries need a property selection workflow.</p>}
  {selected&&<p>Selected request {selected.schedule.viewingId} · viewing version {selected.schedule.version}. Refreshing the feed does not replace this selection.</p>}
  <form className="enq-form" onSubmit={event=>{event.preventDefault();void run('submit');}}>
   <fieldset disabled={busy||!!attempt||!version||!selected&&!listingId}><legend className="sr-only">Viewing details</legend>
    {!selected&&<label>Viewing request notes<textarea required rows={3} value={notes} onChange={event=>{setNotes(event.target.value);onGuard(true);}}/><small>{[...notes].length} / 2,000 characters. Original spacing is retained.</small></label>}
    <p>{selected?'Proposed time':'Optional preferred time'} · Nairobi (EAT, UTC+03:00), 15 minutes to 4 hours.</p>
    <label>Viewing start · Nairobi<input type="datetime-local" step="0.001" required={!!selected||!!end} value={start} onInput={event=>{setStart(event.currentTarget.value);onGuard(true);}} onChange={event=>{setStart(event.target.value);onGuard(true);}}/></label>
    <label>Viewing end · Nairobi<input type="datetime-local" step="0.001" required={!!selected||!!start} value={end} onInput={event=>{setEnd(event.currentTarget.value);onGuard(true);}} onChange={event=>{setEnd(event.target.value);onGuard(true);}}/></label>
    <button type="submit" className="enq-primary">{selected?'Save viewing proposal':'Save viewing request'}</button>
   </fieldset>
  </form>
  {error&&<p role="alert" className="enq-error">{error}</p>}{busy&&<p role="status">Viewing operation in progress…</p>}
  {attempt&&<div className="enq-recovery"><h4>{receipt?(receipt.outcome==='applied'?(receipt.result.status==='requested'?'Viewing requested':'Time proposed · awaiting customer agreement'):receipt.outcome==='conflict'?'Version conflict · viewing unchanged':'Viewing change refused'):uncertain?'Viewing result uncertain':attempt.status==='rejected'?'Viewing request rejected':'Viewing operation in progress'}</h4>
   <p>Original operation {attempt.original.command.operationId}. Its result never updates your working enquiry version or selected viewing.</p>
   {receipt&&<p>{receipt.reason??'Refresh the viewing feed to read the saved schedule.'} {receipt.outcome!=='applied'&&'Finish this original attempt, check current details, then deliberately prepare new work.'}</p>}
   {uncertain&&<><p>A failed recovery read does not prove the save failed. No automatic retry occurs.</p><button type="button" className="enq-secondary" disabled={busy} onClick={()=>void run('recover')}>Read original viewing result</button><button type="button" className="enq-secondary" disabled={busy} onClick={()=>void run('replay')}>Replay exact original viewing save</button></>}
   <details><summary>Original viewing operation kept in this tab</summary><pre>{JSON.stringify(attempt.original,null,2)}</pre></details>
  </div>}
  <button type="button" className="enq-secondary" disabled={busy||uncertain} onClick={clear}>{receipt?'Finish and clear local viewing input':'Discard local viewing input'}</button>
  <div className="enq-section-heading"><h3>Viewing requests and proposals</h3><button type="button" className="enq-secondary" disabled={reading} onClick={()=>void refresh()}>Refresh viewing feed</button></div>
  {reading&&<p role="status">Loading viewings…</p>}{readError&&<p role="alert">Viewing feed unavailable for current access. Refresh to try a new read.</p>}
  {version&&page&&<><p className="enq-subtle">{page.items.length} shown · {page.truncated?'older records remain':'end of visible slice'} · latest 25 maximum. Times shown in Nairobi.</p><ol className="enq-activity">{page.items.map(item=><li key={item.schedule.viewingId}>
   <strong>{item.schedule.status==='requested'?'Requested':'Proposed · awaiting customer agreement'}</strong><span>Viewing {item.schedule.viewingId} · version {item.schedule.version}</span><span>Requested by staff {item.requestedById} · {formatEnquiryTime(item.createdAt)}</span>
   <p className="enq-contact-notes">{item.notes}</p>
   {item.schedule.preferredSlots.map((slot,index)=><span key={index}>Preferred: {formatEnquiryTime(slot.startAt)} – {formatEnquiryTime(slot.endAt)}</span>)}
   {item.schedule.proposedSlot&&<span>Proposed: {formatEnquiryTime(item.schedule.proposedSlot.startAt)} – {formatEnquiryTime(item.schedule.proposedSlot.endAt)}</span>}
   {item.schedule.status==='requested'&&<button type="button" className="enq-secondary" disabled={busy||!!attempt||!!selected||!!notes||!!start||!!end} onClick={()=>choose(item)}>Prepare proposal for this request</button>}
  </li>)}</ol>{!page.items.length&&<p>No viewings in this visible slice.</p>}</>}
 </section>;
}
