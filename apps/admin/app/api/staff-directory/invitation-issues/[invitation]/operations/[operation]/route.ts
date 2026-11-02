import { staffInvitationIssueBoundary } from '../../../../../../../lib/staff-invitation-issue-server.ts';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ invitation: string; operation: string }> };
async function dispatch(request: Request, context: Context) {
  const p = await context.params;
  return staffInvitationIssueBoundary(request, p.invitation, p.operation, false);
}
export {
  dispatch as GET,
  dispatch as POST,
  dispatch as HEAD,
  dispatch as PUT,
  dispatch as PATCH,
  dispatch as DELETE,
  dispatch as OPTIONS,
};
