import { createHash, randomBytes } from 'node:crypto';
import * as oidc from 'openid-client';
import { createIdentityVerifier, type VerifiedIdentity } from './auth.js';

export interface BrowserIdentityConfig {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly apiAudience: string;
  readonly applicationOrigin: string;
  readonly tenantId: string;
  readonly allowLoopbackHttpForTests?: boolean;
}
export interface LoginTransaction {
  readonly verifier: string;
  readonly nonce: string;
  readonly expiresAt: number;
}
export interface BrowserIdentitySession {
  readonly actorId: string;
  readonly accessToken: string;
  readonly csrf: string;
  readonly expiresAt: number;
}
/** Every key includes the trusted application/company scope. Implement expiry in the store too.
 * takeLogin MUST atomically delete and return one unexpired transaction (including across replicas).
 * Store credentials encrypted at rest; never expose these methods through browser routes.
 */
export interface BrowserIdentityStore {
  putLogin(key: string, value: LoginTransaction): Promise<void>;
  takeLogin(key: string, now: number): Promise<LoginTransaction | null>;
  putSession(key: string, value: BrowserIdentitySession): Promise<void>;
  getSession(key: string, now: number): Promise<BrowserIdentitySession | null>;
  deleteSession(key: string): Promise<void>;
}
const random = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const opaque = /^[A-Za-z0-9_-]{43}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class BrowserIdentityError extends Error {
  constructor() {
    super('Sign-in could not be completed.');
  }
}
/** Server-only OIDC code + S256 client and browser boundary. No implicit account linking or roles.
 * Routes: POST /auth/login, GET /auth/callback, GET /auth/session, POST /auth/logout.
 * Next route mounts remain unavailable until a controlled provider and durable store are configured.
 */
export function createBrowserIdentity(
  input: BrowserIdentityConfig,
  store: BrowserIdentityStore,
  options: { transport?: typeof fetch; now?: () => number } = {},
) {
  const c = Object.freeze({ ...input });
  const now = options.now ?? Date.now;
  const loopback = c.allowLoopbackHttpForTests === true;
  if (loopback && process.env.NODE_ENV === 'production') throw new BrowserIdentityError();
  function endpoint(value: string): URL {
    try {
      const url = new URL(value);
      if (
        value !== value.trim() ||
        /[\s\\]/.test(value) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.protocol !== 'https:' &&
          !(
            loopback &&
            url.protocol === 'http:' &&
            ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
          ))
      )
        throw new BrowserIdentityError();
      return url;
    } catch {
      throw new BrowserIdentityError();
    }
  }
  const issuer = endpoint(c.issuer),
    origin = endpoint(c.applicationOrigin);
  if (
    origin.origin !== c.applicationOrigin ||
    !uuid.test(c.tenantId) ||
    !c.clientId ||
    c.clientId.length > 255 ||
    /[\s\x00-\x1f]/.test(c.clientId) ||
    !c.clientSecret ||
    c.clientSecret.length > 4096
  )
    throw new BrowserIdentityError();
  const authorization = endpoint(c.authorizationEndpoint),
    token = endpoint(c.tokenEndpoint),
    jwks = endpoint(c.jwksUrl);
  if ([authorization, token, jwks].some((u) => u.origin !== issuer.origin))
    throw new BrowserIdentityError();
  const redirectUri = origin.origin + '/auth/callback';
  const scope = hash(origin.origin + '|' + c.tenantId + '|' + c.issuer + '|' + c.clientId);
  const cookiePrefix = origin.protocol === 'https:' ? '__Host-' : '';
  const loginCookie = cookiePrefix + 'realtor_login_' + scope.slice(0, 12);
  const sessionCookie = cookiePrefix + 'realtor_session_' + scope.slice(0, 12);
  const key = (kind: string, value: string) => scope + ':' + kind + ':' + hash(value);
  const config = new oidc.Configuration(
    {
      issuer: c.issuer,
      authorization_endpoint: authorization.href,
      token_endpoint: token.href,
      jwks_uri: jwks.href,
      response_types_supported: ['code'],
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
    },
    c.clientId,
    { client_secret: c.clientSecret, id_token_signed_response_alg: 'RS256' },
    oidc.ClientSecretPost(c.clientSecret),
  );
  if (loopback) oidc.allowInsecureRequests(config);
  config.timeout = 5;
  const transport = options.transport ?? fetch;
  config[oidc.customFetch] = async (url, init) => {
    if (![token.href, jwks.href].includes(String(url))) throw new BrowserIdentityError();
    const body = init.body instanceof Uint8Array ? new Uint8Array(init.body).buffer : init.body;
    return transport(url, { ...init, body, redirect: 'error' });
  };
  oidc.enableNonRepudiationChecks(config);
  const verifyAccess = createIdentityVerifier({
    issuer: c.issuer,
    audience: c.apiAudience,
    jwksUrl: c.jwksUrl,
    allowLoopbackHttpForTests: loopback,
  });
  function cookie(request: Request, name: string) {
    const values = (request.headers.get('cookie') ?? '')
      .split(';')
      .map((x) => x.trim())
      .filter((x) => x.startsWith(name + '='));
    if (values.length > 1) throw new BrowserIdentityError();
    if (!values.length) return null;
    const value = values[0]!.slice(name.length + 1);
    if (!opaque.test(value)) throw new BrowserIdentityError();
    return value;
  }
  function cookieHeader(name: string, value: string, seconds: number) {
    return (
      `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}` +
      (origin.protocol === 'https:' ? '; Secure' : '')
    );
  }
  function response(status: number, body: unknown, cookies: string[] = [], location?: string) {
    const headers = new Headers({
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Cookie',
    });
    for (const value of cookies) headers.append('Set-Cookie', value);
    if (location) headers.set('Location', location);
    if (body !== null) headers.set('Content-Type', 'application/json');
    return new Response(body === null ? null : JSON.stringify(body), { status, headers });
  }
  function sameOrigin(request: Request) {
    if (
      request.headers.get('origin') !== origin.origin ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    )
      throw new BrowserIdentityError();
  }
  async function session(request: Request) {
    const id = cookie(request, sessionCookie);
    const value = id ? await store.getSession(key('session', id), now()) : null;
    return value && value.expiresAt > now() ? value : null;
  }
  async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.origin !== origin.origin) return response(404, { error: 'NOT_FOUND' });
      if (request.method === 'POST' && url.pathname === '/auth/login') {
        sameOrigin(request);
        const binding = random(),
          state = random(),
          verifier = oidc.randomPKCECodeVerifier(),
          nonce = oidc.randomNonce();
        await store.putLogin(key('login', binding + '|' + state), {
          verifier,
          nonce,
          expiresAt: now() + 300_000,
        });
        const location = oidc.buildAuthorizationUrl(config, {
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'openid',
          state,
          nonce,
          code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
          code_challenge_method: 'S256',
          audience: c.apiAudience,
        });
        return response(303, null, [cookieHeader(loginCookie, binding, 300)], location.href);
      }
      if (request.method === 'GET' && url.pathname === '/auth/callback') {
        const binding = cookie(request, loginCookie),
          states = url.searchParams.getAll('state');
        const previous = cookie(request, sessionCookie);
        if (!binding || states.length !== 1 || !opaque.test(states[0]!))
          throw new BrowserIdentityError();
        const tx = await store.takeLogin(key('login', binding + '|' + states[0]), now());
        if (!tx || tx.expiresAt <= now()) throw new BrowserIdentityError();
        const tokens = await oidc.authorizationCodeGrant(config, url, {
          pkceCodeVerifier: tx.verifier,
          expectedState: states[0],
          expectedNonce: tx.nonce,
          idTokenExpected: true,
        });
        const claims = tokens.claims();
        const identity = await verifyAccess(tokens.access_token);
        if (
          !claims ||
          claims.sub !== identity.actorId ||
          !Number.isSafeInteger(tokens.expires_in) ||
          tokens.expires_in! < 1 ||
          tokens.expires_in! > 3600 ||
          !Number.isSafeInteger(claims.exp)
        )
          throw new BrowserIdentityError();
        const expiresAt = Math.min(now() + tokens.expires_in! * 1000, claims.exp * 1000);
        const ttl = Math.floor((expiresAt - now()) / 1000);
        if (ttl < 1) throw new BrowserIdentityError();
        const id = random();
        await store.putSession(key('session', id), {
          actorId: identity.actorId,
          accessToken: tokens.access_token,
          csrf: random(),
          expiresAt,
        });
        if (previous) await store.deleteSession(key('session', previous));
        return response(
          303,
          null,
          [cookieHeader(loginCookie, '', 0), cookieHeader(sessionCookie, id, ttl)],
          origin.origin + '/',
        );
      }
      if (request.method === 'GET' && url.pathname === '/auth/session') {
        const s = await session(request);
        return response(200, {
          account: s
            ? {
                actorId: s.actorId,
                tenantId: c.tenantId,
                expiresAt: new Date(s.expiresAt).toISOString(),
              }
            : null,
          csrf: s?.csrf ?? null,
        });
      }
      if (request.method === 'POST' && url.pathname === '/auth/logout') {
        sameOrigin(request);
        const s = await session(request);
        if (s && request.headers.get('x-csrf-token') !== s.csrf) throw new BrowserIdentityError();
        const id = cookie(request, sessionCookie);
        if (id) await store.deleteSession(key('session', id));
        return response(200, { account: null }, [
          cookieHeader(sessionCookie, '', 0),
          cookieHeader(loginCookie, '', 0),
        ]);
      }
      return response(404, { error: 'NOT_FOUND' });
    } catch {
      return response(401, { error: 'SIGN_IN_FAILED' });
    }
  }
  return Object.freeze({
    handle,
    /** Use only on the server. Re-verifies expiry/signature; SQL must check current membership. */
    async authenticate(request: Request): Promise<VerifiedIdentity & { accessToken: string }> {
      if (new URL(request.url).origin !== origin.origin) throw new BrowserIdentityError();
      const s = await session(request);
      if (!s) throw new BrowserIdentityError();
      const identity = await verifyAccess(s.accessToken);
      if (identity.actorId !== s.actorId) throw new BrowserIdentityError();
      return Object.freeze({ ...identity, accessToken: s.accessToken });
    },
  });
}
