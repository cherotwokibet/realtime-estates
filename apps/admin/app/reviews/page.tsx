import type { CSSProperties } from 'react';
import { getDemoBrand, resolveDemoTenantSlug } from '@realtor/demo';
import ReviewWorkspace from '../../components/ReviewWorkspace';
export const dynamic = 'force-dynamic';
export default function ReviewsPage() {
  const brand = getDemoBrand(resolveDemoTenantSlug(process.env.TENANT_SLUG));
  return (
    <div className="draft-workspace" style={{ '--brand': brand.primary } as CSSProperties}>
      <a className="skip" href="#review-main">
        Skip to reviews
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
        <span className="preview-pill">Local synthetic moderator</span>
      </header>
      <main id="review-main" className="draft-main">
        <nav className="draft-breadcrumb" aria-label="Breadcrumb">
          <a href="/">Overview</a>
          <span aria-hidden="true">/</span>
          <span>Revision review</span>
        </nav>
        <ReviewWorkspace
          key={process.env.STAFF_PREVIEW_INSTANCE ?? ''}
          previewInstanceId={process.env.STAFF_PREVIEW_INSTANCE ?? ''}
        />
      </main>
    </div>
  );
}
