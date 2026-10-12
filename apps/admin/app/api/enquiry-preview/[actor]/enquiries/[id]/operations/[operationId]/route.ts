import {enquiryPreviewRequest} from '../../../../../../../../lib/enquiry-preview-server.ts';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{actor:string;id:string;operationId:string}>}){
  return enquiryPreviewRequest(request,await params,'operation');
}
