'use client';

import { useEffect, useRef, useState } from 'react';
import {
  validateDeletionPrivacyQueue,
  validateDeletionPrivacyReceipt,
  validateDeletionProcessingPlan,
  type CustomerDeletionReviewTarget,
  type DeletionPrivacyCommand,
  type DeletionPrivacyDecision,
} from '@realtor/domain';
import { readReferenceJson } from '../lib/reference-draft-wire';

const route = '/api/deletion-privacy';
const limit = 20;
const labels = { plan_review: 'Review processing plan', hold: 'Place on hold' } satisfies Record<
  DeletionPrivacyDecision,
  string
>;
type Receipt = ReturnType<typeof validateDeletionPrivacyReceipt>;
type Plan = ReturnType<typeof validateDeletionProcessingPlan>;
const inventoryLabels = {
  favouriteStates: 'Saved property records',
  favouriteReceipts: 'Saved property receipts',
  pushPreferences: 'Notification preferences',
  pushRegistrations: 'Notification registrations',
  activePushRegistrations: 'Active notification registrations',
  pushReceipts: 'Notification receipts',
  linkedEnquiries: 'Linked enquiries',
  linkedViewings: 'Linked viewings',
  returnReceipts: 'Return-to-review receipts',
} satisfies Record<keyof Plan['inventory'], string>;
const requirements = [
  'Verify the customer identity and linked memberships.',
  'Record the retention reason and expiry for operational history.',
  'Identify the minimum audit and receipt evidence to retain.',
  'Review unlinked enquiries separately to verify identity.',
  'Check for applicable holds.',
  'Verify provider control and disposition.',
  'Verify backup custody, expiry and reapplication after restore.',
];

function decisionPath(target: CustomerDeletionReviewTarget) {
  return [route, target.customerId, target.requestId, target.operationId].join('/');
}

type Queue = ReturnType<typeof validateDeletionPrivacyQueue>;
type Pending = { command: DeletionPrivacyCommand; canRetry: boolean };

class PrivacyExchangeError extends Error {
  constructor(readonly status: number) {
    super('Privacy review request unavailable.');
  }
}

export function DeletionPrivacyWorkspace({
  instanceId,
  scope,
  processingPlanEnabled,
}: {
  instanceId: string;
  processingPlanEnabled: boolean;
  scope: { tenantId: string; reviewerId: string };
}) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [selected, setSelected] = useState<Queue['items'][number] | null>(null);
  const [decision, setDecision] = useState<DeletionPrivacyDecision | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [planningReceipt, setPlanningReceipt] = useState<Receipt | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [status, setStatus] = useState('Load eligible requests to begin.');
  const active = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );

  async function exchange(path: string, signal: AbortSignal, command?: DeletionPrivacyCommand) {
    const response = await fetch(path, {
      method: command ? 'POST' : 'GET',
      headers: {
        'x-preview-instance': instanceId,
        ...(command && { 'content-type': 'application/json' }),
      },
      ...(command && { body: JSON.stringify(command) }),
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new PrivacyExchangeError(response.status);
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

  function select(item: typeof selected) {
    setSelected(item);
    setDecision(null);
    setConfirmed(false);
  }

  function accessLost(error: unknown) {
    if (!(error instanceof PrivacyExchangeError) || ![401, 403].includes(error.status))
      return false;
    setDenied(true);
    setPlanningReceipt(null);
    setPlan(null);
    setQueue(null);
    setPending(null);
    select(null);
    setStatus('Privacy reviewer access is unavailable.');
    return true;
  }

  function load(after: string | null = null) {
    void run(async (signal, current) => {
      setPlanningReceipt(null);
      setPlan(null);
      try {
        const params = new URLSearchParams({ limit: String(limit) });
        if (after) params.set('after', after);
        const page = validateDeletionPrivacyQueue(
          await exchange(route + '?' + params, signal),
          limit,
          after,
          scope,
        );
        if (!current()) return;
        setQueue(page);
        select(null);
        setStatus(
          page.items.length ? 'Eligible requests loaded.' : 'No eligible requests on this page.',
        );
      } catch (error) {
        if (!current() || accessLost(error)) return;
        setQueue(null);
        select(null);
        setStatus('Could not load eligible requests.');
      }
    });
  }

  function settle(command: DeletionPrivacyCommand, recover = false) {
    void run(async (signal, current) => {
      const path = decisionPath(command);
      try {
        const receipt = validateDeletionPrivacyReceipt(
          await exchange(path, signal, recover ? undefined : command),
          { ...scope, ...command },
        );
        if (!current()) return;
        setQueue(null);
        setPending(null);
        setPlanningReceipt(
          processingPlanEnabled && receipt.decision === 'plan_review' ? receipt : null,
        );
        setPlan(null);
        select(null);
        setStatus(
          labels[receipt.decision] + (recover ? ' decision recovered.' : ' decision recorded.'),
        );
      } catch (error) {
        if (!current() || accessLost(error)) return;
        if (recover && error instanceof PrivacyExchangeError && error.status === 404) {
          setPending({ command, canRetry: true });
          setStatus('No original receipt found. You can retry the same decision.');
          return;
        }
        if (
          !recover &&
          error instanceof PrivacyExchangeError &&
          [400, 404, 409].includes(error.status)
        ) {
          setQueue(null);
          setPending(null);
          select(null);
          setStatus('The decision was refused. Reload eligible requests before continuing.');
          return;
        }
        setPending({ command, canRetry: false });
        setStatus('The decision could not be confirmed. Check the original receipt.');
      }
    });
  }

  function loadPlan(receipt: Receipt) {
    void run(async (signal, current) => {
      setPlan(null);
      setStatus('Loading the processing plan.');
      try {
        const value = validateDeletionProcessingPlan(
          await exchange(decisionPath(receipt) + '/processing-plan', signal),
          {
            ...scope,
            customerId: receipt.customerId,
            requestId: receipt.requestId,
            operationId: receipt.operationId,
          },
        );
        if (value.decision.decidedAt !== receipt.decidedAt) throw Error('Privacy receipt changed.');
        if (!current()) return;
        setPlan(value);
        setStatus('Processing plan loaded.');
      } catch (error) {
        if (!current() || accessLost(error)) return;
        setStatus('Could not load the processing plan for this decision.');
      }
    });
  }

  const last = queue?.items.at(-1);
  return (
    <section aria-labelledby="privacy-queue">
      <h2 id="privacy-queue">Eligible deletion requests</h2>
      <p>Synthetic preview. These decisions do not delete accounts or contact providers.</p>
      <p role="status">{status}</p>
      <button type="button" disabled={busy || denied || !!pending} onClick={() => load()}>
        Load eligible requests
      </button>
      {queue?.items.length ? (
        <ul>
          {queue.items.map((item) => (
            <li key={item.requestId}>
              <button
                type="button"
                aria-pressed={selected?.requestId === item.requestId}
                disabled={busy || !!pending}
                onClick={() => select(item)}
              >
                Review request {item.requestId}
              </button>{' '}
              <time dateTime={item.readyAt}>{item.readyAt}</time>
            </li>
          ))}
        </ul>
      ) : null}
      {queue?.hasMore && last && (
        <button type="button" disabled={busy || !!pending} onClick={() => load(last.customerId)}>
          Next page
        </button>
      )}
      {selected && (
        <fieldset disabled={busy || !!pending}>
          <legend>Decision for request {selected.requestId}</legend>
          {(Object.keys(labels) as DeletionPrivacyDecision[]).map((option) => (
            <p key={option}>
              <label>
                <input
                  type="radio"
                  name="decision"
                  checked={decision === option}
                  onChange={() => {
                    setDecision(option);
                    setConfirmed(false);
                  }}
                />{' '}
                {labels[option]}
              </label>
            </p>
          ))}
          <p>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                disabled={!decision}
                onChange={(event) => setConfirmed(event.target.checked)}
              />{' '}
              Confirm this decision for the selected request
            </label>
          </p>
          <button
            type="button"
            disabled={!decision || !confirmed}
            onClick={() => {
              if (decision && confirmed)
                settle({
                  customerId: selected.customerId,
                  requestId: selected.requestId,
                  operationId: crypto.randomUUID(),
                  decision,
                });
            }}
          >
            Record privacy decision
          </button>
        </fieldset>
      )}
      {planningReceipt && (
        <section aria-labelledby="processing-plan">
          <h3 id="processing-plan">Read-only processing plan</h3>
          <p>Request {planningReceipt.requestId}</p>
          <button type="button" disabled={busy} onClick={() => loadPlan(planningReceipt)}>
            {plan ? 'Refresh processing plan' : 'Load processing plan'}
          </button>
          {plan && (
            <>
              <h4>Linked record counts</h4>
              <dl>
                {(Object.keys(inventoryLabels) as (keyof Plan['inventory'])[]).map((key) => (
                  <div key={key}>
                    <dt>{inventoryLabels[key]}</dt>
                    <dd>{plan.inventory[key]}</dd>
                  </div>
                ))}
              </dl>
              <h4>Checks still required</h4>
              <ul>
                {requirements.map((requirement) => (
                  <li key={requirement}>{requirement}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {pending && (
        <div>
          <button type="button" disabled={busy} onClick={() => settle(pending.command, true)}>
            Check original receipt
          </button>
          {pending.canRetry && (
            <button type="button" disabled={busy} onClick={() => settle(pending.command)}>
              Retry the same decision
            </button>
          )}
        </div>
      )}
    </section>
  );
}
