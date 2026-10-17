import { reviewGalleryRequest } from '../../../../../../../lib/review-media-server.ts';
export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; revision: string }> },
): Promise<Response> {
  return reviewGalleryRequest(request, await context.params);
}
