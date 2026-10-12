'use client';
import {useEffect,useRef,useState} from 'react';
import {validateStaffDraftWorkspaceV2,type StaffDraftV2,type StaffDraftWorkspaceV2} from '@realtor/api-client';
import DraftGallery,{type GalleryWork} from './DraftGallery';
import PhotoUpload from './PhotoUpload';
import {createRemoveCommand,createReorderCommand,galleryOrder,matchGalleryReceipt,moveGalleryPhoto,sameGalleryOrder,workspaceMatchesReceipt} from '../lib/gallery-model';
import {calculateWirePricingV2,kesFromMinor,formatKes,type PricingDisclosure} from '@realtor/domain';
import {draftToForm,formToDraft,formsEqual,reconcileDraft,type DraftForm,type ChargeForm} from '../lib/editor-model';
type Failure={status:number;code:string;uncertain:boolean};
async function requestDraft(path:string,instanceId:string,method='GET',body?:unknown):Promise<unknown>{
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
  try{
  let response:Response;
  try{response=await fetch(path,{method,signal:controller.signal,cache:'no-store',credentials:'same-origin',redirect:'error',headers:{'X-Preview-Instance':instanceId,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
  catch{throw {status:0,code:'NETWORK',uncertain:method!=='GET'} satisfies Failure;}
  let data:unknown;try{data=await response.json();}catch{throw {status:response.status,code:'INVALID_RESPONSE',uncertain:method!=='GET'} satisfies Failure;}
  if(!response.ok){const value=data as {error?:{code?:string};submissionUncertain?:boolean};throw {status:response.status,code:value?.error?.code??'HTTP',uncertain:value?.submissionUncertain===true} satisfies Failure;}
  return data;
  }finally{clearTimeout(timer);}
}
function failureMessage(failure:Failure):string {
  if(failure.status===401||failure.status===403)return 'Access is unavailable or the preview identity expired. Your edits remain in this tab. Restart the local preview to restore synthetic access.';
  if(failure.status===404)return 'This draft is unavailable for this company or agent.';
  if(failure.status===409)return 'The saved version changed. Check the saved version before continuing.';
  if(failure.uncertain)return 'The request may have reached the server. Your edits are retained. Check the saved version before another write.';
  if(failure.status===422||failure.status===400)return 'The server could not accept this draft. Check the fields and submission requirements. Your edits are retained.';
  return 'The service is unavailable. Your edits remain in this tab. Check the saved version when the connection returns.';
}
const label=(key:string)=>key.replace(/([A-Z])/g,' $1').replace(/^./,letter=>letter.toUpperCase());
export default function DraftEditor({listingId,revision,previewInstanceId,photoPreviewEnabled=false}:{listingId:string;revision:number;previewInstanceId:string;photoPreviewEnabled?:boolean}){
  const [baseline,setBaseline]=useState<StaffDraftV2|null>(null),[form,setForm]=useState<DraftForm|null>(null);
  const [workspace,setWorkspace]=useState<StaffDraftWorkspaceV2|null>(null),[order,setOrder]=useState<readonly string[]>([]);
  const [remote,setRemote]=useState<StaffDraftV2|null>(null),[pendingWorkspace,setPendingWorkspace]=useState<StaffDraftWorkspaceV2|null>(null);
  const [busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false),[galleryWork,setGalleryWork]=useState<GalleryWork|null>(null),[removeTarget,setRemoveTarget]=useState<string|null>(null);
  const [message,setMessage]=useState('Loading the assigned draft…'),[error,setError]=useState(false);
  const flight=useRef(false);
  const comparisonHeading=useRef<HTMLHeadingElement>(null);
  const uploadLock=useRef(false);const [uploadActive,setUploadActive]=useState(false),[photoEpoch,setPhotoEpoch]=useState(0);
  const setUploadLock=(locked:boolean)=>{uploadLock.current=locked;setUploadActive(locked);};
  const path=`/api/staff/drafts/${encodeURIComponent(listingId)}/${revision}`;
  const call=(target:string,method='GET',body?:unknown)=>requestDraft(target,previewInstanceId,method,body);
  const readWorkspace=async()=>validateStaffDraftWorkspaceV2(await call(path+'/workspace'),listingId,revision);
  const dirty=!!(form&&baseline&&!formsEqual(form,draftToForm(baseline.content)));
  const orderChanged=!!workspace&&!sameGalleryOrder(order,galleryOrder(workspace));
  const needsRepair=!!workspace&&workspace.photos.some((photo,index)=>photo.position!==index);
  const acquire=()=>{if(flight.current)return false;flight.current=true;setBusy(true);return true;};
  const release=()=>{flight.current=false;setBusy(false);};
  function useSnapshot(saved:StaffDraftWorkspaceV2,keepText=false){
    setUploadLock(false);setPhotoEpoch(value=>value+1);
    setWorkspace(saved);setBaseline(saved.draft);setOrder(galleryOrder(saved));
    if(!keepText)setForm(draftToForm(saved.draft.content));
    setRemote(null);setPendingWorkspace(null);setGalleryWork(null);setRemoveTarget(null);setBlocked(false);setError(false);
  }
  function compareSnapshot(saved:StaffDraftWorkspaceV2){setRemote(saved.draft);setPendingWorkspace(saved);setBlocked(true);setError(true);}
  useEffect(()=>{
    let active=true;flight.current=true;setBusy(true);setBaseline(null);setWorkspace(null);setForm(null);setRemote(null);setPendingWorkspace(null);setGalleryWork(null);setOrder([]);setRemoveTarget(null);setBlocked(false);setError(false);setMessage('Loading the assigned draft…');
    requestDraft(path+'/workspace',previewInstanceId).then(value=>{if(active){const saved=validateStaffDraftWorkspaceV2(value,listingId,revision);useSnapshot(saved);setMessage('Saved draft and photo order loaded.');}}).catch((failure:Failure)=>{if(active){setError(true);setMessage(failureMessage(failure));}}).finally(()=>{if(active)release();});
    return()=>{active=false;};
  },[path,previewInstanceId]);
  useEffect(()=>{
    if(!dirty&&!blocked&&!galleryWork&&!orderChanged&&!uploadActive)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[dirty,blocked,galleryWork,orderChanged,uploadActive]);
  useEffect(()=>{if(remote&&!busy)comparisonHeading.current?.focus();},[remote,busy]);
  async function checkSaved(){
    if(galleryWork||uploadLock.current||!acquire())return;
    try{const saved=await readWorkspace(),draft=saved.draft;
      if(!baseline||!form||!workspace){useSnapshot(saved);setMessage('Saved draft and photo order loaded.');}
      else if(draft.version===baseline.version&&draft.state===baseline.state&&JSON.stringify(saved.photos)===JSON.stringify(workspace.photos)){
        const result=reconcileDraft(baseline,form,draft);
        if(result==='conflict'){compareSnapshot(saved);setMessage('The saved fields differ. Compare before continuing.');}
        else{setBlocked(false);setRemote(null);setPendingWorkspace(null);setMessage('The saved version is unchanged. Your text and photo order edits are retained.');setError(false);}
      }else{compareSnapshot(saved);setMessage('A different version is saved. Compare the text and current photos before continuing. Your edits are retained.');}
    }catch(failure){setMessage(failureMessage(failure as Failure));setError(true);}finally{release();}
  }
  async function write(submit:boolean){
    if(uploadLock.current||!form||!baseline||!workspace||blocked||galleryWork||orderChanged||needsRepair||removeTarget||baseline.state!=='draft'||(submit?dirty:!dirty))return;
    let content:ReturnType<typeof formToDraft>;try{content=formToDraft(form);}catch(failure){setMessage((failure as Error).message);setError(true);return;}
    if(!acquire())return;setError(false);setMessage(submit?'Submitting the saved revision…':'Saving and checking your draft…');
    try{
      const result=await call(path+(submit?'/submit':''),submit?'POST':'PUT',submit?{expectedVersion:baseline.version}:{expectedVersion:baseline.version,content}) as {version:string};
      setBlocked(true);const saved=await readWorkspace(),draft=saved.draft,expectedContent=submit?baseline.content:content;
      if(typeof result?.version!=='string'||draft.version!==result.version||JSON.stringify(formToDraft(draftToForm(draft.content)))!==JSON.stringify(expectedContent)||JSON.stringify(saved.photos)!==JSON.stringify(workspace.photos)){
        compareSnapshot(saved);setMessage('A different version was read after the request. Compare before continuing.');
      }else{useSnapshot(saved);setMessage(submit?'Submission confirmed. This revision is awaiting review.':'Draft saved and read back successfully.');}
    }catch(failure){const failed=failure as Failure;setMessage(failureMessage(failed));setError(true);if(failed.uncertain||failed.status===409||failed.status===401||failed.status===403||!failed.status||failed.status>=500)setBlocked(true);}
    finally{release();}
  }
  async function changeGallery(kind:'remove'|'reorder'){
    if(uploadLock.current||!workspace||blocked||galleryWork||workspace.draft.state!=='draft'||(kind==='remove'&&(orderChanged||needsRepair||!removeTarget))||(kind==='reorder'&&!orderChanged&&!needsRepair))return;
    let command:GalleryWork['command'];
    try{command=kind==='remove'?createRemoveCommand(workspace,removeTarget!,crypto.randomUUID()):createReorderCommand(workspace,order,crypto.randomUUID());}
    catch(failure){setError(true);setMessage((failure as Error).message);return;}
    if(!acquire())return;
    setGalleryWork({command,receipt:null,refused:false});setRemoveTarget(null);setRemote(null);setPendingWorkspace(null);setError(false);setMessage('Sending the photo change once. Your text edits are retained.');
    const body=command.kind==='remove_media'?{operationId:command.operationId,expectedVersion:command.expectedVersion,mediaId:command.mediaId}:{operationId:command.operationId,expectedVersion:command.expectedVersion,orderedIds:command.orderedIds};
    try{const receipt=matchGalleryReceipt(command,await call(path+(kind==='remove'?'/media-removals':'/media-reorders'),'POST',body));setGalleryWork({command,receipt,refused:false});setMessage('Original photo result received. Read the current gallery before continuing.');}
    catch(failure){const failed=failure as Failure,refused=!!failed.status&&failed.status>=400&&failed.status<500&&!failed.uncertain;setGalleryWork({command,receipt:null,refused});setError(true);setMessage(refused?'The photo request was refused. Read the current gallery before continuing.':'The photo request may have reached the server. Check the original photo change before another write.');}
    finally{release();}
  }
  async function recoverGallery(){
    if(!galleryWork||!acquire())return;
    let work=galleryWork;
    try{
      if(!work.receipt&&!work.refused){const receipt=matchGalleryReceipt(work.command,await call(path+'/media-operations/'+encodeURIComponent(work.command.operationId)));work={...work,receipt};setGalleryWork(work);}
      const saved=await readWorkspace();compareSnapshot(saved);
      setMessage(work.receipt&&workspaceMatchesReceipt(saved,work.receipt)?'The original photo result and current gallery agree. Compare below and explicitly continue with this saved version.':'The current saved version is loaded. The original result is historical; compare before continuing.');
    }catch(failure){setError(true);setMessage('The original photo change is still retained. Its result or current gallery could not be verified. Check again when access and the connection return.');}
    finally{release();}
  }
  const update=<K extends keyof DraftForm>(key:K,value:DraftForm[K])=>{if(form)setForm({...form,[key]:value});};
  const changeCharge=(index:number,patch:Partial<ChargeForm>)=>{if(form)update('charges',form.charges.map((charge,i)=>i===index?{...charge,...patch}:charge));};
  const editable=baseline?.state==='draft'&&!busy;
  let costPreview:PricingDisclosure|null=null;
  if(form){try{const content=formToDraft(form);if(content.amountMinor!==null&&content.purpose!==null)costPreview=calculateWirePricingV2(kesFromMinor(content.amountMinor),content.purpose,content.rentPeriod,content.pricing);}catch{/* Invalid/incomplete fields stay editable; no invented total. */}}
  const field=(key:keyof DraftForm,hint?:string,type='text')=><label className="draft-field">{label(key)}<input type={type} value={String(form?.[key]??'')} onChange={event=>update(key,event.target.value as never)} disabled={!editable} autoComplete="off"/>{hint&&<small>{hint}</small>}</label>;
  const select=(key:keyof DraftForm,values:readonly string[],empty=true)=><label className="draft-field">{label(key)}<select value={String(form?.[key]??'')} onChange={event=>update(key,event.target.value as never)} disabled={!editable}>{empty&&<option value="">Not supplied</option>}{values.map(value=><option key={value} value={value}>{label(value.replaceAll('_',' '))}</option>)}</select></label>;
  const differences=remote&&form?Object.entries(draftToForm(remote.content)).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(form[key as keyof DraftForm])):[];
  return <>
    <header className="draft-heading"><div><p className="eyebrow">PROPERTY INFORMATION</p><h1>Shape a clear listing</h1><p>Save your work, check the costs, then send the revision for review.</p></div><div className="draft-state"><span className="status-pill status-neutral">{baseline?.state??'Connecting'}</span><small>Revision {revision}{baseline?` · Version ${baseline.version}`:''}</small></div></header>
    <div className="draft-preview-notice"><strong>Authenticated synthetic agent · local preview</strong><p>{photoPreviewEnabled?'This disposable workspace uses fictional stock and verifies test images locally. Saved image previews, real sign-in and publication are still being built.':'This disposable workspace uses fictional stock. Initial photo records are synthetic metadata fixtures, with no image previews. Real sign-in and publication are still being built. Explicit synthetic photo uploads can be enabled locally.'}</p></div>
    <div className={`draft-message ${error?'draft-message-error':''}`} role="status" aria-live="polite"><p>{message}</p><button type="button" className="draft-secondary" onClick={checkSaved} disabled={busy||!!galleryWork||uploadActive}>Check saved version</button></div>
    {remote&&form&&<section className="draft-conflict" aria-label="Version conflict"><h2 tabIndex={-1} ref={comparisonHeading}>Compare before continuing</h2><p>Your edits are on the left. The saved revision is version {remote.version} ({remote.state}). Keeping your text retains the whole local draft, including unchanged fields. The current saved photos replace any proposed order; review every difference first.</p><div className="draft-compare">{differences.map(([key,value])=><div key={key}><h3>{label(key)}</h3><div><p><strong>Your edits</strong><span>{typeof form[key as keyof DraftForm]==='object'?JSON.stringify(form[key as keyof DraftForm],null,2):String(form[key as keyof DraftForm])||'Not supplied'}</span></p><p><strong>Saved version</strong><span>{typeof value==='object'?JSON.stringify(value,null,2):String(value)||'Not supplied'}</span></p></div></div>)}</div><div className="draft-actions"><button type="button" className="draft-secondary" disabled={busy||!pendingWorkspace} onClick={()=>{if(pendingWorkspace){useSnapshot(pendingWorkspace);setMessage('Current saved text and photos loaded. Local edits were discarded.');}}}>Use current saved text and photos</button><button type="button" className="draft-primary" disabled={busy||!pendingWorkspace||remote.state!=='draft'} onClick={()=>{if(pendingWorkspace){useSnapshot(pendingWorkspace,true);setMessage('Your text edits are retained against the current saved photos and version. Review, then save separately.');}}}>Keep my text edits and use current photos</button></div></section>}
    {form&&baseline&&<form onSubmit={event=>{event.preventDefault();void write(false);}}>
      <div className="draft-layout"><div className="draft-sections">
        <section className="draft-panel"><div className="draft-section-heading"><span>01</span><div><h2>The property</h2><p>Incomplete fields can be saved. Review requires a complete listing.</p></div></div><div className="draft-fields">{field('title')}{select('propertyType',['apartment','bedsitter','studio','bungalow','maisonette','townhouse','villa','commercial','land'])}{select('purpose',['rent','sale'])}{field('locality','Public locality label shown in search results.')}</div><label className="draft-field draft-wide">Description<textarea rows={6} value={form.description} disabled={!editable} onChange={event=>update('description',event.target.value)}/></label><div className="draft-fields draft-three">{field('bedrooms','Zero represents a studio or bedsitter.')}{field('privateBathrooms')}{field('sharedBathrooms')}</div></section>
        <section className="draft-panel"><div className="draft-section-heading"><span>02</span><div><h2>Price &amp; additional costs</h2><p>Keep known amounts and costs to confirm separate.</p></div></div><div className="draft-fields">{field('amount','Base amount in KES. Up to two decimal places.')}{select('rentPeriod',['day','week','month','year'])}{select('declaration',['not_declared','incomplete','complete'],false)}</div><p className="draft-help">A complete declaration describes the supplied charge list. Mandatory amounts marked for a quote still need confirmation. Taxes and all-inclusive totals are not verified.</p>
          <div className="draft-charges">{form.charges.map((charge,index)=><fieldset key={charge.id} disabled={!editable}><legend>Charge {index+1}</legend><div className="draft-fields"><label className="draft-field">Charge name<input value={charge.name} onChange={event=>changeCharge(index,{name:event.target.value})}/></label><label className="draft-field">Amount status<select value={charge.amountStatus} onChange={event=>changeCharge(index,{amountStatus:event.target.value as ChargeForm['amountStatus']})}><option value="known">Known amount</option><option value="quote_required">Amount to confirm</option></select></label>{charge.amountStatus==='known'&&<label className="draft-field">Amount in KES<input value={charge.amount} inputMode="decimal" onChange={event=>changeCharge(index,{amount:event.target.value})}/></label>}<label className="draft-field">Timing<select value={charge.timing} onChange={event=>changeCharge(index,{timing:event.target.value as ChargeForm['timing']})}><option value="one_off">One-off</option><option value="per_rental_period">Per rental period</option></select></label><label className="draft-field">Classification<select value={charge.classification} onChange={event=>changeCharge(index,{classification:event.target.value as ChargeForm['classification']})}><option value="fee">Fee</option><option value="refundable_deposit">Refundable deposit</option></select></label><label className="draft-checkbox"><input type="checkbox" checked={charge.mandatory} onChange={event=>changeCharge(index,{mandatory:event.target.checked})}/>Mandatory charge</label></div><button type="button" className="draft-text-button" onClick={()=>update('charges',form.charges.filter((_,i)=>i!==index))}>Remove charge {index+1}</button></fieldset>)}</div><button type="button" className="draft-secondary" disabled={!editable||form.charges.length>=32} onClick={()=>update('charges',[...form.charges,{id:crypto.randomUUID(),name:'',amountStatus:'known',amount:'',timing:'one_off',classification:'fee',mandatory:true}])}>+ Add a charge</button>
        </section>
        <section className="draft-panel"><div className="draft-section-heading"><span>03</span><div><h2>Location &amp; privacy</h2><p>Only provide details you can verify. Blank structured fields remain unknown.</p></div></div><div className="draft-fields">{field('county')}{field('town')}{field('area')}<label className="draft-field">Private Address<textarea rows={3} value={form.privateAddress} disabled={!editable} onChange={event=>update('privateAddress',event.target.value)}/><small>Staff only. This address never appears in the public API.</small></label>{select('publicPrecision',['area','exact'],false)}{field('latitude')}{field('longitude')}</div><p className="draft-help">Area precision hides coordinates from the public catalogue. Exact precision requires valid coordinates and explicit listing authority.</p></section>
        {workspace&&<DraftGallery workspace={workspace} order={order} busy={busy} blocked={blocked||uploadActive} changed={orderChanged} needsRepair={needsRepair} work={galleryWork} current={pendingWorkspace} removeTarget={removeTarget}
          onMove={(id,direction)=>{if(!flight.current&&!galleryWork&&!blocked&&!uploadLock.current)setOrder(moveGalleryPhoto(order,id,direction));}} onReset={()=>{if(!flight.current&&!galleryWork&&!blocked&&!uploadLock.current)setOrder(galleryOrder(workspace));}} onSave={()=>void changeGallery('reorder')}
          onSelectRemoval={setRemoveTarget} onRemove={()=>void changeGallery('remove')} onRecover={()=>void recoverGallery()}/> }
        {workspace&&<PhotoUpload key={photoEpoch} workspace={workspace} instanceId={previewInstanceId} enabled={photoPreviewEnabled} busy={busy} unavailable={blocked||!!galleryWork||uploadActive||orderChanged||needsRepair||!!removeTarget} onLock={setUploadLock} begin={acquire} end={release} onCompare={async()=>{const saved=await readWorkspace();compareSnapshot(saved);setMessage('Original photo result checked. Compare the current saved photos and text before continuing.');}}/>}
      </div><aside className="draft-side"><section className="draft-panel draft-cost-preview"><p className="eyebrow">COST PREVIEW</p><h2>Known amounts</h2>{costPreview?<><dl>{costPreview.knownMandatory.recurringSubtotal&&<div><dt>Mandatory recurring / {costPreview.rentalPeriod}</dt><dd>{formatKes(costPreview.knownMandatory.recurringSubtotal)}</dd></div>}<div><dt>Refundable deposit</dt><dd>{formatKes(costPreview.knownMandatory.refundableDeposit)}</dd></div><div><dt>Known initial subtotal</dt><dd>{formatKes(costPreview.knownMandatory.initialSubtotal)}</dd></div><div><dt>Known optional extras</dt><dd>{formatKes(costPreview.optionalCosts.knownInitialExtras)}</dd></div></dl><p>{costPreview.hasUnresolvedMandatoryAmounts?'Some mandatory costs remain unconfirmed.':'Declared mandatory amounts supplied.'} Optional quotes and undeclared costs are excluded from these subtotals.</p></>:<p>Complete valid price fields to preview known subtotals.</p>}</section><section className="draft-panel"><p className="eyebrow">WORKING COPY</p><h2>Ready when you are</h2><p className="draft-save-state">{uploadActive?'Resolve the original photo upload before writing':galleryWork?'Resolve the original photo change before writing':blocked?'Compare the saved version before writing':orderChanged||needsRepair?'Save the photo order before continuing':dirty?'Unsaved text changes in this tab':'All changes saved'}</p><p>Recovery retains edits while this tab stays open. Refreshing or closing can lose unsaved work; saved changes stay in this disposable database until the preview stops.</p><button className="draft-primary" type="submit" disabled={!editable||!dirty||blocked||!!galleryWork||uploadActive||orderChanged||needsRepair||!!removeTarget}>Save draft</button><button className="draft-secondary" type="button" disabled={!editable||dirty||blocked||!!galleryWork||uploadActive||orderChanged||needsRepair||!!removeTarget} onClick={()=>void write(true)}>Submit saved revision</button><small>Submission sends this revision to a review queue. It does not publish the property.</small></section><section className="draft-panel draft-review-note"><h3>Before review</h3><ul><li>Confirm title, rooms and locality.</li><li>Check the base price and rental period.</li><li>Declare all mandatory costs.</li><li>Verify 4–12 accepted photos.</li></ul><p>{photoPreviewEnabled?'This preview accepts fictional test images through local verification. Saved image previews and operator acceptance remain separate.':'Photo records in this preview are synthetic SQL fixtures. Image-byte and operator verification remain separate.'}</p></section></aside></div>
    </form>}
    <footer className="draft-footer">Synthetic draft · Credentials remain on the server · No live changes</footer>
  </>;
}
