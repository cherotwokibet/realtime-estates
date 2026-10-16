import { listingControlPreviewRequest } from '../../../../../../../lib/listing-control-server.ts';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string; operationId: string }> };
export async function POST(request: Request, { params }: Context) {
  return listingControlPreviewRequest(request, await params, 'set_publication');
}
export async function GET(request: Request, { params }: Context) {
  return listingControlPreviewRequest(request, await params, 'set_publication');
}
