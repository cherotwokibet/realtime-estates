import { enquiryPreviewRequest } from '../../../../../../../../lib/enquiry-preview-server.ts';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ actor: string; id: string }> };
export async function POST(request: Request, { params }: Context) {
  return enquiryPreviewRequest(request, await params, 'viewing-recover');
}
