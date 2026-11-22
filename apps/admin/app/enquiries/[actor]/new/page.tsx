import Link from 'next/link';
import StaffCaptureWorkspace from '../../../../components/StaffCaptureWorkspace';
import { readStaffCaptureScope } from '../../../../lib/staff-capture-original-server.ts';
export const dynamic = 'force-dynamic';
export default async function CapturePage({ params }: { params: Promise<{ actor: string }> }) {
  const { actor } = await params;
  let scope: Awaited<ReturnType<typeof readStaffCaptureScope>> | null = null;
  try {
    if (actor !== 'admin' && actor !== 'agent') throw Error();
    scope = await readStaffCaptureScope(actor);
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
        <StaffCaptureWorkspace scope={scope} actor={actor === 'agent' ? 'agent' : 'admin'} />
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
