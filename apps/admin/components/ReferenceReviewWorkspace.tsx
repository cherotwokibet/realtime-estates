'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiClientError } from '@realtor/api-client';
import { validateSyntheticReferenceContext, formatKes, kesFromMinor } from '@realtor/domain';
import type { ReferenceModerationScreen } from '../lib/reference-moderation-screen.ts';
import { createReferenceModerationClient } from '../lib/reference-moderation-client.ts';
import {
  prepareReferenceModerationAttempt,
  referenceModerationSession,
  restoreReferenceModerationAttempt,
  type ReferenceModerationAttempt,
} from '../lib/reference-moderation-workspace.ts';
import ReviewImages from './ReviewImages.tsx';
import PrivateWorkspaceBoundary, { usePrivateWorkspaceClear } from './PrivateWorkspaceBoundary.tsx';
import ReviewListingVideo from './ReviewListingVideo.tsx';
import {
  referenceTransitionActions,
  assertReferenceAuthorDraftClear,
  type ReferenceTransitionPurpose,
} from '../lib/reference-author-policy.ts';
import type { SyntheticReferenceAction } from '@realtor/domain';
type WorkspaceProps = ReferenceModerationScreen & { purpose?: ReferenceTransitionPurpose };

/** Private candidate workspace; restore a retained original before enabling any new decision. */
export default function ReferenceReviewWorkspace(props: WorkspaceProps) {
  // Replace all local state when server-bound identity or saved versions change.
  const key = [
    props.purpose ?? 'review',
    props.scope.instanceId,
    props.scope.tenantId,
    props.scope.actorId,
    props.scope.listingId,
    props.scope.revision,
    props.context?.review.revisionVersion ?? 'recovery',
    props.context?.review.listingVersion ?? 'recovery',
  ].join(':');
  return (
    <PrivateWorkspaceBoundary key={key}>
      <ReferenceReview {...props} />
    </PrivateWorkspaceBoundary>
  );
}
function ReferenceReview(props: WorkspaceProps) {
  const clearPrivateWorkspace = usePrivateWorkspaceClear();
  const context = useMemo(
    () =>
      props.context === null
        ? null
        : validateSyntheticReferenceContext(
            props.context,
            props.scope.listingId,
            props.scope.revision,
            props.context.review.revisionVersion,
            props.purpose === 'author' ? 'revision' : 'review',
          ),
    [props.context, props.scope.listingId, props.scope.revision, props.purpose],
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
    [retry, setRetry] = useState(0),
    [denied, setDenied] = useState(false);
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
        const saved = referenceModerationSession(window.sessionStorage, props.scope, props.purpose);
        const original = await restoreReferenceModerationAttempt(client, saved, controller.signal);
        if (epoch !== generation.current || controller.signal.aborted) return;
        if (!original && props.purpose === 'author')
          assertReferenceAuthorDraftClear(window.sessionStorage, {
            instanceId: props.scope.instanceId,
            tenantId: props.scope.tenantId,
            actorId: props.scope.actorId,
            listingId: props.scope.listingId,
          });
        session.current = saved;
        current.current = original;
        setPhase(original ? original.status : context ? 'ready' : 'unavailable');
        setMessage(
          original
            ? original.status === 'rejected'
              ? 'This retained action was explicitly refused before a write. Clear the settled original and inspect a fresh saved revision.'
              : 'An original decision is retained. Check its result before taking another action.'
            : context
              ? props.purpose === 'author'
                ? 'Inspect the exact saved content, historical references and photo metadata before submitting or withdrawing.'
                : 'Inspect the complete saved content, historical references and verified photos before deciding.'
              : props.purpose === 'author'
                ? 'No draft or pending revision is available for a new action. Retained recovery is still checked first.'
                : 'This saved review is no longer pending and this tab has no retained original. Return to pending reviews.',
        );
      } catch (error) {
        if (epoch !== generation.current || controller.signal.aborted) return;
        if (error instanceof ApiClientError && [401, 403].includes(error.status ?? 0)) {
          setDenied(true);
          clearPrivateWorkspace();
        }
        setPhase('locked');
        setMessage(
          props.purpose === 'author'
            ? 'Finish any retained draft-save original in its editor. Keep saved data and retry after resolving access or storage problems.'
            : 'The original decision could not be restored. Keep this tab’s saved data and retry when access returns.',
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
  const actions = referenceTransitionActions(props.purpose ?? 'review', context?.review.state);
  async function decide(action: SyntheticReferenceAction) {
    if (
      flight.current ||
      phase !== 'ready' ||
      !ack ||
      !session.current ||
      current.current ||
      !context ||
      !actions.includes(action)
    )
      return;
    flight.current = true;
    const epoch = generation.current;
    try {
      if (props.purpose === 'author')
        assertReferenceAuthorDraftClear(window.sessionStorage, {
          instanceId: props.scope.instanceId,
          tenantId: props.scope.tenantId,
          actorId: props.scope.actorId,
          listingId: props.scope.listingId,
        });
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
    } catch (error) {
      if (epoch !== generation.current) return;
      if (error instanceof ApiClientError && [401, 403].includes(error.status ?? 0)) {
        setDenied(true);
        clearPrivateWorkspace();
      }
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
    } catch (error) {
      if (epoch !== generation.current) return;
      if (error instanceof ApiClientError && [401, 403].includes(error.status ?? 0)) {
        setDenied(true);
        clearPrivateWorkspace();
      }
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
        props.purpose === 'author'
          ? 'Settled original cleared. Read the current draft before preparing another action.'
          : 'Settled original cleared. Return to pending reviews and inspect a fresh saved revision.',
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
  const label = (key: string) =>
    key === 'amountMinor'
      ? 'Advertised price'
      : key
          .replace(/([A-Z])/g, ' $1')
          .toLowerCase()
          .replace(/^./, (c) => c.toUpperCase());
  const receipt = current.current?.receipt;
  if (!reviewed || denied)
    return (
      <section
        className="reference-review draft-panel"
        aria-label={
          props.purpose === 'author' ? 'Saved reference submission' : 'Saved reference review'
        }
      >
        <h1>
          {props.purpose === 'author' ? 'Submit or withdraw saved listing' : 'Review saved listing'}
        </h1>
        <p role="status">
          {denied
            ? 'Current access is unavailable. Retained originals were kept; reload after access is restored.'
            : message}
        </p>
        {denied && (
          <button type="button" onClick={() => window.location.reload()}>
            Reload current access
          </button>
        )}
        {phase === 'locked' && !denied && (
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Retry original restoration
          </button>
        )}
        {phase === 'unavailable' &&
          (props.purpose === 'author' ? (
            <a href={`/drafts/${props.scope.listingId}/${props.scope.revision}`}>
              Read current draft
            </a>
          ) : (
            <a href="/reviews">Return to pending reviews</a>
          ))}
      </section>
    );
  return (
    <section
      className="reference-review draft-panel"
      aria-label={
        props.purpose === 'author' ? 'Saved reference submission' : 'Saved reference review'
      }
      data-phase={phase}
    >
      <h1>
        {props.purpose === 'author' ? 'Submit or withdraw saved listing' : 'Review saved listing'}
      </h1>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {props.purpose !== 'author' && context && props.video && (
        <ReviewListingVideo state={props.video} />
      )}
      <p>
        Listing {reviewed.listingId} · revision {reviewed.revision} · editorial version{' '}
        {reviewed.revisionVersion}
      </p>
      {props.purpose === 'author' && (
        <p>
          <a href={`/drafts/${props.scope.listingId}/${props.scope.revision}`}>
            Return to draft recovery
          </a>
        </p>
      )}
      <h2>Complete private content</h2>
      <dl className="reference-review-facts">
        {Object.entries(reviewed.content).map(([key, value]) => (
          <div
            key={key}
            className={
              ['description', 'pricing', 'location'].includes(key)
                ? 'reference-review-wide'
                : undefined
            }
          >
            <dt>{label(key)}</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>
              {key === 'amountMinor' ? (
                reviewed.content.amountMinor === null ? (
                  'Not supplied'
                ) : (
                  formatKes(kesFromMinor(reviewed.content.amountMinor))
                )
              ) : key === 'location' ? (
                Object.entries(reviewed.content.location)
                  .map(([name, v]) => `${label(name)}: ${v ?? 'Not supplied'}`)
                  .join(' · ')
              ) : key === 'pricing' ? (
                <>
                  <p>Disclosure: {reviewed.content.pricing.declaration.replaceAll('_', ' ')}</p>
                  <ul>
                    {reviewed.content.pricing.charges.map((charge) => (
                      <li key={charge.id}>
                        <strong>{charge.name}</strong>:{' '}
                        {charge.amountStatus === 'known'
                          ? formatKes(kesFromMinor(charge.amountMinor))
                          : 'Quote required'}
                        {' · '}
                        {charge.timing.replaceAll('_', ' ')}
                        {' · '}
                        {charge.classification.replaceAll('_', ' ')}
                        {' · '}
                        {charge.mandatory ? 'Mandatory' : 'Optional'}
                      </li>
                    ))}
                  </ul>
                  {reviewed.content.pricing.charges.length === 0 && (
                    <p>
                      {reviewed.content.pricing.declaration === 'complete'
                        ? 'No additional charges declared.'
                        : 'Charges not fully declared.'}
                    </p>
                  )}
                </>
              ) : (
                display(value)
              )}
            </dd>
          </div>
        ))}
      </dl>
      <h2>Saved historical references</h2>
      <p>Catalogue version {reviewed.attributes.catalogueVersion}</p>
      <dl className="reference-review-facts">
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
      {props.purpose === 'author' && (
        <p>
          Only the current saved revision is submitted or withdrawn. Submission rechecks current
          access, content completeness and required accepted photos. It does not publish the
          listing. Photo acceptance below is synthetic saved metadata; image bytes were not loaded
          here. Finish any retained draft-save original in its editor first.
        </p>
      )}
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
      {props.purpose !== 'author' && !['restoring', 'locked', 'settled'].includes(phase) && (
        <ReviewImages
          onDenied={clearPrivateWorkspace}
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
        <legend>
          {props.purpose === 'author'
            ? 'Action on this exact saved revision'
            : 'Decision on this saved review'}
        </legend>
        <label>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I
          reviewed the saved content, historical references, operational context and photo order,
          including any unavailable-image warning in this synthetic preview.
        </label>
        {props.purpose !== 'author' && (
          <label>
            Rejection reason
            <textarea value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
          </label>
        )}
        {actions.includes('approve') && (
          <button type="button" disabled={!ack} onClick={() => void decide('approve')}>
            Approve saved review
          </button>
        )}
        {actions.includes('reject') && (
          <button
            type="button"
            disabled={!ack || reason.trim().length === 0 || reason !== reason.trim()}
            onClick={() => void decide('reject')}
          >
            Reject with reason
          </button>
        )}
        {actions.includes('submit') && (
          <button type="button" disabled={!ack} onClick={() => void decide('submit')}>
            Submit saved revision for review
          </button>
        )}
        {actions.includes('withdraw') && (
          <button type="button" disabled={!ack} onClick={() => void decide('withdraw')}>
            Withdraw saved revision
          </button>
        )}
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
      {phase === 'settled' &&
        (props.purpose === 'author' ? (
          <a href={`/drafts/${props.scope.listingId}/${props.scope.revision}`}>
            Read current draft
          </a>
        ) : (
          <a href="/reviews">Return to pending reviews</a>
        ))}
    </section>
  );
}
