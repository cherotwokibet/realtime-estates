import Link from 'next/link';
import IntakeWorkspace from '../../components/IntakeWorkspace';
import {getEnquiryPreviewScope} from '../../lib/enquiry-preview-server';
export const dynamic='force-dynamic';
export default function IntakePage(){
 let instanceId:string|null=null;try{instanceId=getEnquiryPreviewScope('admin').instanceId;}catch{}
 return <main className="intake-shell"><header><Link href="/">REALTIME / PREVIEW</Link><Link href="/enquiries/admin">Staff inbox →</Link></header>{instanceId?<IntakeWorkspace instanceId={instanceId}/>:<section className="intake-card"><h1>Enquiry form unavailable</h1><p>Start the opt-in local enquiry preview to test this form with fictional data.</p></section>}</main>;
}
