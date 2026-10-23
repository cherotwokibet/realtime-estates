'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  validateListingReferenceCatalogue,
  selectListingReferenceAttributes,
  type ListingReferenceCatalogue,
  type ListingReferenceSelection,
  type StaffDraftContentV2,
  type SyntheticReferenceDraftReceipt,
} from '@realtor/domain';
import {
  buildReferenceDraftCommand,
  referenceDraftSession,
  prepareReferenceDraftAttempt,
  restoreReferenceDraftAttempt,
  type ReferenceDraftAttempt,
  type ReferenceDraftClient,
  type ReferenceDraftScope,
} from '../lib/reference-draft-workspace.ts';
export interface ReferenceDraftEditorProps {
  scope: ReferenceDraftScope;
  revision: number;
  expectedVersion: string;
  content: StaffDraftContentV2;
  catalogue: ListingReferenceCatalogue;
  /** Construct only in a current-authorized client adapter; no bearer credential is a component prop. */
  client?: ReferenceDraftClient;
  onReceipt?: (receipt: SyntheticReferenceDraftReceipt) => void;
}
/** Candidate component, deliberately not mounted until the authorized BFF/preview boundary is wired. */
export default function ReferenceDraftEditor(props: ReferenceDraftEditorProps) {
  const catalogue = useMemo(
    () => validateListingReferenceCatalogue(props.catalogue),
    [props.catalogue],
  );
  const unknown = (): ListingReferenceSelection => ({
    catalogueVersion: catalogue.version,
    location: { countyId: null, localityId: null, neighbourhoodId: null },
    amenityIds: [],
  });
  const [selected, setSelected] = useState<ListingReferenceSelection>(unknown),
    [confirmed, setConfirmed] = useState(false),
    [status, setStatus] = useState('restoring'),
    [message, setMessage] = useState('Checking for an original draft…'),
    [retry, setRetry] = useState(0),
    [needsRefresh, setNeedsRefresh] = useState(false);
  const current = useRef<ReferenceDraftAttempt | null>(null),
    session = useRef<ReturnType<typeof referenceDraftSession> | null>(null),
    flight = useRef(false),
    generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const scope = ++generation.current,
      abort = new AbortController();
    controller.current = abort;
    current.current = null;
    session.current = null;
    flight.current = true;
    setStatus('restoring');
    setConfirmed(false);
    setNeedsRefresh(false);
    setSelected(unknown());
    if (!props.client) {
      flight.current = false;
      setStatus('blocked');
      setMessage('Reference saving is not connected.');
      return () => abort.abort();
    }
    void (async () => {
      try {
        const retained = referenceDraftSession(window.sessionStorage, props.scope);
        session.current = retained;
        const original = await restoreReferenceDraftAttempt(props.client!, retained, abort.signal);
        if (generation.current !== scope || abort.signal.aborted) return;
        current.current = original;
        setStatus(original ? 'uncertain' : 'ready');
        setMessage(
          original
            ? 'A saved attempt needs original recovery before editing.'
            : 'Choose explicit reference facts.',
        );
      } catch {
        if (generation.current === scope && !abort.signal.aborted) {
          setStatus('blocked');
          setMessage('The retained original could not be checked. Keep it and retry loading.');
        }
      } finally {
        if (generation.current === scope) flight.current = false;
      }
    })();
    return () => abort.abort();
  }, [
    props.client,
    props.scope.instanceId,
    props.scope.tenantId,
    props.scope.actorId,
    props.scope.listingId,
    props.revision,
    props.expectedVersion,
    catalogue,
    retry,
  ]);
  let selectionError = false;
  try {
    selectListingReferenceAttributes(selected, catalogue, props.content.propertyType);
  } catch {
    selectionError = true;
  }
  const locked = status !== 'ready' || needsRefresh || !props.client;
  const choose = (kind: 'countyId' | 'localityId' | 'neighbourhoodId', value: string) =>
    setSelected((old) => ({
      ...old,
      location:
        kind === 'countyId'
          ? { countyId: value || null, localityId: null, neighbourhoodId: null }
          : kind === 'localityId'
            ? { ...old.location, localityId: value || null, neighbourhoodId: null }
            : { ...old.location, neighbourhoodId: value || null },
    }));
  async function run(mode: 'submit' | 'recover' | 'replay') {
    if (flight.current || !props.client || !session.current || needsRefresh) return;
    const scope = generation.current;
    flight.current = true;
    try {
      if (mode === 'submit') {
        if (!confirmed || selectionError || current.current) return;
        const command = buildReferenceDraftCommand(
          {
            operationId: crypto.randomUUID(),
            listingId: props.scope.listingId,
            revision: props.revision,
            expectedVersion: props.expectedVersion,
            content: props.content,
            selection: selected,
          },
          catalogue,
        );
        current.current = prepareReferenceDraftAttempt(
          props.client,
          session.current,
          command,
          catalogue,
        );
      }
      const original = current.current;
      if (!original) return;
      setStatus('sending');
      setMessage(mode === 'recover' ? 'Recovering the original…' : 'Saving the retained original…');
      await (mode === 'submit'
        ? original.submit(controller.current?.signal)
        : mode === 'recover'
          ? original.recoverOriginal(controller.current?.signal)
          : original.replayOriginal(controller.current?.signal));
      if (generation.current !== scope) return;
      setStatus(original.status);
      setMessage(`Original saved at revision version ${original.receipt!.revisionVersion}.`);
    } catch {
      if (generation.current !== scope) return;
      const state = current.current?.status ?? 'ready';
      setStatus(current.current && state === 'ready' ? 'blocked' : state);
      setMessage(
        state === 'uncertain'
          ? 'The save result is unconfirmed. Recover the original before editing.'
          : current.current && state === 'ready'
            ? 'The original could not be retained. Retry loading before another attempt.'
            : 'The draft was not saved. Keep the original until you review this result.',
      );
    } finally {
      if (generation.current === scope) flight.current = false;
    }
  }
  function finish() {
    if (flight.current || !current.current?.canDiscard) return;
    const receipt = current.current.receipt;
    try {
      current.current.discard();
      current.current = null;
      setStatus('ready');
      setConfirmed(false);
      setNeedsRefresh(true);
      setMessage('Refresh the draft before making another change.');
      if (receipt) props.onReceipt?.(receipt);
    } catch {
      setMessage('The original could not be cleared. Keep it and retry.');
    }
  }
  const rows = (kind: string, parent: string | null) => {
    const selectedRows = catalogue.locations.filter(
      (row) => row.kind === kind && (kind === 'county' || row.parentId === parent),
    );
    const counts = new Map<string, number>();
    for (const row of selectedRows) counts.set(row.label, (counts.get(row.label) ?? 0) + 1);
    return selectedRows.map((row) => ({
      ...row,
      displayLabel:
        (counts.get(row.label) ?? 0) > 1 ? `${row.label} (${row.id.slice(-8)})` : row.label,
    }));
  };
  return (
    <section className="draft-panel" aria-label="Reference draft editor">
      <h2>Location and amenities</h2>
      <p>Reference editing preview. These drafts cannot be submitted yet.</p>
      <p>
        Current draft location:{' '}
        {[props.content.location.county, props.content.location.town, props.content.location.area]
          .filter(Boolean)
          .join(' / ') || 'Unknown'}
        . Saving applies your explicit selection, including unknown values.
      </p>
      <fieldset disabled={locked}>
        <legend>Selected reference facts</legend>
        <label className="draft-field">
          County
          <select
            value={selected.location.countyId ?? ''}
            onChange={(e) => choose('countyId', e.target.value)}
            style={{ minHeight: 48 }}
          >
            <option value="">Unknown county</option>
            {rows('county', null).map((row) => (
              <option key={row.id} value={row.id}>
                {row.displayLabel}
              </option>
            ))}
          </select>
        </label>
        <label className="draft-field">
          Town or locality
          <select
            disabled={locked || !selected.location.countyId}
            value={selected.location.localityId ?? ''}
            onChange={(e) => choose('localityId', e.target.value)}
            style={{ minHeight: 48 }}
          >
            <option value="">Unknown locality</option>
            {rows('locality', selected.location.countyId).map((row) => (
              <option key={row.id} value={row.id}>
                {row.displayLabel}
              </option>
            ))}
          </select>
        </label>
        <label className="draft-field">
          Neighbourhood
          <select
            disabled={locked || !selected.location.localityId}
            value={selected.location.neighbourhoodId ?? ''}
            onChange={(e) => choose('neighbourhoodId', e.target.value)}
            style={{ minHeight: 48 }}
          >
            <option value="">Unknown neighbourhood</option>
            {rows('neighbourhood', selected.location.localityId).map((row) => (
              <option key={row.id} value={row.id}>
                {row.displayLabel}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Amenities</legend>
          {catalogue.amenities.map((row) => {
            const checked = selected.amenityIds.includes(row.id),
              applicable =
                props.content.propertyType !== null &&
                row.propertyTypes.includes(props.content.propertyType);
            return (
              <label key={row.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={locked || (!checked && !applicable)}
                  onChange={(e) =>
                    setSelected((old) => ({
                      ...old,
                      amenityIds: e.target.checked
                        ? [...old.amenityIds, row.id]
                        : old.amenityIds.filter((id) => id !== row.id),
                    }))
                  }
                />
                {row.label}
                {!applicable ? ' — unavailable for this property type' : ''}
              </label>
            );
          })}
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          Apply this selection, including unknown values, to the draft.
        </label>
      </fieldset>
      {selectionError && (
        <p role="alert">
          Clear incompatible amenities or correct the selected location before saving.
        </p>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
      <div className="draft-actions">
        <button
          type="button"
          className="draft-primary"
          disabled={locked || !confirmed || selectionError}
          onClick={() => void run('submit')}
        >
          Save reference draft
        </button>
        {status === 'uncertain' && (
          <>
            <button type="button" className="draft-secondary" onClick={() => void run('recover')}>
              Recover original
            </button>
            <button type="button" className="draft-secondary" onClick={() => void run('replay')}>
              Replay identical original
            </button>
          </>
        )}
        {(status === 'received' || status === 'rejected') && (
          <button type="button" className="draft-secondary" onClick={finish}>
            {status === 'received' ? 'Use saved result' : 'Discard rejected original'}
          </button>
        )}
        {status === 'blocked' && props.client && (
          <button type="button" className="draft-secondary" onClick={() => setRetry((n) => n + 1)}>
            Retry loading original
          </button>
        )}
      </div>
    </section>
  );
}
