'use client';
import {useState} from 'react';
import type {PrivateImageState} from '../lib/private-image';

export default function PrivateGalleryImage({state,alt,index,cover,eligible,paused,onDecodeError}:{state:PrivateImageState|undefined;alt:string;index:number;cover:boolean;eligible:boolean;paused:boolean;onDecodeError:(url:string)=>void}){
  const [decoded,setDecoded]=useState<string|null>(null),url=state?.phase==='ready'?state.url:null;
  const visible=!!url&&decoded===url;
  const label=!eligible?'Preview unavailable':paused?'Preview paused':state?.phase==='stale'?'Saved version changed':state?.phase==='unavailable'?'Image unavailable':visible?'':'Loading private image…';
  return <div className={`gallery-placeholder${visible?' gallery-image-ready':''}`} aria-label={visible?undefined:`Photo ${index+1}: ${label}`}>
    {url&&<img key={url} className="gallery-private-image" src={url} alt={alt} decoding="async" onLoad={event=>{if(event.currentTarget.naturalWidth>0&&event.currentTarget.naturalHeight>0)setDecoded(url);else onDecodeError(url);}} onError={()=>onDecodeError(url)}/>}
    {!visible&&<><svg viewBox="0 0 48 36" fill="none" aria-hidden="true"><rect x="1" y="1" width="46" height="34" rx="5"/><circle cx="34" cy="11" r="4"/><path d="m2 30 12-14 10 12 7-7 16 13"/></svg><span role={eligible?'status':undefined}>{label}</span></>}
    {cover&&<strong className="gallery-cover">Cover photo</strong>}
  </div>;
}
