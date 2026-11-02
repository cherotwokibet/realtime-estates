import { invitationRecipientBoundary } from '../../../../lib/invitation-recipient-server.ts';
export const dynamic = 'force-dynamic';
async function dispatch(request: Request) {
  return invitationRecipientBoundary(request, null);
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
