import { DeletionPrivacyWorkspace } from '../../components/DeletionPrivacyWorkspace';
import { deletionPrivacyConfiguration } from '../../lib/deletion-triage-server';

export const dynamic = 'force-dynamic';

export default function DeletionPrivacy() {
  let preview: ReturnType<typeof deletionPrivacyConfiguration> | undefined;
  try {
    preview = deletionPrivacyConfiguration(process.env);
  } catch {}
  return (
    <main className="container">
      <p>
        <a href="/">Staff workspace</a>
      </p>
      <h1>Deletion privacy review</h1>
      {preview ? (
        <DeletionPrivacyWorkspace
          instanceId={preview.instanceId}
          scope={preview.scope}
          processingPlanEnabled={preview.processingPlan}
        />
      ) : (
        <p role="alert">The synthetic privacy reviewer preview is unavailable.</p>
      )}
    </main>
  );
}
