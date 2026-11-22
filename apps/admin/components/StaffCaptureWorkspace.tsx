'use client';
import { useState } from 'react';
import { validateStaffCaptureCommand, type StaffCaptureCommand } from '@realtor/api-client';
import PrivateWorkspaceBoundary from './PrivateWorkspaceBoundary.tsx';
import { useSealedRecovery } from '../lib/use-sealed-recovery.ts';
import type { RecoveryScope } from '../lib/private-recovery-contract.ts';
import { exchangeStaffCaptureOriginal } from '../lib/staff-capture-original-client.ts';
type Props = { scope: RecoveryScope; actor: 'admin' | 'agent' };
export default function StaffCaptureWorkspace(props: Props) {
  return (
    <PrivateWorkspaceBoundary
      key={[props.scope.instanceId, props.scope.tenantId, props.scope.actorId, props.actor].join(
        ':',
      )}
      access={{ profile: props.actor, ...props.scope, role: props.actor }}
    >
      <CaptureContent {...props} />
    </PrivateWorkspaceBoundary>
  );
}
function CaptureContent({ scope, actor }: Props) {
  const actorId = scope.actorId;
  const recovery = useSealedRecovery(scope, actor === 'admin' ? 'capture-admin' : 'capture-agent');
  const pending = recovery.pending === null ? null : validateStaffCaptureCommand(recovery.pending);
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [message, setMessage] = useState(''),
    [notice, setNotice] = useState(false),
    [status, setStatus] = useState('editing'),
    [feedback, setFeedback] = useState(''),
    [canRetry, setCanRetry] = useState(false);
  async function send(recover = false) {
    if (
      !recovery.ready ||
      recovery.busy ||
      status === 'received' ||
      (pending && !recover && !canRetry)
    )
      return;
    let original: StaffCaptureCommand;
    try {
      original =
        pending ??
        validateStaffCaptureCommand({
          policy: 'staff-capture-command-v1',
          operationId: crypto.randomUUID(),
          role: actor,
          input: {
            listingId: null,
            name,
            email: email || null,
            phone: null,
            message,
            noticeVersion: 'synthetic-staff-notice-v1',
            noticeAcknowledged: notice,
          },
        });
    } catch {
      setFeedback('Check your name, email, message and operator attestation.');
      return;
    }
    setCanRetry(false);
    setStatus('sending');
    try {
      const value = await recovery.execute(original, (command, signal) =>
        exchangeStaffCaptureOriginal(scope, validateStaffCaptureCommand(command), recover, signal),
      );
      // The recovery store has already checked the complete command/current actor receipt.
      const receipt = value as Awaited<ReturnType<typeof exchangeStaffCaptureOriginal>>;
      setStatus('received');
      setName('');
      setEmail('');
      setMessage('');
      setNotice(false);
      setFeedback(
        'Synthetic enquiry saved. Reference: ' +
          receipt.enquiryId +
          '. No message was sent and no viewing was booked.',
      );
    } catch (error) {
      setStatus('uncertain');
      if (
        recover &&
        error &&
        typeof error === 'object' &&
        'status' in error &&
        error.status === 404
      ) {
        setCanRetry(true);
        setFeedback(
          'No original receipt found. You may explicitly retry the same retained original.',
        );
      } else
        setFeedback(
          'The result is unconfirmed. Its original remains encrypted; check the original enquiry before any further write.',
        );
    }
  }
  if (!recovery.ready)
    return (
      <section aria-label="Encrypted capture recovery">
        <p role="status">{recovery.error}</p>
        <button type="button" onClick={recovery.retry}>
          Retry encrypted recovery
        </button>
      </section>
    );
  const locked = recovery.busy || !!pending || status === 'received';
  return (
    <section className="intake-card">
      <p className="enq-eyebrow">STAFF CAPTURE / SYNTHETIC {actor.toUpperCase()}</p>
      <h1>Record a new enquiry.</h1>
      <p>
        Captured through the fixed synthetic {actor} account.
        <br />
        Staff ID: {actorId}
      </p>
      <p>
        This local test form saves fictional contact details into the shared preview inbox. Use
        sample data only.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <fieldset disabled={locked}>
          <label>
            Contact name
            <input
              value={pending?.input.name ?? name}
              maxLength={160}
              required
              autoComplete="off"
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </label>
          <label>
            Email address
            <input
              type="email"
              value={pending?.input.email ?? email}
              maxLength={254}
              required
              autoComplete="off"
              onInput={(e) => setEmail(e.currentTarget.value)}
            />
          </label>
          <label>
            Enquiry notes
            <textarea
              value={pending?.input.message ?? message}
              maxLength={2000}
              required
              rows={5}
              onInput={(e) => setMessage(e.currentTarget.value)}
            />
          </label>
          <div className="intake-notice">
            <strong>Test enquiry privacy notice</strong>
            <p>
              We store the name, email and message in this disposable local preview so simulated
              agency staff can review and follow up. Data disappears when the preview stops. No
              email, call or booking is triggered. This test notice is not a production privacy
              policy.
            </p>
            <label className="intake-check">
              <input
                type="checkbox"
                checked={pending?.input.noticeAcknowledged ?? notice}
                onChange={(e) => setNotice(e.currentTarget.checked)}
              />
              I am recording fictional details and have reviewed this test notice. This is my
              operator attestation, not proof of prospect consent.
            </label>
          </div>
          <button type="submit" className="primary" disabled={!notice}>
            Save synthetic enquiry →
          </button>
        </fieldset>
      </form>
      <p role="status" aria-live="polite" className="intake-feedback">
        {feedback}
      </p>
      {pending && (
        <dl>
          <dt>Original request reference</dt>
          <dd>{pending.operationId}</dd>
          {pending.input.phone && (
            <>
              <dt>Original phone</dt>
              <dd>{pending.input.phone}</dd>
            </>
          )}
          {pending.input.listingId && (
            <>
              <dt>Property reference</dt>
              <dd>{pending.input.listingId}</dd>
            </>
          )}
        </dl>
      )}
      {pending && (
        <button
          type="button"
          className="primary"
          disabled={recovery.busy}
          onClick={() => void send(true)}
        >
          Check original enquiry
        </button>
      )}
      {pending && canRetry && (
        <button type="button" disabled={recovery.busy} onClick={() => void send(false)}>
          Retry the same original enquiry
        </button>
      )}
      {recovery.error && <p role="status">{recovery.error}</p>}
      {recovery.busy && (
        <button type="button" onClick={recovery.cancel}>
          Stop waiting; retain original
        </button>
      )}
      {status === 'received' && (
        <div className="intake-notice">
          <strong>Saved as a new, unassigned staff enquiry.</strong>
          <p>
            An admin must assign an owner before it appears in an agent’s assigned inbox. Keep the
            reference above for handover. No follow-up has been sent.
          </p>
          {actor === 'admin' ? (
            <a href="/enquiries/admin">Open admin inbox to assign →</a>
          ) : (
            <a href="/enquiries/agent">Return to my assigned inbox →</a>
          )}
        </div>
      )}
      <p className="intake-limit">
        Unconfirmed originals remain encrypted for authorized recovery in this tab and preview.
        Restarting the preview or closing the tab can make recovery unavailable; do not replace an
        unresolved original.
      </p>
    </section>
  );
}
