import Link from 'next/link';
import StaffCaptureWorkspace from '../../../../components/StaffCaptureWorkspace';
import { getEnquiryPreviewScope } from '../../../../lib/enquiry-preview-server';
export const dynamic = 'force-dynamic';
export default async function CapturePage({ params }: { params: Promise<{ actor: string }> }) {
  const { actor } = await params;
  let scope: ReturnType<typeof getEnquiryPreviewScope> | null = null;
  try {
    scope = getEnquiryPreviewScope(actor);
  } catch {}
  return (
    <main className="intake-shell">
      <header>
        <Link href="/">REALTIME / PREVIEW</Link>
        <Link href={actor === 'agent' ? '/enquiries/agent' : '/enquiries/admin'}>
          Staff inbox →
        </Link>
      </header>
      {scope ? (
        <StaffCaptureWorkspace
          key={scope.instanceId}
          actor={scope.role}
          actorId={scope.actorId}
          instanceId={scope.instanceId}
        />
      ) : (
        <section className="intake-card">
          <h1>Staff capture unavailable</h1>
          <p>
            Start the explicit local synthetic enquiry preview. Production access is not enabled.
          </p>
        </section>
      )}
    </main>
  );
}
