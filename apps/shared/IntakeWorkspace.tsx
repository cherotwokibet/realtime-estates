'use client';
import { useEffect, useRef, useState } from 'react';
import {
  RealtorApiClient,
  createEnquiryProxyTransport,
  type PublicEnquiryAttempt,
} from '@realtor/api-client';

export default function IntakeWorkspace({
  instanceId,
  showInbox = true,
  listingId = null,
  listingTitle,
}: {
  instanceId: string;
  showInbox?: boolean;
  listingId?: string | null;
  listingTitle?: string;
}) {
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [message, setMessage] = useState(''),
    [notice, setNotice] = useState(false),
    [status, setStatus] = useState('editing'),
    [feedback, setFeedback] = useState('');
  const attempt = useRef<PublicEnquiryAttempt | null>(null),
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
      if (attempt.current?.state.status === 'uncertain' || busy.current) {
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
      attempt.current?.state.status === 'received' ||
      (!replay && attempt.current?.state.status === 'uncertain')
    )
      return;
    busy.current = true;
    try {
      if (!replay) {
        const api = new RealtorApiClient({
          baseUrl: window.location.origin,
          privacyNoticeVersion: 'synthetic-staff-notice-v1',
          allowLoopbackHttp: true,
          fetch: createEnquiryProxyTransport({
            origin: window.location.origin,
            instanceId,
            fetch: globalThis.fetch.bind(globalThis),
          }),
        });
        attempt.current = api.preparePublicEnquiry(
          {
            listingId,
            name,
            email: email || null,
            phone: null,
            message,
            origin: 'web',
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
        ? attempt.current.retryOriginal({ signal: controller.current.signal })
        : attempt.current.submit({ signal: controller.current.signal }));
      if (alive.current) {
        setStatus('received');
        setFeedback(
          `Synthetic enquiry saved. Reference: ${receipt.id}. No message was sent and no viewing was booked.`,
        );
      }
    } catch {
      if (alive.current) {
        const uncertain = attempt.current?.state.status === 'uncertain';
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
      <p className="enq-eyebrow">SYNTHETIC GUEST ENQUIRY</p>
      <h1>{listingTitle ? 'Ask about this property.' : 'Tell us what you’re looking for.'}</h1>
      {listingTitle && (
        <p>
          <strong>{listingTitle}</strong>
          <br />
          Synthetic property reference: {listingId}
        </p>
      )}
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
            Your name
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
            How can we help?
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
              I have read this test notice and am using fictional contact details.
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
      {status === 'received' && showInbox && (
        <a href="/enquiries/admin">Open the synthetic admin inbox →</a>
      )}
      <p className="intake-limit">
        Keep this page open while a result is uncertain. Form recovery is held in memory and will be
        lost on reload or crash.
      </p>
    </section>
  );
}
