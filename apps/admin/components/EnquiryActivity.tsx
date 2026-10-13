'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {EnquiryActivityPage} from '@realtor/api-client';
import {createEnquiryPreviewClient} from '../lib/enquiry-client';
import {formatEnquiryTime,enquiryStatusLabel} from '../lib/enquiry-model';
export default function EnquiryActivity({actor,instanceId,enquiryId}:{actor:'admin'|'agent';instanceId:string;enquiryId:string}){
 const client=useMemo(()=>createEnquiryPreviewClient({basePath:`/api/enquiry-preview/${actor}`,instanceId}),[actor,instanceId]);
 const [page,setPage]=useState<EnquiryActivityPage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 const controller=useRef<AbortController|null>(null),generation=useRef(0);
 async function refresh(){
  const current=++generation.current;controller.current?.abort();const next=new AbortController();controller.current=next;setPage(null);setError(false);setBusy(true);
  try{const result=await client.activity(enquiryId,next.signal);if(current===generation.current)setPage(result);}
  catch{if(current===generation.current)setError(true);}
  finally{if(current===generation.current){setBusy(false);controller.current=null;}}
 }
 useEffect(()=>{void refresh();return()=>{generation.current++;controller.current?.abort();};},[client,enquiryId]);
 const gap=page&&(page.items[0]?.version!==page.currentVersion||page.items.some((item,index)=>index>0&&BigInt(page.items[index-1]!.version)-BigInt(item.version)>1n));
 const label={received:'Enquiry received',assign:'Owner assignment recorded',transition:'Status change recorded',reschedule:'Follow-up change recorded'};
 return <section className="enq-activity" aria-label="Recorded activity"><div className="enq-section-heading"><h3>Recorded activity</h3><button type="button" className="enq-secondary" onClick={()=>void refresh()} disabled={busy}>Refresh activity</button></div>
 <p className="enq-subtle">Capture and applied v2 workflow changes only. Legacy changes may be missing. This read does not change your working version or send a message.</p>
 {busy&&<p role="status">Loading recorded activity…</p>}{error&&<p role="alert">Activity unavailable for the current staff access. Refresh to try again.</p>}
 {page&&<><p className="enq-subtle">Read at saved version {page.currentVersion} · {page.items.length} events shown · {page.truncated?'older supported events remain':'end of supported activity slice'}. Times shown in Nairobi.</p>{gap&&<p className="enq-warning">Some saved versions have no supported activity event. This is not a complete audit trail.</p>}
 <ol>{page.items.map(item=><li key={`${item.kind}:${item.version}:${item.eventId}`}><strong>{label[item.kind]}</strong><time dateTime={item.occurredAt}>{formatEnquiryTime(item.occurredAt)}</time><span>Recorded actor ID: {item.actorId??'Guest / not recorded'} · saved version {item.version}</span><span>Status: {enquiryStatusLabel(item.status as Parameters<typeof enquiryStatusLabel>[0])} · owner ID: {item.assignedAgentId??'Unassigned'}</span>{item.nextActionAt&&<span>Historical next follow-up: {formatEnquiryTime(item.nextActionAt)}</span>}</li>)}</ol></>}
 </section>;
}
