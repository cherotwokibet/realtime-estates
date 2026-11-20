'use client';
import { authChange, authChangeEffect } from '@realtor/browser-auth/events';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  formatKes,
  kesFromMinor,
  type CustomerFavouriteCommand,
  type CustomerFavouriteReceipt,
  validateCustomerFavouriteReceipt,
  validateCustomerFavouritesPage,
  validateCustomerFavouriteState,
  parseCustomerFavouriteJson,
} from '@realtor/domain';
import { CustomerViewGate } from '../lib/customer-view';
import {
  validateBrowserSession,
  validateBrowserFavourites,
  readCustomerBrowserReply,
  type BrowserSession as Session,
  type FavouriteSummary as Summary,
} from '../lib/customer-browser';
type Row = { listingId: string; version: string; available: boolean };
export default function CustomerAccount({
  candidate,
  tenantId,
  mode = 'synthetic',
}: {
  tenantId: string;
  candidate: null | { id: string; title: string };
  mode?: 'synthetic' | 'hosted';
}) {
  const gate = useRef(new CustomerViewGate()),
    channel = useRef<BroadcastChannel | null>(null),
    authChannel = useRef<BroadcastChannel | null>(null);
  const validateSession = (value: unknown) =>
    validateBrowserSession(value, tenantId, Date.now(), mode);
  const [session, setSession] = useState<Session | null>(null),
    [rows, setRows] = useState<Row[]>([]),
    [summaries, setSummaries] = useState<Summary[]>([]),
    [hasMore, setHasMore] = useState(false),
    [candidateState, setCandidate] = useState<{ version: string; saved: boolean } | null>(null),
    [receipt, setReceipt] = useState<CustomerFavouriteReceipt | null>(null),
    [missing, setMissing] = useState(false),
    [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  const blocked = useRef(false);
  const clear = () => {
    gate.current.invalidate();
    setSession(null);
    setRows([]);
    setHasMore(false);
    setSummaries([]);
    setReceipt(null);
    setCandidate(null);
    setMissing(false);
  };
  async function api(
    path: string,
    signal: AbortSignal,
    body?: unknown,
    csrf?: string | null,
  ): Promise<any> {
    const controller = new AbortController(),
      abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) controller.abort();
    const timer = setTimeout(abort, 15000);
    try {
      const r = await fetch('/api/customer' + path, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers:
          body === undefined
            ? {}
            : {
                'Content-Type': 'application/json',
                'X-Customer-Intent': 'session-v1',
                ...(csrf ? { 'X-Customer-CSRF': csrf } : {}),
              },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const value = await readCustomerBrowserReply(r);
      if (!r.ok) throw { status: r.status, ...(value as object) };
      if (controller.signal.aborted) throw Error('Customer request cancelled.');
      return value;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
  async function read(signal: AbortSignal, ticket: number, existing?: Session) {
    const next = validateSession(existing ?? (await api('/session', signal)));
    if (!gate.current.current(ticket)) return;
    if (
      next.policy !==
        (mode === 'hosted'
          ? 'hosted-customer-browser-session-v1'
          : 'customer-browser-session-v1') ||
      !Array.isArray(next.choices)
    )
      throw Error();
    setSession(next);
    setMissing(false);
    setReceipt(null);
    if (next.account) {
      const [list, state] = await Promise.all([
        api('/favourites', signal),
        candidate ? api('/state?listing=' + candidate.id, signal) : Promise.resolve(null),
      ]);
      if (!gate.current.current(ticket)) return;
      const checked = validateBrowserFavourites(list, next.account);
      const page = checked.page;
      setRows([...page.items]);
      setSummaries([...checked.summaries]);
      setHasMore(page.hasMore);
      if (state) setCandidate(validateCustomerFavouriteState(state, next.account, candidate!.id));
    }
  }
  async function refresh() {
    if (blocked.current) {
      setBusy(false);
      return;
    }
    clear();
    setBusy(true);
    setError('');
    const t = gate.current.begin();
    try {
      await read(t.signal, t.version);
    } catch (e) {
      if (gate.current.current(t.version)) {
        if ([401, 403].includes((e as { status?: number }).status ?? 0)) {
          blocked.current = true;
          clear();
          setBusy(false);
          channel.current?.postMessage('signed-out');
          setError('Your account access ended. Refresh when you want to sign in again.');
        } else
          setError('Your account could not be loaded. Please sign in again or try refreshing.');
      }
    } finally {
      if (gate.current.current(t.version)) setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
    if (typeof BroadcastChannel !== 'undefined') {
      if (mode === 'hosted') {
        authChannel.current = new BroadcastChannel('realtor-hosted-auth-v1');
        authChannel.current.onmessage = (e) => {
          const effect = authChangeEffect(e.data);
          if (effect === 'ignore') return;
          const mayRecheck = effect === 'recheck' && !blocked.current;
          blocked.current = true;
          clear();
          setBusy(false);
          setError('Sign-in changed in another tab. Refresh to verify access.');
          if (mayRecheck) {
            blocked.current = false;
            void refresh();
          }
        };
      }
      const c = new BroadcastChannel('realtor-customer:' + window.location.origin);
      channel.current = c;
      c.onmessage = (e) => {
        if (e.data === 'signed-out') {
          blocked.current = true;
          clear();
          setBusy(false);
          setError('Signed out in another tab. Refresh when you want to sign in again.');
        } else if (e.data === 'changed' && (mode === 'synthetic' || !blocked.current)) {
          blocked.current = false;
          clear();
          void refresh();
        } else if (e.data === 'refresh' && !blocked.current) {
          clear();
          void refresh();
        }
      };
    }
    const check = () => {
      void refresh();
    };
    const show = (e: PageTransitionEvent) => {
      if (e.persisted) void refresh();
    };
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', show);
    return () => {
      gate.current.invalidate();
      channel.current?.close();
      authChannel.current?.close();
      authChannel.current = null;
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', show);
    };
  }, [tenantId, candidate?.id, mode]);
  useEffect(() => {
    if (!session?.account) return;
    const timer = setTimeout(
      () => {
        blocked.current = true;
        clear();
        setBusy(false);
        setError('Your session expired. Refresh to sign in again.');
      },
      Math.max(0, Date.parse(session.account.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session?.account?.generation]);
  async function login(userId: string) {
    if (mode !== 'synthetic') return;
    blocked.current = false;
    clear();
    setBusy(true);
    setError('');
    const t = gate.current.begin();
    try {
      const next = validateSession(await api('/sign-in', t.signal, { userId }));
      if (!gate.current.current(t.version)) return;
      channel.current?.postMessage('changed');
      await read(t.signal, t.version, next);
    } catch {
      if (gate.current.current(t.version))
        setError('This test account is unavailable. Refresh and try again.');
    } finally {
      if (gate.current.current(t.version)) setBusy(false);
    }
  }
  async function logout() {
    const csrf = session?.csrf;
    blocked.current = true;
    clear();
    setBusy(true);
    setError('');
    channel.current?.postMessage('signed-out');
    authChannel.current?.postMessage(authChange('signing-out'));
    const t = gate.current.begin();
    try {
      await api('/sign-out', t.signal, {}, csrf);
      channel.current?.postMessage('signed-out');
      if (gate.current.current(t.version))
        authChannel.current?.postMessage(authChange('signed-out'));
      if (mode === 'synthetic') await read(t.signal, t.version);
    } catch {
      if (gate.current.current(t.version))
        setError(
          'Sign-out could not be confirmed. Private details have been cleared; try refreshing.',
        );
    } finally {
      if (gate.current.current(t.version)) setBusy(false);
    }
  }
  async function action(
    kind: 'save' | 'recover' | 'retry' | 'settle',
    listingId?: string,
    version?: string,
    saved?: boolean,
  ) {
    if (!session?.account) return;
    const t = gate.current.begin();
    setBusy(true);
    setError('');
    setMissing(false);
    try {
      let command = session.pending;
      if (kind === 'save')
        command = {
          policy: 'customer-favourite-command-v1',
          operationId: crypto.randomUUID(),
          listingId: listingId!,
          expectedVersion: version!,
          saved: saved!,
        };
      if (kind === 'settle') {
        await api('/settle', t.signal, { operationId: command!.operationId }, session.csrf);
        if (gate.current.current(t.version)) {
          channel.current?.postMessage('refresh');
          await read(t.signal, t.version);
        }
        return;
      }
      const result =
        kind === 'recover'
          ? await api('/original', t.signal)
          : kind === 'retry'
            ? await api('/retry', t.signal, { operationId: command!.operationId }, session.csrf)
            : await api('/favourite', t.signal, command, session.csrf);
      if (!gate.current.current(t.version)) return;
      const checked = validateCustomerFavouriteReceipt(result, command!, session.account);
      setSession({ ...session, pending: command });
      setReceipt(checked);
    } catch (e) {
      if (!gate.current.current(t.version)) return;
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403) {
        blocked.current = true;
        clear();
        channel.current?.postMessage('signed-out');
        setError('Your account access ended. Please refresh and sign in again.');
        setBusy(false);
        return;
      }
      if (kind === 'recover' && status === 404) {
        setMissing(true);
        setError('No original is recorded yet. You may deliberately retry the same saved action.');
      } else
        setError(
          kind === 'save' || kind === 'retry'
            ? 'The outcome is not confirmed. Recover the original before starting another action.'
            : 'The original could not be read. Try recovery again.',
        );
      if (kind === 'save') {
        try {
          const next = validateSession(await api('/session', t.signal));
          if (gate.current.current(t.version)) setSession(next);
        } catch {
          if (gate.current.current(t.version))
            setError(
              'Your action may be retained on the server. Refresh your account before continuing.',
            );
        }
      }
    } finally {
      if (gate.current.current(t.version)) setBusy(false);
    }
  }
  async function more() {
    if (!session?.account || !rows.length) return;
    const t = gate.current.begin();
    setBusy(true);
    try {
      const result = await api('/favourites?limit=20&after=' + rows.at(-1)!.listingId, t.signal);
      if (!gate.current.current(t.version)) return;
      const checked = validateBrowserFavourites(
        result,
        session.account,
        20,
        rows.at(-1)!.listingId,
      );
      const page = checked.page;
      setRows([...rows, ...page.items]);
      setSummaries([...summaries, ...checked.summaries]);
      setHasMore(page.hasMore);
    } catch (e) {
      if (gate.current.current(t.version)) {
        if ([401, 403].includes((e as { status?: number }).status ?? 0)) {
          blocked.current = true;
          clear();
          setBusy(false);
          channel.current?.postMessage('signed-out');
          setError('Your account access ended. Please sign in again.');
        } else setError('More saved homes could not be loaded. Try refreshing.');
      }
    } finally {
      if (gate.current.current(t.version)) setBusy(false);
    }
  }
  return (
    <section className="customer-account" aria-busy={busy}>
      <p className="eyebrow">YOUR SAVED HOMES</p>
      <h1>Keep the places you want to revisit.</h1>
      {mode === 'synthetic' ? (
        <p>
          Synthetic test accounts only. These choices do not create real accounts or send messages.
        </p>
      ) : (
        <p>
          Save homes to revisit them later. <Link href="/sign-in">Manage sign-in</Link>
        </p>
      )}
      {busy && <p role="status">Loading your account…</p>}
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        onClick={() => {
          blocked.current = false;
          void refresh();
        }}
        disabled={busy}
      >
        Refresh account
      </button>
      {session && !session.account && (
        <div>
          <h2>Choose a test account</h2>
          {session.choices.map((u) => (
            <button type="button" key={u.id} disabled={busy} onClick={() => void login(u.id)}>
              {u.label}
            </button>
          ))}
          <p>Your saved homes will appear here after you sign in.</p>
        </div>
      )}
      {session?.account && (
        <>
          <div className="customer-account__identity">
            <h2>{session.account.label}</h2>
            <button type="button" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
          {session.pending && (
            <aside className="customer-account__pending">
              <h2>{receipt ? 'Saved action confirmed' : 'An action needs your attention'}</h2>
              <p>
                {receipt
                  ? receipt.outcome === 'conflict'
                    ? 'The property changed before this action. Finish this result, then refresh before trying again.'
                    : receipt.saved
                      ? 'This home is saved to your account.'
                      : 'This home is removed from your saved homes.'
                  : 'The same original action is retained. Recovery reads its saved result without another write.'}
              </p>
              {receipt ? (
                <button disabled={busy} onClick={() => void action('settle')}>
                  Finish this result
                </button>
              ) : (
                <>
                  <button disabled={busy} onClick={() => void action('recover')}>
                    Recover original action
                  </button>
                  {missing && (
                    <button disabled={busy} onClick={() => void action('retry')}>
                      Retry the same action
                    </button>
                  )}
                </>
              )}
            </aside>
          )}
          {candidate && candidateState && (
            <div className="customer-account__candidate">
              <h2>{candidate.title}</h2>
              <Link href={'/properties/' + candidate.id}>View property details and price</Link>
              <button
                disabled={busy || !!session.pending}
                onClick={() =>
                  void action('save', candidate.id, candidateState.version, !candidateState.saved)
                }
              >
                {candidateState.saved ? 'Remove this saved home' : 'Save this home'}
              </button>
            </div>
          )}
          <h2>Saved homes</h2>
          {!rows.length && !busy && (
            <p>
              You have no saved homes yet.{' '}
              <Link href="/">Browse properties to find a place you like.</Link>
            </p>
          )}
          <ul className="customer-account__list">
            {rows.map((row) => {
              const summary = summaries.find((x) => x.listingId === row.listingId);
              return (
                <li key={row.listingId}>
                  <h3>{summary?.title ?? 'Saved property unavailable'}</h3>
                  {summary && (
                    <p>
                      {formatKes(kesFromMinor(summary.priceMinor))}
                      {summary.purpose === 'rent' && summary.rentalPeriod
                        ? ' / ' + summary.rentalPeriod
                        : ''}
                    </p>
                  )}
                  {row.available && summary ? (
                    <Link href={'/properties/' + row.listingId}>View details</Link>
                  ) : (
                    <p>This property is unavailable right now. You can still remove it.</p>
                  )}
                  <button
                    disabled={busy || !!session.pending}
                    onClick={() => void action('save', row.listingId, row.version, false)}
                  >
                    Remove saved home
                  </button>
                </li>
              );
            })}
          </ul>
          {hasMore && (
            <button disabled={busy} onClick={() => void more()}>
              Load more saved homes
            </button>
          )}
        </>
      )}
      <p>
        <Link href="/">Continue browsing properties →</Link>
      </p>
    </section>
  );
}
