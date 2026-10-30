import { previewConfiguration } from '../../lib/staff-preview-policy';
import { ListingReportsWorkspace } from '../../components/ListingReportsWorkspace';
export const dynamic = 'force-dynamic';
export default function Reports() {
  let instanceId: string | null = null;
  try {
    if (process.env.STAFF_REPORT_PREVIEW_MODE === 'synthetic-v1')
      instanceId = previewConfiguration(process.env).instanceId;
  } catch {}
  return (
    <main id="reports" tabIndex={-1} className="container">
      <a href="#reports">Skip to listing reports</a>
      <p>
        <a href="/">Staff workspace</a>
      </p>
      <h1>Listing concerns and review</h1>
      {instanceId ? (
        <ListingReportsWorkspace key={instanceId} instanceId={instanceId} />
      ) : (
        <p role="alert">
          Reports unavailable. An explicit current synthetic admin preview is required.
        </p>
      )}
    </main>
  );
}
