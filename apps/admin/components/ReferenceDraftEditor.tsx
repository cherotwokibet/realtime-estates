'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { draftToForm, formToDraft, type DraftForm } from '../lib/editor-model.ts';
import { referenceFormCommand } from '../lib/reference-draft-form.ts';
import { usePrivateWorkspaceClear } from './PrivateWorkspaceBoundary.tsx';
import { ApiClientError } from '@realtor/api-client';
import ReferencePropertyFields from './ReferencePropertyFields.tsx';
import ReferenceDraftOriginal from './ReferenceDraftOriginal.tsx';
import { assertReferenceDraftAuthorClear } from '../lib/reference-author-policy.ts';
import {
  validateListingReferenceCatalogue,
  selectListingReferenceAttributes,
  type ListingReferenceCatalogue,
  type ListingReferenceSelection,
  type StaffDraftContentV2,
  type SyntheticReferenceDraftReceipt,
} from '@realtor/domain';
import {
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
  initialSelection?: ListingReferenceSelection;
  /** Keep original recovery available after a terminal transition or catalogue replacement. */
  editingDisabled?: boolean;
  /** Construct only in a current-authorized client adapter; no bearer credential is a component prop. */
  client?: ReferenceDraftClient;
  onReceipt?: (receipt: SyntheticReferenceDraftReceipt) => void;
}
/** Reference picker mounted only through the current-authorized synthetic workspace route. */
export default function ReferenceDraftEditor(props: ReferenceDraftEditorProps) {
  const clearPrivateWorkspace = usePrivateWorkspaceClear();
  const catalogue = useMemo(
    () => validateListingReferenceCatalogue(props.catalogue),
    [props.catalogue],
  );
  const unknown = (): ListingReferenceSelection => ({
    catalogueVersion: catalogue.version,
    location: { countyId: null, localityId: null, neighbourhoodId: null },
    amenityIds: [],
  });
  const initialSelection = useMemo(
    () =>
      props.initialSelection
        ? selectListingReferenceAttributes(
            props.initialSelection,
            catalogue,
            props.content.propertyType,
          )
        : unknown(),
    [props.initialSelection, catalogue, props.content.propertyType],
  );
  const [selected, setSelected] = useState<ListingReferenceSelection>(() => initialSelection),
    [form, setForm] = useState<DraftForm>(() => draftToForm(props.content)),
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
    setSelected(initialSelection);
    setForm(draftToForm(props.content));
    if (!props.client) {
      flight.current = false;
      setStatus('blocked');
      setMessage('Reference saving is not connected.');
      return () => {
        generation.current++;
        abort.abort();
      };
    }
    void (async () => {
      try {
        const retained = referenceDraftSession(window.sessionStorage, props.scope);
        session.current = retained;
        const original = await restoreReferenceDraftAttempt(props.client!, retained, abort.signal);
        if (generation.current !== scope || abort.signal.aborted) return;
        if (!original)
          assertReferenceDraftAuthorClear(window.sessionStorage, props.scope, props.revision);
        current.current = original;
        setStatus(original ? 'uncertain' : 'ready');
        setMessage(
          original
            ? 'A saved attempt needs original recovery before editing.'
            : props.editingDisabled
              ? 'This saved snapshot is read-only. Original recovery remains available.'
              : 'Choose explicit reference facts.',
        );
      } catch (error) {
        if (error instanceof ApiClientError && [401, 403].includes(error.status ?? 0))
          clearPrivateWorkspace();
        if (generation.current === scope && !abort.signal.aborted) {
          setStatus('blocked');
          setMessage(
            'Finish any retained submission or withdrawal first. Keep saved originals and retry after resolving storage or access problems.',
          );
        }
      } finally {
        if (generation.current === scope) flight.current = false;
      }
    })();
    return () => {
      generation.current++;
      abort.abort();
    };
  }, [
    props.client,
    props.scope.instanceId,
    props.scope.tenantId,
    props.scope.actorId,
    props.scope.listingId,
    props.revision,
    props.expectedVersion,
    catalogue,
    initialSelection,
    props.editingDisabled,
    props.content,
    retry,
  ]);
  let selectionError = false;
  try {
    const content = formToDraft(form);
    selectListingReferenceAttributes(selected, catalogue, content.propertyType);
  } catch {
    selectionError = true;
  }
  const locked =
    status !== 'ready' || needsRefresh || !props.client || props.editingDisabled === true;
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
  async function run(mode: 'prepare' | 'submit' | 'recover' | 'replay') {
    if (flight.current || !props.client || !session.current || needsRefresh) return;
    const scope = generation.current;
    flight.current = true;
    try {
      if (mode === 'prepare') {
        if (
          status !== 'ready' ||
          !confirmed ||
          selectionError ||
          current.current ||
          props.editingDisabled
        )
          return;
        assertReferenceDraftAuthorClear(window.sessionStorage, props.scope, props.revision);
        const command = referenceFormCommand(form, selected, catalogue, {
          operationId: crypto.randomUUID(),
          listingId: props.scope.listingId,
          revision: props.revision,
          expectedVersion: props.expectedVersion,
        });
        current.current = prepareReferenceDraftAttempt(
          props.client,
          session.current,
          command,
          catalogue,
        );
        setStatus('reviewing');
        setMessage(
          'Review the full original below before sending. It has not been sent or retained yet.',
        );
        return;
      }
      if (mode === 'submit' && (status !== 'reviewing' || props.editingDisabled)) return;
      if (mode === 'submit')
        assertReferenceDraftAuthorClear(window.sessionStorage, props.scope, props.revision);
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
    } catch (error) {
      if (generation.current !== scope) return;
      if (error instanceof ApiClientError && [401, 403].includes(error.status ?? 0))
        clearPrivateWorkspace();
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
  function revise() {
    if (flight.current || status !== 'reviewing' || current.current?.status !== 'ready') return;
    try {
      current.current.discard();
      current.current = null;
      setStatus('ready');
      setConfirmed(false);
      setMessage('Revise the unsent facts and review again.');
    } catch {
      setStatus('blocked');
      setMessage('The original could not be cleared. Keep it and retry loading.');
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
      <h2>Property, location and amenities</h2>
      {props.editingDisabled && (
        <p role="status">
          Fresh editing is unavailable for this saved snapshot. Retained original recovery remains
          available.
        </p>
      )}
      <p>
        Save property and reference facts together. Submission and publication require separate
        checks.
      </p>
      <ReferencePropertyFields form={form} setForm={setForm} disabled={locked} />
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
              applicable = row.propertyTypes.some((type) => type === form.propertyType);
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
          Apply this selection, including unknown values, and review all property facts.
        </label>
      </fieldset>
      {selectionError && (
        <p role="alert">
          Correct invalid property facts, exact costs or reference choices before reviewing. Clear
          incompatible amenities explicitly.
        </p>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
      {current.current && (
        <ReferenceDraftOriginal
          command={current.current.original}
          catalogue={current.current.catalogue}
        />
      )}
      <div className="draft-actions">
        <button
          type="button"
          className="draft-primary"
          disabled={locked || !confirmed || selectionError}
          onClick={() => void run('prepare')}
        >
          Review reference draft
        </button>
        {status === 'reviewing' && (
          <>
            <button type="button" className="draft-primary" onClick={() => void run('submit')}>
              Send reviewed draft
            </button>
            <button type="button" className="draft-secondary" onClick={revise}>
              Revise unsent facts
            </button>
          </>
        )}
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
