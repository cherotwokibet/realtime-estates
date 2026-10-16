import type { CSSProperties } from 'react';
import { getDemoBrand, resolveDemoTenantSlug } from '@realtor/demo';
import DraftEditor from '../../../../components/DraftEditor';
export default async function DraftPage({
  params,
}: {
  params: Promise<{ id: string; revision: string }>;
}) {
  const { id, revision } = await params;
  const brand = getDemoBrand(resolveDemoTenantSlug(process.env.TENANT_SLUG));
  return (
    <div className="draft-workspace" style={{ '--brand': brand.primary } as CSSProperties}>
      <a className="skip" href="#draft-main">
        Skip to draft
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
      <main id="draft-main" className="draft-main">
        <nav className="draft-breadcrumb" aria-label="Breadcrumb">
          <a href="/">Overview</a>
          <span aria-hidden="true">/</span>
          <span>Listing draft</span>
        </nav>
        <DraftEditor
          key={`${id}/${revision}/${process.env.STAFF_PREVIEW_INSTANCE ?? ''}`}
          listingId={id}
          revision={Number(revision)}
          previewInstanceId={process.env.STAFF_PREVIEW_INSTANCE ?? ''}
          photoPreviewEnabled={
            process.env.NODE_ENV === 'development' &&
            process.env.STAFF_PREVIEW_MEDIA === 'synthetic'
          }
        />
      </main>
    </div>
  );
}
