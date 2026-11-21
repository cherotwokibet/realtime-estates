import { readStaffAllocationScope } from '../../lib/staff-allocation-scope.ts';
import { previewConfiguration } from '../../lib/staff-preview-policy';
import { ListingReportsWorkspace } from '../../components/ListingReportsWorkspace';
export const dynamic = 'force-dynamic';
export default async function Reports() {
  let scope: Awaited<ReturnType<typeof readStaffAllocationScope>> | null = null;
  let instanceId: string | null = null;
  try {
    if (process.env.STAFF_REPORT_PREVIEW_MODE === 'synthetic-v1') {
      scope = await readStaffAllocationScope();
      instanceId = previewConfiguration(process.env).instanceId;
    }
  } catch {}
  return (
    <main id="reports" tabIndex={-1} className="container">
      <a href="#reports">Skip to listing reports</a>
      <p>
        <a href="/">Staff workspace</a>
      </p>
      <h1>Listing concerns and review</h1>
      {instanceId && scope ? (
        <ListingReportsWorkspace key={instanceId} instanceId={instanceId} scope={scope} />
      ) : (
        <p role="alert">
          Reports unavailable. An explicit current synthetic admin preview is required.
        </p>
      )}
    </main>
  );
}
