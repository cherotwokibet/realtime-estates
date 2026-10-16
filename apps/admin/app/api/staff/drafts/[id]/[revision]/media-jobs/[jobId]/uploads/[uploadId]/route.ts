import { photoPreviewRequest } from '../../../../../../../../../../lib/photo-preview-server';
export const dynamic = 'force-dynamic';
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; revision: string; jobId: string; uploadId: string }> },
) {
  return photoPreviewRequest(request, await context.params, 'upload');
}
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; revision: string; jobId: string; uploadId: string }> },
) {
  return photoPreviewRequest(request, await context.params, 'status');
}
