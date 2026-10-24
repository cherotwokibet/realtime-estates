import AllocationWorkspace from '../../../components/AllocationWorkspace.tsx';
import { readStaffAllocationScope } from '../../../lib/staff-allocation-scope.ts';
import { getDemoBrand, resolveDemoTenantSlug } from '@realtor/demo';
import type { CSSProperties } from 'react';
import ReferenceCreationWorkspace from '../../../components/ReferenceCreationWorkspace.tsx';
import { readReferenceCreationScreen } from '../../../lib/reference-creation-screen.ts';
export const dynamic = 'force-dynamic';
export default async function NewListingPage() {
  const references = process.env.STAFF_PREVIEW_REFERENCE_CREATION !== undefined;
  let creation: Awaited<ReturnType<typeof readReferenceCreationScreen>> | null = null;
  if (references) {
    try {
      creation = await readReferenceCreationScreen();
    } catch {
      /* Stay closed on unavailable current identity/configuration. */
    }
  }
  let scope: Awaited<ReturnType<typeof readStaffAllocationScope>> | null = null;
  try {
    if (!references) scope = await readStaffAllocationScope();
  } catch {
    /* Credentials remain server-only. */
  }
  const brand = getDemoBrand(resolveDemoTenantSlug(process.env.TENANT_SLUG));
  return (
    <div className="draft-workspace" style={{ '--brand': brand.primary } as CSSProperties}>
      <a className="skip" href="#creation-main">
        Skip to creation
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
      <main id="creation-main" className="draft-main">
        {references ? (
          creation ? (
            <ReferenceCreationWorkspace {...creation} />
          ) : (
            <p role="alert">
              Reference creation is unavailable. Restore current staff access and the explicit
              synthetic configuration.
            </p>
          )
        ) : scope ? (
          <AllocationWorkspace kind="creation" scope={scope} />
        ) : (
          <p role="alert">
            Use the local synthetic staff launcher. Production staff creation is not configured.
          </p>
        )}
      </main>
    </div>
  );
}
