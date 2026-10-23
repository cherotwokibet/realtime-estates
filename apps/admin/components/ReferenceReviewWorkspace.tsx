'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { validateSyntheticReferenceContext } from '@realtor/domain';
import type { ReferenceModerationScreen } from '../lib/reference-moderation-screen.ts';
import { createReferenceModerationClient } from '../lib/reference-moderation-client.ts';
import {
  prepareReferenceModerationAttempt,
  referenceModerationSession,
  restoreReferenceModerationAttempt,
  type ReferenceModerationAttempt,
} from '../lib/reference-moderation-workspace.ts';
import ReviewImages from './ReviewImages.tsx';

/** Private candidate workspace; restore a retained original before enabling any new decision. */
export default function ReferenceReviewWorkspace(props: ReferenceModerationScreen) {
  // Replace all local state when server-bound identity or saved versions change.
  const key = [
    props.scope.instanceId,
    props.scope.tenantId,
    props.scope.actorId,
    props.scope.listingId,
    props.scope.revision,
    props.context?.review.revisionVersion ?? 'recovery',
    props.context?.review.listingVersion ?? 'recovery',
  ].join(':');
  return <ReferenceReview key={key} {...props} />;
}
function ReferenceReview(props: ReferenceModerationScreen) {
  const context = useMemo(
    () =>
      props.context === null
        ? null
        : validateSyntheticReferenceContext(
            props.context,
            props.scope.listingId,
            props.scope.revision,
            props.context.review.revisionVersion,
            'review',
          ),
    [props.context, props.scope.listingId, props.scope.revision],
  );
  const client = useMemo(
    () => createReferenceModerationClient(props.scope),
    [
      props.scope.instanceId,
      props.scope.tenantId,
      props.scope.actorId,
      props.scope.listingId,
      props.scope.revision,
    ],
  );
  const current = useRef<ReferenceModerationAttempt | null>(null);
  const session = useRef<ReturnType<typeof referenceModerationSession> | null>(null);
  const flight = useRef(false),
    generation = useRef(0),
    abort = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState('restoring'),
    [message, setMessage] = useState('Checking this tab for an original decision…');
  const [reason, setReason] = useState(''),
    [ack, setAck] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const epoch = ++generation.current,
      controller = new AbortController();
    abort.current = controller;
    current.current = null;
    session.current = null;
    flight.current = true;
    setPhase('restoring');
    setAck(false);
    setReason('');
    setMessage('Checking this tab for an original decision…');
    (async () => {
      try {
        const saved = referenceModerationSession(window.sessionStorage, props.scope);
        const original = await restoreReferenceModerationAttempt(client, saved, controller.signal);
        if (epoch !== generation.current || controller.signal.aborted) return;
        session.current = saved;
        current.current = original;
        setPhase(original ? 'uncertain' : context ? 'ready' : 'unavailable');
        setMessage(
          original
            ? 'An original decision is retained. Check its result before taking another action.'
            : context
              ? 'Inspect the complete saved content, historical references and verified photos before deciding.'
              : 'This saved review is no longer pending and this tab has no retained original. Return to pending reviews.',
        );
      } catch {
        if (epoch !== generation.current || controller.signal.aborted) return;
        setPhase('locked');
        setMessage(
          'The original decision could not be restored. Keep this tab’s saved data and retry when access returns.',
        );
      } finally {
        if (epoch === generation.current) flight.current = false;
      }
    })();
    return () => {
      generation.current++;
      controller.abort();
    };
  }, [client, context, retry]);
  const reviewed = current.current?.original.review ?? context?.review;
  async function decide(action: 'approve' | 'reject') {
    if (
      flight.current ||
      phase !== 'ready' ||
      !ack ||
      !session.current ||
      current.current ||
      !context
    )
      return;
    flight.current = true;
    const epoch = generation.current;
    try {
      const attempt = prepareReferenceModerationAttempt(
        client,
        session.current,
        {
          policy: 'synthetic-reference-transition-v1',
          operationId: crypto.randomUUID(),
          action,
          listingId: props.scope.listingId,
          revision: props.scope.revision,
          review: context.review,
          reason: action === 'reject' ? reason : null,
        },
        context.catalogue,
      );
      current.current = attempt;
      setPhase('sending');
      setMessage('Submitting this exact decision once…');
      await attempt.submit(abort.current?.signal);
      if (epoch !== generation.current) return;
      setPhase('received');
      setMessage(
        'The original decision is confirmed. Clear the settled original before leaving this workspace.',
      );
    } catch {
      if (epoch !== generation.current) return;
      const state = current.current?.status;
      setPhase(state === 'uncertain' ? 'uncertain' : state === 'rejected' ? 'rejected' : 'locked');
      setMessage(
        state === 'uncertain'
          ? 'The decision may have committed. Check the original result; another decision is locked.'
          : state === 'rejected'
            ? 'The server refused this decision. Clear the settled original and load a fresh review.'
            : 'The decision could not be prepared safely. Keep saved data and retry restoration.',
      );
    } finally {
      if (epoch === generation.current) flight.current = false;
    }
  }
  async function recover() {
    if (flight.current || phase !== 'uncertain' || !current.current) return;
    flight.current = true;
    const epoch = generation.current;
    setPhase('sending');
    setMessage('Checking the exact retained original…');
    try {
      await current.current.recoverOriginal(abort.current?.signal);
      if (epoch !== generation.current) return;
      setPhase('received');
      setMessage('The original result is confirmed. Clear the settled original before leaving.');
    } catch {
      if (epoch !== generation.current) return;
      setPhase('uncertain');
      setMessage(
        'The original remains unconfirmed. Saved facts and the decision lock are retained.',
      );
    } finally {
      if (epoch === generation.current) flight.current = false;
    }
  }
  function clear() {
    if (flight.current || !current.current?.canDiscard || !['received', 'rejected'].includes(phase))
      return;
    try {
      current.current.discard();
      setPhase('settled');
      setMessage(
        'Settled original cleared. Return to pending reviews and inspect a fresh saved revision.',
      );
    } catch {
      setPhase('locked');
      setMessage('The saved original changed. Keep it and retry restoration.');
    }
  }
  const display = (value: unknown): string =>
    value === null
      ? 'Not supplied'
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  const receipt = current.current?.receipt;
  if (!reviewed)
    return (
      <section aria-label="Saved reference review">
        <h1>Review saved listing</h1>
        <p role="status">{message}</p>
        {phase === 'locked' && (
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Retry original restoration
          </button>
        )}
        {phase === 'unavailable' && <a href="/reviews">Return to pending reviews</a>}
      </section>
    );
  return (
    <section aria-label="Saved reference review">
      <h1>Review saved listing</h1>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <p>
        Listing {reviewed.listingId} · revision {reviewed.revision} · editorial version{' '}
        {reviewed.revisionVersion}
      </p>
      <h2>Complete private content</h2>
      <dl>
        {Object.entries(reviewed.content).map(([key, value]) => (
          <div key={key}>
            <dt>{key.replace(/([A-Z])/g, ' $1')}</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{display(value)}</dd>
          </div>
        ))}
      </dl>
      <h2>Saved historical references</h2>
      <p>Catalogue version {reviewed.attributes.catalogueVersion}</p>
      <dl>
        {Object.entries(reviewed.attributes.location).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value ? `${value.label} (${value.id})` : 'Unknown'}</dd>
          </div>
        ))}
      </dl>
      <ul>
        {reviewed.attributes.amenities.map((a) => (
          <li key={a.id}>
            {a.label} ({a.id})
          </li>
        ))}
      </ul>
      <h2>Operational context</h2>
      <p>
        Listing version {reviewed.listingVersion}; state {reviewed.state}; availability{' '}
        {reviewed.availability}; confirmed {reviewed.availabilityConfirmedAt ?? 'Not recorded'};
        publication {reviewed.publicationStatus}; published revision{' '}
        {reviewed.publishedRevision ?? 'None'}.
      </p>
      <h2>Saved photo order</h2>
      <ol>
        {reviewed.photos.map((p) => (
          <li key={p.id}>
            {p.position + 1}. {p.altText ?? 'No alternative text'} · {p.id} · accepted{' '}
            {String(p.accepted)} · sealed {String(p.sealed)} · SHA-256 {p.sha256 ?? 'Not recorded'}
          </li>
        ))}
      </ol>
      {!['restoring', 'locked', 'settled'].includes(phase) && (
        <ReviewImages
          instanceId={props.scope.instanceId}
          listingId={reviewed.listingId}
          revision={reviewed.revision}
          version={reviewed.revisionVersion}
        />
      )}
      {current.current && (
        <p>
          Retained action: {current.current.original.action}; reason:{' '}
          {current.current.original.reason ?? 'None'}; operation:{' '}
          {current.current.original.operationId}.
        </p>
      )}
      {receipt && (
        <p>
          Confirmed result: {receipt.state}; editorial version {receipt.revisionVersion}.
        </p>
      )}
      <fieldset disabled={phase !== 'ready'}>
        <legend>Decision on this saved review</legend>
        <label>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I
          inspected all saved content, historical references, operational context and verified
          photos.
        </label>
        <label>
          Rejection reason
          <textarea value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button type="button" disabled={!ack} onClick={() => void decide('approve')}>
          Approve saved review
        </button>
        <button
          type="button"
          disabled={!ack || reason.trim().length === 0 || reason !== reason.trim()}
          onClick={() => void decide('reject')}
        >
          Reject with reason
        </button>
      </fieldset>
      {phase === 'uncertain' && (
        <button type="button" onClick={() => void recover()}>
          Check original result
        </button>
      )}
      {['received', 'rejected'].includes(phase) && (
        <button type="button" onClick={clear}>
          Clear settled original
        </button>
      )}
      {phase === 'locked' && (
        <button type="button" onClick={() => setRetry((n) => n + 1)}>
          Retry original restoration
        </button>
      )}
      {phase === 'settled' && <a href="/reviews">Return to pending reviews</a>}
    </section>
  );
}
