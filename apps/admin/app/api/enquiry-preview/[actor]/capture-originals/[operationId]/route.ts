import { staffCaptureOriginalRequest } from '../../../../../../lib/staff-capture-original-server.ts';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Context = { params: Promise<{ actor: string; operationId: string }> };
export async function GET(request: Request, context: Context) {
  const p = await context.params;
  return staffCaptureOriginalRequest(request, p.actor, p.operationId);
}
export const POST = GET;
