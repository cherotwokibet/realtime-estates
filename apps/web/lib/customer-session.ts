import { createHash, randomBytes } from 'node:crypto';
import { CustomerFavouritesClient, CustomerApiError } from '@realtor/api-client';
import {
  parseCustomerFavouriteJson,
  validateCustomerFavouriteCommand,
  type CustomerFavouriteCommand,
} from '@realtor/domain';
export interface CustomerPreviewUser {
  readonly id: string;
  readonly label: string;
  readonly bearerToken: string;
}
export interface CustomerPreviewConfig {
  readonly policy: 'synthetic-customer-session-v1';
  readonly tenantId: string;
  readonly apiOrigin: string;
  readonly webOrigin: string;
  readonly expiresAt: string;
  readonly users: readonly CustomerPreviewUser[];
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function exact(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
    throw Error('Invalid customer configuration.');
  const own = Reflect.ownKeys(v);
  if (own.length !== keys.length || own.some((k) => typeof k !== 'string' || !keys.includes(k)))
    throw Error('Invalid customer fields.');
  const out: Record<string, unknown> = Object.create(null);
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) throw Error('Invalid customer fields.');
    out[k] = d.value;
  }
  return out;
}
const textId = (v: unknown): string => {
  if (typeof v !== 'string' || !uuid.test(v)) throw Error('Invalid identity.');
  return v;
};
function loopbackOrigin(v: unknown): string {
  if (typeof v !== 'string' || v !== v.trim() || /[\\\s]/.test(v)) throw Error('Invalid origin.');
  const u = new URL(v);
  if (
    !['http:', 'https:'].includes(u.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ||
    u.origin !== v ||
    u.username ||
    u.password
  )
    throw Error('Loopback preview origin required.');
  return u.origin;
}
export function customerPreviewConfig(
  source: string | undefined,
  expectedTenant: string,
  environment: string | undefined,
  now = Date.now(),
): CustomerPreviewConfig | null {
  if (source === undefined) return null;
  if (environment === 'production' || source.length > 32768)
    throw Error('Synthetic customer preview unavailable.');
  const r = exact(parseCustomerFavouriteJson(source), [
    'policy',
    'tenantId',
    'apiOrigin',
    'webOrigin',
    'expiresAt',
    'users',
  ]);
  if (r.policy !== 'synthetic-customer-session-v1' || textId(r.tenantId) !== textId(expectedTenant))
    throw Error('Invalid customer scope.');
  if (
    typeof r.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(r.expiresAt)) ||
    new Date(r.expiresAt).toISOString() !== r.expiresAt ||
    Date.parse(r.expiresAt) <= now ||
    Date.parse(r.expiresAt) > now + 900000
  )
    throw Error('Invalid preview expiry.');
  if (!Array.isArray(r.users) || r.users.length < 1 || r.users.length > 4)
    throw Error('Invalid preview users.');
  const users = r.users.map((v) => {
    const u = exact(v, ['id', 'label', 'bearerToken']);
    const id = textId(u.id);
    if (
      typeof u.label !== 'string' ||
      !/^Synthetic [A-Za-z0-9 -]{1,60}$/.test(u.label) ||
      typeof u.bearerToken !== 'string' ||
      u.bearerToken.length > 8192 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(u.bearerToken)
    )
      throw Error('Invalid preview user.');
    return Object.freeze({ id, label: u.label, bearerToken: u.bearerToken });
  });
  if (new Set(users.map((u) => u.id)).size !== users.length) throw Error('Duplicate preview user.');
  return Object.freeze({
    policy: 'synthetic-customer-session-v1',
    tenantId: r.tenantId as string,
    apiOrigin: loopbackOrigin(r.apiOrigin),
    webOrigin: loopbackOrigin(r.webOrigin),
    expiresAt: r.expiresAt,
    users: Object.freeze(users),
  });
}
interface Session {
  readonly key: string;
  readonly csrf: string;
  readonly generation: string;
  readonly user: CustomerPreviewUser;
  readonly expires: number;
  pending: CustomerFavouriteCommand | null;
  recoveryMissing: boolean;
  readonly active: Set<AbortController>;
}
class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
const token = () => randomBytes(32).toString('hex');
/** Bounded single-process synthetic session bridge. No provider account creation or production activation. */
export class CustomerSessionBridge {
  private readonly sessions = new Map<string, Session>();
  readonly cookieName: string;
  constructor(
    private readonly config: CustomerPreviewConfig,
    private readonly transport: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly summaryReader: (listingId: string) => Promise<null | {
      title: string;
      priceMinor: number;
      purpose: string;
      rentalPeriod: string | null;
    }> = async () => null,
  ) {
    this.cookieName =
      'realtor_customer_' +
      createHash('sha256')
        .update(config.webOrigin + '|' + config.tenantId)
        .digest('hex')
        .slice(0, 16);
  }
  private dispose(s: Session) {
    this.sessions.delete(s.key);
    for (const c of s.active) c.abort();
    s.active.clear();
    s.pending = null;
  }
  get webOrigin() {
    return this.config.webOrigin;
  }
  get tenantId() {
    return this.config.tenantId;
  }
  close() {
    for (const s of this.sessions.values()) this.dispose(s);
  }
  private prune() {
    for (const s of this.sessions.values()) if (s.expires <= this.now()) this.dispose(s);
  }
  private cookie(request: Request): string | null {
    const parts = (request.headers.get('cookie') ?? '')
      .split(';')
      .map((x) => x.trim())
      .filter((x) => x.startsWith(this.cookieName + '='));
    if (parts.length > 1) throw new Refusal(400, 'INVALID_SESSION');
    if (parts.length === 0) return null;
    const value = parts[0]!.slice(this.cookieName.length + 1);
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Refusal(401, 'SIGN_IN_REQUIRED');
    return value;
  }
  private response(status: number, value: unknown, setCookie?: string) {
    return Response.json(value, {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        Vary: 'Cookie',
        ...(setCookie ? { 'Set-Cookie': setCookie } : {}),
      },
    });
  }
  private cookieHeader(key: string, maxAge: number) {
    return (
      this.cookieName +
      '=' +
      key +
      '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' +
      maxAge +
      (this.config.webOrigin.startsWith('https:') ? '; Secure' : '')
    );
  }
  private publicSession(s: Session | null) {
    return {
      policy: 'customer-browser-session-v1',
      account: s
        ? {
            tenantId: this.config.tenantId,
            customerId: s.user.id,
            label: s.user.label,
            generation: s.generation,
            expiresAt: new Date(s.expires).toISOString(),
          }
        : null,
      csrf: s?.csrf ?? null,
      pending: s?.pending ?? null,
      choices: this.config.users.map((u) => ({ id: u.id, label: u.label })),
    };
  }
  private async call<T>(
    s: Session,
    fn: (
      client: CustomerFavouritesClient,
      auth: { bearerToken: string; signal: AbortSignal },
    ) => Promise<T>,
    request: Request,
  ): Promise<T> {
    const c = new AbortController(),
      abort = () => c.abort();
    s.active.add(c);
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) c.abort();
    try {
      const result = await fn(
        new CustomerFavouritesClient({
          baseUrl: this.config.apiOrigin,
          scope: { tenantId: this.config.tenantId, customerId: s.user.id },
          allowLoopbackHttp: true,
          fetch: this.transport,
        }),
        { bearerToken: s.user.bearerToken, signal: c.signal },
      );
      if (this.sessions.get(s.key) !== s || s.expires <= this.now())
        throw new Refusal(401, 'SIGN_IN_REQUIRED');
      return result;
    } catch (e) {
      if (e instanceof CustomerApiError && [401, 403].includes(e.status ?? 0)) this.dispose(s);
      throw e;
    } finally {
      s.active.delete(c);
      request.signal.removeEventListener('abort', abort);
    }
  }
  private async readBody(request: Request): Promise<unknown> {
    if (
      request.headers.get('content-type') !== 'application/json' ||
      request.headers.has('content-encoding') ||
      request.headers.has('transfer-encoding')
    )
      throw new Refusal(400, 'INVALID_REQUEST');
    const length = request.headers.get('content-length');
    if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > 2048))
      throw new Refusal(413, 'REQUEST_TOO_LARGE');
    const reader = request.body?.getReader();
    if (!reader) throw new Refusal(400, 'INVALID_REQUEST');
    let n = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const r = await reader.read();
        if (r.done) break;
        n += r.value.length;
        if (n > 2048) throw new Refusal(413, 'REQUEST_TOO_LARGE');
        chunks.push(r.value);
      }
      if (length !== null && Number(length) !== n) throw new Refusal(400, 'INVALID_REQUEST');
      const b = new Uint8Array(n);
      let p = 0;
      for (const c of chunks) {
        b.set(c, p);
        p += c.length;
      }
      try {
        return parseCustomerFavouriteJson(new TextDecoder('utf-8', { fatal: true }).decode(b));
      } catch {
        throw new Refusal(400, 'INVALID_REQUEST');
      }
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  async handle(request: Request): Promise<Response> {
    try {
      if (process.env.NODE_ENV === 'production') throw new Refusal(404, 'UNAVAILABLE');
      this.prune();
      if (this.now() >= Date.parse(this.config.expiresAt))
        throw new Refusal(401, 'PREVIEW_EXPIRED');
      const u = new URL(request.url);
      if (u.origin !== this.config.webOrigin || request.url.includes('#'))
        throw new Refusal(403, 'ORIGIN_REFUSED');
      const origin = request.headers.get('origin'),
        site = request.headers.get('sec-fetch-site');
      if (
        (origin !== null && origin !== this.config.webOrigin) ||
        (site !== null && !['same-origin', 'none'].includes(site))
      )
        throw new Refusal(403, 'ORIGIN_REFUSED');
      for (const k of [
        'authorization',
        'x-actor-id',
        'x-tenant-id',
        'x-role',
        'range',
        'if-none-match',
      ])
        if (request.headers.has(k)) throw new Refusal(400, 'INVALID_REQUEST');
      const path = u.pathname.slice('/api/customer'.length);
      if (
        !u.pathname.startsWith('/api/customer/') ||
        ![
          '/session',
          '/sign-in',
          '/sign-out',
          '/favourites',
          '/state',
          '/favourite',
          '/original',
          '/settle',
          '/retry',
        ].includes(path)
      )
        throw new Refusal(404, 'UNAVAILABLE');
      const post = ['/sign-in', '/sign-out', '/favourite', '/settle', '/retry'].includes(path);
      if (request.method !== (post ? 'POST' : 'GET')) throw new Refusal(405, 'METHOD_UNAVAILABLE');
      if (
        post &&
        (origin !== this.config.webOrigin ||
          request.headers.get('x-customer-intent') !== 'session-v1')
      )
        throw new Refusal(403, 'ORIGIN_REFUSED');
      if (
        !post &&
        (request.body !== null ||
          request.headers.has('content-type') ||
          request.headers.has('content-length'))
      )
        throw new Refusal(400, 'INVALID_REQUEST');
      if (!['/favourites', '/state'].includes(path) && request.url.includes('?'))
        throw new Refusal(400, 'INVALID_REQUEST');
      const key = this.cookie(request);
      let s = key ? (this.sessions.get(key) ?? null) : null;
      if (path === '/session') {
        if (s) {
          try {
            await this.call(s, (api, auth) => api.getAccount(auth), request);
          } catch {
            return this.response(401, { error: 'SIGN_IN_REQUIRED' }, this.cookieHeader('', 0));
          }
        }
        return this.response(200, this.publicSession(s));
      }
      if (path === '/sign-in') {
        const body = await this.readBody(request);
        let user: CustomerPreviewUser | undefined;
        try {
          const r = exact(body, ['userId']);
          user = this.config.users.find((x) => x.id === r.userId);
        } catch {
          throw new Refusal(400, 'INVALID_REQUEST');
        }
        if (!user) throw new Refusal(403, 'ACCOUNT_UNAVAILABLE');
        if (this.sessions.size >= 32 && !s) throw new Refusal(429, 'SESSION_LIMIT');
        const api = new CustomerFavouritesClient({
          baseUrl: this.config.apiOrigin,
          scope: { tenantId: this.config.tenantId, customerId: user.id },
          allowLoopbackHttp: true,
          fetch: this.transport,
        });
        await api.getAccount({ bearerToken: user.bearerToken, signal: request.signal });
        if (s && this.sessions.get(s.key) !== s) throw new Refusal(401, 'SIGN_IN_REQUIRED');
        this.prune();
        if (this.sessions.size >= 32 && !s) throw new Refusal(429, 'SESSION_LIMIT');
        if (s) this.dispose(s);
        const expires = Math.min(this.now() + 600000, Date.parse(this.config.expiresAt));
        s = {
          key: token(),
          csrf: token(),
          generation: token(),
          user,
          expires,
          pending: null,
          recoveryMissing: false,
          active: new Set(),
        };
        this.sessions.set(s.key, s);
        return this.response(
          200,
          this.publicSession(s),
          this.cookieHeader(s.key, Math.floor((expires - this.now()) / 1000)),
        );
      }
      if (!s) throw new Refusal(401, 'SIGN_IN_REQUIRED');
      if (post && request.headers.get('x-customer-csrf') !== s.csrf)
        throw new Refusal(403, 'CSRF_REFUSED');
      if (path === '/sign-out') {
        const r = await this.readBody(request);
        try {
          exact(r, []);
        } catch {
          throw new Refusal(400, 'INVALID_REQUEST');
        }
        this.dispose(s);
        return this.response(200, { signedOut: true }, this.cookieHeader('', 0));
      }
      if (path === '/state') {
        const keys = [...u.searchParams.keys()];
        const listing = u.searchParams.get('listing');
        if (keys.length !== 1 || keys[0] !== 'listing' || !listing || !uuid.test(listing))
          throw new Refusal(400, 'INVALID_REQUEST');
        return this.response(
          200,
          await this.call(s, (api, auth) => api.getFavourite(listing, auth), request),
        );
      }
      if (path === '/favourites') {
        const seen = new Set<string>();
        let limit = 20,
          after: string | undefined;
        for (const [k, v] of u.searchParams) {
          if (seen.has(k) || !['limit', 'after'].includes(k))
            throw new Refusal(400, 'INVALID_REQUEST');
          seen.add(k);
          if (k === 'limit') {
            if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(v)) throw new Refusal(400, 'INVALID_REQUEST');
            limit = Number(v);
          } else {
            if (!uuid.test(v)) throw new Refusal(400, 'INVALID_REQUEST');
            after = v;
          }
        }
        const result = await this.call(
          s,
          (api, auth) => api.listFavourites(auth, { limit, ...(after ? { after } : {}) }),
          request,
        );
        const summaries = [];
        for (const item of result.items) {
          if (!item.available) continue;
          try {
            const value = await this.summaryReader(item.listingId);
            if (value) summaries.push({ listingId: item.listingId, ...value });
          } catch {}
        }
        if (this.sessions.get(s.key) !== s || s.expires <= this.now())
          throw new Refusal(401, 'SIGN_IN_REQUIRED');
        return this.response(200, { page: result, summaries });
      }
      if (path === '/favourite') {
        let command: CustomerFavouriteCommand;
        try {
          command = validateCustomerFavouriteCommand(await this.readBody(request));
        } catch (e) {
          if (e instanceof Refusal) throw e;
          throw new Refusal(400, 'INVALID_REQUEST');
        }
        if (s.pending) throw new Refusal(409, 'ORIGINAL_PENDING');
        s.pending = command;
        s.recoveryMissing = false;
        try {
          const result = await this.call(
            s,
            (api, auth) => api.setFavourite(command, auth),
            request,
          );
          return this.response(200, result);
        } catch (e) {
          if (
            e instanceof CustomerApiError &&
            !e.submissionUncertain &&
            this.sessions.get(s.key) === s
          )
            s.pending = null;
          throw e;
        }
      }
      if (path === '/original') {
        if (!s.pending) throw new Refusal(404, 'ORIGINAL_UNAVAILABLE');
        const command = s.pending;
        try {
          const result = await this.call(
            s,
            (api, auth) => api.getFavouriteOriginal(command, auth),
            request,
          );
          s.recoveryMissing = false;
          return this.response(200, result);
        } catch (e) {
          if (e instanceof CustomerApiError && e.status === 404 && this.sessions.get(s.key) === s)
            s.recoveryMissing = true;
          throw e;
        }
      }
      if (path === '/retry') {
        let op: unknown;
        try {
          op = exact(await this.readBody(request), ['operationId']).operationId;
        } catch (e) {
          if (e instanceof Refusal) throw e;
          throw new Refusal(400, 'INVALID_REQUEST');
        }
        if (!s.pending || s.pending.operationId !== op || !s.recoveryMissing)
          throw new Refusal(409, 'ORIGINAL_PENDING');
        const command = s.pending;
        s.recoveryMissing = false;
        const result = await this.call(s, (api, auth) => api.setFavourite(command, auth), request);
        return this.response(200, result);
      }
      if (path === '/settle') {
        let op: unknown;
        try {
          op = exact(await this.readBody(request), ['operationId']).operationId;
        } catch (e) {
          if (e instanceof Refusal) throw e;
          throw new Refusal(400, 'INVALID_REQUEST');
        }
        if (!s.pending || s.pending.operationId !== op) throw new Refusal(409, 'ORIGINAL_PENDING');
        await this.call(s, (api, auth) => api.getFavouriteOriginal(s!.pending!, auth), request);
        s.pending = null;
        return this.response(200, { settled: true });
      }
      throw new Refusal(404, 'UNAVAILABLE');
    } catch (e) {
      if (e instanceof Refusal) return this.response(e.status, { error: e.code });
      if (e instanceof CustomerApiError)
        return this.response(e.submissionUncertain ? 503 : (e.status ?? 503), {
          error: e.submissionUncertain ? 'OUTCOME_UNKNOWN' : 'CUSTOMER_UNAVAILABLE',
          submissionUncertain: e.submissionUncertain,
        });
      return this.response(503, { error: 'CUSTOMER_UNAVAILABLE' });
    }
  }
}

/** Next's development adapter normalizes the URL hostname. Only the exact configured Host may be adapted. */
export function normalizeCustomerRouteRequest(request: Request, trustedOrigin: string): Request {
  const origin = loopbackOrigin(trustedOrigin);
  if (request.headers.get('host') !== new URL(origin).host) throw Error('Customer host refused.');
  const u = new URL(request.url);
  return new Request(origin + u.pathname + u.search + u.hash, request);
}
