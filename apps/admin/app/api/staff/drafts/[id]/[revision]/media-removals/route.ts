import { galleryPreviewRequest } from '../../../../../../../lib/gallery-preview-server';
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; revision: string }> },
) {
  return galleryPreviewRequest(request, await context.params, 'remove');
}
