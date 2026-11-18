'use client';
import { useEffect, useRef, useState } from 'react';
import type { FirebaseWebConfig } from './config.js';
import {
  createBrowserSignInClient,
  firebaseSignInAdapter,
  SignInError,
  type BrowserSession,
} from './client.js';

export default function SignInPanel({
  config,
  title = 'Sign in',
  continueHref = '/account',
}: {
  config: FirebaseWebConfig;
  title?: string;
  continueHref: '/account' | '/';
}) {
  const client = useRef<ReturnType<typeof createBrowserSignInClient> | null>(null);
  const active = useRef<AbortController | null>(null),
    epoch = useRef(0),
    working = useRef(true),
    channel = useRef<BroadcastChannel | null>(null);
  const [current, setCurrent] = useState<BrowserSession | null>(null),
    [busy, setBusy] = useState(true),
    [message, setMessage] = useState(''),
    [uncertain, setUncertain] = useState(false);
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  function start() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const version = ++epoch.current;
    working.current = true;
    setBusy(true);
    setMessage('');
    return { controller, version };
  }
  function live(version: number) {
    return epoch.current === version && !active.current?.signal.aborted;
  }
  async function refresh(notify = false) {
    const { controller, version } = start();
    setCurrent(null);
    setPassword('');
    try {
      const value = await client.current!.getSession(controller.signal);
      if (live(version)) {
        setCurrent(value);
        setUncertain(false);
        if (notify) channel.current?.postMessage({ type: 'auth-changed' });
      }
    } catch {
      if (live(version)) {
        setMessage('Could not check your sign-in. Please try again.');
        setUncertain(true);
      }
    } finally {
      if (live(version)) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    client.current = createBrowserSignInClient(() => firebaseSignInAdapter(config));
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('realtor-hosted-auth-v1');
      channel.current.onmessage = (event) => {
        if (event.data?.type === 'auth-changed') {
          setEmail('');
          void refresh();
        }
      };
    }
    const foreground = () => {
      if (document.visibilityState === 'visible' && !working.current) void refresh();
    };
    document.addEventListener('visibilitychange', foreground);
    void refresh();
    return () => {
      epoch.current++;
      active.current?.abort();
      channel.current?.close();
      channel.current = null;
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [config]);
  useEffect(() => {
    if (!current?.account) return;
    const timer = setTimeout(
      () => {
        setCurrent(null);
        void refresh();
      },
      Math.max(0, Date.parse(current.account.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [current]);
  async function signIn(kind: 'google' | 'password') {
    if (working.current) return;
    const { controller, version } = start();
    setCurrent(null);
    setUncertain(false);
    try {
      const value = await client.current!.signIn(kind, email, password, controller.signal);
      if (live(version)) {
        setCurrent(value);
        setEmail('');
        setUncertain(false);
        channel.current?.postMessage({ type: 'auth-changed' });
      }
    } catch (error) {
      if (live(version)) {
        const unknown = error instanceof SignInError && error.kind === 'uncertain';
        setUncertain(unknown);
        setMessage(
          unknown
            ? 'We could not confirm sign-in. Check your sign-in before trying again.'
            : 'Could not sign in. Check your account details or try another method.',
        );
      }
    } finally {
      setPassword('');
      if (live(version)) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  async function logout() {
    if (working.current || !current) return;
    const value = current,
      { controller, version } = start();
    setCurrent(null);
    setEmail('');
    setPassword('');
    channel.current?.postMessage({ type: 'auth-changed' });
    try {
      const next = await client.current!.logout(value, controller.signal);
      if (live(version)) {
        setCurrent(next);
        setUncertain(false);
        channel.current?.postMessage({ type: 'auth-changed' });
      }
    } catch {
      if (live(version)) {
        setUncertain(true);
        setMessage('Could not confirm sign-out. Check your sign-in.');
      }
    } finally {
      if (live(version)) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className="hosted-sign-in" aria-busy={busy}>
      <style>{`.hosted-sign-in{max-width:28rem;margin:clamp(2rem,8vh,6rem) auto;padding:2rem;border:1px solid #ddd3d7;border-radius:1rem;background:#fff;color:#29232a;font:inherit}.hosted-sign-in h1{font-size:1.8rem;margin:0 0 .7rem}.hosted-sign-in p{line-height:1.5}.hosted-sign-in label{display:block;font-weight:650;margin:1rem 0 .4rem}.hosted-sign-in input{box-sizing:border-box;width:100%;font:inherit;padding:.8rem;border:1px solid #9b9197;border-radius:.45rem}.hosted-sign-in button,.hosted-sign-in .continue{display:block;box-sizing:border-box;width:100%;padding:.85rem 1rem;margin-top:1rem;border:1px solid var(--brand,#871b46);border-radius:.5rem;font:inherit;font-weight:650;background:var(--brand,#871b46);color:white;text-align:center;text-decoration:none;cursor:pointer}.hosted-sign-in .secondary{background:white;color:var(--brand,#871b46)}.hosted-sign-in button:disabled{opacity:.6;cursor:wait}.hosted-sign-in :focus-visible{outline:3px solid #c28c36;outline-offset:3px}.hosted-sign-in .message{padding:.8rem;background:#fff4df;border-radius:.45rem}.hosted-sign-in .help{font-size:.9rem;color:#62565f}`}</style>
      <h1>{title}</h1>
      <p>Use the account enabled for your workspace.</p>
      {message && (
        <p className="message" role="alert">
          {message}
        </p>
      )}
      {current?.account ? (
        <>
          <p role="status">You are signed in.</p>
          <a className="continue" href={continueHref}>
            Continue
          </a>
          <button type="button" className="secondary" disabled={busy} onClick={() => void logout()}>
            Sign out
          </button>
        </>
      ) : (
        <>
          <button type="button" disabled={busy || uncertain} onClick={() => void signIn('google')}>
            Continue with Google
          </button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void signIn('password');
            }}
          >
            <label htmlFor="hosted-sign-in-email">Email address</label>
            <input
              id="hosted-sign-in-email"
              type="email"
              autoComplete="username"
              required
              maxLength={320}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy || uncertain}
            />
            <label htmlFor="hosted-sign-in-password">Password</label>
            <input
              id="hosted-sign-in-password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy || uncertain}
            />
            <button type="submit" className="secondary" disabled={busy || uncertain}>
              Sign in with email
            </button>
          </form>
          <p className="help">Need access? Ask your workspace administrator.</p>
        </>
      )}
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => void refresh(true)}
      >
        Check sign-in
      </button>
      {busy && <p role="status">Checking sign-in…</p>}
    </section>
  );
}
