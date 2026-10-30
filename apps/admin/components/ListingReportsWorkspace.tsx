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
class BoundaryError extends Error {
  constructor(readonly status: number) {
    super('Report request unavailable');
  }
}
async function exchange(path: string, instanceId: string, command?: ListingReportDecisionCommand) {
  const abort = new AbortController(),
    timer = setTimeout(() => abort.abort(), 12000);
  try {
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
      signal: abort.signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new BoundaryError(response.status);
    }
    if (
      response.headers.get('content-type')?.split(';')[0] !== 'application/json' ||
      response.headers.has('content-encoding') ||
      !response.body
    )
      throw Error('Invalid framing');
    const reader = response.body.getReader(),
      decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '',
      bytes = 0,
      empty = 0;
    try {
      for (;;) {
        const p = await reader.read();
        if (p.done) break;
        if (!p.value.byteLength) {
          if (++empty > 1024) throw Error();
          if (empty % 64 === 0) await new Promise((r) => setTimeout(r, 0));
          continue;
        }
        empty = 0;
        bytes += p.value.byteLength;
        if (bytes > (command ? 8192 : 524288)) throw Error();
        text += decoder.decode(p.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return parseListingReportJson(text);
  } finally {
    clearTimeout(timer);
  }
}
export function ListingReportsWorkspace({ instanceId }: { instanceId: string }) {
  const [queue, setQueue] = useState<ListingReportQueue | null>(null),
    [filter, setFilter] = useState<ListingReportQueue['status']>('new'),
    [selected, setSelected] = useState<ListingReportAdminRecord | null>(null),
    [reason, setReason] = useState(''),
    [kind, setKind] = useState<'reviewed' | 'dismissed'>('reviewed'),
    [pending, setPending] = useState<ListingReportDecisionCommand | null>(null),
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
      setPending(null);
      setStatus(
        'Access unavailable. Private report data was cleared; reload after restoring current admin access.',
      );
    } else
      setStatus(
        'Could not confirm the result. Keep the original review and inspect it before retrying.',
      );
  }
  async function load(before?: string) {
    if (locked.current || pending || reason) return;
    locked.current = true;
    setBusy(true);
    setQueue(null);
    setSelected(null);
    try {
      const raw = await exchange(
        '/api/listing-reports?limit=20&status=' + filter + (before ? '&before=' + before : ''),
        instanceId,
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
      const raw = await exchange(
        `/api/listing-reports/${command.reportId}/operations/${command.operationId}`,
        instanceId,
        method === 'POST' ? command : undefined,
      );
      if (!alive.current) return;
      if (
        !raw ||
        typeof raw !== 'object' ||
        Array.isArray(raw) ||
        Object.keys(raw).join(',') !== 'receipt'
      )
        throw Error();
      const receipt = validateListingReportDecisionReceipt(
        (raw as { receipt: unknown }).receipt,
        command,
      );
      setPending(null);
      setReason('');
      setSelected(null);
      setQueue(null);
      setStatus(
        `Review saved at version${receipt.version}. Publication was not changed. Load the current queue to continue.`,
      );
    } catch (e) {
      if (alive.current) {
        if (e instanceof BoundaryError && [400, 409, 422].includes(e.status) && method === 'POST') {
          setPending(null);
          setSelected(null);
          setQueue(null);
          setStatus(
            'Review refused without a saved result. Discard local fields and reload the current queue before another decision.',
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
      setPending(command);
      void review('POST', command);
    } catch {
      setStatus('Supply a plain review reason of at most500 characters.');
    }
  }
  return (
    <section>
      <p>
        Synthetic local workflow. Report concerns are unverified. Reviewing or dismissing a report
        does not change property publication.
      </p>
      <label>
        Queue status
        <select
          value={filter}
          disabled={busy || !!pending || !!reason}
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
      <button disabled={busy || !!pending || !!reason} onClick={() => void load()}>
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
                  disabled={busy || !!pending || !!reason || r.status !== 'new'}
                  onClick={() => setSelected(r)}
                >
                  Review this report
                </button>
              </li>
            ))}
          </ul>
          {queue.hasMore && (
            <button
              disabled={busy || !!pending || !!reason}
              onClick={() => void load(queue.items.at(-1)!.reportId)}
            >
              Older reports
            </button>
          )}
        </>
      )}
      {selected && (
        <fieldset disabled={busy || !!pending}>
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
            Original review:{pending.operationId}. Keep this page open; no browser storage or hidden
            retry is used.
          </p>
          <button disabled={busy} onClick={() => void review('GET', pending)}>
            Check original review
          </button>
          <button disabled={busy} onClick={() => void review('POST', pending)}>
            Retry exact review
          </button>
        </div>
      )}
    </section>
  );
}
