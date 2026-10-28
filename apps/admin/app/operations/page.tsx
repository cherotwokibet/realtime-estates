import type { CSSProperties } from 'react';
import { getDemoBrand, resolveDemoTenantSlug } from '@realtor/demo';
import { getEnquiryPreviewScope, loadOperationsPreview } from '../../lib/enquiry-preview-server.ts';
import OperationsOverview from '../../components/OperationsOverview.tsx';
import './operations.css';
export const dynamic = 'force-dynamic';
export default async function OperationsPage() {
  const brand = getDemoBrand(resolveDemoTenantSlug(process.env.TENANT_SLUG));
  let data: Awaited<ReturnType<typeof loadOperationsPreview>> | null = null;
  let enquiriesEnabled = false;
  try {
    getEnquiryPreviewScope('admin');
    enquiriesEnabled = true;
  } catch {}
  try {
    data = await loadOperationsPreview();
  } catch {}
  return (
    <main
      id="operations-main"
      className="ops-page"
      style={{ '--brand': brand.primary } as CSSProperties}
    >
      <a className="skip" href="#operations-title">
        Skip to daily work
      </a>
      <header className="ops-masthead">
        <a href="/">{brand.name} · Staff workspace</a>
        <span>Independent platform preview</span>
      </header>
      <section className="ops-intro">
        <p>DAILY OPERATIONS / ADMIN</p>
        <h1 id="operations-title">Work that needs attention.</h1>
        <p>Review stock, decide submissions and give every conversation a next step.</p>
        <p className="ops-notice">
          Synthetic local data · No messages, reminders or publication changes are sent by this
          overview.
        </p>
        <a className="ops-refresh" href="/operations">
          Refresh overview
        </a>
        {data && enquiriesEnabled && <a href="/enquiries/admin">Open enquiry workspace</a>}
      </section>
      {data ? (
        <OperationsOverview data={data} />
      ) : (
        <section role="alert" className="ops-unavailable">
          <h2>Daily work is unavailable</h2>
          <p>
            A current authorized admin read is required. Retry the overview or check the synthetic
            launcher. Previous private rows are not displayed.
          </p>
        </section>
      )}
    </main>
  );
}
