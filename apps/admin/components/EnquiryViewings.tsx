'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {ViewingDetail,ViewingPage,ViewingSlot,ViewingHistoryPage} from '@realtor/api-client';
import {createEnquiryPreviewClient,EnquiryPreviewError} from '../lib/enquiry-client';
import {prepareViewingAttempt,type ViewingAttempt} from '../lib/viewing-attempt';
import {prepareViewingTerminationAttempt,type ViewingTerminationAttempt} from '../lib/viewing-termination-attempt';
import {prepareViewingConfirmationAttempt,type ViewingConfirmationAttempt} from '../lib/viewing-confirmation-attempt';
import {formatEnquiryTime,fromNairobiInput} from '../lib/enquiry-model';
import type {EnquiryReadGuard} from '../lib/enquiry-read-guard';
import type {ViewingPropertyChoice,ViewingPropertyPage} from '../lib/viewing-properties';

type Props={actor:'admin'|'agent';instanceId:string;enquiryId:string;version:string|null;listingId:string|null;onGuard:(value:boolean)=>void;onAccessDenied:(error:unknown)=>void;readGuard:EnquiryReadGuard};
type LocalAttempt=ViewingAttempt|ViewingConfirmationAttempt|ViewingTerminationAttempt;
const viewingStatusText:Record<ViewingDetail['schedule']['status'],string>={requested:'Requested',proposed:'Proposed · awaiting customer agreement',confirmed:'Confirmed · phone agreement recorded',cancelled:'Cancelled',declined:'Declined'};
const refusalText:Record<string,string>={VERSION_CONFLICT:'This viewing or enquiry changed since your selected version.',ENQUIRY_CLOSED:'This enquiry has closed. Check current details before scheduling.',LISTING_MISMATCH:'The enquiry is linked to a different property.',LISTING_UNAVAILABLE:'This property is no longer eligible for a new viewing change.',INVALID_STATE:'This viewing is no longer at the stage required for this action.',SLOT_NOT_FUTURE:'The viewing time has already started or passed.',PROPOSED_SLOT_MISMATCH:'The agreement must refer to the exact current proposed time.',AGREEMENT_BEFORE_PROPOSAL:'Phone agreement must be recorded at or after this proposal.',AGREEMENT_IN_FUTURE:'Phone agreement cannot be in the future.',RECORD_TIME_IN_FUTURE:'The saved viewing time is ahead of the service clock. Check the record before preparing new work.'};
export default function EnquiryViewings({actor,instanceId,enquiryId,version,listingId,onGuard,onAccessDenied,readGuard}:Props){
 const client=useMemo(()=>createEnquiryPreviewClient({basePath:`/api/enquiry-preview/${actor}`,instanceId}),[actor,instanceId]);
 const [notes,setNotes]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState('');
 const [selected,setSelected]=useState<ViewingDetail|null>(null),[attempt,setAttempt]=useState<LocalAttempt|null>(null);
 const [selectedAction,setSelectedAction]=useState<'propose'|'confirm'|'cancel'|'decline'>('propose'),[agreed,setAgreed]=useState(''),[phoneAccepted,setPhoneAccepted]=useState(false);
 const [properties,setProperties]=useState<ViewingPropertyPage|null>(null),[property,setProperty]=useState<ViewingPropertyChoice|null>(null);
 const [propertyBusy,setPropertyBusy]=useState(false),[propertyError,setPropertyError]=useState(false);
 const propertyGeneration=useRef(0),propertyReader=useRef<AbortController|null>(null);
 const original=useRef<LocalAttempt|null>(null),lock=useRef(false),alive=useRef(true);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[page,setPage]=useState<ViewingPage|null>(null);
 const [savedHistory,setSavedHistory]=useState<ViewingHistoryPage|null>(null),[historyTarget,setHistoryTarget]=useState<string|null>(null),[historyBusy,setHistoryBusy]=useState(false),[historyError,setHistoryError]=useState(false);
 const historyGeneration=useRef(0),historyReader=useRef<AbortController|null>(null);
 const [reading,setReading]=useState(false),[readError,setReadError]=useState(false);
 const generation=useRef(0),reader=useRef<AbortController|null>(null);
 function deny(error:unknown){if(error instanceof EnquiryPreviewError&&[401,403,404].includes(error.status)){generation.current++;reader.current?.abort();setPage(null);setReading(false);setReadError(true);historyGeneration.current++;historyReader.current?.abort();setSavedHistory(null);setHistoryBusy(false);onAccessDenied(error);}}
 async function refresh(){
  const turn=++generation.current;reader.current?.abort();const controller=new AbortController();reader.current=controller;const mayApply=readGuard.capture();
  setPage(null);setReadError(false);setReading(true);
  try{const value=await client.viewings(enquiryId,controller.signal);if(alive.current&&turn===generation.current&&mayApply())setPage(value);}
  catch(error){if(alive.current&&turn===generation.current){setReadError(true);deny(error);}}
  finally{if(alive.current&&turn===generation.current)setReading(false);}
 }
 useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false;generation.current++;reader.current?.abort();};},[client,enquiryId]);
 async function loadHistory(target:string){
  const turn=++historyGeneration.current;historyReader.current?.abort();const controller=new AbortController();historyReader.current=controller;const mayApply=readGuard.capture();
  setHistoryTarget(target);setSavedHistory(null);setHistoryError(false);setHistoryBusy(true);
  try{const value=await client.viewingHistory(enquiryId,target,controller.signal);if(alive.current&&turn===historyGeneration.current&&mayApply())setSavedHistory(value);}
  catch(error){if(alive.current&&turn===historyGeneration.current){setHistoryError(true);deny(error);}}
  finally{if(alive.current&&turn===historyGeneration.current)setHistoryBusy(false);}
 }
 useEffect(()=>{historyGeneration.current++;historyReader.current?.abort();setSavedHistory(null);setHistoryTarget(null);setHistoryBusy(false);return()=>{historyGeneration.current++;historyReader.current?.abort();};},[client,enquiryId]);
 useEffect(()=>{if(!version){historyGeneration.current++;historyReader.current?.abort();setSavedHistory(null);setHistoryBusy(false);}},[version]);
 async function refreshProperties(){
  const turn=++propertyGeneration.current;propertyReader.current?.abort();const controller=new AbortController();propertyReader.current=controller;const mayApply=readGuard.capture();
  setProperties(null);setPropertyBusy(true);setPropertyError(false);
  try{const value=await client.viewingProperties(controller.signal);if(alive.current&&turn===propertyGeneration.current&&mayApply())setProperties(value);}
  catch(error){if(alive.current&&turn===propertyGeneration.current){setPropertyError(true);deny(error);}}
  finally{if(alive.current&&turn===propertyGeneration.current)setPropertyBusy(false);}
 }
 useEffect(()=>{if(version&&!listingId)void refreshProperties();return()=>{propertyGeneration.current++;propertyReader.current?.abort();};},[client,version,listingId]);
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
    if(captured||!version||!selected&&!listingId&&!property)throw new EnquiryPreviewError('validation');
    if(selected&&(selectedAction==='cancel'||selectedAction==='decline')){
     captured=prepareViewingTerminationAttempt(client,enquiryId,selected.schedule.viewingId,selectedAction,{operationId:crypto.randomUUID(),expectedVersion:selected.schedule.version,reason:notes});
    }else if(selected&&selectedAction==='confirm'){
     if(!phoneAccepted||selected.schedule.status!=='proposed'||!selected.schedule.proposedSlot)throw new Error('Select a proposal and record phone agreement to that exact time.');
     const agreedAt=fromNairobiInput(agreed);
     if(Date.parse(agreedAt)>Date.now()||agreedAt<selected.updatedAt)throw new Error('Agreement time must be between this proposal being recorded and now.');
     captured=prepareViewingConfirmationAttempt(client,enquiryId,selected.schedule.viewingId,{operationId:crypto.randomUUID(),expectedVersion:selected.schedule.version,slot:selected.schedule.proposedSlot,channel:'phone',agreedAt,notes});
    }else captured=prepareViewingAttempt(client,enquiryId,selected
      ?{kind:'propose',viewingId:selected.schedule.viewingId,command:{operationId:crypto.randomUUID(),expectedVersion:selected.schedule.version,slot:slot()}}
      :{kind:'request',command:{operationId:crypto.randomUUID(),expectedEnquiryVersion:version,listingId:listingId??property!.id,notes,preferredSlots:start||end?[slot()]:[]}});
    original.current=captured;setAttempt(captured);onGuard(true);
   }
   if(!captured)throw new EnquiryPreviewError('validation');
   await (mode==='submit'?captured.submit():mode==='recover'?captured.recoverOriginal():captured.replayOriginal());
  }catch(error){if(alive.current){setError(error instanceof Error?error.message:'Viewing request unavailable.');deny(error);}}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 function clear(){
  if(lock.current||original.current?.status==='uncertain'||original.current?.status==='sending')return;
  original.current=null;setAttempt(null);setSelected(null);setSelectedAction('propose');setAgreed('');setPhoneAccepted(false);setProperty(null);setNotes('');setStart('');setEnd('');setError('');onGuard(false);
 }
 function choose(item:ViewingDetail,action:'propose'|'confirm'|'cancel'|'decline'){if(lock.current||original.current||notes||start||end||selected||property||agreed)return;setSelected(item);setSelectedAction(action);onGuard(true);}
 const uncertain=attempt?.status==='uncertain',receipt=attempt?.receipt,ending=!!selected&&(selectedAction==='cancel'||selectedAction==='decline');
 return <section className="enq-contacts" aria-label="Viewing scheduling">
  <h3>{selected?(ending?(selectedAction==='cancel'?'Cancel this viewing':'Decline this viewing'):selectedAction==='confirm'?'Record phone agreement and confirm':'Propose a viewing time'):'Request a viewing'}</h3>
  <p className="enq-subtle">Synthetic scheduling preview. A proposal awaits customer agreement. Confirmation requires completed phone agreement to the exact proposed time. Saving sends no invitation or reminder and does not reserve staff time.</p>
  <p className="enq-warning">Input and original operations stay only in this tab. Closing or reloading loses recovery details. Finish or clear this work before switching enquiries or roles.</p>
  {version&&!listingId&&!selected&&<div>
   <label>Property for this viewing<select disabled={busy||!!attempt||propertyBusy} value={property?.id??''} onChange={event=>{if(lock.current||original.current)return;const choice=properties?.items.find(item=>item.id===event.target.value)??null;setProperty(choice);onGuard(true);}}>
    <option value="">Choose a property</option>{property&&!properties?.items.some(item=>item.id===property.id)&&<option value={property.id}>{property.title} · retained selection, check availability</option>}
    {properties?.items.map(item=><option key={item.id} value={item.id}>{item.title} · {item.locality} · {item.purpose==='rent'?'Rent':'Buy'}</option>)}
   </select></label>
   <button type="button" className="enq-secondary" disabled={propertyBusy||busy} onClick={()=>void refreshProperties()}>Refresh property choices</button>
   {propertyBusy&&<p role="status">Loading eligible property choices…</p>}{propertyError&&<p role="alert">Property choices unavailable. Try a fresh read.</p>}
   {properties&&<p className="enq-subtle">{properties.items.length} public properties loaded{properties.mayBeTruncated?' · more may exist':''}. Availability is checked again when saving. Refreshing choices does not replace your selection.</p>}
   {property&&<p>Selected property: {property.title}. This applies to this viewing request and does not change the general enquiry.</p>}
  </div>}
  {selected&&<p>Selected {ending?'viewing':selectedAction==='confirm'?'proposal':'request'} {selected.schedule.viewingId} · viewing version {selected.schedule.version}. Refreshing the feed does not replace this selection.</p>}
  <form className="enq-form" onSubmit={event=>{event.preventDefault();void run('submit');}}>
   <fieldset disabled={busy||!!attempt||!version||!selected&&!listingId&&!property}><legend className="sr-only">Viewing details</legend>
    {(!selected||selectedAction==='confirm'||ending)&&<label>{ending?'Reason for ending this viewing':selected?'Phone agreement notes':'Viewing request notes'}<textarea required rows={3} value={notes} onChange={event=>{setNotes(event.target.value);onGuard(true);}}/><small>{[...notes].length} / {ending?'1,000':'2,000'} characters. Original spacing is retained.</small></label>}
    {ending?<><p>This records an explicit {selectedAction==='cancel'?'cancellation':'decline'} from {selected!.schedule.status}. Saved evidence remains in history, including any previous slot and phone agreement. Saving sends no customer message.</p>{selected!.schedule.proposedSlot&&<p>Previous time: {formatEnquiryTime(selected!.schedule.proposedSlot.startAt)} – {formatEnquiryTime(selected!.schedule.proposedSlot.endAt)}</p>}</>:selected&&selectedAction==='confirm'?<>
     <p>Exact proposed time: {formatEnquiryTime(selected.schedule.proposedSlot?.startAt??null)} – {formatEnquiryTime(selected.schedule.proposedSlot?.endAt??null)}</p>
     <p>Proposal recorded: {formatEnquiryTime(selected.updatedAt)}. This confirmation cannot change the slot.</p>
     <label>Phone agreement time · Nairobi<input type="datetime-local" step="0.001" required value={agreed} onInput={event=>{setAgreed(event.currentTarget.value);onGuard(true);}} onChange={event=>{setAgreed(event.target.value);onGuard(true);}}/></label>
     <label className="enq-agreement-check"><input type="checkbox" required checked={phoneAccepted} onChange={event=>{setPhoneAccepted(event.target.checked);onGuard(true);}}/>I recorded the customer's agreement to this exact time by phone.</label>
    </>:<>
     <p>{selected?'Proposed time':'Optional preferred time'} · Nairobi (EAT, UTC+03:00), 15 minutes to 4 hours.</p>
     <label>Viewing start · Nairobi<input type="datetime-local" step="0.001" required={!!selected||!!end} value={start} onInput={event=>{setStart(event.currentTarget.value);onGuard(true);}} onChange={event=>{setStart(event.target.value);onGuard(true);}}/></label>
     <label>Viewing end · Nairobi<input type="datetime-local" step="0.001" required={!!selected||!!start} value={end} onInput={event=>{setEnd(event.currentTarget.value);onGuard(true);}} onChange={event=>{setEnd(event.target.value);onGuard(true);}}/></label>
    </>}
    <button type="submit" className="enq-primary">{selected?(ending?(selectedAction==='cancel'?'Save reasoned cancellation':'Save reasoned decline'):selectedAction==='confirm'?'Confirm agreed viewing time':'Save viewing proposal'):'Save viewing request'}</button>
   </fieldset>
  </form>
  {error&&<p role="alert" className="enq-error">{error}</p>}{busy&&<p role="status">Viewing operation in progress…</p>}
  {attempt&&<div className="enq-recovery"><h4>{receipt?(receipt.outcome==='applied'?(receipt.result.status==='cancelled'?'Viewing cancelled':receipt.result.status==='declined'?'Viewing declined':receipt.result.status==='requested'?'Viewing requested':receipt.result.status==='confirmed'?'Viewing confirmed · phone agreement recorded':'Time proposed · awaiting customer agreement'):receipt.outcome==='conflict'?'Version conflict · viewing unchanged':'Viewing change refused'):uncertain?'Viewing result uncertain':attempt.status==='rejected'?'Viewing request rejected':'Viewing operation in progress'}</h4>
   <p>Original operation {attempt.original.command.operationId}. This historical result leaves your working enquiry and selected viewing versions unchanged.</p>
   {receipt&&<p>{receipt.reason?refusalText[receipt.reason]:'Refresh the viewing feed to read the saved schedule.'} {receipt.outcome!=='applied'&&'Finish this original attempt, check current details, then deliberately prepare new work.'}</p>}
   {uncertain&&<><p>A failed recovery read does not prove the save failed. No automatic retry occurs.</p><button type="button" className="enq-secondary" disabled={busy} onClick={()=>void run('recover')}>Read original viewing result</button><button type="button" className="enq-secondary" disabled={busy} onClick={()=>void run('replay')}>Replay exact original viewing save</button></>}
   <details><summary>Original viewing operation kept in this tab</summary><pre>{JSON.stringify(attempt.original,null,2)}</pre></details>
  </div>}
  <button type="button" className="enq-secondary" disabled={busy||uncertain} onClick={clear}>{receipt?'Finish and clear local viewing input':'Discard local viewing input'}</button>
  <div className="enq-section-heading"><h3>Viewing history</h3><button type="button" className="enq-secondary" disabled={reading} onClick={()=>void refresh()}>Refresh viewing feed</button></div>
  {reading&&<p role="status">Loading viewings…</p>}{readError&&<p role="alert">Viewing feed unavailable for current access. Refresh to try a new read.</p>}
  {version&&page&&<><p className="enq-subtle">{page.items.length} shown · {page.truncated?'older records remain':'end of visible slice'} · latest 25 maximum. Times shown in Nairobi.</p><ol className="enq-activity">{page.items.map(item=><li key={item.schedule.viewingId}>
   <strong>{viewingStatusText[item.schedule.status]}</strong><span>Viewing {item.schedule.viewingId} · version {item.schedule.version}</span><span>Requested by staff {item.requestedById} · {formatEnquiryTime(item.createdAt)}</span>
   <p className="enq-contact-notes">{item.notes}</p>
   {item.schedule.preferredSlots.map((slot,index)=><span key={index}>Preferred: {formatEnquiryTime(slot.startAt)} – {formatEnquiryTime(slot.endAt)}</span>)}
   {item.schedule.proposedSlot&&<span>{item.schedule.termination?'Previous agreed/proposed time':item.schedule.status==='confirmed'?'Confirmed':'Proposed'}: {formatEnquiryTime(item.schedule.proposedSlot.startAt)} – {formatEnquiryTime(item.schedule.proposedSlot.endAt)}</span>}
   {item.schedule.agreement&&item.confirmation&&<><span>Phone agreement: {formatEnquiryTime(item.schedule.agreement.agreedAt)} · recorded by staff {item.confirmation.recordedById} at {formatEnquiryTime(item.confirmation.recordedAt)}</span><p className="enq-contact-notes">{item.schedule.agreement.notes}</p></>}
   {item.schedule.termination&&item.terminationRecord&&<><span>{viewingStatusText[item.schedule.status]} from {item.schedule.termination.fromStatus} · {formatEnquiryTime(item.schedule.termination.endedAt)} · recorded by staff {item.terminationRecord.recordedById}</span><p className="enq-contact-notes">{item.schedule.termination.reason}</p></>}
   <button type="button" className="enq-secondary" disabled={historyBusy} onClick={()=>void loadHistory(item.schedule.viewingId)}>Read saved history for this viewing</button>
   {['requested','proposed','confirmed'].includes(item.schedule.status)&&<button type="button" className="enq-secondary" disabled={busy||!!attempt||!!selected||!!property||!!notes||!!start||!!end} onClick={()=>choose(item,'cancel')}>Prepare cancellation for this viewing</button>}
   {['requested','proposed'].includes(item.schedule.status)&&<button type="button" className="enq-secondary" disabled={busy||!!attempt||!!selected||!!property||!!notes||!!start||!!end} onClick={()=>choose(item,'decline')}>Prepare decline for this viewing</button>}
   {item.schedule.status==='requested'&&<button type="button" className="enq-secondary" disabled={busy||!!attempt||!!selected||!!property||!!notes||!!start||!!end} onClick={()=>choose(item,'propose')}>Prepare proposal for this request</button>}
   {item.schedule.status==='proposed'&&<button type="button" className="enq-secondary" disabled={busy||!!attempt||!!selected||!!property||!!notes||!!start||!!end} onClick={()=>choose(item,'confirm')}>Record phone agreement for this proposal</button>}
  </li>)}</ol>{!page.items.length&&<p>No viewings in this visible slice.</p>}</>}
  {historyTarget&&<section aria-label="Saved viewing history"><div className="enq-section-heading"><h3>Saved viewing history</h3><button type="button" className="enq-secondary" disabled={historyBusy} onClick={()=>void loadHistory(historyTarget)}>Refresh saved viewing history</button></div>
   <p className="enq-subtle">Viewing {historyTarget}. Saved states only; this read does not replace selected input or its working version.</p>
   {historyBusy&&<p role="status">Loading saved viewing history…</p>}{historyError&&<p role="alert">Saved viewing history unavailable for current access. Try a fresh authorized read.</p>}
   {version&&savedHistory&&<><p>{savedHistory.items.length} saved states shown · viewing version at this read {savedHistory.currentVersion} · {savedHistory.truncated?'earlier states remain':'start of retained history'}.</p><ol className="enq-activity">{savedHistory.items.map(item=><li key={item.schedule.version}>
    <strong>{viewingStatusText[item.schedule.status]} · saved version {item.schedule.version}</strong><span>Recorded by staff {item.actorId} · {formatEnquiryTime(item.recordedAt)}</span>
    {item.schedule.proposedSlot&&<span>Saved slot: {formatEnquiryTime(item.schedule.proposedSlot.startAt)} – {formatEnquiryTime(item.schedule.proposedSlot.endAt)}</span>}
    {item.schedule.agreement&&<><span>Phone agreement: {formatEnquiryTime(item.schedule.agreement.agreedAt)}</span><p className="enq-contact-notes">{item.schedule.agreement.notes}</p></>}
    {item.schedule.termination&&<><span>Ended from {item.schedule.termination.fromStatus}</span><p className="enq-contact-notes">{item.schedule.termination.reason}</p></>}
   </li>)}</ol></>}
  </section>}
 </section>;
}
