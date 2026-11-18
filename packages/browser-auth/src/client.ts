import { initializeApp, deleteApp } from 'firebase/app';
import {
  initializeAuth,
  inMemoryPersistence,
  browserPopupRedirectResolver,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import type { FirebaseWebConfig } from './config.js';

export interface BrowserAccount {
  readonly actorId: string;
  readonly tenantId: string;
  readonly expiresAt: string;
}
export interface BrowserSession {
  readonly account: BrowserAccount | null;
  readonly csrf: string | null;
}
export interface FirebaseSignInAdapter {
  google(): Promise<{ idToken(): Promise<string> }>;
  password(email: string, password: string): Promise<{ idToken(): Promise<string> }>;
  dispose(): Promise<void>;
}
const opaque = /^[A-Za-z0-9_-]{43}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class SignInError extends Error {
  constructor(readonly kind: 'failed' | 'uncertain' | 'cancelled' | 'busy' = 'failed') {
    super('Sign-in could not be completed.');
  }
}
export function firebaseSignInAdapter(config: FirebaseWebConfig): FirebaseSignInAdapter {
  const app = initializeApp(
    {
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      appId: config.appId,
    },
    'realtor-sign-in-' + crypto.randomUUID(),
  );
  // Configure memory persistence at construction, before any sign-in. No localStorage/IndexedDB token session.
  const auth = initializeAuth(app, {
    persistence: inMemoryPersistence,
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  auth.tenantId = config.authTenantId ?? null;
  return {
    async google() {
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      return { idToken: () => result.user.getIdToken() };
    },
    async password(email, password) {
      const result = await signInWithEmailAndPassword(auth, email, password);
      return { idToken: () => result.user.getIdToken() };
    },
    async dispose() {
      try {
        await signOut(auth);
      } finally {
        await deleteApp(app);
      }
    },
  };
}
function session(value: unknown): BrowserSession {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'account,csrf'
  )
    throw new SignInError();
  const v = value as Record<string, unknown>;
  if (v.account === null && v.csrf === null) return { account: null, csrf: null };
  if (
    !v.account ||
    typeof v.account !== 'object' ||
    Object.keys(v.account).sort().join(',') !== 'actorId,expiresAt,tenantId' ||
    typeof v.csrf !== 'string' ||
    !opaque.test(v.csrf)
  )
    throw new SignInError();
  const a = v.account as Record<string, unknown>;
  if (
    typeof a.actorId !== 'string' ||
    !uuid.test(a.actorId) ||
    typeof a.tenantId !== 'string' ||
    !uuid.test(a.tenantId) ||
    typeof a.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(a.expiresAt)) ||
    new Date(a.expiresAt).toISOString() !== a.expiresAt ||
    Date.parse(a.expiresAt) <= Date.now()
  )
    throw new SignInError();
  return {
    account: { actorId: a.actorId, tenantId: a.tenantId, expiresAt: a.expiresAt },
    csrf: v.csrf,
  };
}
/** One deliberate exchange. Lost/malformed replies require a session GET, never automatic resubmission. */
export function createBrowserSignInClient(
  makeAdapter: () => FirebaseSignInAdapter,
  transport: typeof fetch = fetch,
) {
  let active = false;
  const check = (signal?: AbortSignal) => {
    if (signal?.aborted) throw new SignInError('cancelled');
  };
  async function call(path: string, signal?: AbortSignal, body?: unknown, csrf?: string) {
    check(signal);
    const timeout = AbortSignal.timeout(15000),
      combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await transport(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: combined,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    // A denied session has no authority. Allow deliberate re-authentication; retain uncertainty for outages.
    if (path === '/auth/session' && body === undefined && response.status === 401) {
      await response.body?.cancel().catch(() => {});
      return { account: null, csrf: null };
    }
    if (!response.ok) throw new SignInError();
    const reader = response.body?.getReader();
    if (!reader) throw new SignInError();
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.length;
        if (size > 8192) throw new SignInError();
        chunks.push(result.value);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) {
        bytes.set(c, at);
        at += c.length;
      }
      check(signal);
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  async function getSession(signal?: AbortSignal) {
    return session(await call('/auth/session', signal));
  }
  async function signIn(
    kind: 'google' | 'password',
    email = '',
    password = '',
    signal?: AbortSignal,
  ) {
    if (active) throw new SignInError('busy');
    active = true;
    let adapter: FirebaseSignInAdapter | undefined,
      exchanging = false;
    try {
      check(signal);
      adapter = makeAdapter();
      // Open Google immediately from the click handler; do not await a bootstrap fetch before the popup.
      const credential = await (kind === 'google'
        ? adapter.google()
        : adapter.password(email, password));
      check(signal);
      const started = (await call('/auth/login', signal, {})) as Record<string, unknown>;
      if (
        !started ||
        typeof started !== 'object' ||
        Object.keys(started).sort().join(',') !== 'policy,state' ||
        started.policy !== 'firebase-browser-login-v1' ||
        typeof started.state !== 'string' ||
        !opaque.test(started.state)
      )
        throw new SignInError();
      const idToken = await credential.idToken();
      check(signal);
      if (
        idToken.length > 8192 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(idToken)
      )
        throw new SignInError();
      exchanging = true;
      const result = await call('/auth/firebase', signal, { state: started.state, idToken });
      if (
        !result ||
        typeof result !== 'object' ||
        Object.keys(result).join(',') !== 'signedIn' ||
        (result as { signedIn: unknown }).signedIn !== true
      )
        throw new SignInError('uncertain');
      const current = await getSession(signal);
      if (!current.account) throw new SignInError('uncertain');
      return current;
    } catch (error) {
      if (signal?.aborted) throw new SignInError('cancelled');
      if (error instanceof SignInError && ['busy', 'uncertain'].includes(error.kind)) throw error;
      throw new SignInError(exchanging ? 'uncertain' : 'failed');
    } finally {
      try {
        await adapter?.dispose();
      } catch {
        throw new SignInError(exchanging ? 'uncertain' : 'failed');
      } finally {
        active = false;
      }
    }
  }
  async function logout(current: BrowserSession, signal?: AbortSignal) {
    if (active) throw new SignInError('busy');
    active = true;
    try {
      const value = await call('/auth/logout', signal, {}, current.csrf ?? undefined);
      if (
        !value ||
        typeof value !== 'object' ||
        Object.keys(value).join(',') !== 'account' ||
        (value as { account: unknown }).account !== null
      )
        throw new SignInError('uncertain');
      const result = await getSession(signal);
      if (result.account) throw new SignInError('uncertain');
      return result;
    } finally {
      active = false;
    }
  }
  return Object.freeze({ getSession, signIn, logout });
}
