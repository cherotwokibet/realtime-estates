import { handlePublicPhoto, type PublicPhotoTarget } from '../../../../../../../lib/public-photos';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<PublicPhotoTarget> }) {
  return handlePublicPhoto(request, await params, process.env);
}
export function HEAD() {
  return new Response(null, {
    status: 405,
    headers: { Allow: 'GET', 'Cache-Control': 'no-store' },
  });
}
