import { galleryPreviewRequest } from '../../../../../../../lib/gallery-preview-server';
export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; revision: string }> },
) {
  return galleryPreviewRequest(request, await context.params, 'workspace');
}
