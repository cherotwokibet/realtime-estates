'use client';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { validateListingSuccessorCommand, type ListingSuccessorCommand } from '@realtor/api-client';
import { createListingSuccessorClient } from '../lib/listing-successor-client';
import {
  prepareListingSuccessorAttempt,
  type ListingSuccessorAttempt,
} from '../lib/listing-successor-attempt';

export default function ListingSuccessor({
  instanceId,
  listingId,
  expectedListingVersion,
  predecessor,
}: {
  instanceId: string;
  listingId: string;
  expectedListingVersion: string;
  predecessor: ListingSuccessorCommand['predecessor'];
}) {
  const [title, setTitle] = useState('');
  const [attempt, setAttempt] = useState<ListingSuccessorAttempt | null>(null);
  const [, render] = useState(0);
  const [message, setMessage] = useState(
    'Enter an optional new title. Review the original before submitting.',
  );
  const [error, setError] = useState(false);
  const active = useRef<ListingSuccessorAttempt | null>(null);
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
      setMessage('Recover this original before leaving. Its result is still uncertain.');
    }
  }
  function prepare() {
    if (active.current || flight.current) return;
    try {
      const value = prepareListingSuccessorAttempt(
        createListingSuccessorClient({ instanceId }),
        validateListingSuccessorCommand({
          listingId,
          operationId: crypto.randomUUID(),
          expectedListingVersion,
          predecessor,
          content: {
            title,
            pricing: { declaration: 'not_declared', charges: [] },
            location: { county: null, town: null, area: null },
          },
        }),
      );
      active.current = value;
      setAttempt(value);
      setError(false);
      setMessage('Original prepared. Review the predecessor and submit once.');
    } catch {
      setError(true);
      setMessage('Review the new title and refresh the listing context if needed.');
    }
  }
  async function run(mode: 'submit' | 'recover' | 'replay') {
    const value = active.current;
    if (!value || flight.current) return;
    flight.current = true;
    setError(false);
    setMessage(
      mode === 'recover' ? 'Reading the exact original…' : 'Sending the retained original…',
    );
    const pending =
      mode === 'submit'
        ? value.submit()
        : mode === 'recover'
          ? value.recoverOriginal()
          : value.replayOriginal();
    render((n) => n + 1);
    try {
      const receipt = await pending;
      setMessage(
        receipt.decision.outcome === 'applied'
          ? 'New draft confirmed. Open it for a fresh read before editing.'
          : receipt.decision.outcome === 'conflict'
            ? 'The predecessor changed. Refresh the listing context before preparing another original.'
            : 'A listing or revision limit was reached. This operation allocated no draft.',
      );
    } catch {
      setError(true);
      setMessage(
        value.status === 'uncertain'
          ? 'Result uncertain. Keep this original; recover with GET or deliberately replay the same operation.'
          : 'The operation was not confirmed. Refresh current access and listing context before another attempt.',
      );
    } finally {
      flight.current = false;
      render((n) => n + 1);
    }
  }
  const result = attempt?.receipt?.decision;
  return (
    <section className="enq-contacts listing-creation" aria-label="Start a new revision">
      <nav className="draft-breadcrumb" aria-label="Revision navigation">
        <a href="/listings" onClick={navigate}>
          Listing queue
        </a>
        <a href={`/listings/${listingId}/successor`} onClick={navigate}>
          Refresh listing context
        </a>
      </nav>
      <span className="creation-eyebrow">NEW REVISION · PRIVATE DRAFT</span>
      <h1>Start a new draft</h1>
      <p className="enq-warning">
        Local synthetic preview. The original is retained only in this tab. Recover an uncertain
        result before navigating or closing it.
      </p>
      <p>
        Listing {listingId} · listing version {expectedListingVersion}
      </p>
      <p>
        Predecessor: revision {predecessor.revision} · version {predecessor.version} ·{' '}
        {predecessor.state}
      </p>
      <p>
        The new draft starts with an empty gallery and unknown facts. Enter its content explicitly.
        The approved public revision remains selected.
      </p>
      <fieldset disabled={!!attempt}>
        <legend>New draft facts</legend>
        <label>
          New title (optional)
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={320}
            autoComplete="off"
          />
        </label>
        <button className="enq-primary" type="button" onClick={prepare}>
          Prepare original revision
        </button>
      </fieldset>
      {attempt && (
        <section aria-label="Retained revision original">
          <h2>Retained original</h2>
          <p>Operation {attempt.original.operationId}</p>
          <p>
            Title: {attempt.original.content.title ?? 'Unknown'} · Attempt: {attempt.status}
          </p>
          {attempt.status === 'ready' && (
            <>
              <button className="enq-primary" type="button" onClick={() => void run('submit')}>
                Submit original revision
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
                Replay same original revision
              </button>
            </>
          )}
          {result?.outcome === 'applied' && (
            <>
              <p>
                Original initial result: listing version {result.result.listingVersion} · revision{' '}
                {result.result.revision} · revision version {result.result.revisionVersion}. Read
                current state before editing.
              </p>
              <a
                className="enq-primary"
                href={`/drafts/${listingId}/${result.result.revision}`}
                onClick={navigate}
              >
                Open new draft for a fresh read
              </a>
            </>
          )}
        </section>
      )}
      <p role={error ? 'alert' : 'status'} aria-live="polite">
        {message}
      </p>
    </section>
  );
}
