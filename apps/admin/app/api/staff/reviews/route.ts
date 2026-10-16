import { reviewPreviewRequest } from '../../../../lib/review-preview-server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return reviewPreviewRequest(request);
}
