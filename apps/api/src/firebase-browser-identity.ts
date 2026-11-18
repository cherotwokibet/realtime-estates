import { createHash, randomBytes } from 'node:crypto';
import { parseCustomerFavouriteJson } from '@realtor/domain';
import type { BrowserIdentityStore, BrowserIdentitySession } from './browser-identity.js';
import type { FirebaseVerifiedToken } from './firebase-identity.js';

export interface FirebaseBrowserIdentityConfig {
  readonly projectId: string;
  readonly authTenantId?: string;
  readonly applicationOrigin: string;
  readonly tenantId: string;
  readonly allowLoopbackHttpForTests?: boolean;
}
export type FirebaseBrowserTokenVerifier = (
  token: string,
  recent?: boolean,
) => Promise<FirebaseVerifiedToken>;
const random = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const opaque = /^[A-Za-z0-9_-]{43}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
class Refused extends Error {}

/** Firebase client SDK -> recent verified ID token -> opaque SQL-backed browser session.
 * Client Firebase persistence must be in-memory and cleared after exchange. No refresh token enters SQL.
 * Roles/company claims are never used; protected API operations must check current SQL membership.
 */
export function createFirebaseBrowserIdentity(
  input: FirebaseBrowserIdentityConfig,
  store: BrowserIdentityStore,
  verify: FirebaseBrowserTokenVerifier,
  now: () => number = Date.now,
) {
  const c = Object.freeze({ ...input }),
    origin = new URL(c.applicationOrigin);
  const local =
    c.allowLoopbackHttpForTests === true &&
    process.env.NODE_ENV !== 'production' &&
    origin.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if (c.allowLoopbackHttpForTests && process.env.NODE_ENV === 'production') throw new Refused();
  if (
    origin.origin !== c.applicationOrigin ||
    (origin.protocol !== 'https:' && !local) ||
    !uuid.test(c.tenantId) ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(c.projectId) ||
    (c.authTenantId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(c.authTenantId))
  )
    throw new Refused();
  const scope = hash(
    'firebase|' +
      c.projectId +
      '|' +
      (c.authTenantId ?? '') +
      '|' +
      origin.origin +
      '|' +
      c.tenantId,
  );
  const prefix = origin.protocol === 'https:' ? '__Host-' : '';
  const loginCookie = prefix + 'realtor_firebase_login_' + scope.slice(0, 12);
  const sessionCookie = prefix + 'realtor_firebase_session_' + scope.slice(0, 12);
  const key = (kind: string, value: string) => scope + ':' + kind + ':' + hash(value);
  function cookie(r: Request, name: string) {
    const values = (r.headers.get('cookie') ?? '')
      .split(';')
      .map((x) => x.trim())
      .filter((x) => x.startsWith(name + '='));
    if (values.length > 1) throw new Refused();
    if (!values.length) return null;
    const v = values[0]!.slice(name.length + 1);
    if (!opaque.test(v)) throw new Refused();
    return v;
  }
  function cookieValue(name: string, value: string, ttl: number) {
    return (
      `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttl}` +
      (origin.protocol === 'https:' ? '; Secure' : '')
    );
  }
  function reply(status: number, value: unknown, cookies: string[] = []) {
    const headers = new Headers({
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': 'application/json',
      Vary: 'Cookie',
    });
    for (const v of cookies) headers.append('Set-Cookie', v);
    return new Response(JSON.stringify(value), { status, headers });
  }
  function trustedRequest(r: Request, post = false) {
    const u = new URL(r.url),
      supplied = r.headers.get('origin');
    if (
      u.origin !== origin.origin ||
      u.hash ||
      (supplied !== null && supplied !== origin.origin) ||
      r.headers.get('sec-fetch-site') === 'cross-site' ||
      (post && supplied !== origin.origin)
    )
      throw new Refused();
    for (const name of ['authorization', 'x-actor-id', 'x-tenant-id', 'x-role'])
      if (r.headers.has(name)) throw new Refused();
  }
  async function rawSession(r: Request) {
    const id = cookie(r, sessionCookie),
      value = id ? await store.getSession(key('session', id), now()) : null;
    return value && value.expiresAt > now() ? value : null;
  }
  async function authenticate(r: Request) {
    trustedRequest(r);
    const value = await rawSession(r);
    if (!value) throw new Refused();
    const verified = await verify(value.accessToken);
    const current = await rawSession(r);
    if (
      verified.actorId !== value.actorId ||
      verified.expiresAt <= now() ||
      !current ||
      current.csrf !== value.csrf ||
      current.accessToken !== value.accessToken
    )
      throw new Refused();
    return Object.freeze({
      actorId: value.actorId,
      tenantId: c.tenantId,
      accessToken: value.accessToken,
    });
  }
  async function body(r: Request): Promise<{ state: string; idToken: string }> {
    if (
      r.headers.get('content-type') !== 'application/json' ||
      r.headers.has('content-encoding') ||
      r.headers.has('transfer-encoding')
    )
      throw new Refused();
    const declared = r.headers.get('content-length');
    if (declared !== null && (!/^[1-9][0-9]{0,4}$/.test(declared) || Number(declared) > 16384))
      throw new Refused();
    const reader = r.body?.getReader();
    if (!reader) throw new Refused();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Refused()), 5000);
    });
    try {
      let length = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const next = await Promise.race([reader.read(), deadline]);
        if (next.done) break;
        length += next.value.length;
        if (length > 16384) throw new Refused();
        chunks.push(next.value);
      }
      if (declared !== null && Number(declared) !== length) throw new Refused();
      const all = new Uint8Array(length);
      let at = 0;
      for (const chunk of chunks) {
        all.set(chunk, at);
        at += chunk.length;
      }
      const value = parseCustomerFavouriteJson(
        new TextDecoder('utf-8', { fatal: true }).decode(all),
      ) as Record<string, unknown>;
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== 'idToken,state' ||
        typeof value.state !== 'string' ||
        !opaque.test(value.state) ||
        typeof value.idToken !== 'string' ||
        value.idToken.length > 8192 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.idToken)
      )
        throw new Refused();
      return { state: value.state, idToken: value.idToken };
    } finally {
      clearTimeout(timer);
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  async function handle(r: Request): Promise<Response> {
    try {
      const path = new URL(r.url).pathname,
        post = r.method === 'POST';
      if (new URL(r.url).search) throw new Refused();
      trustedRequest(r, post);
      if (post && path === '/auth/login') {
        const previous = cookie(r, loginCookie);
        if (previous) await store.cancelLogin(key('login', previous));
        const binding = random(),
          state = random();
        await store.putLogin(key('login', binding), {
          state,
          verifier: random(),
          nonce: random(),
          expiresAt: now() + 300000,
        });
        return reply(200, { policy: 'firebase-browser-login-v1', state }, [
          cookieValue(loginCookie, binding, 300),
        ]);
      }
      if (post && path === '/auth/firebase') {
        const binding = cookie(r, loginCookie),
          previous = cookie(r, sessionCookie);
        if (!binding) throw new Refused();
        const value = await body(r),
          loginKey = key('login', binding);
        const tx = await store.claimLogin(loginKey, value.state, now());
        if (!tx || tx.state !== value.state) throw new Refused();
        const identity = await verify(value.idToken, true);
        if (
          !uuid.test(identity.actorId) ||
          !Number.isSafeInteger(identity.expiresAt) ||
          identity.expiresAt <= now()
        )
          throw new Refused();
        const id = random(),
          expiresAt = Math.min(now() + 3600000, identity.expiresAt);
        if (expiresAt - now() < 1000) throw new Refused();
        const session: BrowserIdentitySession = {
          actorId: identity.actorId,
          accessToken: value.idToken,
          csrf: random(),
          expiresAt,
        };
        if (
          r.signal.aborted ||
          !(await store.completeLogin(loginKey, key('session', id), session, now()))
        )
          throw new Refused();
        if (previous) await store.deleteSession(key('session', previous));
        if (!(await store.getSession(key('session', id), now()))) throw new Refused();
        return reply(200, { signedIn: true }, [
          cookieValue(loginCookie, '', 0),
          cookieValue(sessionCookie, id, Math.floor((expiresAt - now()) / 1000)),
        ]);
      }
      if (r.method === 'GET' && path === '/auth/session') {
        const value = await rawSession(r);
        if (!value) return reply(200, { account: null, csrf: null });
        await authenticate(r);
        return reply(200, {
          account: {
            actorId: value.actorId,
            tenantId: c.tenantId,
            expiresAt: new Date(value.expiresAt).toISOString(),
          },
          csrf: value.csrf,
        });
      }
      if (post && path === '/auth/logout') {
        const value = await rawSession(r);
        if (value && r.headers.get('x-csrf-token') !== value.csrf) throw new Refused();
        const login = cookie(r, loginCookie),
          id = cookie(r, sessionCookie);
        if (login) await store.cancelLogin(key('login', login));
        if (id) await store.deleteSession(key('session', id));
        return reply(200, { account: null }, [
          cookieValue(loginCookie, '', 0),
          cookieValue(sessionCookie, '', 0),
        ]);
      }
      return reply(404, { error: 'NOT_FOUND' });
    } catch {
      return reply(401, { error: 'SIGN_IN_FAILED' });
    }
  }
  return Object.freeze({
    handle,
    authenticate,
    async authenticateSession(request: Request) {
      const identity = await authenticate(request);
      const value = await rawSession(request);
      if (!value || value.accessToken !== identity.accessToken) throw new Refused();
      return Object.freeze({
        ...identity,
        csrf: value.csrf,
        expiresAt: value.expiresAt,
        generation: hash(scope + '|' + cookie(request, sessionCookie)),
      });
    },
    applicationOrigin: origin.origin,
    tenantId: c.tenantId,
  });
}
