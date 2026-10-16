'use client';
import { useRef, useState } from 'react';
import type { ViewingDetail } from '@realtor/api-client';
import { EnquiryPreviewError, type EnquiryPreviewClient } from '../lib/enquiry-client';
import {
  prepareViewingReminderAdmissionAttempt,
  prepareViewingReminderCaptureAttempt,
} from '../lib/viewing-reminder-attempt';
import { formatEnquiryTime, fromNairobiInput } from '../lib/enquiry-model';
type AdmissionAttempt = ReturnType<typeof prepareViewingReminderAdmissionAttempt>;
type CaptureAttempt = ReturnType<typeof prepareViewingReminderCaptureAttempt>;
type Props = {
  client: EnquiryPreviewClient;
  enquiryId: string;
  selected: ViewingDetail;
  hasAccess: boolean;
  onGuard: (guard: boolean) => void;
  onAccessDenied: (error: unknown) => void;
};
export default function ViewingReminder({
  client,
  enquiryId,
  selected,
  hasAccess,
  onGuard,
  onAccessDenied,
}: Props) {
  const [due, setDue] = useState(''),
    [expiry, setExpiry] = useState(''),
    [admission, setAdmission] = useState<AdmissionAttempt | null>(null),
    [capture, setCapture] = useState<CaptureAttempt | null>(null);
  const originalAdmission = useRef<AdmissionAttempt | null>(null),
    originalCapture = useRef<CaptureAttempt | null>(null),
    lock = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const uncertain = admission?.status === 'uncertain' || capture?.status === 'uncertain';
  async function run(kind: 'admission' | 'capture', mode: 'submit' | 'recover' | 'replay') {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (kind === 'admission') {
        let a = originalAdmission.current;
        if (mode === 'submit') {
          if (a || !hasAccess || selected.schedule.status !== 'confirmed')
            throw new EnquiryPreviewError('validation');
          a = prepareViewingReminderAdmissionAttempt(
            client,
            enquiryId,
            selected.schedule.viewingId,
            {
              operationId: crypto.randomUUID(),
              expectedVersion: selected.schedule.version,
              dueAt: fromNairobiInput(due),
              expiresAt: fromNairobiInput(expiry),
            },
          );
          originalAdmission.current = a;
          setAdmission(a);
          onGuard(true);
        }
        if (!a) throw new EnquiryPreviewError('validation');
        await (mode === 'submit'
          ? a.submit()
          : mode === 'recover'
            ? a.recoverOriginal()
            : a.replayOriginal());
      } else {
        let a = originalCapture.current;
        if (mode === 'submit') {
          const receipt = originalAdmission.current?.receipt;
          if (a || !hasAccess || receipt?.outcome !== 'admitted')
            throw new EnquiryPreviewError('validation');
          a = prepareViewingReminderCaptureAttempt(client, receipt, {
            operationId: crypto.randomUUID(),
          });
          originalCapture.current = a;
          setCapture(a);
          onGuard(true);
        }
        if (!a) throw new EnquiryPreviewError('validation');
        await (mode === 'submit'
          ? a.submit()
          : mode === 'recover'
            ? a.recoverOriginal()
            : a.replayOriginal());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Synthetic reminder unavailable.');
      if (e instanceof EnquiryPreviewError && [401, 403, 404].includes(e.status)) onAccessDenied(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function clear() {
    if (
      lock.current ||
      originalAdmission.current?.status === 'uncertain' ||
      originalCapture.current?.status === 'uncertain'
    )
      return;
    originalAdmission.current = null;
    originalCapture.current = null;
    setAdmission(null);
    setCapture(null);
    setDue('');
    setExpiry('');
    setError('');
    onGuard(false);
  }
  function finishCapture() {
    if (lock.current || originalCapture.current?.status !== 'received') return;
    originalCapture.current = null;
    setCapture(null);
    setError('');
  }
  return (
    <section aria-label="Synthetic viewing reminder">
      <h4>Test a synthetic reminder</h4>
      <p>
        No customer message is sent. This records a SQL-only test capture, with no recipient or
        delivery provider.
      </p>
      <p>
        Selected confirmed viewing {selected.schedule.viewingId} · version{' '}
        {selected.schedule.version}. Exact time:{' '}
        {formatEnquiryTime(selected.schedule.proposedSlot?.startAt ?? null)} –{' '}
        {formatEnquiryTime(selected.schedule.proposedSlot?.endAt ?? null)}. Refreshing leaves this
        selection unchanged.
      </p>
      <form
        className="enq-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run('admission', 'submit');
        }}
      >
        <fieldset disabled={busy || !!admission || !hasAccess}>
          <legend>Explicit test window · Nairobi</legend>
          <p>
            Enter due and expiry deliberately. No cadence is assumed. The service checks
            confirmation time and requires expiry at or before the viewing starts.
          </p>
          <label>
            Test reminder due · Nairobi
            <input
              type="datetime-local"
              step="0.001"
              required
              value={due}
              onInput={(e) => {
                setDue(e.currentTarget.value);
                onGuard(true);
              }}
              onChange={(e) => {
                setDue(e.target.value);
                onGuard(true);
              }}
            />
          </label>
          <label>
            Test reminder expiry · Nairobi
            <input
              type="datetime-local"
              step="0.001"
              required
              value={expiry}
              onInput={(e) => {
                setExpiry(e.currentTarget.value);
                onGuard(true);
              }}
              onChange={(e) => {
                setExpiry(e.target.value);
                onGuard(true);
              }}
            />
          </label>
          <button className="enq-primary" type="submit">
            Save synthetic reminder admission
          </button>
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Synthetic reminder operation in progress…</p>}
      {admission && (
        <div className="enq-recovery">
          <h4>
            {admission.receipt
              ? `Admission ${admission.receipt.outcome}`
              : admission.status === 'uncertain'
                ? 'Admission result uncertain'
                : `Admission ${admission.status}`}
          </h4>
          <p>
            Original admission {admission.original.command.operationId}. This historical decision
            does not change your selected version.
          </p>
          {admission.receipt?.reason && (
            <p>
              Service decision: {admission.receipt.reason}. Finish this original work before
              preparing a new admission.
            </p>
          )}
          {admission.status === 'uncertain' && (
            <>
              <p>Failed recovery does not prove the save failed. No automatic retry occurs.</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run('admission', 'recover')}
              >
                Read original reminder admission
              </button>
              <button type="button" disabled={busy} onClick={() => void run('admission', 'replay')}>
                Replay exact original reminder admission
              </button>
            </>
          )}
          <details>
            <summary>Original reminder admission kept in this tab</summary>
            <pre>
              {JSON.stringify(
                { original: admission.original, receipt: admission.receipt },
                null,
                2,
              )}
            </pre>
          </details>
        </div>
      )}
      {admission?.receipt?.outcome === 'admitted' && !capture && (
        <button
          type="button"
          className="enq-secondary"
          disabled={busy || !hasAccess}
          onClick={() => void run('capture', 'submit')}
        >
          Record one synthetic capture attempt
        </button>
      )}
      {capture && (
        <div className="enq-recovery">
          <h4>
            {capture.receipt
              ? `Synthetic capture ${capture.receipt.outcome}`
              : capture.status === 'uncertain'
                ? 'Synthetic capture result uncertain'
                : `Synthetic capture ${capture.status}`}
          </h4>
          <p>
            Original capture operation {capture.original.command.operationId}. No message was sent.
            Waiting and suppressed decisions remain unchanged on recovery.
          </p>
          {capture.receipt?.reason && <p>Service decision: {capture.receipt.reason}.</p>}
          {capture.status === 'uncertain' && (
            <>
              <p>Retain this exact operation. A failed read does not prove capture failed.</p>
              <button type="button" disabled={busy} onClick={() => void run('capture', 'recover')}>
                Read original synthetic capture
              </button>
              <button type="button" disabled={busy} onClick={() => void run('capture', 'replay')}>
                Replay exact original synthetic capture
              </button>
            </>
          )}
          {capture.status === 'received' && (
            <button type="button" disabled={busy} onClick={finishCapture}>
              Finish capture result before a deliberate new attempt
            </button>
          )}
          <details>
            <summary>Original synthetic capture kept in this tab</summary>
            <pre>
              {JSON.stringify({ original: capture.original, receipt: capture.receipt }, null, 2)}
            </pre>
          </details>
        </div>
      )}
      <button type="button" className="enq-secondary" disabled={busy || uncertain} onClick={clear}>
        Clear local reminder work
      </button>
    </section>
  );
}
