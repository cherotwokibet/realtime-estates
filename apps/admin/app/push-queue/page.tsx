import { readStaffAllocationScope } from '../../lib/staff-allocation-scope.ts';
import { PushQueueWorkspace } from '../../components/PushQueueWorkspace';
import { pushQueueConfiguration } from '../../lib/push-queue-preview-server';

export const dynamic = 'force-dynamic';

export default async function PushQueuePage() {
  let scope: Awaited<ReturnType<typeof readStaffAllocationScope>> | undefined;
  let preview: ReturnType<typeof pushQueueConfiguration> | undefined;
  try {
    preview = pushQueueConfiguration(process.env);
    const current = await readStaffAllocationScope();
    if (current.tenantId !== preview.tenantId) throw Error('Scope changed.');
    scope = current;
  } catch {}
  return (
    <main className="container">
      <p>
        <a href="/">Staff workspace</a>
      </p>
      <h1>Notification queue</h1>
      {preview && scope ? (
        <PushQueueWorkspace scope={scope} />
      ) : (
        <p role="alert">The synthetic notification queue preview is unavailable.</p>
      )}
    </main>
  );
}
