'use client';
import { validateSyntheticPushQueueSummary } from '@realtor/domain';
import PrivateWorkspaceBoundary from './PrivateWorkspaceBoundary.tsx';
import type { RecoveryScope } from '../lib/private-recovery-contract.ts';
import { usePrivateSummary } from '../lib/use-private-summary.ts';
export function PushQueueWorkspace({ scope }: { scope: RecoveryScope }) {
  return (
    <PrivateWorkspaceBoundary
      key={[scope.instanceId, scope.tenantId, scope.actorId].join(':')}
      access={{ profile: 'staff', ...scope, role: 'admin' }}
    >
      <PushQueueContent scope={scope} />
    </PrivateWorkspaceBoundary>
  );
}
function PushQueueContent({ scope }: { scope: RecoveryScope }) {
  const read = usePrivateSummary(scope, 'push');
  const summary =
    read.data === null ? null : validateSyntheticPushQueueSummary(read.data, scope.tenantId);
  const loading = read.busy,
    refresh = read.refresh;
  const status =
    read.error ||
    (loading
      ? 'Loading queue summary.'
      : summary
        ? 'Queue summary loaded.'
        : 'Load the current queue counts.');
  return (
    <section aria-label="Synthetic notification queue">
      <button type="button" onClick={() => void refresh()} disabled={loading}>
        Refresh queue summary
      </button>
      <p role="status">{status}</p>
      {summary && (
        <dl>
          <div>
            <dt>Due</dt>
            <dd>{summary.due}</dd>
          </div>
          <div>
            <dt>Scheduled</dt>
            <dd>{summary.scheduled}</dd>
          </div>
          <div>
            <dt>Waiting for retry</dt>
            <dd>{summary.waitingForRetry}</dd>
          </div>
          <div>
            <dt>Captured</dt>
            <dd>{summary.captured}</dd>
          </div>
          <div>
            <dt>Suppressed</dt>
            <dd>{summary.suppressed}</dd>
          </div>
          <div>
            <dt>Oldest due job</dt>
            <dd>
              {summary.oldestDueAgeSeconds === null
                ? 'None'
                : summary.oldestDueAgeSeconds + ' seconds'}
            </dd>
          </div>
          <div>
            <dt>Oldest retry job</dt>
            <dd>
              {summary.oldestRetryAgeSeconds === null
                ? 'None'
                : summary.oldestRetryAgeSeconds + ' seconds'}
            </dd>
          </div>
          <div>
            <dt>Next retry</dt>
            <dd>
              {summary.nextRetryAt ? (
                <time dateTime={summary.nextRetryAt}>{summary.nextRetryAt}</time>
              ) : (
                'None scheduled'
              )}
            </dd>
          </div>
          <div>
            <dt>Measured at</dt>
            <dd>
              <time dateTime={summary.asOf}>{summary.asOf}</time>
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
