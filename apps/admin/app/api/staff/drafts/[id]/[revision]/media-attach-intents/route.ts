import {photoPreviewRequest} from '../../../../../../../lib/photo-preview-server';
export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{id:string;revision:string}>}){return photoPreviewRequest(request,await context.params,'intent');}
