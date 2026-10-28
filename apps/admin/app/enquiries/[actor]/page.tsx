import type { CSSProperties } from 'react';
import { getDemoBrand, resolveDemoTenantSlug } from '@realtor/demo';
import EnquiryWorkspace from '../../../components/EnquiryWorkspace';
import { getEnquiryPreviewScope } from '../../../lib/enquiry-preview-server';
import { enquiryEntryTarget, type EntryQuery } from '../../../lib/operations-navigation';

export const dynamic = 'force-dynamic';
export default async function EnquiryPage({
  params,
  searchParams,
}: {
  params: Promise<{ actor: string }>;
  searchParams?: Promise<EntryQuery>;
}) {
  const { actor } = await params;
  const brand = getDemoBrand(resolveDemoTenantSlug(process.env.TENANT_SLUG));
  let scope: ReturnType<typeof getEnquiryPreviewScope> | null = null;
  let target: ReturnType<typeof enquiryEntryTarget> = null;
  try {
    target = enquiryEntryTarget((await searchParams) ?? {});
    scope = getEnquiryPreviewScope(actor);
  } catch {
    /* Unconfigured or production workspaces remain unavailable. */
  }
  return (
    <main className="enq-shell" style={{ '--brand': brand.primary } as CSSProperties}>
      <a className="skip" href="#inbox-title">
        Skip to inbox
      </a>
      <header className="enq-masthead">
        <a href="/" aria-label={`${brand.name} workspace overview`}>
          <span>
            {brand.initials}
            <span>/</span>
          </span>
          <strong>
            {brand.name}
            <small>STAFF WORKSPACE</small>
          </strong>
        </a>
        <span>Independent platform preview</span>
      </header>
      {scope && (actor === 'admin' || actor === 'agent') ? (
        <EnquiryWorkspace
          key={`${scope.instanceId}:${target?.enquiryId ?? ''}:${target?.viewingId ?? ''}`}
          initialEnquiryId={target?.enquiryId}
          initialViewingId={target?.viewingId}
          actor={actor}
          actorId={scope.actorId}
          instanceId={scope.instanceId}
          reminderCaptureEnabled={process.env.STAFF_REMINDER_CAPTURE_MODE === 'capture-only-v1'}
        />
      ) : (
        <section className="enq-empty">
          <h1 id="inbox-title">Enquiry workspace unavailable</h1>
          <p>
            This inbox requires the explicit local synthetic preview launcher. Production sign-in
            and persistence are still separate release work.
          </p>
          <a href="/">Return to workspace overview</a>
        </section>
      )}
    </main>
  );
}
