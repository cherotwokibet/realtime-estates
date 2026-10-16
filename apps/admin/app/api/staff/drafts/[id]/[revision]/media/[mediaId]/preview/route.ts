import { imagePreviewRequest } from '../../../../../../../../../lib/image-preview-server.ts';

export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; revision: string; mediaId: string }> },
): Promise<Response> {
  return imagePreviewRequest(request, await context.params);
}
