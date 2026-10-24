import ReferenceSuccessorWorkspace from '../../../../components/ReferenceSuccessorWorkspace.tsx';
import { readReferenceSuccessorScreen } from '../../../../lib/reference-successor-screen.ts';
import type { CSSProperties } from 'react';
import type { StaffListingSummary } from '@realtor/api-client';
import { getDemoBrand, resolveDemoTenantSlug } from '@realtor/demo';
import ListingSuccessor from '../../../../components/ListingSuccessor.tsx';
import { readStaffListingDetail } from '../../../../lib/listing-queue-server.ts';
import { previewConfiguration } from '../../../../lib/staff-preview-policy.ts';
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
  let instanceId: string | null = null;
  try {
    if (!references) {
      instanceId = previewConfiguration(process.env).instanceId;
      listing = await readStaffListingDetail(id);
    }
  } catch {
    /* Failed authorized reads expose no private context or diagnostics. */
  }
  const brand = getDemoBrand(resolveDemoTenantSlug(process.env.TENANT_SLUG));
  const latest = listing?.latest;
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
        ) : listing &&
          latest &&
          instanceId &&
          (latest.state === 'approved' || latest.state === 'rejected') ? (
          <ListingSuccessor
            instanceId={instanceId}
            listingId={listing.listingId}
            expectedListingVersion={listing.version}
            predecessor={{
              revision: latest.revision,
              version: latest.version,
              state: latest.state,
            }}
          />
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
