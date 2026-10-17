import { reviewImageRequest } from '../../../../../../../../../lib/review-media-server.ts';
export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; revision: string; mediaId: string }> },
): Promise<Response> {
  return reviewImageRequest(request, await context.params);
}
