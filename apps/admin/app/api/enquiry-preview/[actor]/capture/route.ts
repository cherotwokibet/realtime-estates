import { staffCapturePreviewRequest } from '../../../../../lib/enquiry-preview-server.ts';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, { params }: { params: Promise<{ actor: string }> }) {
  return staffCapturePreviewRequest(request, (await params).actor);
}
