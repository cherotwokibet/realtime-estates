import type { CSSProperties } from 'react';
import type { StaffListingSummary } from '@realtor/domain';
import { getDemoBrand, resolveDemoTenantSlug } from '@realtor/demo';
import ListingDuplicates from '../../../../components/ListingDuplicates';
import { readStaffListingDetail } from '../../../../lib/listing-queue-server';
import { previewConfiguration } from '../../../../lib/staff-preview-policy';
export const dynamic = 'force-dynamic';
export default async function DuplicatesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let listing: StaffListingSummary | null = null,
    instanceId: string | null = null;
  try {
    instanceId = previewConfiguration(process.env).instanceId;
    listing = await readStaffListingDetail(id);
  } catch {
    /* Safe unavailable state only. */
  }
  const brand = getDemoBrand(resolveDemoTenantSlug(process.env.TENANT_SLUG));
  return (
    <div className="draft-workspace" style={{ '--brand': brand.primary } as CSSProperties}>
      <a className="skip" href="#duplicates-main">
        Skip to possible matches
      </a>
      <header className="draft-masthead">
        <span className="workspace-brand">
          <strong>{brand.name}</strong>
        </span>
        <span className="preview-pill">Local synthetic preview</span>
      </header>
      <main id="duplicates-main" className="draft-main">
        {listing && instanceId ? (
          <ListingDuplicates
            key={`${instanceId}:${listing.listingId}:${listing.version}:${listing.latest?.revision}:${listing.latest?.version}`}
            listing={listing}
            instanceId={instanceId}
          />
        ) : (
          <section className="enq-contacts">
            <h1>Possible matches unavailable</h1>
            <p role="alert">A fresh authorized listing read is required.</p>
            <a href="/listings">Read the listing queue</a>
          </section>
        )}
      </main>
    </div>
  );
}
