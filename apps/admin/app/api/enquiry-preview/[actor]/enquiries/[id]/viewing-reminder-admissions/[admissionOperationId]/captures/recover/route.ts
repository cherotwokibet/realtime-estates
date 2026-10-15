import {enquiryPreviewRequest} from '../../../../../../../../../../lib/enquiry-preview-server.ts';
export const dynamic='force-dynamic';
export async function POST(request:Request,{params}:{params:Promise<{actor:string;id:string;admissionOperationId:string}>}){
 return enquiryPreviewRequest(request,await params,'reminder-capture-recover');
}
