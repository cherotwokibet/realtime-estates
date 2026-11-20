'use client';
import { authChange, authChangeEffect } from '@realtor/browser-auth/events';
import { useEffect, useRef, useState } from 'react';
import {
  parseStaffInvitationJson,
  validateStaffBranchCommand,
  validateStaffBranchRecord,
  validateStaffBranchPage,
  type StaffBranchCurrent,
  type StaffBranchRecord,
  type StaffBranchCommand,
} from '@realtor/domain';
import { readReferenceJson } from '../lib/reference-draft-wire.ts';
import { validateHostedStaffSession, type HostedStaffSession } from '../lib/hosted-staff-wire.ts';
export default function HostedStaffWorkspace({ tenantId }: { tenantId: string }) {
  const active = useRef<AbortController | null>(null),
    version = useRef(0),
    working = useRef(true),
    blocked = useRef(false),
    channel = useRef<BroadcastChannel | null>(null);
  const [session, setSession] = useState<HostedStaffSession | null>(null),
    [rows, setRows] = useState<readonly StaffBranchCurrent[]>([]),
    [next, setNext] = useState<string | null>(null),
    [busy, setBusy] = useState(true),
    [message, setMessage] = useState(''),
    [receipt, setReceipt] = useState<StaffBranchRecord | null>(null),
    [missing, setMissing] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const [selected, setSelected] = useState<StaffBranchCurrent | null>(null),
    [name, setName] = useState(''),
    [enabled, setEnabled] = useState(true),
    [reason, setReason] = useState('');
  function clear() {
    setSession(null);
    setRows([]);
    setNext(null);
    setReceipt(null);
    setMissing(false);
    setSelected(null);
    setName('');
    setReason('');
    setEnabled(true);
  }
  function begin() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const ticket = ++version.current;
    working.current = true;
    setBusy(true);
    return { signal: controller.signal, ticket };
  }
  const live = (ticket: number) => version.current === ticket && !active.current?.signal.aborted;
  async function call(
    path: string,
    signal: AbortSignal,
    body?: unknown,
    csrf?: string,
  ): Promise<any> {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
    const response = await fetch('/api/hosted-staff/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: combined,
      headers:
        body === undefined
          ? {}
          : {
              'Content-Type': 'application/json',
              'X-Staff-Intent': 'hosted-staff-v1',
              ...(csrf ? { 'X-Staff-CSRF': csrf } : {}),
            },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.headers.get('cache-control') !== 'no-store')
      throw Error('Uncacheable staff reply required.');
    const data = await readReferenceJson(response, 65536, combined, parseStaffInvitationJson);
    if (!response.ok) throw { status: response.status };
    return data;
  }
  function lock(message: string) {
    blocked.current = true;
    version.current++;
    active.current?.abort();
    working.current = false;
    clear();
    setBusy(false);
    setUncertain(true);
    setMessage(message);
  }
  async function refresh() {
    blocked.current = false;
    const { signal, ticket } = begin();
    clear();
    setMessage('');
    setUncertain(true);
    try {
      const s = validateHostedStaffSession(await call('session', signal), tenantId);
      const r = await call('branches?limit=10', signal);
      if (Object.keys(r).join(',') !== 'page') throw Error();
      const p = validateStaffBranchPage(r.page, { limit: 10, after: null });
      if (live(ticket)) {
        setSession(s);
        setRows(p.items);
        setNext(p.nextAfter);
        setUncertain(false);
      }
    } catch {
      if (live(ticket))
        setMessage(
          'Branch administration could not be loaded. Sign in with current company admin access, then refresh.',
        );
    } finally {
      if (live(ticket)) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('realtor-hosted-auth-v1');
      channel.current.onmessage = (e) => {
        const effect = authChangeEffect(e.data);
        if (effect === 'ignore') return;
        lock('Sign-in changed in another tab. Refresh to verify access.');
        if (effect === 'recheck') void refresh();
      };
    }
    const focus = () => {
        if (!working.current && !blocked.current) void refresh();
      },
      show = (e: PageTransitionEvent) => {
        if (e.persisted && !blocked.current) void refresh();
      };
    const visibility = () => {
      if (document.visibilityState === 'hidden') {
        version.current++;
        active.current?.abort();
        working.current = false;
        setBusy(false);
        clear();
        setUncertain(true);
      } else if (!working.current && !blocked.current) void refresh();
    };
    window.addEventListener('focus', focus);
    window.addEventListener('pageshow', show);
    document.addEventListener('visibilitychange', visibility);
    void refresh();
    return () => {
      version.current++;
      active.current?.abort();
      channel.current?.close();
      window.removeEventListener('focus', focus);
      window.removeEventListener('pageshow', show);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [tenantId]);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      () => {
        lock('Your session expired. Refresh to verify access.');
      },
      Math.max(0, Date.parse(session.account.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session?.account.generation]);
  async function action(
    kind: 'command' | 'original' | 'retry' | 'settle',
    fresh?: StaffBranchCommand,
  ) {
    if (working.current || !session || uncertain) return;
    const command = fresh ?? session.pending;
    if (!command) return;
    const { signal, ticket } = begin();
    setMessage('');
    try {
      const result = await call(
        kind,
        signal,
        kind === 'original'
          ? undefined
          : kind === 'command'
            ? command
            : { operationId: command.operationId },
        session.csrf,
      );
      if (!live(ticket)) return;
      if (kind === 'settle') {
        if (JSON.stringify(result) !== '{"settled":true}') throw Error();
        await refresh();
        return;
      }
      if (Object.keys(result).join(',') !== 'receipt') throw Error();
      const checked = validateStaffBranchRecord(result.receipt, command, session.account.actorId);
      setSession({ ...session, pending: command });
      setReceipt(checked);
      setMissing(false);
      setSelected(null);
      setName('');
      setReason('');
    } catch (e) {
      if (!live(ticket)) return;
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403) {
        lock('Staff access ended. Sign in again.');
      } else if (kind === 'original' && status === 404) {
        setMissing(true);
        setMessage(
          'No original is recorded yet. You may deliberately retry the same retained change.',
        );
      } else {
        setUncertain(true);
        setReceipt(null);
        setSelected(null);
        setName('');
        setReason('');
        setMessage(
          'The outcome is not confirmed. Refresh to load the retained action before continuing.',
        );
      }
    } finally {
      if (live(ticket)) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  async function more() {
    if (!session || !next || working.current) return;
    const after = next,
      { signal, ticket } = begin();
    try {
      const r = await call('branches?limit=10&after=' + after, signal);
      if (Object.keys(r).join(',') !== 'page') throw Error();
      const p = validateStaffBranchPage(r.page, { limit: 10, after });
      if (live(ticket)) {
        setRows([...rows, ...p.items]);
        setNext(p.nextAfter);
      }
    } catch {
      if (live(ticket)) {
        clear();
        setUncertain(true);
        setMessage('Branches could not be loaded. Refresh and verify access.');
      }
    } finally {
      if (live(ticket)) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  async function logout() {
    if (working.current || !session) return;
    blocked.current = true;
    const csrf = session.csrf,
      { signal, ticket } = begin();
    clear();
    setUncertain(true);
    channel.current?.postMessage(authChange('signing-out'));
    try {
      const r = await call('sign-out', signal, {}, csrf);
      if (JSON.stringify(r) !== '{"signedOut":true}') throw Error();
      if (live(ticket)) setMessage('Signed out.');
      if (live(ticket)) channel.current?.postMessage(authChange('signed-out'));
    } catch {
      if (live(ticket))
        setMessage('Sign-out could not be confirmed. Private details have been cleared.');
    } finally {
      if (live(ticket)) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className="hosted-staff" aria-busy={busy}>
      <h1>Branch administration</h1>
      <p>
        Current company admin access is required. <a href="/sign-in">Manage sign-in</a>
      </p>
      {message && <p role="alert">{message}</p>}
      {busy && <p role="status">Checking staff access…</p>}
      <button disabled={busy} onClick={() => void refresh()}>
        Refresh branches and retained action
      </button>
      {session && (
        <>
          <button disabled={busy} onClick={() => void logout()}>
            Sign out
          </button>
          {session.pending && (
            <aside>
              <h2>{receipt ? 'Branch change confirmed' : 'A branch change needs recovery'}</h2>
              {receipt ? (
                <>
                  <p>
                    {receipt.outcome === 'conflict'
                      ? 'The branch changed. Finish this result and refresh before another edit.'
                      : receipt.outcome === 'unchanged'
                        ? 'This branch already matches your change.'
                        : 'Your branch change was saved.'}
                  </p>
                  <button disabled={busy || uncertain} onClick={() => void action('settle')}>
                    Finish this result
                  </button>
                </>
              ) : (
                <>
                  <p>The original action is retained on the server.</p>
                  <button disabled={busy || uncertain} onClick={() => void action('original')}>
                    Recover original change
                  </button>
                  {missing && (
                    <button disabled={busy || uncertain} onClick={() => void action('retry')}>
                      Retry the same change
                    </button>
                  )}
                </>
              )}
            </aside>
          )}
          <h2>Company branches</h2>
          <ul>
            {rows.map((row) => (
              <li key={row.branchId}>
                {row.name} — {row.active ? 'Active' : 'Inactive'}{' '}
                <button
                  disabled={busy || uncertain || !!session.pending}
                  onClick={() => {
                    setSelected(row);
                    setName(row.name);
                    setEnabled(row.active);
                    setReason('');
                  }}
                >
                  Edit branch
                </button>
              </li>
            ))}
          </ul>
          {next && (
            <button disabled={busy} onClick={() => void more()}>
              Load more branches
            </button>
          )}
          {!session.pending && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  const c = validateStaffBranchCommand({
                    policy: 'staff-branch-command-v1',
                    operationId: crypto.randomUUID(),
                    branchId: selected?.branchId ?? crypto.randomUUID(),
                    expectedVersion: selected?.version ?? '0',
                    name,
                    active: enabled,
                    reason,
                  });
                  void action('command', c);
                } catch {
                  setMessage('Supply a valid branch name and a reason for this change.');
                }
              }}
            >
              <h2>{selected ? 'Edit branch' : 'Create a branch'}</h2>
              <label htmlFor="hosted-branch-name">Branch name</label>
              <input
                id="hosted-branch-name"
                required
                maxLength={160}
                value={name}
                disabled={busy || uncertain}
                onChange={(e) => setName(e.target.value)}
              />
              <label>
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={busy || uncertain}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                Branch is active
              </label>
              <label htmlFor="hosted-branch-reason">Reason for this change</label>
              <textarea
                id="hosted-branch-reason"
                required
                maxLength={500}
                disabled={busy || uncertain}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <button type="submit" disabled={busy || uncertain}>
                Save branch change
              </button>
              {selected && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setSelected(null);
                    setName('');
                    setReason('');
                    setEnabled(true);
                  }}
                >
                  Create another branch instead
                </button>
              )}
            </form>
          )}
        </>
      )}
    </section>
  );
}
