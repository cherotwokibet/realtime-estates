import { listingSuccessorPreviewRequest } from '../../../../../../../lib/listing-successor-server.ts';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string; operationId: string }> };
export async function POST(request: Request, { params }: Context) {
  return listingSuccessorPreviewRequest(request, await params);
}
export async function GET(request: Request, { params }: Context) {
  return listingSuccessorPreviewRequest(request, await params);
}
