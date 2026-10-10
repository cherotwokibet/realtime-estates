import {reviewPreviewRequest} from '../../../../../../lib/review-preview-server';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string;revision:string}>}){return reviewPreviewRequest(request,await params);}
