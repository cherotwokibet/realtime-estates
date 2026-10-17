import type { CSSProperties } from 'react';
import { getDemoBrand, resolveDemoTenantSlug } from '@realtor/demo';
import type { StaffListingPage } from '@realtor/api-client';
import { readStaffListingQueue } from '../../lib/listing-queue-server';
export const dynamic = 'force-dynamic';
const status = {
  draft: 'Draft',
  pending: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected',
};
export default async function ListingsPage() {
  const brand = getDemoBrand(resolveDemoTenantSlug(process.env.TENANT_SLUG));
  let page: StaffListingPage | null = null;
  try {
    page = await readStaffListingQueue();
  } catch {
    /* No private rows or upstream diagnostics survive a failed current authorized read. */
  }
  return (
    <div className="draft-workspace" style={{ '--brand': brand.primary } as CSSProperties}>
      <a className="skip" href="#listing-queue-main">
        Skip to listing queue
      </a>
      <header className="draft-masthead">
        <a className="workspace-brand" href="/">
          <span className="brand-monogram" aria-hidden="true">
            {brand.initials}
          </span>
          <span>
            <strong>{brand.name}</strong>
            <small>STAFF WORKSPACE</small>
          </span>
        </a>
        <span className="preview-pill">Local synthetic preview</span>
      </header>
      <main id="listing-queue-main" className="draft-main">
        <nav className="draft-breadcrumb" aria-label="Breadcrumb">
          <a href="/">Overview</a>
          <span aria-hidden="true">/</span>
          <span>Listing queue</span>
        </nav>
        <section className="enq-contacts" aria-label="Authorized listing queue">
          <h1>Listing work</h1>
          <a className="enq-secondary" href="/listings/import">
            Preview listing CSV
          </a>
          <p>
            Read the latest revision before making a change. An unfinished draft leaves the approved
            public listing intact.
          </p>
          <p className="enq-warning">
            Local preview with fictional inventory. Current staff access is checked on each read.
            Changes disappear when the preview stops.
          </p>
          <a className="enq-secondary" href="/listings">
            Refresh authorized listing queue
          </a>
          {!page ? (
            <p role="alert">
              Listing queue unavailable for current access. Use the explicit local synthetic staff
              launcher, then try a fresh read.
            </p>
          ) : (
            <>
              <a className="enq-primary" href="/listings/new">
                Create a new listing
              </a>
              <p>
                {page.items.length} shown ·{' '}
                {page.truncated ? 'more listings remain' : 'end of visible slice'} · latest{' '}
                {page.limit} maximum. This is a bounded read, not a company total.
              </p>
              {!page.items.length && <p>No listings visible to this staff account.</p>}
              <ol className="enq-activity">
                {page.items.map((item) => (
                  <li key={item.listingId}>
                    <h2>{item.latest?.title ?? 'Untitled listing'}</h2>
                    <span>
                      Listing {item.listingId} · listing version {item.version}
                    </span>
                    <span>Assigned staff {item.assignedAgentId}</span>
                    <span>
                      Availability: {item.availability} · publication: {item.publicationStatus}
                    </span>
                    <span>
                      {item.publishedRevision === null
                        ? 'No approved public revision'
                        : `Selected approved public revision ${item.publishedRevision}`}
                    </span>
                    <a className="enq-secondary" href={`/listings/${item.listingId}/controls`}>
                      Availability &amp; publication
                    </a>
                    {item.latest ? (
                      <>
                        <strong>
                          {status[item.latest.state]} · latest revision {item.latest.revision} ·
                          revision version {item.latest.version}
                        </strong>
                        <a
                          className="enq-secondary"
                          href={`/drafts/${item.listingId}/${item.latest.revision}`}
                        >
                          Open revision {item.latest.revision} for a fresh read
                        </a>
                        {(item.latest.state === 'approved' || item.latest.state === 'rejected') && (
                          <a className="enq-primary" href={`/listings/${item.listingId}/successor`}>
                            Start a new draft
                          </a>
                        )}
                      </>
                    ) : (
                      <p>No draft yet.</p>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
