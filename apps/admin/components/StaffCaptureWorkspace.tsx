'use client';
import { useEffect, useRef, useState } from 'react';
import { createEnquiryPreviewClient, type CaptureAttempt } from '../lib/enquiry-client';

export default function StaffCaptureWorkspace({
  instanceId,
  actor,
  actorId,
}: {
  instanceId: string;
  actor: 'admin' | 'agent';
  actorId: string;
}) {
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [message, setMessage] = useState(''),
    [notice, setNotice] = useState(false),
    [status, setStatus] = useState('editing'),
    [feedback, setFeedback] = useState('');
  const attempt = useRef<CaptureAttempt | null>(null),
    busy = useRef(false),
    controller = useRef<AbortController | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (attempt.current?.status === 'uncertain' || busy.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);
  async function send(replay = false) {
    if (
      busy.current ||
      attempt.current?.status === 'received' ||
      (!replay && attempt.current?.status === 'uncertain')
    )
      return;
    busy.current = true;
    try {
      if (!replay) {
        const api = createEnquiryPreviewClient({
          basePath: `/api/enquiry-preview/${actor}`,
          instanceId,
        });
        attempt.current = api.prepareCapture(
          {
            listingId: null,
            name,
            email: email || null,
            phone: null,
            message,
            noticeVersion: 'synthetic-staff-notice-v1',
            noticeAcknowledged: notice as true,
          },
          crypto.randomUUID(),
        );
      }
      if (!attempt.current) throw new Error();
      controller.current = new AbortController();
      setStatus('sending');
      setFeedback('Saving your synthetic enquiry…');
      const receipt = await (replay
        ? attempt.current.retryOriginal(controller.current.signal)
        : attempt.current.submit(controller.current.signal));
      if (alive.current) {
        setStatus('received');
        setFeedback(
          `Synthetic enquiry saved. Reference: ${receipt.id}. No message was sent and no viewing was booked.`,
        );
      }
    } catch {
      if (alive.current) {
        const uncertain = attempt.current?.status === 'uncertain';
        setStatus(uncertain ? 'uncertain' : 'editing');
        setFeedback(
          uncertain
            ? 'We could not confirm the result. Keep this page open and retry the original enquiry to recover it safely.'
            : 'Check your name, email, message and notice acknowledgement, then try again.',
        );
        if (!uncertain) attempt.current = null;
      }
    } finally {
      busy.current = false;
      controller.current = null;
    }
  }
  const locked = ['sending', 'uncertain', 'received'].includes(status);
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
              value={name}
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
              value={email}
              maxLength={254}
              required
              autoComplete="off"
              onInput={(e) => setEmail(e.currentTarget.value)}
            />
          </label>
          <label>
            Enquiry notes
            <textarea
              value={message}
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
                checked={notice}
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
      {status === 'uncertain' && (
        <button type="button" className="primary" onClick={() => void send(true)}>
          Retry original enquiry
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
        Keep this page open while a result is uncertain. Form recovery is held in memory and will be
        lost on reload or crash.
      </p>
    </section>
  );
}
