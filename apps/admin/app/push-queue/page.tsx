import { PushQueueWorkspace } from '../../components/PushQueueWorkspace';
import { pushQueueConfiguration } from '../../lib/push-queue-preview-server';

export const dynamic = 'force-dynamic';

export default function PushQueuePage() {
  let preview: ReturnType<typeof pushQueueConfiguration> | undefined;
  try {
    preview = pushQueueConfiguration(process.env);
  } catch {}
  return (
    <main className="container">
      <p>
        <a href="/">Staff workspace</a>
      </p>
      <h1>Notification queue</h1>
      {preview ? (
        <PushQueueWorkspace instanceId={preview.instanceId} tenantId={preview.tenantId} />
      ) : (
        <p role="alert">The synthetic notification queue preview is unavailable.</p>
      )}
    </main>
  );
}
