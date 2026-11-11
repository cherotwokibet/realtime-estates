'use client';
import { useEffect, useRef, useState } from 'react';
import {
  validateCustomerDeletionReviewReceipt,
  validateCustomerDeletionTriage,
  type CustomerDeletionDisposition,
  type CustomerDeletionReviewCommand,
} from '@realtor/domain';
import { readReferenceJson } from '../lib/reference-draft-wire';

type Queue = ReturnType<typeof validateCustomerDeletionTriage>;
type Pending = { command: CustomerDeletionReviewCommand; phase: 'uncertain' | 'missing' };
const labels = {
  ready_for_privacy_review: 'Ready for privacy review',
  needs_information: 'Needs information',
} satisfies Record<CustomerDeletionDisposition, string>;
const base = '/api/deletion-triage';
class ExchangeError extends Error {
  constructor(readonly status: number) {
    super('Deletion triage request unavailable.');
  }
}
export function DeletionTriageWorkspace({
  instanceId,
  scope,
}: {
  instanceId: string;
  scope: { tenantId: string; reviewerId: string };
}) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [selected, setSelected] = useState<Queue['items'][number] | null>(null);
  const [decision, setDecision] = useState<CustomerDeletionDisposition | ''>('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Load unreviewed requests to begin.');
  const [denied, setDenied] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );

  async function exchange(
    path: string,
    signal: AbortSignal,
    command?: CustomerDeletionReviewCommand,
  ) {
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
      throw new ExchangeError(response.status);
    }
    return readReferenceJson(response, 16384, signal);
  }

  async function run(action: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
    if (active.current || denied) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    const current = () => active.current === controller;
    try {
      await action(AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]), current);
    } finally {
      if (current()) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  function clearSelection() {
    setSelected(null);
    setDecision('');
  }
  function accessLost(error: unknown) {
    if (!(error instanceof ExchangeError) || ![401, 403].includes(error.status)) return false;
    setDenied(true);
    setQueue(null);
    setPending(null);
    clearSelection();
    setStatus('Review access is unavailable.');
    return true;
  }

  function load(after: string | null = null) {
    void run(async (signal, current) => {
      try {
        const value = await exchange(base + '?limit=20' + (after ? '&after=' + after : ''), signal);
        const page = validateCustomerDeletionTriage(value, 20, after, scope.tenantId);
        if (!current()) return;
        setQueue(page);
        clearSelection();
        setStatus(page.items.length ? 'Unreviewed requests loaded.' : 'No unreviewed requests.');
      } catch (error) {
        if (!current() || accessLost(error)) return;
        setQueue(null);
        clearSelection();
        setStatus('Could not load unreviewed requests.');
      }
    });
  }

  function settle(command: CustomerDeletionReviewCommand, recover = false) {
    void run(async (signal, current) => {
      const { customerId, requestId, operationId } = command;
      const path = base + '/' + customerId + '/' + requestId + '/' + operationId;
      try {
        const value = await exchange(path, signal, recover ? undefined : command);
        const receipt = validateCustomerDeletionReviewReceipt(value, { ...scope, ...command });
        if (!current()) return;
        setPending(null);
        clearSelection();
        setQueue(null);
        setStatus(labels[receipt.disposition] + ' recorded. Reload to see remaining requests.');
      } catch (error) {
        if (!current() || accessLost(error)) return;
        if (recover && error instanceof ExchangeError && error.status === 404) {
          setPending({ command, phase: 'missing' });
          setStatus('No original decision found. You can retry the same decision.');
          return;
        }
        if (!recover && error instanceof ExchangeError && error.status < 500) {
          setPending(null);
          clearSelection();
          setQueue(null);
          setStatus('The decision was refused. Reload the queue before continuing.');
          return;
        }
        setPending({ command, phase: 'uncertain' });
        setStatus('The decision could not be confirmed. Check the original receipt.');
      }
    });
  }

  const last = queue?.items.at(-1);
  return (
    <section aria-labelledby="triage-heading">
      <h2 id="triage-heading">Unreviewed requests</h2>
      <p role="status">{status}</p>
      <button type="button" disabled={busy || denied || !!pending} onClick={() => load()}>
        Load unreviewed requests
      </button>
      {queue && queue.items.length > 0 && (
        <ul>
          {queue.items.map((item) => (
            <li key={item.customerId}>
              <p>
                Request {item.requestId} ·{' '}
                <time dateTime={item.requestedAt}>{item.requestedAt}</time>
              </p>
              <button
                type="button"
                aria-pressed={selected?.customerId === item.customerId}
                disabled={busy || !!pending}
                onClick={() => {
                  setSelected(item);
                  setDecision('');
                }}
              >
                Review request for {item.customerId}
              </button>
            </li>
          ))}
        </ul>
      )}
      {queue?.hasMore && last && (
        <button type="button" disabled={busy || !!pending} onClick={() => load(last.customerId)}>
          Next page
        </button>
      )}
      {selected && !pending && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!decision || active.current) return;
            settle({
              policy: 'synthetic-customer-deletion-review-command-v1',
              customerId: selected.customerId,
              requestId: selected.requestId,
              operationId: crypto.randomUUID(),
              disposition: decision,
            });
          }}
        >
          <label htmlFor="triage-decision">Triage decision</label>
          <select
            id="triage-decision"
            value={decision}
            disabled={busy}
            onChange={(event) => {
              const value = event.target.value;
              setDecision(
                value === 'ready_for_privacy_review' || value === 'needs_information' ? value : '',
              );
            }}
          >
            <option value="">Choose a decision</option>
            <option value="ready_for_privacy_review">{labels.ready_for_privacy_review}</option>
            <option value="needs_information">{labels.needs_information}</option>
          </select>
          <button type="submit" disabled={busy || !decision}>
            Confirm triage decision
          </button>
        </form>
      )}
      {pending?.phase === 'uncertain' && (
        <button type="button" disabled={busy} onClick={() => settle(pending.command, true)}>
          Check original decision
        </button>
      )}
      {pending?.phase === 'missing' && (
        <button type="button" disabled={busy} onClick={() => settle(pending.command)}>
          Retry the same decision
        </button>
      )}
    </section>
  );
}
