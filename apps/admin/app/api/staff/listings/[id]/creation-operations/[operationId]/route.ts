import { listingCreationPreviewRequest } from '../../../../../../../lib/listing-creation-server.ts';
type Context = { params: Promise<{ id: string; operationId: string }> };
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: Context) {
  return listingCreationPreviewRequest(request, await context.params);
}
export async function POST(request: Request, context: Context) {
  return listingCreationPreviewRequest(request, await context.params);
}
