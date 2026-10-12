import type {CSSProperties} from 'react';
import {getDemoBrand,resolveDemoTenantSlug} from '@realtor/demo';
import EnquiryWorkspace from '../../../components/EnquiryWorkspace';
import {getEnquiryPreviewScope} from '../../../lib/enquiry-preview-server';

export const dynamic='force-dynamic';
export default async function EnquiryPage({params}:{params:Promise<{actor:string}>}){
  const {actor}=await params;
  const brand=getDemoBrand(resolveDemoTenantSlug(process.env.TENANT_SLUG));
  let scope:ReturnType<typeof getEnquiryPreviewScope>|null=null;
  try{scope=getEnquiryPreviewScope(actor)}catch{/* Unconfigured or production workspaces remain unavailable. */}
  return <main className="enq-shell" style={{'--brand':brand.primary} as CSSProperties}><a className="skip" href="#inbox-title">Skip to inbox</a><header className="enq-masthead"><a href="/" aria-label={`${brand.name} workspace overview`}><span>{brand.initials}<span>/</span></span><strong>{brand.name}<small>STAFF WORKSPACE</small></strong></a><span>Independent platform preview</span></header>{scope && (actor==='admin'||actor==='agent') ? <EnquiryWorkspace actor={actor} actorId={scope.actorId} instanceId={scope.instanceId}/> : <section className="enq-empty"><h1 id="inbox-title">Enquiry workspace unavailable</h1><p>This inbox requires the explicit local synthetic preview launcher. Production sign-in and persistence are still separate release work.</p><a href="/">Return to workspace overview</a></section>}</main>;
}
