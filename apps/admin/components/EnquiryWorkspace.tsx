'use client';

import EnquiryActivity from './EnquiryActivity';
import EnquiryContacts from './EnquiryContacts';
import EnquiryViewings from './EnquiryViewings';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  StaffEnquiryDetailV2,
  StaffEnquiryPageV2,
  EnquiryAssigneePageV2,
  EnquiryOperationInputV2,
  EnquiryOperationReceiptV2,
} from '@realtor/api-client';
import { createEnquiryPreviewClient, EnquiryPreviewError } from '../lib/enquiry-client';
import { createEnquiryReadGuard } from '../lib/enquiry-read-guard';
import {
  allowedEnquiryActions,
  createEnquiryCommand,
  enquiryActionLabel,
  enquiryStatusLabel,
  enquiryForm,
  enquiryFormsEqual,
  formatEnquiryTime,
  enquiryDueLabel,
  type EnquiryForm,
} from '../lib/enquiry-model';

type Props = {
  actor: 'admin' | 'agent';
  actorId: string;
  instanceId: string;
  reminderCaptureEnabled?: boolean;
};
type Attempt = {
  id: string;
  command: EnquiryOperationInputV2;
  receipt: EnquiryOperationReceiptV2 | null;
};
function shortId(id: string | null) {
  return id ? `${id.slice(0, 4)}…${id.slice(-6)}` : 'Unassigned';
}
function errorText(error: unknown) {
  return error instanceof EnquiryPreviewError
    ? error.message
    : 'The request could not be completed. Check the local preview and try a read again.';
}
function Snapshot({ value }: { value: StaffEnquiryDetailV2 }) {
  return (
    <dl className="enq-facts">
      <div>
        <dt>Saved version</dt>
        <dd>{value.version}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>{enquiryStatusLabel(value.status)}</dd>
      </div>
      <div>
        <dt>Assigned staff ID</dt>
        <dd>{value.assignedAgentId ?? 'Unassigned'}</dd>
      </div>
      <div>
        <dt>Follow-up · Nairobi</dt>
        <dd>{formatEnquiryTime(value.nextActionAt)}</dd>
      </div>
    </dl>
  );
}

export default function EnquiryWorkspace({
  actor,
  actorId,
  instanceId,
  reminderCaptureEnabled = false,
}: Props) {
  const client = useMemo(
    () => createEnquiryPreviewClient({ basePath: `/api/enquiry-preview/${actor}`, instanceId }),
    [actor, instanceId],
  );
  const [queue, setQueue] = useState<StaffEnquiryPageV2 | null>(null);
  const [directory, setDirectory] = useState<EnquiryAssigneePageV2 | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState<StaffEnquiryDetailV2 | null>(null);
  const [form, setForm] = useState<EnquiryForm | null>(null);
  const [initialForm, setInitialForm] = useState<EnquiryForm | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const attemptRef = useRef<Attempt | null>(null);
  const [current, setCurrent] = useState<StaffEnquiryDetailV2 | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const contactGuard = useRef(false);
  const viewingGuard = useRef(false);
  const [viewingWork, setViewingWork] = useState(false);
  function guardViewing(value: boolean) {
    viewingGuard.current = value;
    setViewingWork(value);
  }
  const [contactWork, setContactWork] = useState(false);
  function guardContact(value: boolean) {
    contactGuard.current = value;
    setContactWork(value);
  }
  const [queueBusy, setQueueBusy] = useState(false);
  const [notice, setNotice] = useState('Choose an enquiry to see its saved details.');
  const [error, setError] = useState('');
  const [queueError, setQueueError] = useState('');
  const [directoryError, setDirectoryError] = useState('');
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const alive = useRef(true);
  const readRef = useRef<AbortController | null>(null);
  const queueRef = useRef<AbortController | null>(null);
  const directoryRef = useRef<AbortController | null>(null);
  const readGuard = useRef(createEnquiryReadGuard());
  const sequence = useRef(0);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const comparisonHeading = useRef<HTMLHeadingElement>(null);
  const dirty = !!(form && initialForm && !enquiryFormsEqual(form, initialForm));
  const unresolved = !!(attempt && !attempt.receipt);
  function remember(value: Attempt | null) {
    attemptRef.current = value;
    setAttempt(value);
  }
  function deny(error: unknown) {
    if (error instanceof EnquiryPreviewError && [401, 403, 404].includes(error.status)) {
      readGuard.current.invalidate();
      sequence.current++;
      readRef.current?.abort();
      queueRef.current?.abort();
      directoryRef.current?.abort();
      setQueueBusy(false);
      setBusy(false);
      setSaved(null);
      setCurrent(null);
      setQueue(null);
      setDirectory(null);
      setNotice(
        'Private saved details have been hidden. Local input and any original command are retained in this tab.',
      );
    }
  }
  async function refreshQueue() {
    queueRef.current?.abort();
    const controller = new AbortController();
    queueRef.current = controller;
    const mayApply = readGuard.current.capture();
    setQueueBusy(true);
    setQueueError('');
    try {
      const value = await client.list(controller.signal);
      if (alive.current && !controller.signal.aborted && mayApply()) setQueue(value);
    } catch (e) {
      if (alive.current && !controller.signal.aborted) {
        setQueueError(errorText(e));
        deny(e);
      }
    } finally {
      if (alive.current && !controller.signal.aborted) setQueueBusy(false);
    }
  }
  async function refreshDirectory() {
    if (actor !== 'admin') return;
    directoryRef.current?.abort();
    const controller = new AbortController();
    directoryRef.current = controller;
    const mayApply = readGuard.current.capture();
    setDirectoryError('');
    try {
      const value = await client.assignees(controller.signal);
      if (alive.current && !controller.signal.aborted && mayApply()) setDirectory(value);
    } catch (e) {
      if (alive.current && !controller.signal.aborted) {
        setDirectoryError(errorText(e));
        deny(e);
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    void refreshQueue();
    void refreshDirectory();
    return () => {
      alive.current = false;
      readGuard.current.invalidate();
      sequence.current++;
      readRef.current?.abort();
      queueRef.current?.abort();
      directoryRef.current?.abort();
    };
    // The client is immutable for this server-provided preview instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || attemptRef.current || contactGuard.current || viewingGuard.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  async function selectEnquiry(id: string, discard = false) {
    if (
      lock.current ||
      contactGuard.current ||
      viewingGuard.current ||
      (attemptRef.current && !attemptRef.current.receipt)
    )
      return;
    if (id === selected) return;
    if (!discard && (dirty || attemptRef.current)) {
      setPendingSelection(id);
      return;
    }
    readRef.current?.abort();
    const controller = new AbortController();
    readRef.current = controller;
    const turn = ++sequence.current;
    const mayApply = readGuard.current.capture();
    setSelected(id);
    setSaved(null);
    setForm(null);
    setInitialForm(null);
    setCurrent(null);
    remember(null);
    setPendingSelection(null);
    setError('');
    setBusy(true);
    try {
      const value = await client.detail(id, controller.signal);
      if (!alive.current || turn !== sequence.current || !mayApply()) return;
      const raw = enquiryForm(value, actor);
      setSaved(value);
      setForm(raw);
      setInitialForm(raw);
      setNotice('Saved details loaded. Changes require a deliberate save.');
      requestAnimationFrame(() => detailHeading.current?.focus());
    } catch (e) {
      if (alive.current && turn === sequence.current && !controller.signal.aborted) {
        setError(errorText(e));
        deny(e);
      }
    } finally {
      if (alive.current && turn === sequence.current) setBusy(false);
    }
  }
  async function checkCurrent() {
    if (lock.current || !selected) return;
    lock.current = true;
    setBusy(true);
    setError('');
    readRef.current?.abort();
    const controller = new AbortController();
    readRef.current = controller;
    const turn = ++sequence.current;
    const mayApply = readGuard.current.capture();
    try {
      const value = await client.detail(selected, controller.signal);
      if (!alive.current || turn !== sequence.current || !mayApply()) return;
      setCurrent(value);
      setNotice(
        'Current saved details are ready to compare. Your working version and raw input have not changed.',
      );
      requestAnimationFrame(() => comparisonHeading.current?.focus());
    } catch (e) {
      if (alive.current && !controller.signal.aborted) {
        setError(errorText(e));
        deny(e);
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function save() {
    if (lock.current || attemptRef.current || !saved || !form) return;
    let command: EnquiryOperationInputV2;
    try {
      command = createEnquiryCommand(saved, form, crypto.randomUUID(), actor);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Check the action, staff ID, follow-up date and reason.',
      );
      return;
    }
    const original = Object.freeze({ id: saved.id, command, receipt: null });
    remember(original);
    lock.current = true;
    setBusy(true);
    setError('');
    setCurrent(null);
    setNotice('Saving this original command once. Keep this tab open.');
    try {
      const receipt = await client.apply(original.id, command);
      if (!alive.current) return;
      remember(Object.freeze({ ...original, receipt }));
      setNotice(
        receipt.outcome === 'applied'
          ? 'The original command was saved. Check current details before another change.'
          : 'The original result is available. Check current details before another change.',
      );
    } catch (e) {
      if (!alive.current) return;
      setError(errorText(e));
      deny(e);
      if (e instanceof EnquiryPreviewError && !e.uncertain) {
        remember(null);
        setNotice(
          'This request was refused or was not dispatched. Raw input is retained. Check current details before trying a new change.',
        );
      } else
        setNotice(
          'The save result is uncertain. The original command is retained; recover it before another save.',
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function recover() {
    const original = attemptRef.current;
    if (lock.current || !original || original.receipt) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const receipt = await client.recover(original.id, original.command);
      if (!alive.current) return;
      remember(Object.freeze({ ...original, receipt }));
      setNotice('The original result was recovered by reading its receipt. No command was resent.');
    } catch (e) {
      if (alive.current) {
        setError(errorText(e));
        deny(e);
        setNotice(
          'Recovery did not establish the original result. Keep this original command; no new save is enabled.',
        );
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function adopt() {
    if (!current || lock.current || (attemptRef.current && !attemptRef.current.receipt)) return;
    if (!form) {
      const raw = enquiryForm(current, actor);
      setForm(raw);
      setInitialForm(raw);
    }
    setSaved(current);
    setCurrent(null);
    remember(null);
    setError('');
    setNotice(
      'Current saved version adopted explicitly. Your raw action, date and reason remain for review before saving.',
    );
  }
  const actions = saved ? allowedEnquiryActions(saved, actor) : [];
  const shown =
    queue?.items.filter(
      (item) =>
        filter === 'all' ||
        (filter === 'unassigned' ? !item.assignedAgentId : item.assignedAgentId === actorId),
    ) ?? [];
  const reasonNeeded = form && ['close_lost', 'spam', 'reopen'].includes(form.action);
  const timeNeeded = form && ['contact', 'qualify', 'reschedule'].includes(form.action);
  return (
    <div
      className="enq-app"
      onClickCapture={(e) => {
        if (
          (contactGuard.current || viewingGuard.current) &&
          e.target instanceof Element &&
          e.target.closest('a[href]')
        ) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <section className="enq-intro" aria-labelledby="inbox-title">
        <div>
          <span className="eyebrow">
            DAILY OPERATIONS / {actor === 'admin' ? 'ADMIN' : 'AGENT'}
          </span>
          <h1 id="inbox-title">
            Every enquiry.
            <br />
            <em>A clear next step.</em>
          </h1>
          <p>Assign an owner, record contact and keep the next follow-up visible.</p>
          <a href={`/enquiries/${actor}/new`}>Record a staff enquiry →</a>
        </div>
        <div className="enq-role">
          <span className="enq-role-dot" />
          Synthetic {actor} workspace<small>Staff ID {actorId}</small>
          <p>
            Local role simulation · expires with the preview.
            <br />
            No messages or reminders are sent.
          </p>
        </div>
      </section>
      <div className="enq-banner">
        <strong>Development preview</strong>
        <span>
          Fictional enquiries in a disposable database. Saving contact records work already done; it
          does not contact a prospect or confirm a viewing.
        </span>
      </div>
      <nav className="enq-nav" aria-label="Preview workspaces">
        <a
          href="/"
          onClick={(e) => {
            if (dirty || attemptRef.current || contactGuard.current || viewingGuard.current)
              e.preventDefault();
          }}
        >
          Workspace overview
        </a>
        {dirty || attempt || contactWork || viewingWork ? (
          <span>Finish or explicitly discard this work before switching roles.</span>
        ) : (
          <a href={`/enquiries/${actor === 'admin' ? 'agent' : 'admin'}`}>
            Open synthetic {actor === 'admin' ? 'agent' : 'admin'} workspace ↗
          </a>
        )}
      </nav>
      <div className="enq-layout">
        <section className="enq-queue" aria-labelledby="queue-title">
          <div className="enq-section-heading">
            <div>
              <span className="eyebrow">VISIBLE TO THIS ROLE</span>
              <h2 id="queue-title">Enquiry inbox</h2>
            </div>
            <button
              type="button"
              className="enq-secondary"
              onClick={() => void refreshQueue()}
              disabled={queueBusy || busy}
            >
              Refresh
            </button>
          </div>
          <p className="enq-subtle">
            {queue
              ? `${queue.items.length} loaded${queue.truncated ? ' · more available' : ' · end of visible slice'}`
              : queueBusy
                ? 'Loading visible enquiries…'
                : 'Queue unavailable'}
            . This is a bounded queue, not a company total.
          </p>
          <label className="enq-filter">
            Show within loaded enquiries
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All loaded</option>
              <option value="unassigned">Unassigned</option>
              <option value="mine">Assigned to this staff ID</option>
            </select>
          </label>
          {queueError && (
            <p className="enq-error" role="alert">
              {queueError}
            </p>
          )}
          {pendingSelection && (
            <div className="enq-warning">
              <p>
                Discard the current raw input and completed result before opening another enquiry?
              </p>
              <button className="enq-secondary" onClick={() => setPendingSelection(null)}>
                Keep working
              </button>
              <button
                className="enq-secondary"
                onClick={() => void selectEnquiry(pendingSelection, true)}
              >
                Discard and open enquiry
              </button>
            </div>
          )}
          <div className="enq-items" aria-busy={queueBusy}>
            {shown.map((item) => (
              <button
                type="button"
                className={`enq-item ${selected === item.id ? 'enq-selected' : ''}`}
                aria-pressed={selected === item.id}
                key={item.id}
                onClick={() => void selectEnquiry(item.id)}
                disabled={busy || unresolved}
              >
                <span className="enq-item-top">
                  <strong>{item.name}</strong>
                  <span className={`enq-status enq-status-${item.status}`}>
                    {enquiryStatusLabel(item.status)}
                  </span>
                </span>
                <span>
                  {item.listingId
                    ? `Property ${shortId(item.listingId)} · revision ${item.contactedRevision}`
                    : 'General enquiry'}{' '}
                  · {item.origin}
                </span>
                <span className="enq-item-bottom">
                  <span>Owner {shortId(item.assignedAgentId)}</span>
                  <span>{enquiryDueLabel(item.nextActionAt)}</span>
                </span>
                <span className="enq-item-time">{formatEnquiryTime(item.nextActionAt)}</span>
              </button>
            ))}
          </div>
          {queue && !shown.length && (
            <div className="enq-empty">
              <h3>No enquiries in this view</h3>
              <p>Try another loaded-queue filter or refresh. No customer activity is invented.</p>
            </div>
          )}
        </section>
        <section className="enq-detail" aria-label="Selected enquiry">
          <p className="enq-notice" role="status">
            {notice}
          </p>
          {error && (
            <p id="enquiry-error" className="enq-error" role="alert">
              {error}
            </p>
          )}
          {!selected && (
            <div className="enq-welcome">
              <span aria-hidden="true">↗</span>
              <h2>Start with one conversation</h2>
              <p>
                Choose a prospect from the inbox. Their details and next action will appear here.
              </p>
              <div>
                01 Assign an owner
                <br />
                02 Record contact
                <br />
                03 Set the next follow-up
              </div>
            </div>
          )}
          {selected && !saved && (
            <div className="enq-empty">
              <h2>Saved details {busy ? 'loading' : 'unavailable'}</h2>
              <p>
                Private details are shown only after an authorized read. Any retained local input is
                below.
              </p>
              <button className="enq-secondary" disabled={busy} onClick={() => void checkCurrent()}>
                Check current enquiry
              </button>
            </div>
          )}
          {saved && (
            <>
              <header className="enq-detail-heading">
                <div>
                  <span className="eyebrow">
                    {saved.origin.toUpperCase()} ENQUIRY / SAVED VERSION {saved.version}
                  </span>
                  <h2 ref={detailHeading} tabIndex={-1}>
                    {saved.name}
                  </h2>
                  <p>
                    {saved.listingId
                      ? `Property ${saved.listingId} · original contacted revision ${saved.contactedRevision}`
                      : 'General enquiry · no property attached'}
                  </p>
                </div>
                <span className={`enq-status enq-status-${saved.status}`}>
                  {enquiryStatusLabel(saved.status)}
                </span>
              </header>
              <div className="enq-contact">
                <div>
                  <span>Email</span>
                  <strong>{saved.email ?? 'Not supplied'}</strong>
                </div>
                <div>
                  <span>Phone</span>
                  <strong>{saved.phone ?? 'Not supplied'}</strong>
                </div>
              </div>
              <div className="enq-message">
                <span className="eyebrow">PROSPECT MESSAGE</span>
                <p>{saved.message}</p>
              </div>
              <Snapshot value={saved} />
              {saved.closureReason && (
                <p className="enq-subtle">Saved reason: {saved.closureReason}</p>
              )}
              <p className="enq-subtle">
                Updated {formatEnquiryTime(saved.updatedAt)} · notice {saved.noticeVersion}
              </p>
            </>
          )}
          {form && (
            <form
              className="enq-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
              aria-describedby={error ? 'enquiry-error' : undefined}
            >
              <div className="enq-section-heading">
                <div>
                  <span className="eyebrow">WORKING INPUT / {dirty ? 'UNSAVED' : 'READY'}</span>
                  <h3>Record the next step</h3>
                </div>
                {saved && (
                  <button
                    className="enq-secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => void checkCurrent()}
                  >
                    Check current enquiry
                  </button>
                )}
              </div>
              <fieldset disabled={busy || !!attempt || !saved}>
                <legend className="sr-only">Enquiry operation</legend>
                <label>
                  Action
                  <select
                    value={form.action}
                    onChange={(e) =>
                      setForm({ ...form, action: e.target.value as EnquiryForm['action'] })
                    }
                  >
                    {!actions.includes(form.action) && (
                      <option value={form.action} disabled>
                        {enquiryActionLabel(form.action)} · review against current state
                      </option>
                    )}
                    {actions.map((action) => (
                      <option key={action} value={action}>
                        {enquiryActionLabel(action)}
                      </option>
                    ))}
                  </select>
                </label>
                {form.action === 'assign' && (
                  <label>
                    Assign to active staff
                    <select
                      value={form.assignedAgentId}
                      onChange={(e) => setForm({ ...form, assignedAgentId: e.target.value })}
                    >
                      <option value="">Choose a staff ID</option>
                      {directory?.items.map((staff) => (
                        <option value={staff.userId} key={staff.userId}>
                          {staff.role} · {staff.userId}
                        </option>
                      ))}
                    </select>
                    <small>IDs and roles are supplied by the private staff directory.</small>
                  </label>
                )}
                {directoryError && form.action === 'assign' && (
                  <p className="enq-error">{directoryError}</p>
                )}
                {form.action === 'assign' && (
                  <button
                    type="button"
                    className="enq-secondary"
                    onClick={() => void refreshDirectory()}
                  >
                    Reload staff directory
                  </button>
                )}
                {directory?.truncated && form.action === 'assign' && (
                  <p className="enq-warning">
                    Only {directory.limit} staff were loaded. Do not assume this is the full
                    directory.
                  </p>
                )}
                {timeNeeded && (
                  <label>
                    Next follow-up · Nairobi (EAT, UTC+03:00)
                    <input
                      type="datetime-local"
                      step="0.001"
                      value={form.nextActionLocal}
                      onInput={(e) => setForm({ ...form, nextActionLocal: e.currentTarget.value })}
                      onChange={(e) => setForm({ ...form, nextActionLocal: e.target.value })}
                    />
                    <small>
                      Past dates are allowed and remain visibly overdue. Seconds and milliseconds
                      are retained.
                    </small>
                  </label>
                )}
                {reasonNeeded && (
                  <label>
                    {form.action === 'reopen' ? 'Reason for reopening' : 'Closure reason'}
                    <textarea
                      value={form.reason}
                      rows={3}
                      maxLength={1000}
                      onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    />
                    <small>Required · up to 1,000 characters. No message is sent.</small>
                  </label>
                )}
                <button
                  className="enq-primary"
                  type="submit"
                  disabled={
                    !actions.includes(form.action) || (form.action === 'assign' && !directory)
                  }
                >
                  {enquiryActionLabel(form.action)}
                </button>
              </fieldset>
              <p className="enq-subtle">
                A save uses working version {saved?.version ?? 'unavailable'}. Changing a queue
                filter or checking current details does not update this version.
              </p>
            </form>
          )}
          {attempt && (
            <section className="enq-recovery" aria-labelledby="original-title">
              <span className="eyebrow">
                ORIGINAL COMMAND / {attempt.receipt ? 'RESULT KNOWN' : 'RESULT UNCERTAIN'}
              </span>
              <h3 id="original-title">
                {attempt.receipt
                  ? `${attempt.receipt.outcome === 'applied' ? 'Saved' : attempt.receipt.outcome === 'noop' ? 'No change' : attempt.receipt.outcome === 'conflict' ? 'Version conflict' : 'Change refused'} · original result`
                  : 'Recover this save before continuing'}
              </h3>
              <p>
                Operation {attempt.command.operationId} · expected version{' '}
                {attempt.command.expectedVersion}
              </p>
              {attempt.receipt ? (
                <>
                  <dl className="enq-facts">
                    <div>
                      <dt>Historical result version</dt>
                      <dd>{attempt.receipt.result.version}</dd>
                    </div>
                    <div>
                      <dt>Result status</dt>
                      <dd>{enquiryStatusLabel(attempt.receipt.result.status)}</dd>
                    </div>
                    <div>
                      <dt>Result follow-up · UTC</dt>
                      <dd>{attempt.receipt.result.nextActionAt ?? 'Not scheduled'}</dd>
                    </div>
                    <div>
                      <dt>Result owner ID</dt>
                      <dd>{attempt.receipt.result.assignedAgentId ?? 'Unassigned'}</dd>
                    </div>
                  </dl>
                  {attempt.receipt.reason && <p>{attempt.receipt.reason}</p>}
                  <p>
                    This receipt is historical. It does not replace your working version. Check
                    current details, then explicitly adopt them before a new change.
                  </p>
                  <button
                    className="enq-secondary"
                    disabled={busy}
                    onClick={() => void checkCurrent()}
                  >
                    Check current enquiry
                  </button>
                </>
              ) : (
                <>
                  <p>
                    No automatic retry is made. A missing recovery response does not establish
                    whether the original save committed. Do not refresh or switch roles while this
                    is unresolved.
                  </p>
                  <button className="enq-primary" disabled={busy} onClick={() => void recover()}>
                    Recover original result
                  </button>
                </>
              )}
              <details>
                <summary>Original command kept in this tab</summary>
                <pre>{JSON.stringify(attempt.command, null, 2)}</pre>
              </details>
            </section>
          )}
          {current && (
            <section className="enq-comparison" aria-labelledby="comparison-title">
              <span className="eyebrow">READ-ONLY CURRENT COMPARISON</span>
              <h3 id="comparison-title" ref={comparisonHeading} tabIndex={-1}>
                Current saved version {current.version}
              </h3>
              <Snapshot value={current} />
              <p>
                Your raw action, date, staff selection and reason will be retained. Review them
                against the new saved state before submitting.
              </p>
              <button className="enq-primary" disabled={busy || unresolved} onClick={adopt}>
                Use this current version
              </button>
              {unresolved && <p>Recover the original result before adopting another version.</p>}
            </section>
          )}
          {selected && (
            <EnquiryContacts
              key={`contact:${actor}:${instanceId}:${selected}`}
              actor={actor}
              instanceId={instanceId}
              enquiryId={selected}
              version={saved?.version ?? null}
              onGuard={guardContact}
              onAccessDenied={deny}
              readGuard={readGuard.current}
            />
          )}
          {selected && (
            <EnquiryViewings
              reminderCaptureEnabled={reminderCaptureEnabled}
              key={`viewing:${actor}:${instanceId}:${selected}`}
              actor={actor}
              instanceId={instanceId}
              enquiryId={selected}
              version={saved?.version ?? null}
              listingId={saved?.listingId ?? null}
              onGuard={guardViewing}
              onAccessDenied={deny}
              readGuard={readGuard.current}
            />
          )}
          {selected && saved && (
            <EnquiryActivity
              key={`${actor}:${instanceId}:${selected}`}
              actor={actor}
              instanceId={instanceId}
              enquiryId={selected}
              readGuard={readGuard.current}
              onAccessDenied={deny}
            />
          )}
        </section>
      </div>
      <footer className="enq-footer">
        Independently rebuilt · Synthetic development data · Follow-up times shown in Nairobi
      </footer>
    </div>
  );
}
