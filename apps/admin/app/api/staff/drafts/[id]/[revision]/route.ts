import { staffPreviewRequest } from '../../../../../../lib/staff-preview-server';
type Context = { params: Promise<{ id: string; revision: string }> };
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: Context) {
  return staffPreviewRequest(request, await context.params);
}
export async function PUT(request: Request, context: Context) {
  return staffPreviewRequest(request, await context.params);
}
