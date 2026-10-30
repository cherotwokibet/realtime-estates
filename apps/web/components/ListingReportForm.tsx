'use client';
import { useRef, useState } from 'react';
import {
  LISTING_REPORT_REASONS,
  parseListingReportJson,
  validateListingReportCommand,
  validateListingReportReceipt,
  type ListingReportCommand,
  type ListingReportReason,
} from '@realtor/domain';
const labels: Record<ListingReportReason, string> = {
  suspected_fraud: 'Suspected fraud',
  wrong_price: 'Price concern',
  unavailable: 'Property unavailable',
  other: 'Other concern',
};
/** No account/contact requirement, localStorage or background submission/retry. */
export function ListingReportForm({
  listingId,
  instanceId,
}: {
  listingId: string;
  instanceId: string;
}) {
  const [reason, setReason] = useState<ListingReportReason>('other'),
    [details, setDetails] = useState(''),
    [pending, setPending] = useState<ListingReportCommand | null>(null),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(''),
    [saved, setSaved] = useState(false);
  const locked = useRef(false);
  async function execute(method: 'GET' | 'POST', command: ListingReportCommand) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setStatus(method === 'GET' ? 'Checking the original report…' : 'Sending the report…');
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(
        `/api/listing-reports/${command.listingId}/${command.operationId}`,
        {
          method,
          headers: {
            'x-preview-instance': instanceId,
            ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
          },
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
          ...(method === 'POST' ? { body: JSON.stringify(command) } : {}),
        },
      );
      if (
        !response.body ||
        response.headers.get('content-type')?.split(';')[0] !== 'application/json' ||
        response.headers.has('content-encoding')
      )
        throw Error('Invalid response framing');
      const reader = response.body.getReader();
      let emptyFrames = 0;
      let text = '',
        bytes = 0;
      const decoder = new TextDecoder('utf-8', { fatal: true });
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          if (!part.value.byteLength) {
            if (++emptyFrames > 1024) throw Error('Too many empty frames');
            if (emptyFrames % 64 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
            continue;
          }
          emptyFrames = 0;
          bytes += part.value.byteLength;
          if (bytes > 8192) throw Error('Response too large');
          text += decoder.decode(part.value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (!response.ok) {
        setStatus(
          response.status === 404
            ? 'No saved original was found. Keep this request and explicitly retry it if needed.'
            : response.status === 429
              ? 'Please wait before trying again. The original request is retained.'
              : 'The result could not be confirmed. Keep this request and check its original result.',
        );
        return;
      }
      if (response.status !== (method === 'POST' ? 202 : 200)) throw Error('Unexpected status');
      const envelope = parseListingReportJson(text);
      if (
        !envelope ||
        typeof envelope !== 'object' ||
        Array.isArray(envelope) ||
        Object.keys(envelope).join(',') !== 'receipt'
      )
        throw Error('Invalid acknowledgment');
      validateListingReportReceipt((envelope as { receipt: unknown }).receipt, command);
      setSaved(true);
      setPending(null);
      setDetails('');
      setStatus(
        'Report saved for company review. This does not establish fraud, remove the listing or confirm a reply.',
      );
    } catch {
      setStatus(
        'The outcome is uncertain. Your original request is retained; check its result before retrying.',
      );
    } finally {
      clearTimeout(timer);
      locked.current = false;
      setBusy(false);
    }
  }
  function submit() {
    if (locked.current || pending || saved) return;
    try {
      const command = validateListingReportCommand({
        policy: 'listing-report-command-v1',
        listingId,
        operationId: crypto.randomUUID(),
        reason,
        details: details.trim() || null,
      });
      setPending(command);
      void execute('POST', command);
    } catch {
      setStatus('Use plain details up to1200 characters, without markup or control characters.');
    }
  }
  return (
    <section aria-labelledby="report-heading">
      <h2 id="report-heading">Report a listing concern</h2>
      <p>
        No signup or contact details required. Include only the property concern; do not send
        identity documents, payment information or another person’s private details. This synthetic
        preview does not contact anyone.
      </p>
      <fieldset disabled={busy || !!pending || saved}>
        <legend>Concern details</legend>
        <label>
          Reason
          <select value={reason} onChange={(e) => setReason(e.target.value as ListingReportReason)}>
            {LISTING_REPORT_REASONS.map((r) => (
              <option key={r} value={r}>
                {labels[r]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Details (optional)
          <textarea
            value={details}
            maxLength={2400}
            onChange={(e) => setDetails(e.target.value)}
            rows={4}
          />
        </label>
        <button type="button" onClick={submit}>
          Send report for review
        </button>
      </fieldset>
      <p role="status" aria-live="polite">
        {status}
      </p>
      {pending && (
        <div>
          <p>
            Original request:{pending.operationId}. Keep this page open while checking; reloading
            loses the local request.
          </p>
          <button type="button" disabled={busy} onClick={() => void execute('GET', pending)}>
            Check original report
          </button>
          <button type="button" disabled={busy} onClick={() => void execute('POST', pending)}>
            Retry this exact report
          </button>
        </div>
      )}
    </section>
  );
}
