import type { CSSProperties } from 'react';
import type { StaffListingSummary } from '@realtor/api-client';
import { getDemoBrand, resolveDemoTenantSlug } from '@realtor/demo';
import ListingControls from '../../../../components/ListingControls';
import { readStaffListingDetail } from '../../../../lib/listing-queue-server';
import { previewConfiguration } from '../../../../lib/staff-preview-policy';
export const dynamic = 'force-dynamic';
export default async function ControlsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let listing: StaffListingSummary | null = null,
    instanceId: string | null = null;
  try {
    instanceId = previewConfiguration(process.env).instanceId;
    listing = await readStaffListingDetail(id);
  } catch {
    /* No private diagnostics on failed current access. */
  }
  const brand = getDemoBrand(resolveDemoTenantSlug(process.env.TENANT_SLUG));
  return (
    <div className="draft-workspace" style={{ '--brand': brand.primary } as CSSProperties}>
      <a className="skip" href="#controls-main">
        Skip to listing controls
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
      <main id="controls-main" className="draft-main">
        {listing && instanceId ? (
          <ListingControls listing={listing} instanceId={instanceId} />
        ) : (
          <section className="enq-contacts">
            <h1>Listing controls unavailable</h1>
            <p role="alert">A current authorized listing read is required.</p>
            <a href="/listings">Read the listing queue</a>
          </section>
        )}
      </main>
    </div>
  );
}
