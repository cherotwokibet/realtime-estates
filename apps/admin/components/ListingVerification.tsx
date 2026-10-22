'use client';
import { useEffect, useRef, useState } from 'react';
import type {
  StaffListingSummary,
  ListingVerificationHistory,
  ListingVerificationCommand,
} from '@realtor/domain';
import {
  createListingVerificationClient,
  ListingVerificationError,
} from '../lib/listing-verification-client';
import {
  prepareListingVerificationAttempt,
  type ListingVerificationAttempt,
} from '../lib/listing-verification-attempt';
import { listingVerificationSession } from '../lib/listing-verification-session';

export default function ListingVerification({
  listing,
  instanceId,
  initialHistory,
}: {
  listing: StaffListingSummary;
  instanceId: string;
  initialHistory: ListingVerificationHistory;
}) {
  const [history, setHistory] = useState<ListingVerificationHistory | null>(initialHistory),
    [attempt, setAttempt] = useState<ListingVerificationAttempt | null>(null),
    [hydrated, setHydrated] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(
      'Record a private synthetic staff assessment. This does not verify a real person or property.',
    ),
    [subject, setSubject] = useState<ListingVerificationCommand['subject']>('identity'),
    [outcome, setOutcome] = useState<ListingVerificationCommand['outcome']>('inconclusive'),
    [reference, setReference] = useState(''),
    [note, setNote] = useState(''),
    [observedAt, setObservedAt] = useState('');
  const flight = useRef<AbortController | null>(null),
    retained = useRef<ListingVerificationAttempt | null>(null),
    mounted = useRef(false);
  const session = () => listingVerificationSession(sessionStorage, instanceId, listing.listingId);
  useEffect(() => {
    mounted.current = true;
    try {
      const original = session().load();
      if (original) {
        const restored = prepareListingVerificationAttempt(
          createListingVerificationClient({ instanceId }),
          original,
          true,
        );
        retained.current = restored;
        setAttempt(restored);
        setMessage(
          'An earlier original is retained. Read its saved result before preparing another assessment.',
        );
      }
      setHydrated(true);
    } catch {
      setMessage(
        'Retained assessment storage is unavailable or invalid. No write is enabled; preserve this session and resolve its saved original.',
      );
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (retained.current && !retained.current.canDiscard) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const navigate = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('a[href]') &&
        retained.current &&
        !retained.current.canDiscard
      ) {
        event.preventDefault();
        setMessage(
          'Recover the uncertain original before leaving. Reload recovery retains its exact saved facts.',
        );
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', navigate, true);
    return () => {
      mounted.current = false;
      flight.current?.abort();
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', navigate, true);
    };
    // This component is keyed by its server-provided preview instance and listing currency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function prepare() {
    if (
      !hydrated ||
      flight.current ||
      retained.current ||
      !listing.latest ||
      !history ||
      history.beforeVersion !== null
    )
      return;
    try {
      const original = session().save({
        operationId: crypto.randomUUID(),
        policy: 'synthetic-check-record-v1',
        target: {
          listingId: listing.listingId,
          listingVersion: listing.version,
          revision: listing.latest.revision,
          revisionVersion: listing.latest.version,
        },
        expectedVerificationVersion: history.verificationVersion,
        subject,
        outcome,
        evidenceReference: reference === '' ? null : reference,
        note,
        observedAt,
      });
      const next = prepareListingVerificationAttempt(
        createListingVerificationClient({ instanceId }),
        original,
      );
      retained.current = next;
      setAttempt(next);
      setMessage(
        'Original retained before dispatch. Review its exact facts, then explicitly record it.',
      );
    } catch {
      setMessage(
        'Use a nonblank note up to600 Unicode characters, a canonical UTC millisecond observation, and a synthetic: reference for supported or not-supported outcomes. Storage must retain the exact original before a write.',
      );
    }
  }
  async function run(mode: 'submit' | 'recoverOriginal' | 'replayOriginal') {
    const current = retained.current;
    if (!current || flight.current) return;
    const controller = new AbortController();
    flight.current = controller;
    setBusy(true);
    try {
      const result = await current[mode](controller.signal);
      if (mounted.current)
        setMessage(
          `Original decision: ${result.decision.outcome}${result.decision.reason ? ` — ${result.decision.reason}` : ''}. This historical receipt does not establish current listing or history currency.`,
        );
    } catch (error) {
      if (mounted.current) {
        if (error instanceof ListingVerificationError && [401, 403, 404].includes(error.status))
          setHistory(null);
        setMessage(
          current.status === 'uncertain'
            ? 'Result remains uncertain. Keep this original; use read-only recovery or explicitly replay these identical facts.'
            : 'No successful assessment was confirmed. Review the retained attempt before starting again.',
        );
      }
    } finally {
      flight.current = null;
      if (mounted.current) {
        setBusy(false);
        setAttempt(current);
      }
    }
  }
  async function readHistory(before: string | null = null) {
    if (flight.current) return;
    const controller = new AbortController();
    flight.current = controller;
    setBusy(true);
    setHistory(null);
    try {
      const page = await createListingVerificationClient({ instanceId }).history(
        listing.listingId,
        20,
        before,
        controller.signal,
      );
      if (mounted.current) {
        setHistory(page);
        setMessage('Fresh authorized history read. Records describe historical staff assessments.');
      }
    } catch {
      if (mounted.current)
        setMessage(
          'Fresh history is unavailable. Previous records are cleared; no new assessment can be prepared.',
        );
    } finally {
      flight.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  function finish() {
    if (!retained.current?.canDiscard || flight.current) return;
    try {
      session().clear();
      retained.current = null;
      setAttempt(null);
      setHistory(null);
      setMessage('Original closed locally. Read latest history before preparing a new assessment.');
    } catch {
      setMessage('The retained original could not be cleared. No new attempt is enabled.');
    }
  }
  return (
    <section
      className="enq-contacts listing-creation listing-controls listing-verification"
      aria-label="Private synthetic assessment history"
    >
      <nav className="draft-breadcrumb" aria-label="Assessment navigation">
        <a href="/listings">Listing queue</a>
        <a href={`/listings/${listing.listingId}/duplicates`}>Possible duplicates</a>
      </nav>
      <span className="creation-eyebrow">PRIVATE SYNTHETIC CHECKS</span>
      <h1>{listing.latest?.title ?? 'Listing assessment'}</h1>
      <p className="enq-warning">
        Synthetic staff statements only. A supported outcome is not a public verified badge or
        validated identity, ownership or advertising authority. Use synthetic references and notes
        only.
      </p>
      <p>
        Listing version {listing.version} · revision {listing.latest?.revision ?? 'none'} · revision
        version {listing.latest?.version ?? 'none'}. Stale target facts require a fresh page; they
        are never silently replaced.
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {!attempt && (
        <fieldset
          disabled={
            !hydrated || busy || !history || history.beforeVersion !== null || !listing.latest
          }
        >
          <legend>Prepare an assessment original</legend>
          <label>
            Subject
            <select value={subject} onChange={(e) => setSubject(e.target.value as typeof subject)}>
              <option value="identity">Identity</option>
              <option value="advertising_authority">Advertising authority</option>
              <option value="availability">Availability</option>
            </select>
          </label>
          <label>
            Staff outcome
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
              <option value="inconclusive">Inconclusive</option>
              <option value="supported">Supported</option>
              <option value="not_supported">Not supported</option>
            </select>
          </label>
          <label>
            Synthetic evidence reference
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="synthetic:fixture-reference"
              maxLength={90}
            />
          </label>
          <label>
            Private synthetic note
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1200}
              rows={4}
            />
          </label>
          <label>
            Observed at (UTC, including milliseconds)
            <input
              value={observedAt}
              onChange={(e) => setObservedAt(e.target.value)}
              placeholder="2026-10-23T00:00:00.000Z"
              maxLength={24}
            />
          </label>
          <button className="enq-primary" type="button" onClick={prepare}>
            Retain original for review
          </button>
        </fieldset>
      )}
      {attempt && (
        <section aria-label="Retained synthetic assessment">
          <h2>Retained original · {attempt.status}</h2>
          <p>Operation {attempt.original.operationId}</p>
          <dl>
            <dt>Subject / outcome</dt>
            <dd>
              {attempt.original.subject} / {attempt.original.outcome}
            </dd>
            <dt>Note</dt>
            <dd>{attempt.original.note}</dd>
            <dt>Reference</dt>
            <dd>{attempt.original.evidenceReference ?? 'None — inconclusive'}</dd>
            <dt>Observed</dt>
            <dd>{attempt.original.observedAt}</dd>
            <dt>Original history version</dt>
            <dd>{attempt.original.expectedVerificationVersion}</dd>
          </dl>
          {attempt.status === 'ready' && (
            <button
              disabled={busy}
              type="button"
              className="enq-primary"
              onClick={() => void run('submit')}
            >
              Record this synthetic assessment
            </button>
          )}
          {attempt.status === 'uncertain' && (
            <>
              <button
                disabled={busy}
                type="button"
                className="enq-primary"
                onClick={() => void run('recoverOriginal')}
              >
                Read original result
              </button>
              <button
                disabled={busy}
                type="button"
                className="enq-secondary"
                onClick={() => void run('replayOriginal')}
              >
                Explicitly replay identical original
              </button>
            </>
          )}
          {attempt.receipt && (
            <p>
              Saved original outcome: {attempt.receipt.decision.outcome}. Recorded by{' '}
              {attempt.receipt.actorId} at {attempt.receipt.completedAt}.{' '}
              {attempt.receipt.decision.reason}
            </p>
          )}
          {attempt.canDiscard && (
            <button disabled={busy} type="button" className="enq-secondary" onClick={finish}>
              {attempt.status === 'ready'
                ? 'Discard unsent original'
                : 'Close known original locally'}
            </button>
          )}
        </section>
      )}
      <section aria-label="Recorded assessment history">
        <h2>Private recorded history</h2>
        <button
          disabled={busy}
          type="button"
          className="enq-secondary"
          onClick={() => void readHistory()}
        >
          Read latest history
        </button>
        {history ? (
          <>
            <p>
              Current history counter {history.verificationVersion}.{' '}
              {history.beforeVersion === null
                ? 'Newest page.'
                : `Older records before version ${history.beforeVersion}.`}{' '}
              {history.hasMore ? 'More older records exist.' : 'End of this history window.'}
            </p>
            {history.records.length === 0 && (
              <p>
                No recorded assessments in this window. This does not prove identity or uniqueness.
              </p>
            )}
            <ol>
              {history.records.map((record) => (
                <li key={record.verificationVersion}>
                  <h3>
                    Assessment {record.verificationVersion} · {record.subject} · {record.outcome}
                  </h3>
                  <p>{record.note}</p>
                  <p>Reference: {record.evidenceReference ?? 'None'}</p>
                  <p>
                    Observed {record.observedAt}; recorded {record.recordedAt} by {record.actorId}.
                  </p>
                  <p>
                    Historical target: listing version {record.target.listingVersion}, revision{' '}
                    {record.target.revision}, revision version {record.target.revisionVersion}.
                  </p>
                </li>
              ))}
            </ol>
            {history.hasMore && (
              <button
                disabled={busy}
                type="button"
                className="enq-secondary"
                onClick={() => void readHistory(history.records.at(-1)!.verificationVersion)}
              >
                Read older history
              </button>
            )}
          </>
        ) : (
          <p>Read current authorized history before preparing another assessment.</p>
        )}
      </section>
    </section>
  );
}
