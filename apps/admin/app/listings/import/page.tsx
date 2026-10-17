import ListingImport from '../../../components/ListingImport';
import { previewConfiguration } from '../../../lib/staff-preview-policy';
import { getDemoBrand, resolveDemoTenantSlug } from '@realtor/demo';
import type { CSSProperties } from 'react';
export const dynamic = 'force-dynamic';
export default function ListingImportPage() {
  let instanceId: string | null = null;
  try {
    instanceId = previewConfiguration(process.env).instanceId;
  } catch {
    /* Server credentials never enter client props. */
  }
  const brand = getDemoBrand(resolveDemoTenantSlug(process.env.TENANT_SLUG));
  return (
    <div className="draft-workspace" style={{ '--brand': brand.primary } as CSSProperties}>
      <a className="skip" href="#import-main">
        Skip to import preview
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
      <main id="import-main" className="draft-main">
        {instanceId ? (
          <ListingImport key={instanceId} instanceId={instanceId} />
        ) : (
          <p role="alert">
            Use the local synthetic staff launcher. Production staff import is not configured.
          </p>
        )}
      </main>
    </div>
  );
}
