import ReferenceSuccessorWorkspace from '../../../../components/ReferenceSuccessorWorkspace.tsx';
import { readReferenceSuccessorScreen } from '../../../../lib/reference-successor-screen.ts';
import type { CSSProperties } from 'react';
import type { StaffListingSummary } from '@realtor/api-client';
import { getDemoBrand, resolveDemoTenantSlug } from '@realtor/demo';
import AllocationWorkspace from '../../../../components/AllocationWorkspace.tsx';
import { readStaffAllocationScope } from '../../../../lib/staff-allocation-scope.ts';
import { readStaffListingDetail } from '../../../../lib/listing-queue-server.ts';
export const dynamic = 'force-dynamic';
export default async function SuccessorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const references = process.env.STAFF_PREVIEW_REFERENCE_SUCCESSOR !== undefined;
  let successor: Awaited<ReturnType<typeof readReferenceSuccessorScreen>> | null = null;
  if (references) {
    try {
      successor = await readReferenceSuccessorScreen(id);
    } catch {
      /* Current access required; no credential diagnostics. */
    }
  }
  let listing: StaffListingSummary | null = null;
  let scope: Awaited<ReturnType<typeof readStaffAllocationScope>> | null = null;
  try {
    if (!references) {
      scope = await readStaffAllocationScope();
      listing = await readStaffListingDetail(id);
    }
  } catch {
    /* Failed authorized reads expose no private context or diagnostics. */
  }
  const brand = getDemoBrand(resolveDemoTenantSlug(process.env.TENANT_SLUG));
  return (
    <div className="draft-workspace" style={{ '--brand': brand.primary } as CSSProperties}>
      <a className="skip" href="#successor-main">
        Skip to new revision
      </a>
      <header className="draft-masthead">
        <span className="workspace-brand">
          <span className="brand-monogram" aria-hidden="true">
            {brand.initials}
          </span>
          <span>
            <strong>{brand.name}</strong>
            <small>STAFF WORKSPACE</small>
          </span>
        </span>
        <span className="preview-pill">Local synthetic preview</span>
      </header>
      <main id="successor-main" className="draft-main">
        {references ? (
          successor ? (
            <ReferenceSuccessorWorkspace {...successor} />
          ) : (
            <p role="alert">
              Reference successor unavailable. Restore current staff access and explicit synthetic
              configuration.
            </p>
          )
        ) : listing && scope ? (
          <AllocationWorkspace kind="revision" scope={scope} listing={listing} />
        ) : (
          <section className="enq-contacts">
            <h1>New draft unavailable</h1>
            <p role="alert">
              A current authorized read of an approved or rejected latest revision is required.
            </p>
            <a href="/listings">Read the listing queue</a>
          </section>
        )}
      </main>
    </div>
  );
}
