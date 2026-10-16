'use client';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { validateListingControlCommand, type StaffListingSummary } from '@realtor/api-client';
import { createListingControlClient } from '../lib/listing-control-client';
import {
  prepareListingControlAttempt,
  type ListingControlAttempt,
} from '../lib/listing-control-attempt';

export default function ListingControls({
  listing,
  instanceId,
}: {
  listing: StaffListingSummary;
  instanceId: string;
}) {
  const [kind, setKind] = useState('');
  const [target, setTarget] = useState('');
  const [attempt, setAttempt] = useState<ListingControlAttempt | null>(null);
  const [message, setMessage] = useState(
    'Choose an operation and explicit target, then prepare the original.',
  );
  const [error, setError] = useState(false);
  const [, render] = useState(0);
  const active = useRef<ListingControlAttempt | null>(null);
  const flight = useRef(false);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (active.current && !active.current.canDiscard) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (active.current && !active.current.canDiscard) {
      event.preventDefault();
      setError(true);
      setMessage('Keep the uncertain original. Recover it before leaving this page.');
    }
  }
  function prepare() {
    if (flight.current || active.current) return;
    try {
      const original = validateListingControlCommand({
        listingId: listing.listingId,
        operationId: crypto.randomUUID(),
        expectedListingVersion: listing.version,
        kind,
        ...(kind === 'confirm_availability'
          ? { availability: target }
          : { publicationStatus: target }),
      });
      const next = prepareListingControlAttempt(
        createListingControlClient({ instanceId }),
        original,
      );
      active.current = next;
      setAttempt(next);
      setError(false);
      setMessage('Original prepared. Review the target and version before submitting.');
    } catch {
      setError(true);
      setMessage('Choose a valid operation and target.');
    }
  }
  async function run(mode: 'submit' | 'recover' | 'replay') {
    const value = active.current;
    if (!value || flight.current) return;
    flight.current = true;
    setError(false);
    try {
      const pending =
        mode === 'submit'
          ? value.submit()
          : mode === 'recover'
            ? value.recoverOriginal()
            : value.replayOriginal();
      render((n) => n + 1);
      const receipt = await pending;
      setMessage(
        receipt.decision.outcome === 'applied'
          ? 'Original operation confirmed. Read current listing state before another change.'
          : `Original ${receipt.decision.outcome}: ${receipt.decision.reason}. Read current state before preparing another operation.`,
      );
    } catch {
      setError(true);
      setMessage(
        value.status === 'uncertain'
          ? 'Result uncertain. Keep this original; recover with GET or deliberately replay the same operation.'
          : 'Operation not confirmed. Read current access and listing state before another attempt.',
      );
    } finally {
      flight.current = false;
      render((n) => n + 1);
    }
  }
  const original = attempt?.original,
    decision = attempt?.receipt?.decision;
  return (
    <section
      className="enq-contacts listing-creation listing-controls"
      aria-label="Listing availability and publication"
    >
      <nav className="draft-breadcrumb" aria-label="Listing control navigation">
        <a href="/listings" onClick={navigate}>
          Listing queue
        </a>
        <a href={`/listings/${listing.listingId}/controls`} onClick={navigate}>
          Read current listing state
        </a>
      </nav>
      <span className="creation-eyebrow">LISTING OPERATIONS</span>
      <h1>Availability &amp; publication</h1>
      <p className="enq-warning">
        Local synthetic preview. An original is retained only in this tab. Recover uncertainty
        before navigating or closing it.
      </p>
      <dl>
        <dt>Listing</dt>
        <dd>{listing.latest?.title ?? listing.slug}</dd>
        <dt>Read listing version</dt>
        <dd>{listing.version}</dd>
        <dt>Read availability</dt>
        <dd>{listing.availability}</dd>
        <dt>Read publication</dt>
        <dd>{listing.publicationStatus}</dd>
        <dt>Selected approved revision</dt>
        <dd>{listing.publishedRevision ?? 'None'}</dd>
      </dl>
      <p>
        Assigned agents can confirm availability or pause eligible stock. Administrators can
        publish, archive or explicitly reopen archived stock. The server checks current access and
        eligibility.
      </p>
      <p>
        Confirming nonavailable stock pauses a published listing. Confirming available stock does
        not republish it. Publishing requires a matching approved snapshot and fresh availability;
        this view does not supply a confirmation timestamp. Publishing never renews confirmation.
      </p>
      <fieldset disabled={!!attempt}>
        <legend>Explicit listing change</legend>
        <label>
          Operation
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setTarget('');
            }}
          >
            <option value="">Choose operation</option>
            <option value="confirm_availability">Confirm availability</option>
            <option value="set_publication">Change publication</option>
          </select>
        </label>
        <label>
          Target
          <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={!kind}>
            <option value="">Choose target</option>
            {(kind === 'confirm_availability'
              ? ['available', 'reserved', 'rented', 'sold', 'withdrawn']
              : ['paused', 'published', 'archived']
            ).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <button className="enq-primary" type="button" onClick={prepare}>
          Prepare original change
        </button>
      </fieldset>
      {attempt && original && (
        <section aria-label="Retained listing change">
          <h2>Retained original</h2>
          <p>Operation {original.operationId}</p>
          <p>
            Kind: {original.kind} · Target:{' '}
            {original.kind === 'confirm_availability'
              ? original.availability
              : original.publicationStatus}{' '}
            · Expected listing version: {original.expectedListingVersion} · Attempt:{' '}
            {attempt.status}
          </p>
          {attempt.status === 'ready' && (
            <>
              <button className="enq-primary" type="button" onClick={() => void run('submit')}>
                Submit original change
              </button>
              <button
                className="enq-secondary"
                type="button"
                onClick={() => {
                  if (!flight.current && active.current?.status === 'ready') {
                    active.current = null;
                    setAttempt(null);
                    setMessage('Prepared original discarded.');
                  }
                }}
              >
                Discard prepared original
              </button>
            </>
          )}
          {attempt.status === 'uncertain' && (
            <>
              <button className="enq-primary" type="button" onClick={() => void run('recover')}>
                Recover exact original with GET
              </button>
              <button className="enq-secondary" type="button" onClick={() => void run('replay')}>
                Replay same original change
              </button>
            </>
          )}
          {decision?.outcome === 'applied' && (
            <p>
              Historical original result: listing version {decision.result.listingVersion}. This
              receipt does not establish current availability or public visibility.
            </p>
          )}
          {attempt.canDiscard && attempt.status !== 'ready' && (
            <a
              className="enq-primary"
              href={`/listings/${listing.listingId}/controls`}
              onClick={navigate}
            >
              Read current state before another change
            </a>
          )}
        </section>
      )}
      <p role={error ? 'alert' : 'status'} aria-live="polite">
        {message}
      </p>
    </section>
  );
}
