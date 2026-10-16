import type { CSSProperties } from 'react';
import type { StaffListingSummary } from '@realtor/api-client';
import { getDemoBrand, resolveDemoTenantSlug } from '@realtor/demo';
import ListingSuccessor from '../../../../components/ListingSuccessor';
import { readStaffListingDetail } from '../../../../lib/listing-queue-server';
import { previewConfiguration } from '../../../../lib/staff-preview-policy';
export const dynamic = 'force-dynamic';
export default async function SuccessorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let listing: StaffListingSummary | null = null;
  let instanceId: string | null = null;
  try {
    instanceId = previewConfiguration(process.env).instanceId;
    listing = await readStaffListingDetail(id);
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
        {listing &&
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
