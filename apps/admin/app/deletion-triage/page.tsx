import { deletionTriageConfiguration } from '../../lib/deletion-triage-server';
import { DeletionTriageWorkspace } from '../../components/DeletionTriageWorkspace';

export const dynamic = 'force-dynamic';
export default function DeletionTriage() {
  let preview: ReturnType<typeof deletionTriageConfiguration> | undefined;
  try {
    preview = deletionTriageConfiguration(process.env);
  } catch {}
  return (
    <main className="container">
      <p>
        <a href="/">Staff workspace</a>
      </p>
      <h1>Account deletion requests</h1>
      {preview ? (
        <DeletionTriageWorkspace instanceId={preview.instanceId} scope={preview.scope} />
      ) : (
        <p role="alert">The synthetic staff review preview is unavailable.</p>
      )}
    </main>
  );
}
