'use client';
import type {MediaOperationReceiptV2,StaffDraftWorkspaceV2} from '@realtor/api-client';
import type {GalleryCommand} from '../lib/gallery-model';

export interface GalleryWork {command:GalleryCommand;receipt:MediaOperationReceiptV2|null;refused:boolean}
interface Props {
  workspace:StaffDraftWorkspaceV2;order:readonly string[];busy:boolean;blocked:boolean;changed:boolean;needsRepair:boolean;
  work:GalleryWork|null;current:StaffDraftWorkspaceV2|null;removeTarget:string|null;
  onMove:(id:string,direction:'up'|'down')=>void;onReset:()=>void;onSave:()=>void;
  onSelectRemoval:(id:string|null)=>void;onRemove:()=>void;onRecover:()=>void;
}
const outcome=(receipt:MediaOperationReceiptV2)=>receipt.outcome==='applied'?(receipt.kind==='remove_media'?'Photo removed from the draft.':'Photo order saved.'):receipt.outcome==='noop'?'The saved order was already the same.':receipt.reason==='VERSION_CONFLICT'?'The saved version changed before this request.':receipt.reason==='REVISION_NOT_DRAFT'?'This revision is no longer a draft.':receipt.reason==='MEDIA_NOT_FOUND'?'The selected photo was already absent.':'The saved photo set changed. Read the current gallery before continuing.';
export default function DraftGallery(props:Props){
  const {workspace,order,busy,blocked,changed,needsRepair,work,current,removeTarget}=props;
  const editable=workspace.draft.state==='draft'&&!busy&&!blocked&&!work;
  const accepted=workspace.photos.filter(photo=>photo.accepted&&photo.provenance==='sealed').length;
  const target=workspace.photos.find(photo=>photo.id===removeTarget);
  return <section className="draft-panel gallery-panel" aria-labelledby="gallery-heading">
    <div className="draft-section-heading"><span>04</span><div><h2 id="gallery-heading">Photos &amp; cover</h2><p>Put the strongest photo first. Save the full order when you are ready.</p></div></div>
    <div className="gallery-summary"><strong>{workspace.photos.length} of 12 photos</strong><span>{accepted} accepted records · 4 required for review</span></div>
    <p className="gallery-fixture">Synthetic photo records. Image previews and adding uploads are not available in this local workspace yet.</p>
    {needsRepair&&<p className="gallery-warning">The saved positions have gaps. Save the complete photo order to repair them before removing a photo.</p>}
    {order.length===0?<div className="gallery-empty"><strong>Your gallery is empty</strong><p>Photo uploads will be connected in the next delivery stage.</p></div>:<ol className="gallery-grid" aria-label="Photo order">{order.map((id,index)=>{
      const photo=workspace.photos.find(item=>item.id===id);if(!photo)return null;
      return <li className="gallery-card" key={id}>
        <div className="gallery-placeholder" aria-label={`Photo ${index+1}: preview unavailable`}><svg viewBox="0 0 48 36" fill="none" aria-hidden="true"><rect x="1" y="1" width="46" height="34" rx="5"/><circle cx="34" cy="11" r="4"/><path d="m2 30 12-14 10 12 7-7 16 13"/></svg><span>Preview unavailable</span>{index===0&&<strong className="gallery-cover">Cover photo</strong>}</div>
        <div className="gallery-card-body"><strong>Photo {index+1}</strong><p>{photo.altText}</p><span className={`gallery-badge ${photo.accepted&&photo.provenance==='sealed'?'':'gallery-badge-waiting'}`}>{photo.accepted&&photo.provenance==='sealed'?'Accepted record':'Needs verification'}</span>
          <div className="gallery-controls"><button type="button" className="draft-secondary" aria-label={`Move photo ${index+1} earlier`} disabled={!editable||index===0||!!removeTarget} onClick={()=>props.onMove(id,'up')}>↑</button><button type="button" className="draft-secondary" aria-label={`Move photo ${index+1} later`} disabled={!editable||index===order.length-1||!!removeTarget} onClick={()=>props.onMove(id,'down')}>↓</button><button type="button" className="draft-text-button" disabled={!editable||changed||needsRepair||!!removeTarget} onClick={()=>props.onSelectRemoval(id)} aria-label={`Remove photo ${index+1}`}>Remove</button></div>
        </div>
      </li>;
    })}</ol>}
    <div className="gallery-order-actions"><p>{changed?'Photo order has unsaved changes.':needsRepair?'Save this full order to repair the positions.':'The displayed order is saved.'} Text edits remain separate.</p><div><button type="button" className="draft-secondary" onClick={props.onReset} disabled={!editable||!changed||!!removeTarget}>Reset photo order</button><button type="button" className="draft-primary" onClick={props.onSave} disabled={!editable||(!changed&&!needsRepair)||!!removeTarget}>Save photo order</button></div></div>
    {target&&<div className="gallery-confirm" role="group" aria-label="Confirm photo removal"><h3>Remove this photo from the draft?</h3><p>{target.altText}</p><p>This changes this draft only. Stored files and existing approved listings stay intact.</p><div className="draft-actions"><button type="button" className="draft-secondary" disabled={busy} onClick={()=>props.onSelectRemoval(null)}>Keep photo</button><button type="button" className="draft-primary" disabled={!editable} onClick={props.onRemove}>Confirm removal</button></div></div>}
    {work&&<div className="gallery-recovery" role="status" aria-live="polite"><p className="eyebrow">PHOTO CHANGE</p><h3>{busy?'Checking your photo change…':work.receipt?outcome(work.receipt):work.refused?'The request was refused.':'The original result needs checking.'}</h3><p>{work.receipt?'This is the original result. Read the current saved version, then choose how to continue.':work.refused?'Read the current saved version before starting another change. Your text edits stay in this tab.':'The request may have reached the server. Keep this tab open and check the original result. Further writes are paused.'}</p>
      <button type="button" className="draft-secondary" disabled={busy} onClick={props.onRecover}>{work.receipt||work.refused?'Read current gallery':'Check original photo change'}</button>
      {current&&<div className="gallery-current"><strong>Current saved gallery · {current.photos.length} photos</strong><p>Version {current.draft.version} · {current.draft.state}. Compare your text in the comparison panel and explicitly use this saved version before another change.</p><ol>{current.photos.map((photo,index)=><li key={photo.id}>{index===0?'Cover — ':''}{photo.altText}</li>)}</ol></div>}
    </div>}
  </section>;
}
