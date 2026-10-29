'use client';
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  brandThemeCss,
  validateCompanySettingsCommand,
  validateCompanySettingsContent,
  validateCompanySettingsRecord,
  validateCompanySettingsState,
  type CompanySettingsContent,
  type CompanySettingsState,
  type CompanySettingsCommand,
} from '@realtor/domain';
const initial: CompanySettingsContent = {
  companyName: 'Synthetic agency',
  summary: 'Independent company content preview.',
  about: 'Replace this fictional copy with approved company content.',
  officeAddress: null,
  openingHours: null,
  colors: { primary: '#5e0202', secondary: '#194d3e', accent: '#b77b27', background: '#ffffff' },
};
export default function CompanySettingsWorkspace({
  initialState,
  instanceId,
}: {
  initialState: CompanySettingsState;
  instanceId: string;
}) {
  const [state, setState] = useState(initialState),
    [form, setForm] = useState<CompanySettingsContent>(initialState.current ?? initial),
    [approved, setApproved] = useState(false),
    [pending, setPending] = useState<CompanySettingsCommand | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [denied, setDenied] = useState(false),
    [needsAdoption, setNeedsAdoption] = useState(false),
    [comparison, setComparison] = useState<CompanySettingsState | null>(null);
  const abort = useRef<AbortController | null>(null);
  const preview = useMemo(() => {
    try {
      return validateCompanySettingsContent(form);
    } catch {
      return null;
    }
  }, [form]);
  const valid = preview !== null;
  const unchanged = JSON.stringify(preview) === JSON.stringify(state.current);
  function field(key: keyof Omit<CompanySettingsContent, 'colors'>, value: string) {
    setForm((v) => ({
      ...v,
      [key]: ['officeAddress', 'openingHours'].includes(key) && value === '' ? null : value,
    }));
    setApproved(false);
    setComparison(null);
  }
  async function request(op: string | null, command?: CompanySettingsCommand) {
    const controller = new AbortController();
    abort.current = controller;
    const response = await fetch('/api/company-settings' + (op ? '/operations/' + op : ''), {
      method: command ? 'POST' : 'GET',
      headers: {
        'x-preview-instance': instanceId,
        ...(command ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(command ? { body: JSON.stringify(command) } : {}),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      setDenied(true);
      setForm(initial);
      setState({
        policy: 'company-settings-state-v1',
        version: '0',
        current: null,
        history: [],
        hasMore: false,
      });
      setComparison(null);
      throw Error(
        'Access ended. Private content was cleared; sign in through a fresh authorized session.',
      );
    }
    if (!response.ok)
      throw Object.assign(
        Error(
          response.status === 409
            ? 'The saved version or original request conflicts. Compare the current saved content before continuing.'
            : response.status === 404
              ? 'Original result is unavailable. This does not prove rollback; retain the original request.'
              : 'The result is unavailable. Retain the original request and inspect it before making another change.',
        ),
        { definitiveRefusal: !!command && [400, 409, 422].includes(response.status) },
      );
    return response.json();
  }
  async function save() {
    if (busy || pending || !preview || !approved || unchanged || denied || needsAdoption) return;
    const command = validateCompanySettingsCommand({
      policy: 'company-settings-command-v1',
      operationId: crypto.randomUUID(),
      expectedVersion: state.version,
      content: preview,
      approval: 'approved-for-publication',
    });
    setPending(command);
    await original(command, true);
  }
  async function original(command: CompanySettingsCommand, send = false) {
    setBusy(true);
    setMessage('Inspecting the original settings operation…');
    try {
      const receipt = validateCompanySettingsRecord(
        await request(command.operationId, send ? command : undefined),
      );
      if (JSON.stringify(receipt.request) !== JSON.stringify(command))
        throw Error('Original result does not match the retained request.');
      setApproved(false);
      setMessage(
        'Approved content saved at version ' +
          receipt.version +
          '. Current settings must be refreshed before another change.',
      );
      const current = validateCompanySettingsState(await request(null));
      setState(current);
      setForm(current.current ?? initial);
      setComparison(null);
      setPending(null);
      setMessage(
        'Approved content saved at version ' +
          receipt.version +
          '. Current saved version ' +
          current.version +
          ' loaded.',
      );
    } catch (e) {
      if (e && typeof e === 'object' && 'definitiveRefusal' in e && e.definitiveRefusal === true) {
        setPending(null);
        setNeedsAdoption(true);
        setApproved(false);
      }
      setMessage(e instanceof Error ? e.message : 'Original result remains uncertain.');
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }
  async function compare() {
    setBusy(true);
    try {
      const current = validateCompanySettingsState(await request(null));
      setComparison(current);
      setMessage('Current saved content loaded for comparison. Your unsaved fields are retained.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Saved content unavailable.');
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }
  if (denied)
    return (
      <section role="alert">
        <h2>Current admin access required</h2>
        <p>{message}</p>
        <p>
          Reload after renewing your authorized session. Any unresolved original operation remains
          blocked.
        </p>
      </section>
    );
  return (
    <div className="settings-grid">
      <section>
        <h2>Approved company content</h2>
        <p>
          Saved version {state.version}. Content is public after approval. Contacts, identities,
          domains and optional modules are controlled separately.
        </p>
        <p role="status" aria-live="polite">
          {message}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy || pending !== null}>
            <legend>Public copy and brand palette</legend>
            {(['companyName', 'summary', 'about', 'officeAddress', 'openingHours'] as const).map(
              (key) => (
                <label key={key}>
                  {
                    (
                      {
                        companyName: 'Company name',
                        summary: 'Short summary',
                        about: 'About the company',
                        officeAddress: 'Public office address (optional)',
                        openingHours: 'Opening hours (optional)',
                      } as const
                    )[key]
                  }
                  {key === 'about' ? (
                    <textarea
                      value={form[key] ?? ''}
                      onChange={(e) => field(key, e.target.value)}
                      rows={6}
                      maxLength={4000}
                    />
                  ) : (
                    <input
                      value={form[key] ?? ''}
                      onChange={(e) => field(key, e.target.value)}
                      maxLength={key === 'companyName' ? 160 : 320}
                    />
                  )}
                </label>
              ),
            )}
            {(['primary', 'secondary', 'accent', 'background'] as const).map((key) => (
              <label key={key}>
                {key[0]!.toUpperCase() + key.slice(1)} colour
                <input
                  value={form.colors[key]}
                  pattern="#[0-9a-fA-F]{6}"
                  maxLength={7}
                  onChange={(e) => {
                    setForm((v) => ({ ...v, colors: { ...v.colors, [key]: e.target.value } }));
                    setApproved(false);
                  }}
                />
              </label>
            ))}
            {!valid && (
              <p role="alert">
                Use non-empty plain text, supported lengths and six-digit hex colours. Remove
                markup, control characters and leading/trailing spaces. Optional fields may be
                empty.
              </p>
            )}
            <label className="settings-check">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />
              I have reviewed the preview and approve this copy and palette for publication. This
              records my approval; it does not prove external asset rights.
            </label>
            <button disabled={!valid || !approved || unchanged || needsAdoption} type="submit">
              Approve and save content
            </button>
          </fieldset>
        </form>
        <button type="button" disabled={busy} onClick={() => void compare()}>
          Compare current saved content
        </button>
        {busy && (
          <button type="button" onClick={() => abort.current?.abort()}>
            Stop waiting
          </button>
        )}
        {pending && (
          <section aria-label="Original operation recovery">
            <h3>Keep the original request</h3>
            <p>
              Operation {pending.operationId}. No automatic retry or replacement request. Stay on
              this page until reconciled; closing it loses this in-memory recovery context.
            </p>
            <button disabled={busy} onClick={() => void original(pending)}>
              Inspect original result
            </button>
            <button disabled={busy} onClick={() => void original(pending, true)}>
              Explicitly resend the same original request
            </button>
          </section>
        )}
        {comparison && (
          <section aria-label="Saved comparison">
            <h3>Current saved version {comparison.version}</h3>
            <p>{comparison.current?.companyName ?? 'No saved content'}</p>
            <p>{comparison.current?.summary}</p>
            <p>{comparison.current?.about}</p>
            <p>{comparison.current?.officeAddress}</p>
            <p>{comparison.current?.openingHours}</p>
            <p>
              Palette:
              {comparison.current
                ? Object.values(comparison.current.colors).join(', ')
                : 'not configured'}
            </p>
            <button
              disabled={busy || pending !== null}
              onClick={() => {
                setState(comparison);
                setForm(comparison.current ?? initial);
                setApproved(false);
                setComparison(null);
                setNeedsAdoption(false);
                setMessage('Saved content explicitly adopted.');
              }}
            >
              Adopt saved content
            </button>
            {needsAdoption && (
              <button
                disabled={busy || pending !== null}
                onClick={() => {
                  setState(comparison);
                  setComparison(null);
                  setApproved(false);
                  setNeedsAdoption(false);
                  setMessage(
                    'Your fields retained against the freshly inspected version. Review and approve again before a new request.',
                  );
                }}
              >
                Keep my fields against this saved version
              </button>
            )}
          </section>
        )}
      </section>
      <aside>
        <section
          aria-label="Branding preview"
          className="settings-preview"
          style={preview ? (brandThemeCss(preview.colors) as CSSProperties) : undefined}
        >
          <p>UNSAVED BRAND PREVIEW</p>
          <h2>{preview?.companyName ?? 'Preview unavailable'}</h2>
          {preview && (
            <>
              <h3>{preview.summary}</h3>
              <p>{preview.about}</p>
              <p>{preview.officeAddress ?? 'Office address not configured'}</p>
              <p>{preview.openingHours ?? 'Opening hours not configured'}</p>
              <button type="button" disabled>
                Example action · preview only
              </button>
              <p>
                No payment, advertising, export or account-administration modules are enabled by
                this editor.
              </p>
            </>
          )}
        </section>
        <section>
          <h2>Approval history</h2>
          <p>
            Latest20 records. Earlier approvals remain in the audit store; this page is not a full
            export.
          </p>
          <ol>
            {state.history.map((r) => (
              <li key={r.version}>
                <strong>
                  Version {r.version} · {r.request.content.companyName}
                </strong>
                <p>
                  <time>{r.recordedAt}</time> · Approved by {r.actorId}
                </p>
              </li>
            ))}
          </ol>
          {state.hasMore && <p>Earlier records exist.</p>}
        </section>
      </aside>
    </div>
  );
}
