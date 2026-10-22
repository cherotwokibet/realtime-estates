import type { CSSProperties } from 'react';
import type { StaffListingSummary, ListingVerificationHistory } from '@realtor/domain';
import { getDemoBrand, resolveDemoTenantSlug } from '@realtor/demo';
import ListingVerification from '../../../../components/ListingVerification';
import { readStaffListingDetail } from '../../../../lib/listing-queue-server';
import { readInitialListingVerificationHistory } from '../../../../lib/listing-verification-server';
import { previewConfiguration } from '../../../../lib/staff-preview-policy';
export const dynamic = 'force-dynamic';
export default async function VerificationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let listing: StaffListingSummary | null = null,
    history: ListingVerificationHistory | null = null,
    instanceId: string | null = null;
  try {
    instanceId = previewConfiguration(process.env).instanceId;
    history = await readInitialListingVerificationHistory(id);
    listing = await readStaffListingDetail(id);
  } catch {
    /* Current-admin history is required before private rendering. */
  }
  const brand = getDemoBrand(resolveDemoTenantSlug(process.env.TENANT_SLUG));
  return (
    <div className="draft-workspace" style={{ '--brand': brand.primary } as CSSProperties}>
      <a className="skip" href="#verification-main">
        Skip to private assessments
      </a>
      <header className="draft-masthead">
        <span className="workspace-brand">
          <strong>{brand.name}</strong>
        </span>
        <span className="preview-pill">Local synthetic preview</span>
      </header>
      <main id="verification-main" className="draft-main">
        {listing && history && instanceId ? (
          <ListingVerification
            key={`${instanceId}:${listing.listingId}:${listing.version}:${listing.latest?.revision}:${listing.latest?.version}`}
            listing={listing}
            initialHistory={history}
            instanceId={instanceId}
          />
        ) : (
          <section className="enq-contacts">
            <h1>Private assessments unavailable</h1>
            <p role="alert">Fresh current-admin access to this company and listing is required.</p>
            <a href="/listings">Read the listing queue</a>
          </section>
        )}
      </main>
    </div>
  );
}
