import { galleryPreviewRequest } from '../../../../../../../../lib/gallery-preview-server';
export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; revision: string; operationId: string }> },
) {
  return galleryPreviewRequest(request, await context.params, 'operation');
}
