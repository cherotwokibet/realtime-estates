'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PROPERTY_TYPES,
  RENTAL_PERIODS,
  normalizeStaffDraftContentV2,
  validateListingReferenceCatalogue,
  selectListingReferenceAttributes,
  type ListingReferenceCatalogue,
  type ListingReferenceSelection,
} from '@realtor/domain';
import { draftToForm, formToDraft, type DraftForm } from '../lib/editor-model.ts';
import ReferenceCreationOriginal from './ReferenceCreationOriginal.tsx';
import {
  openReferenceCreationEntry,
  type CreationIdentity,
} from '../lib/reference-creation-entry.ts';
import { createReferenceCreationClient } from '../lib/reference-creation-client.ts';
import {
  buildReferenceCreationCommand,
  prepareReferenceCreationAttempt,
  restoreReferenceCreationAttempt,
  type ReferenceCreationAttempt,
} from '../lib/reference-creation-workspace.ts';
export interface ReferenceCreationWorkspaceProps {
  identity: CreationIdentity;
  catalogue: ListingReferenceCatalogue;
}
const emptyForm = () =>
  draftToForm(
    normalizeStaffDraftContentV2({
      pricing: { declaration: 'not_declared', charges: [] },
      location: { county: null, town: null, area: null },
    }),
  );
export default function ReferenceCreationWorkspace(props: ReferenceCreationWorkspaceProps) {
  const catalogue = useMemo(
    () => validateListingReferenceCatalogue(props.catalogue),
    [props.catalogue],
  );
  const [retainedCatalogue, setRetainedCatalogue] = useState(catalogue);
  const [form, setForm] = useState<DraftForm>(emptyForm),
    [slug, setSlug] = useState(''),
    [selected, setSelected] = useState<ListingReferenceSelection>(() => ({
      catalogueVersion: catalogue.version,
      location: { countyId: null, localityId: null, neighbourhoodId: null },
      amenityIds: [],
    })),
    [confirmed, setConfirmed] = useState(false),
    [status, setStatus] = useState('restoring'),
    [message, setMessage] = useState('Checking for an original creation before enabling controls…'),
    [retry, setRetry] = useState(0);
  const entry = useRef<ReturnType<typeof openReferenceCreationEntry> | null>(null),
    client = useRef<ReturnType<typeof createReferenceCreationClient> | null>(null),
    active = useRef<ReferenceCreationAttempt | null>(null),
    flight = useRef(true),
    generation = useRef(0),
    controller = useRef<AbortController | null>(null),
    safeToLeave = useRef(false);
  useEffect(() => {
    const gen = ++generation.current,
      abort = new AbortController();
    controller.current = abort;
    flight.current = true;
    safeToLeave.current = false;
    active.current = null;
    entry.current = null;
    client.current = null;
    setStatus('restoring');
    setConfirmed(false);
    void (async () => {
      try {
        const opened = openReferenceCreationEntry(window.sessionStorage, props.identity, () =>
          crypto.randomUUID(),
        );
        entry.current = opened;
        const base = createReferenceCreationClient(opened.scope);
        const transport = {
          ...base,
          async catalogue(version: string, signal?: AbortSignal) {
            const result = await base.catalogue(version, signal);
            if (gen === generation.current && !abort.signal.aborted) setRetainedCatalogue(result);
            return result;
          },
        };
        client.current = transport;
        const original = await restoreReferenceCreationAttempt(
          transport,
          opened.session,
          abort.signal,
        );
        if (gen !== generation.current || abort.signal.aborted) return;
        active.current = original;
        safeToLeave.current = original === null;
        setStatus(original ? 'uncertain' : 'ready');
        setMessage(
          original
            ? 'A retained creation needs original recovery. New allocation is locked.'
            : 'Enter the initial facts and explicit reference choices. Missing facts remain unknown.',
        );
      } catch {
        if (gen === generation.current && !abort.signal.aborted) {
          setStatus('blocked');
          setMessage(
            'The original could not be checked. Keep this tab and retry loading; no new creation is enabled.',
          );
        }
      } finally {
        if (gen === generation.current) flight.current = false;
      }
    })();
    return () => abort.abort();
  }, [
    props.identity.instanceId,
    props.identity.tenantId,
    props.identity.actorId,
    catalogue,
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
  const locked = status !== 'ready';
  let invalid = false;
  try {
    const content = formToDraft(form);
    selectListingReferenceAttributes(selected, catalogue, content.propertyType);
  } catch {
    invalid = true;
  }
  const update = (field: keyof DraftForm, value: string) =>
    setForm((old) => ({ ...old, [field]: value }));
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
  const rows = (kind: string, parent: string | null) => {
    const items = catalogue.locations.filter(
      (r) => r.kind === kind && (kind === 'county' || r.parentId === parent),
    );
    return items.map((row) => ({
      ...row,
      label:
        items.filter((r) => r.label === row.label).length > 1
          ? `${row.label} (${row.id.slice(-8)})`
          : row.label,
    }));
  };
  async function run(mode: 'submit' | 'recover' | 'replay') {
    if (flight.current || !entry.current || !client.current) return;
    const gen = generation.current;
    flight.current = true;
    try {
      if (mode === 'submit') {
        if (status !== 'ready' || !confirmed || invalid || active.current) return;
        setRetainedCatalogue(catalogue);
        const command = buildReferenceCreationCommand(
          {
            listingId: entry.current.scope.listingId,
            operationId: crypto.randomUUID(),
            slug,
            content: formToDraft(form),
            selection: selected,
          },
          catalogue,
        );
        active.current = prepareReferenceCreationAttempt(
          client.current,
          entry.current.session,
          command,
          catalogue,
        );
      }
      const original = active.current;
      if (!original) return;
      safeToLeave.current = false;
      setStatus('sending');
      setMessage(
        mode === 'recover'
          ? 'Reading the retained original…'
          : 'Sending the complete retained original…',
      );
      await (mode === 'submit'
        ? original.submit(controller.current?.signal)
        : mode === 'recover'
          ? original.recoverOriginal(controller.current?.signal)
          : original.replayOriginal(controller.current?.signal));
      if (gen !== generation.current) return;
      safeToLeave.current = original.canDiscard;
      setStatus(original.status);
      setMessage('Creation confirmed. Open the current draft for a fresh read before editing.');
    } catch {
      if (gen !== generation.current) return;
      const original = active.current,
        state = original?.status ?? 'ready';
      safeToLeave.current = !!original && original.canDiscard && state !== 'ready';
      setStatus(!original || state === 'ready' ? 'blocked' : state);
      setMessage(
        state === 'uncertain'
          ? 'Result uncertain. Keep the original and recover it, or deliberately replay the identical operation.'
          : original && state === 'ready'
            ? 'The original could not be retained. Retry loading before another attempt.'
            : 'Creation was not confirmed. Review the retained facts and current access.',
      );
    } finally {
      if (gen === generation.current) flight.current = false;
    }
  }
  function reloadOriginal() {
    if (flight.current || !entry.current || !active.current) return;
    try {
      entry.current.verifyReload(active.current);
      // Explicit same-page reload is safe only after readback of the complete retained original.
      safeToLeave.current = true;
      window.location.reload();
    } catch {
      safeToLeave.current = false;
      setStatus('blocked');
      setMessage('The original could not be verified in storage. Keep this tab and retry loading.');
    }
  }
  function finish() {
    if (flight.current || !entry.current || !active.current?.canDiscard) return;
    const original = active.current,
      created = original.receipt !== null,
      id = original.original.listingId;
    try {
      entry.current.release(original);
      active.current = null;
      safeToLeave.current = true;
      if (created) window.location.assign(`/drafts/${id}/1/references`);
      else {
        setForm(emptyForm());
        setSlug('');
        setConfirmed(false);
        setRetry((n) => n + 1);
      }
    } catch {
      safeToLeave.current = false;
      setStatus('blocked');
      setMessage('The retained original could not be cleared. Keep it and retry loading.');
    }
  }
  return (
    <section className="draft-panel" aria-label="Reference creation workspace">
      <nav aria-label="Creation navigation">
        <a href="/listings">Listing queue</a>
      </nav>
      <h1>Create a listing with references</h1>
      <p>
        Private synthetic preview. The original is retained in this browser tab for recovery.
        Photos, availability and publication are separate steps.
      </p>
      <fieldset disabled={locked}>
        <legend>Initial listing facts</legend>
        <label className="draft-field">
          Listing slug
          <input
            value={slug}
            maxLength={160}
            autoComplete="off"
            onChange={(e) => setSlug(e.target.value)}
          />
        </label>
        {(
          [
            'title',
            'description',
            'privateAddress',
            'bedrooms',
            'privateBathrooms',
            'sharedBathrooms',
          ] as const
        ).map((field) => (
          <label className="draft-field" key={field}>
            {
              {
                title: 'Title',
                description: 'Description',
                privateAddress: 'Private address (staff only)',
                bedrooms: 'Bedrooms',
                privateBathrooms: 'Private bathrooms',
                sharedBathrooms: 'Shared bathrooms',
              }[field]
            }
            <input
              value={form[field]}
              onChange={(e) => update(field, e.target.value)}
              maxLength={field === 'description' ? 10000 : field === 'privateAddress' ? 1000 : 320}
            />
          </label>
        ))}
        <label className="draft-field">
          Property type
          <select
            value={form.propertyType}
            onChange={(e) => update('propertyType', e.target.value)}
          >
            <option value="">Unknown type</option>
            {PROPERTY_TYPES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="draft-field">
          Purpose
          <select value={form.purpose} onChange={(e) => update('purpose', e.target.value)}>
            <option value="">Unknown purpose</option>
            <option value="rent">Rent</option>
            <option value="sale">Sale</option>
          </select>
        </label>
        <label className="draft-field">
          Base price (KES; blank is unknown)
          <input
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => update('amount', e.target.value)}
          />
        </label>
        <label className="draft-field">
          Rental period
          <select value={form.rentPeriod} onChange={(e) => update('rentPeriod', e.target.value)}>
            <option value="">Unknown / not applicable</option>
            {RENTAL_PERIODS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="draft-field">
          Cost declaration
          <select
            value={form.declaration}
            onChange={(e) =>
              setForm((old) => ({
                ...old,
                declaration: e.target.value as DraftForm['declaration'],
              }))
            }
          >
            {['not_declared', 'incomplete', 'complete'].map((v) => (
              <option key={v} value={v}>
                {v.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="reference-costs">
          <legend>Additional fees and refundable deposits</legend>
          {form.charges.map((charge, index) => (
            <div className="reference-charge" key={charge.id}>
              <label className="draft-field">
                Charge name
                <input
                  value={charge.name}
                  maxLength={160}
                  onChange={(e) =>
                    setForm((old) => ({
                      ...old,
                      charges: old.charges.map((c, i) =>
                        i === index ? { ...c, name: e.target.value } : c,
                      ),
                    }))
                  }
                />
              </label>
              <label className="draft-field">
                Amount status
                <select
                  value={charge.amountStatus}
                  onChange={(e) =>
                    setForm((old) => ({
                      ...old,
                      charges: old.charges.map((c, i) =>
                        i === index
                          ? { ...c, amountStatus: e.target.value as 'known' | 'quote_required' }
                          : c,
                      ),
                    }))
                  }
                >
                  <option value="known">Known</option>
                  <option value="quote_required">Quote required</option>
                </select>
              </label>
              <label className="draft-field">
                KES amount
                <input
                  value={charge.amount}
                  inputMode="decimal"
                  disabled={charge.amountStatus === 'quote_required'}
                  onChange={(e) =>
                    setForm((old) => ({
                      ...old,
                      charges: old.charges.map((c, i) =>
                        i === index ? { ...c, amount: e.target.value } : c,
                      ),
                    }))
                  }
                />
              </label>
              <label className="draft-field">
                Timing
                <select
                  value={charge.timing}
                  onChange={(e) =>
                    setForm((old) => ({
                      ...old,
                      charges: old.charges.map((c, i) =>
                        i === index
                          ? { ...c, timing: e.target.value as 'one_off' | 'per_rental_period' }
                          : c,
                      ),
                    }))
                  }
                >
                  <option value="one_off">One off</option>
                  <option value="per_rental_period">Per rental period</option>
                </select>
              </label>
              <label className="draft-field">
                Classification
                <select
                  value={charge.classification}
                  onChange={(e) =>
                    setForm((old) => ({
                      ...old,
                      charges: old.charges.map((c, i) =>
                        i === index
                          ? { ...c, classification: e.target.value as 'fee' | 'refundable_deposit' }
                          : c,
                      ),
                    }))
                  }
                >
                  <option value="fee">Fee</option>
                  <option value="refundable_deposit">Refundable deposit</option>
                </select>
              </label>
              <label className="draft-checkbox">
                <input
                  type="checkbox"
                  checked={charge.mandatory}
                  onChange={(e) =>
                    setForm((old) => ({
                      ...old,
                      charges: old.charges.map((c, i) =>
                        i === index ? { ...c, mandatory: e.target.checked } : c,
                      ),
                    }))
                  }
                />
                Mandatory
              </label>
              <button
                type="button"
                onClick={() =>
                  setForm((old) => ({ ...old, charges: old.charges.filter((_, i) => i !== index) }))
                }
              >
                Remove charge
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={form.charges.length >= 32}
            onClick={() =>
              setForm((old) => ({
                ...old,
                charges: [
                  ...old.charges,
                  {
                    id: crypto.randomUUID(),
                    name: '',
                    amountStatus: 'quote_required',
                    amount: '',
                    timing: 'one_off',
                    classification: 'fee',
                    mandatory: false,
                  },
                ],
              }))
            }
          >
            Add charge
          </button>
        </fieldset>
        {(['countyId', 'localityId', 'neighbourhoodId'] as const).map((kind, i) => (
          <label className="draft-field" key={kind}>
            {['County', 'Town / locality', 'Neighbourhood'][i]}
            <select
              value={selected.location[kind] ?? ''}
              onChange={(e) => choose(kind, e.target.value)}
            >
              <option value="">Unknown</option>
              {rows(
                ['county', 'locality', 'neighbourhood'][i]!,
                i === 0
                  ? null
                  : i === 1
                    ? selected.location.countyId
                    : selected.location.localityId,
              ).map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <fieldset>
          <legend>Explicit amenities</legend>
          {catalogue.amenities.map((row) => (
            <label key={row.id}>
              <input
                type="checkbox"
                checked={selected.amenityIds.includes(row.id)}
                disabled={
                  !selected.amenityIds.includes(row.id) &&
                  !row.propertyTypes.some((type) => type === form.propertyType)
                }
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
            </label>
          ))}
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          Create with these explicit facts, including unknown values.
        </label>
      </fieldset>
      {invalid && (
        <p role="alert">
          Review the exact price, fees, property type and compatible reference choices.
        </p>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
      {active.current && (
        <ReferenceCreationOriginal
          command={active.current.original}
          catalogue={retainedCatalogue}
        />
      )}
      {active.current && (
        <p>
          Retained target: {active.current.original.listingId}; operation:{' '}
          {active.current.original.operationId}; slug: {active.current.original.slug}. Current draft
          facts require a fresh read after confirmation.
        </p>
      )}
      <div className="draft-actions">
        <button
          type="button"
          disabled={locked || !confirmed || invalid || !slug}
          onClick={() => void run('submit')}
        >
          Create once
        </button>
        {status === 'uncertain' && (
          <>
            <button type="button" onClick={reloadOriginal}>
              Reload retained workspace
            </button>
            <button type="button" onClick={() => void run('recover')}>
              Recover original
            </button>
            <button type="button" onClick={() => void run('replay')}>
              Replay identical original
            </button>
          </>
        )}
        {(status === 'received' || status === 'rejected') && (
          <button type="button" onClick={finish}>
            {status === 'received' ? 'Finish and open current draft' : 'Discard rejected original'}
          </button>
        )}
        {status === 'blocked' && (
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Retry loading original
          </button>
        )}
      </div>
    </section>
  );
}
