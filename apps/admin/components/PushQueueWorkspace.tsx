'use client';

import { useEffect, useRef, useState } from 'react';
import { validateSyntheticPushQueueSummary } from '@realtor/domain';
import { readReferenceJson } from '../lib/reference-draft-wire';

type Summary = ReturnType<typeof validateSyntheticPushQueueSummary>;

export function PushQueueWorkspace({
  instanceId,
  tenantId,
}: {
  instanceId: string;
  tenantId: string;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Load the current queue counts.');
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );

  async function refresh() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]);
    setSummary(null);
    setLoading(true);
    setStatus('Loading queue summary.');
    try {
      const response = await fetch('/api/push-queue', {
        headers: { 'x-preview-instance': instanceId },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal,
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        if (request.current === controller)
          setStatus(
            response.status === 401 || response.status === 403
              ? 'Queue access is unavailable.'
              : 'Could not load the queue summary.',
          );
        return;
      }
      const result = validateSyntheticPushQueueSummary(
        await readReferenceJson(response, 4096, signal),
        tenantId,
      );
      if (request.current === controller) {
        setSummary(result);
        setStatus('Queue summary loaded.');
      }
    } catch {
      if (request.current === controller) setStatus('Could not load the queue summary.');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }

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
