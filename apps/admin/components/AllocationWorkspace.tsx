'use client';
import { useEffect, useRef, useState } from 'react';
import { normalizeStaffDraftContentV2, type StaffListingSummary } from '@realtor/domain';
import {
  openCreationAllocation,
  openSuccessorAllocation,
  type AllocationIdentity,
} from '../lib/allocation-recovery.ts';
import { createListingCreationClient } from '../lib/listing-creation-client.ts';
import { createListingSuccessorClient } from '../lib/listing-successor-client.ts';
import AllocationOriginal from './AllocationOriginal.tsx';
type Props = { scope: AllocationIdentity } & (
  { kind: 'creation' } | { kind: 'revision'; listing: StaffListingSummary }
);
type Entry = ReturnType<typeof openCreationAllocation> | ReturnType<typeof openSuccessorAllocation>;
type Attempt = NonNullable<Entry['restored']>;
export default function AllocationWorkspace(props: Props) {
  const [slug, setSlug] = useState(''),
    [title, setTitle] = useState(''),
    [status, setStatus] = useState('restoring'),
    [message, setMessage] = useState(
      'Checking for a retained original before enabling allocation…',
    ),
    [retry, setRetry] = useState(0);
  const entry = useRef<Entry | null>(null),
    active = useRef<Attempt | null>(null),
    flight = useRef(true),
    generation = useRef(0),
    safeToLeave = useRef(false),
    controller = useRef<AbortController | null>(null);
  const listing = props.kind === 'revision' ? props.listing : null;
  useEffect(() => {
    const gen = ++generation.current,
      abort = new AbortController();
    controller.current = abort;
    flight.current = true;
    safeToLeave.current = false;
    entry.current = null;
    active.current = null;
    setStatus('restoring');
    try {
      const scope = props.scope;
      const opened =
        props.kind === 'creation'
          ? openCreationAllocation(
              createListingCreationClient({ instanceId: scope.instanceId, scope }),
              window.sessionStorage,
              scope,
            )
          : openSuccessorAllocation(
              createListingSuccessorClient({ instanceId: scope.instanceId, scope }),
              window.sessionStorage,
              scope,
              props.listing.listingId,
              props.listing,
            );
      if (gen !== generation.current) return;
      entry.current = opened;
      active.current = opened.restored;
      safeToLeave.current = opened.restored === null;
      const eligible = props.kind === 'creation' || ('eligible' in opened && opened.eligible);
      setStatus(opened.restored ? 'uncertain' : eligible ? 'ready' : 'ineligible');
      setMessage(
        opened.restored
          ? 'A retained original needs explicit recovery. No new IDs or requests were generated.'
          : eligible
            ? 'Enter initial facts, then review the original before sending.'
            : 'The latest revision is not terminal. There is no retained original to recover here.',
      );
    } catch {
      setStatus('blocked');
      setMessage(
        'The retained original could not be checked. Keep this tab and retry loading; new allocation is locked.',
      );
    } finally {
      if (gen === generation.current) flight.current = false;
    }
    return () => abort.abort();
  }, [
    props.scope.instanceId,
    props.scope.tenantId,
    props.scope.actorId,
    props.kind,
    listing,
    retry,
  ]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (!safeToLeave.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const click = (e: MouseEvent) => {
      if (!safeToLeave.current && e.target instanceof Element && e.target.closest('a[href]')) {
        e.preventDefault();
        e.stopPropagation();
        setMessage('Recover the retained original before leaving this workspace.');
      }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', click, true);
    };
  }, []);
  function prepare() {
    if (flight.current || active.current || !entry.current || status !== 'ready') return;
    try {
      const content = normalizeStaffDraftContentV2({
        title,
        pricing: { declaration: 'not_declared', charges: [] },
        location: { county: null, town: null, area: null },
      });
      // Each entry owns its allocation eligibility and restores before these UUID callbacks.
      active.current =
        props.kind === 'creation'
          ? (entry.current as ReturnType<typeof openCreationAllocation>).prepare(
              { slug, content },
              () => crypto.randomUUID(),
              () => crypto.randomUUID(),
            )
          : (entry.current as ReturnType<typeof openSuccessorAllocation>).prepare(content, () =>
              crypto.randomUUID(),
            );
      setStatus('reviewing');
      setMessage('Review the full original and send explicitly. No request has been sent.');
    } catch {
      setStatus('blocked');
      safeToLeave.current = false;
      setMessage(
        'Review the initial facts and retained storage. Retry loading before preparing another original.',
      );
    }
  }
  async function run(mode: 'send' | 'recover' | 'replay') {
    const original = active.current;
    if (flight.current || !original || !entry.current) return;
    if ((mode === 'send' && status !== 'reviewing') || (mode !== 'send' && status !== 'uncertain'))
      return;
    const gen = generation.current;
    flight.current = true;
    safeToLeave.current = false;
    setStatus('sending');
    setMessage(
      mode === 'recover'
        ? 'Reading the exact retained original…'
        : 'Sending the exact retained original…',
    );
    try {
      await (mode === 'send'
        ? original.submit(controller.current?.signal)
        : mode === 'recover'
          ? original.recoverOriginal(controller.current?.signal)
          : original.replayOriginal(controller.current?.signal));
      if (gen !== generation.current) return;
      safeToLeave.current = original.canLeave;
      setStatus(original.status);
      setMessage(
        original.freshDraftTarget
          ? 'Allocation confirmed. Open the current draft for a fresh read before editing.'
          : 'The original result allocated no draft. Review current listing context before a separate attempt.',
      );
    } catch {
      if (gen !== generation.current) return;
      const state = original.status;
      safeToLeave.current = state !== 'ready' && original.canLeave;
      setStatus(state === 'ready' ? 'blocked' : state);
      setMessage(
        state === 'uncertain'
          ? 'Result uncertain. Keep the original and recover it, or deliberately replay the identical operation.'
          : state === 'ready'
            ? 'The original could not be retained and read back. No request was sent; keep this tab and retry loading.'
            : 'Allocation was refused. Review retained facts and current access before continuing.',
      );
    } finally {
      if (gen === generation.current) flight.current = false;
    }
  }
  function reloadOriginal() {
    if (flight.current || !active.current) return;
    try {
      active.current.verifyReload();
      safeToLeave.current = true;
      window.location.reload();
    } catch {
      safeToLeave.current = false;
      setStatus('blocked');
      setMessage('The complete original could not be verified in storage. Keep this tab.');
    }
  }
  function finish(openDraft: boolean) {
    const original = active.current;
    if (flight.current || !original?.canDiscard) return;
    const target = openDraft ? original.freshDraftTarget : null;
    if (openDraft && !target) return;
    try {
      original.discard();
      active.current = null;
      safeToLeave.current = true;
      if (target) window.location.assign(`/drafts/${target.listingId}/${target.revision}`);
      else if (props.kind === 'revision') window.location.reload();
      else setRetry((n) => n + 1);
    } catch {
      safeToLeave.current = false;
      setStatus('blocked');
      setMessage(
        'The matching retained original could not be cleared. Keep this tab and retry loading.',
      );
    }
  }
  const original = active.current;
  return (
    <section className="draft-panel" aria-label="Retained listing allocation workspace">
      <nav aria-label="Allocation navigation">
        <a href="/listings">Listing queue</a>
      </nav>
      <h1>{props.kind === 'creation' ? 'Create a listing' : 'Start a new draft'}</h1>
      <p>
        Local synthetic preview. The complete sent original is retained in this browser tab for
        recovery after reload. Closing the tab can remove it. Saved draft editing, photos and
        publication are separate steps.
      </p>
      {listing && (
        <p>
          Current listing {listing.listingId} · version {listing.version} · latest revision{' '}
          {listing.latest?.revision ?? 'Unknown'} · {listing.latest?.state ?? 'Unknown'}. A retained
          original is checked before new-revision eligibility.
        </p>
      )}
      <fieldset disabled={status !== 'ready'}>
        <legend>Initial listing facts</legend>
        {props.kind === 'creation' && (
          <label>
            Listing slug
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              maxLength={160}
              autoComplete="off"
            />
          </label>
        )}
        <label>
          Initial title (optional)
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={320}
            autoComplete="off"
          />
        </label>
        <p>
          Other facts remain unknown. Enter them explicitly in the current draft editor after
          allocation; a new revision starts with an empty gallery.
        </p>
        <button className="enq-primary" type="button" onClick={prepare}>
          Prepare original {props.kind === 'creation' ? 'creation' : 'revision'}
        </button>
      </fieldset>
      {original && (
        <section aria-label="Retained allocation original">
          <AllocationOriginal command={original.original} />
          <p>Attempt: {status === 'reviewing' ? 'ready for review' : original.status}</p>
          {status === 'reviewing' && (
            <button className="enq-primary" type="button" onClick={() => void run('send')}>
              Send exact original
            </button>
          )}
          {status === 'uncertain' && (
            <>
              <button className="enq-primary" type="button" onClick={() => void run('recover')}>
                Recover exact original with GET
              </button>
              <button className="enq-secondary" type="button" onClick={() => void run('replay')}>
                Replay same original
              </button>
              <button className="enq-secondary" type="button" onClick={reloadOriginal}>
                Verify original and reload
              </button>
            </>
          )}
          {original.canDiscard && status !== 'blocked' && (
            <button className="enq-secondary" type="button" onClick={() => finish(false)}>
              {status === 'reviewing' ? 'Discard prepared original' : 'Clear confirmed original'}
            </button>
          )}
          {original.freshDraftTarget && (
            <button className="enq-primary" type="button" onClick={() => finish(true)}>
              Open current draft for a fresh read
            </button>
          )}
        </section>
      )}
      {status === 'blocked' && (
        <button
          className="enq-secondary"
          type="button"
          disabled={flight.current}
          onClick={() => setRetry((n) => n + 1)}
        >
          Retry loading retained original
        </button>
      )}
      <p
        role={['blocked', 'uncertain', 'rejected'].includes(status) ? 'alert' : 'status'}
        aria-live="polite"
      >
        {message}
      </p>
    </section>
  );
}
