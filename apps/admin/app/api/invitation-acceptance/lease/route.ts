import { invitationRecipientLeaseRequest } from '../../../../lib/invitation-recipient-server.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => invitationRecipientLeaseRequest(request);
