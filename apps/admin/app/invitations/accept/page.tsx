import InvitationAcceptanceWorkspace from '../../../components/InvitationAcceptanceWorkspace.tsx';
import { loadInvitationRecipientContext } from '../../../lib/invitation-recipient-server.ts';
import '../../staff/staff.css';
export const dynamic = 'force-dynamic';
export default async function InvitationAcceptance() {
  let data: Awaited<ReturnType<typeof loadInvitationRecipientContext>> | null = null;
  try {
    data = await loadInvitationRecipientContext();
  } catch {}
  return (
    <main className="staff-page">
      <h1>Accept a staff invitation</h1>
      <p>
        Synthetic local preview. No email is sent. A separately verified recipient identity is
        required.
      </p>
      {data ? (
        <InvitationAcceptanceWorkspace
          key={data.instanceId + ':' + data.session.tenantId + ':' + data.session.actorId}
          {...data}
        />
      ) : (
        <section role="alert">
          <h2>Invitation acceptance unavailable</h2>
          <p>
            A current verified recipient session is required. Real login integration is not enabled
            in this preview.
          </p>
          <a href="/invitations/accept">Retry recipient verification</a>
        </section>
      )}
    </main>
  );
}
