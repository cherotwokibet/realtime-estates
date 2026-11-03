import type { CSSProperties } from 'react';
import { getDemoBrand, resolveDemoTenantSlug } from '@realtor/demo';
import DraftEditor from '../../../../components/DraftEditor.tsx';
import ReferenceDraftWorkspace from '../../../../components/ReferenceDraftWorkspace.tsx';
import { readMixedDraftScreen, type MixedDraftScreen } from '../../../../lib/mixed-draft-screen.ts';
export const dynamic = 'force-dynamic';
export default async function DraftPage({
  params,
}: {
  params: Promise<{ id: string; revision: string }>;
}) {
  const { id, revision } = await params;
  const brand = getDemoBrand(resolveDemoTenantSlug(process.env.TENANT_SLUG));
  const routed = process.env.STAFF_PREVIEW_REFERENCE !== undefined;
  let screen: MixedDraftScreen | null = null;
  if (routed) {
    try {
      screen = await readMixedDraftScreen(id, revision);
    } catch {
      /* No stale props, secrets, local-storage deletion or ordinary fallback. */
    }
  }
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
        {routed && screen?.kind === 'ordinary' && (
          <p>
            <a href={`/drafts/${id}/${revision}/references`}>Edit location and amenities</a>
          </p>
        )}
        {routed && !screen ? (
          <section className="draft-panel">
            <h1>Draft unavailable</h1>
            <p role="alert">
              Fresh access and compatible draft readers are required. Retained originals have not
              been changed.
            </p>
          </section>
        ) : screen?.kind === 'reference' ? (
          <ReferenceDraftWorkspace
            videoEnabled={process.env.STAFF_PREVIEW_VIDEO === 'synthetic-private-listing-video-v1'}
            key={JSON.stringify([
              screen.screen.scope,
              screen.screen.revision,
              screen.screen.expectedVersion,
              screen.screen.catalogue.version,
              screen.screen.editingDisabled,
            ])}
            {...screen.screen}
          />
        ) : (
          <DraftEditor
            key={`${id}/${revision}/${process.env.STAFF_PREVIEW_INSTANCE ?? ''}`}
            listingId={id}
            revision={Number(revision)}
            previewInstanceId={
              screen?.kind === 'ordinary'
                ? screen.instanceId
                : (process.env.STAFF_PREVIEW_INSTANCE ?? '')
            }
            photoPreviewEnabled={
              process.env.NODE_ENV === 'development' &&
              process.env.STAFF_PREVIEW_MEDIA === 'synthetic'
            }
          />
        )}
      </main>
    </div>
  );
}
