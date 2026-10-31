import { staffInvitationBoundary } from '../../../../../lib/staff-invitation-server.ts';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ invitation: string }> };
export async function GET(request: Request, context: Context) {
  const params = await context.params;
  return staffInvitationBoundary(request, 'current', params.invitation, undefined);
}
