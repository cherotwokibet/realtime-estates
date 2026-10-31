import { staffInvitationBoundary } from '../../../../../../lib/staff-invitation-server.ts';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ operation: string }> };
export async function GET(request: Request, context: Context) {
  const params = await context.params;
  return staffInvitationBoundary(request, 'capture', params.operation, undefined);
}
export async function POST(request: Request, context: Context) {
  const params = await context.params;
  return staffInvitationBoundary(request, 'capture', params.operation, undefined);
}
