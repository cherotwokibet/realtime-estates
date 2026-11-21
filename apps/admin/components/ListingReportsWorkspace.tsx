'use client';
import { useEffect, useRef, useState } from 'react';
import {
  parseListingReportJson,
  validateListingReportQueue,
  validateListingReportDecisionCommand,
  validateListingReportDecisionReceipt,
  type ListingReportQueue,
  type ListingReportAdminRecord,
  type ListingReportDecisionCommand,
} from '@realtor/domain';
import PrivateWorkspaceBoundary from './PrivateWorkspaceBoundary.tsx';
import { useSealedRecovery } from '../lib/use-sealed-recovery.ts';
import type { RecoveryScope } from '../lib/private-recovery-contract.ts';
import { readBrowserDecodedJson } from '../lib/browser-decoded-json.ts';
class BoundaryError extends Error {
  constructor(readonly status: number) {
    super('Report request unavailable');
  }
}
async function exchange(
  path: string,
  instanceId: string,
  command: ListingReportDecisionCommand | undefined,
  caller: AbortSignal,
) {
  const signal = AbortSignal.any([caller, AbortSignal.timeout(12000)]);
  const response = await fetch(path, {
    method: command ? 'POST' : 'GET',
    headers: {
      'x-preview-instance': instanceId,
      ...(command ? { 'content-type': 'application/json' } : {}),
    },
    ...(command ? { body: JSON.stringify(command) } : {}),
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new BoundaryError(response.status);
  }
  return readBrowserDecodedJson(response, command ? 8192 : 524288, signal, parseListingReportJson);
}
type Props = { instanceId: string; scope: RecoveryScope };
export function ListingReportsWorkspace(props: Props) {
  return (
    <PrivateWorkspaceBoundary
      key={[props.scope.instanceId, props.scope.tenantId, props.scope.actorId].join(':')}
      access={{ profile: 'staff', ...props.scope, role: 'admin' }}
    >
      <ReportsContent {...props} />
    </PrivateWorkspaceBoundary>
  );
}
function ReportsContent({ instanceId, scope }: Props) {
  const recovery = useSealedRecovery(scope, 'report');
  const pending =
    recovery.pending === null ? null : validateListingReportDecisionCommand(recovery.pending);
  const [queue, setQueue] = useState<ListingReportQueue | null>(null),
    [filter, setFilter] = useState<ListingReportQueue['status']>('new'),
    [selected, setSelected] = useState<ListingReportAdminRecord | null>(null),
    [reason, setReason] = useState(''),
    [kind, setKind] = useState<'reviewed' | 'dismissed'>('reviewed'),
    [status, setStatus] = useState('Load reports to begin.'),
    [busy, setBusy] = useState(false);
  const locked = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function failure(e: unknown) {
    if (e instanceof BoundaryError && [401, 403].includes(e.status)) {
      setQueue(null);
      setSelected(null);
      setReason('');
      setStatus(
        'Access unavailable. Private report data was cleared; reload after restoring current admin access.',
      );
    } else
      setStatus(
        'Could not confirm the result. Keep the original review and inspect it before retrying.',
      );
  }
  async function load(before?: string) {
    if (!recovery.ready || recovery.busy || locked.current || pending || reason) return;
    locked.current = true;
    setBusy(true);
    setQueue(null);
    setSelected(null);
    try {
      const raw = await recovery.read((signal) =>
        exchange(
          '/api/listing-reports?limit=20&status=' + filter + (before ? '&before=' + before : ''),
          instanceId,
          undefined,
          signal,
        ),
      );
      if (!alive.current) return;
      if (
        !raw ||
        typeof raw !== 'object' ||
        Array.isArray(raw) ||
        Object.keys(raw).join(',') !== 'queue'
      )
        throw Error();
      setQueue(
        validateListingReportQueue((raw as { queue: unknown }).queue, {
          limit: 20,
          status: filter,
        }),
      );
      setSelected(null);
      setStatus(before ? 'Older report page loaded.' : 'Current report page loaded.');
    } catch (e) {
      if (alive.current) failure(e);
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function review(method: 'GET' | 'POST', command: ListingReportDecisionCommand) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      const receipt = validateListingReportDecisionReceipt(
        await recovery.execute(command, async (original, signal) => {
          const exact = validateListingReportDecisionCommand(original);
          const raw = await exchange(
            `/api/listing-reports/${exact.reportId}/operations/${exact.operationId}`,
            instanceId,
            method === 'POST' ? exact : undefined,
            signal,
          );
          if (
            !raw ||
            typeof raw !== 'object' ||
            Array.isArray(raw) ||
            Object.keys(raw).join(',') !== 'receipt'
          )
            throw Error('Original result is unavailable.');
          return (raw as { receipt: unknown }).receipt;
        }),
        command,
      );
      if (!alive.current) return;
      setReason('');
      setSelected(null);
      setQueue(null);
      setStatus(
        `Review saved at version${receipt.version}. Publication was not changed. Load the current queue to continue.`,
      );
    } catch (e) {
      if (alive.current) {
        if (e instanceof BoundaryError && [400, 409, 422].includes(e.status) && method === 'POST') {
          setSelected(null);
          setQueue(null);
          setStatus(
            'The current attempt was refused. Its encrypted original remains retained; inspect the outcome before another decision.',
          );
        } else failure(e);
      }
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function submit() {
    if (!selected || pending || locked.current) return;
    try {
      const command = validateListingReportDecisionCommand({
        policy: 'listing-report-decision-command-v1',
        operationId: crypto.randomUUID(),
        reportId: selected.reportId,
        expectedVersion: selected.version,
        decision: kind,
        reason: reason.trim(),
      });
      void review('POST', command);
    } catch {
      setStatus('Supply a plain review reason of at most500 characters.');
    }
  }
  return (
    <section aria-label="Private report review">
      <p role="status">{recovery.error}</p>
      {!recovery.ready && <button onClick={recovery.retry}>Retry encrypted recovery</button>}
      <p>
        Synthetic local workflow. Report concerns are unverified. Reviewing or dismissing a report
        does not change property publication.
      </p>
      <label>
        Queue status
        <select
          value={filter}
          disabled={!recovery.ready || recovery.busy || busy || !!pending || !!reason}
          onChange={(e) => {
            setFilter(e.target.value as ListingReportQueue['status']);
            setQueue(null);
            setSelected(null);
          }}
        >
          {['new', 'reviewed', 'dismissed', 'all'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <button
        disabled={!recovery.ready || recovery.busy || busy || !!pending || !!reason}
        onClick={() => void load()}
      >
        Load current reports
      </button>
      <p role="status" aria-live="polite">
        {status}
      </p>
      {queue && (
        <>
          <p>
            {queue.items.length} reports on this page.
            {queue.hasMore ? ' Older reports are available.' : ''}
          </p>
          {queue.items.length === 0 && <p>No reports in this selection.</p>}
          <ul>
            {queue.items.map((r) => (
              <li key={r.reportId}>
                <strong>{r.reason}</strong>
                <p>
                  Property:{r.listingId} · Revision{r.revision} · {r.status}
                </p>
                <p>{r.details ?? 'No further details supplied.'}</p>
                {r.decision && (
                  <p>
                    Review:{r.decision.kind} · {r.decision.reason}
                  </p>
                )}
                <button
                  disabled={
                    !recovery.ready ||
                    recovery.busy ||
                    busy ||
                    !!pending ||
                    !!reason ||
                    r.status !== 'new'
                  }
                  onClick={() => setSelected(r)}
                >
                  Review this report
                </button>
              </li>
            ))}
          </ul>
          {queue.hasMore && (
            <button
              disabled={!recovery.ready || recovery.busy || busy || !!pending || !!reason}
              onClick={() => void load(queue.items.at(-1)!.reportId)}
            >
              Older reports
            </button>
          )}
        </>
      )}
      {selected && (
        <fieldset disabled={!recovery.ready || recovery.busy || busy || !!pending}>
          <legend>Review report {selected.reportId}</legend>
          <label>
            Decision
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="reviewed">Reviewed</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </label>
          <label>
            Review reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              rows={4}
            />
          </label>
          <button onClick={submit}>Save report review</button>
        </fieldset>
      )}
      {!pending && reason && (
        <button
          disabled={busy}
          onClick={() => {
            setReason('');
            setSelected(null);
            setQueue(null);
            setStatus('Local fields discarded. Reload current reports.');
          }}
        >
          Discard local review fields
        </button>
      )}
      {pending && (
        <div>
          <p>
            Original review:{pending.operationId}. The original is encrypted in this tab for
            authorized recovery after reload; no hidden retry is used. Closing the tab can remove
            it.
          </p>
          <pre>{JSON.stringify(pending, null, 2)}</pre>
          <button disabled={recovery.busy || busy} onClick={() => void review('GET', pending)}>
            Check original review
          </button>
          <button disabled={recovery.busy || busy} onClick={() => void review('POST', pending)}>
            Retry exact review
          </button>
        </div>
      )}
    </section>
  );
}
