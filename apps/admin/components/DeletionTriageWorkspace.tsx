'use client';
import { useEffect, useRef, useState } from 'react';
import {
  validateCustomerDeletionReviewReceipt,
  validateCustomerDeletionReturnReceipt,
  type CustomerDeletionReviewTarget,
  validateCustomerDeletionTriage,
  validateCustomerDeletionFollowUp,
  type CustomerDeletionDisposition,
  type CustomerDeletionReviewCommand,
} from '@realtor/domain';
import { readBrowserDecodedJson } from '../lib/browser-decoded-json.ts';
import PrivateWorkspaceBoundary, { usePrivateWorkspaceClear } from './PrivateWorkspaceBoundary.tsx';
import { useSealedRecovery } from '../lib/use-sealed-recovery.ts';
import { recoveryCommand } from '../lib/private-recovery-contract.ts';

type Queue = ReturnType<typeof validateCustomerDeletionTriage>;
type FollowUpQueue = ReturnType<typeof validateCustomerDeletionFollowUp>;
type Pending = {
  command: CustomerDeletionReviewCommand | CustomerDeletionReviewTarget;
  phase: 'uncertain' | 'missing';
};
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
type Props = {
  instanceId: string;
  scope: { tenantId: string; reviewerId: string };
  followUp: boolean;
};
export function DeletionTriageWorkspace(props: Props) {
  return (
    <PrivateWorkspaceBoundary
      key={[props.instanceId, props.scope.tenantId, props.scope.reviewerId].join(':')}
      access={{
        profile: 'deletion-triage',
        instanceId: props.instanceId,
        tenantId: props.scope.tenantId,
        actorId: props.scope.reviewerId,
        role: 'admin',
      }}
    >
      <DeletionTriageContent {...props} />
    </PrivateWorkspaceBoundary>
  );
}
function DeletionTriageContent({ instanceId, scope, followUp }: Props) {
  const clearPrivate = usePrivateWorkspaceClear();
  const recovery = useSealedRecovery(
    { instanceId, tenantId: scope.tenantId, actorId: scope.reviewerId },
    'deletion-triage',
  );
  const [queue, setQueue] = useState<Queue | FollowUpQueue | null>(null);
  const [selected, setSelected] = useState<Queue['items'][number] | null>(null);
  const [decision, setDecision] = useState<CustomerDeletionDisposition | ''>('');
  const [returnSelection, setReturnSelection] = useState<FollowUpQueue['items'][number] | null>(
    null,
  );
  const [attempt, setAttempt] = useState<Pending | null>(null);
  const original =
    recovery.pending === null
      ? null
      : (recoveryCommand('deletion-triage', recovery.pending) as Pending['command']);
  const pending: Pending | null = original
    ? {
        command: original,
        phase: attempt?.command.operationId === original.operationId ? attempt.phase : 'uncertain',
      }
    : null;
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
    command?: CustomerDeletionReviewCommand | CustomerDeletionReviewTarget,
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
    return readBrowserDecodedJson(response, 16384, signal);
  }

  async function run(action: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
    if (active.current || denied || !recovery.ready || recovery.busy) return;
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
    setReturnSelection(null);
    setDecision('');
  }
  function accessLost(error: unknown) {
    if (!(error instanceof ExchangeError) || ![401, 403].includes(error.status)) return false;
    clearPrivate();
    setDenied(true);
    setQueue(null);
    setAttempt(null);
    clearSelection();
    setStatus('Review access is unavailable.');
    return true;
  }

  function load(after: string | null = null, outcome?: CustomerDeletionDisposition) {
    void run(async (signal, current) => {
      try {
        const params = new URLSearchParams({ limit: '20' });
        if (after) params.set('after', after);
        if (outcome) params.set('disposition', outcome);
        const value = await recovery.read((owned) =>
          exchange(base + '?' + params, AbortSignal.any([signal, owned])),
        );
        const page = outcome
          ? validateCustomerDeletionFollowUp(value, 20, after, scope.tenantId, outcome)
          : validateCustomerDeletionTriage(value, 20, after, scope.tenantId);
        if (!current()) return;
        setQueue(page);
        clearSelection();
        const queueName = outcome ? labels[outcome] : 'Unreviewed requests';
        setStatus(page.items.length ? queueName + ' loaded.' : 'No requests in this queue.');
      } catch (error) {
        if (!current() || accessLost(error)) return;
        setQueue(null);
        clearSelection();
        setStatus('Could not load requests.');
      }
    });
  }

  function settle(
    command: CustomerDeletionReviewCommand | CustomerDeletionReviewTarget,
    recover = false,
  ) {
    void run(async (signal, current) => {
      const { customerId, requestId, operationId } = command;
      const isReturn = !('disposition' in command);
      const path =
        base + '/' + customerId + '/' + requestId + '/' + operationId + (isReturn ? '/return' : '');
      try {
        const value = await recovery.execute(command, (_original, owned) =>
          exchange(path, AbortSignal.any([signal, owned]), recover ? undefined : command),
        );
        let outcome: string;
        if (isReturn) {
          validateCustomerDeletionReturnReceipt(value, { ...scope, ...command });
          outcome = 'Returned to privacy review.';
        } else {
          const receipt = validateCustomerDeletionReviewReceipt(value, { ...scope, ...command });
          outcome = labels[receipt.disposition] + ' recorded.';
        }
        if (!current()) return;
        setAttempt(null);
        clearSelection();
        setQueue(null);
        setStatus(outcome + ' Reload to see remaining requests.');
      } catch (error) {
        if (!current() || accessLost(error)) return;
        if (recover && error instanceof ExchangeError && error.status === 404) {
          setAttempt({ command, phase: 'missing' });
          setStatus(
            isReturn
              ? 'No original return found. You can retry the same return.'
              : 'No original decision found. You can retry the same decision.',
          );
          return;
        }
        if (!recover && error instanceof ExchangeError && error.status < 500) {
          setAttempt({ command, phase: 'uncertain' });
          clearSelection();
          setQueue(null);
          setStatus(
            isReturn
              ? 'The return was refused. Its encrypted original is retained; check its receipt before further work.'
              : 'The decision was refused. Its encrypted original is retained; check its receipt before further work.',
          );
          return;
        }
        setAttempt({ command, phase: 'uncertain' });
        setStatus(
          isReturn
            ? 'The return could not be confirmed. Check the original receipt.'
            : 'The decision could not be confirmed. Check the original receipt.',
        );
      }
    });
  }

  if (!recovery.ready)
    return (
      <section aria-label="Encrypted deletion recovery">
        <p role="status">{recovery.error}</p>
        <button type="button" onClick={recovery.retry}>
          Retry encrypted recovery
        </button>
      </section>
    );
  const last = queue?.items.at(-1);
  const outcome = queue && 'disposition' in queue ? queue.disposition : undefined;
  return (
    <section aria-labelledby="triage-heading">
      <h2 id="triage-heading">{outcome ? labels[outcome] : 'Unreviewed requests'}</h2>
      <p role="status">{status}</p>
      {recovery.error && <p role="status">{recovery.error}</p>}
      {busy && (
        <button
          type="button"
          onClick={() => {
            recovery.cancel();
            active.current?.abort();
          }}
        >
          Stop waiting; retain original
        </button>
      )}
      <button type="button" disabled={busy || denied || !!pending} onClick={() => load()}>
        Load unreviewed requests
      </button>
      {followUp &&
        (Object.keys(labels) as CustomerDeletionDisposition[]).map((value) => (
          <button
            key={value}
            type="button"
            disabled={busy || denied || !!pending}
            onClick={() => load(null, value)}
          >
            {labels[value]}
          </button>
        ))}
      {queue && queue.items.length > 0 && (
        <ul>
          {queue.items.map((item) => (
            <li key={item.customerId}>
              <p>
                Request {item.requestId} ·{' '}
                <time dateTime={'reviewedAt' in item ? item.reviewedAt : item.requestedAt}>
                  {'reviewedAt' in item ? item.reviewedAt : item.requestedAt}
                </time>
              </p>
              {'requestedAt' in item && (
                <button
                  type="button"
                  aria-pressed={selected?.customerId === item.customerId}
                  disabled={busy || !!pending}
                  onClick={() => {
                    setReturnSelection(null);
                    setSelected(item);
                    setDecision('');
                  }}
                >
                  Review request for {item.customerId}
                </button>
              )}
              {outcome === 'needs_information' && 'reviewedAt' in item && (
                <button
                  type="button"
                  disabled={busy || !!pending}
                  aria-pressed={returnSelection?.customerId === item.customerId}
                  onClick={() => {
                    clearSelection();
                    setReturnSelection(item);
                  }}
                >
                  Return request {item.requestId} to privacy review
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {queue?.hasMore && last && (
        <button
          type="button"
          disabled={busy || !!pending}
          onClick={() => load(last.customerId, outcome)}
        >
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
      {returnSelection && !pending && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (active.current) return;
            settle({
              customerId: returnSelection.customerId,
              requestId: returnSelection.requestId,
              operationId: crypto.randomUUID(),
            });
          }}
        >
          <p>Move request {returnSelection.requestId} to Ready for privacy review.</p>
          <button type="submit" disabled={busy}>
            Confirm return to privacy review
          </button>
          <button type="button" disabled={busy} onClick={clearSelection}>
            Cancel
          </button>
        </form>
      )}
      {pending?.phase === 'uncertain' && (
        <button type="button" disabled={busy} onClick={() => settle(pending.command, true)}>
          {'disposition' in pending.command ? 'Check original decision' : 'Check original return'}
        </button>
      )}
      {pending?.phase === 'missing' && (
        <button type="button" disabled={busy} onClick={() => settle(pending.command)}>
          {'disposition' in pending.command ? 'Retry the same decision' : 'Retry the same return'}
        </button>
      )}
    </section>
  );
}
