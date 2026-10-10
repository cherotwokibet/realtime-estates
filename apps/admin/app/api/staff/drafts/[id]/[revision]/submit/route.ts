import {staffPreviewRequest} from '../../../../../../../lib/staff-preview-server';
export async function POST(request:Request,context:{params:Promise<{id:string;revision:string}>}){return staffPreviewRequest(request,await context.params,true);}
