import { CustomerApiError, CustomerFavouritesClient } from '@realtor/api-client';
import {
  parseCustomerFavouriteJson,
  validateCustomerFavouriteCommand,
  DomainError,
} from '@realtor/domain';
import type { CustomerOriginals } from './customer-browser-originals.js';
import { AuthenticationError } from './auth.js';
export interface HostedCustomerSession {
  readonly actorId: string;
  readonly tenantId: string;
  readonly accessToken: string;
  readonly csrf: string;
  readonly generation: string;
  readonly expiresAt: number;
}
interface Identity {
  authenticateSession(request: Request): Promise<HostedCustomerSession>;
  handle(request: Request): Promise<Response>;
}
class Refused extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const reply = (status: number, value: unknown) =>
  Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      Vary: 'Cookie',
      'X-Content-Type-Options': 'nosniff',
    },
  });
async function body(r: Request) {
  if (
    r.headers.get('content-type') !== 'application/json' ||
    r.headers.has('content-encoding') ||
    r.headers.has('transfer-encoding')
  )
    throw new Refused(400, 'INVALID_REQUEST');
  const length = r.headers.get('content-length');
  if (length !== null && (!/^(0|[1-9][0-9]{0,3})$/.test(length) || Number(length) > 2048))
    throw new Refused(400, 'INVALID_REQUEST');
  const reader = r.body?.getReader();
  if (!reader) throw new Refused(400, 'INVALID_REQUEST');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Refused(408, 'INVALID_REQUEST')), 5000);
  });
  try {
    const chunks: Uint8Array[] = [];
    let n = 0;
    while (true) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next.done) break;
      n += next.value.length;
      if (n > 2048) throw new Refused(400, 'INVALID_REQUEST');
      chunks.push(next.value);
    }
    if (length !== null && Number(length) !== n) throw new Refused(400, 'INVALID_REQUEST');
    const bytes = new Uint8Array(n);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    return parseCustomerFavouriteJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function exact(v: unknown, names: string[]): Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).sort().join(',') !== names.sort().join(',')
  )
    throw new Refused(400, 'INVALID_REQUEST');
  return v as Record<string, unknown>;
}
/** Explicit HTTPS deployment adapter. Session authority stays server-side; upstream checks live membership. */
export function createHostedCustomerBrowser(
  inputConfig: { applicationOrigin: string; apiOrigin: string; tenantId: string },
  identity: Identity,
  originals: CustomerOriginals,
  transport: typeof fetch = fetch,
  summaryReader: (listingId: string) => Promise<null | {
    title: string;
    priceMinor: number;
    purpose: string;
    rentalPeriod: string | null;
  }> = async () => null,
) {
  const config = Object.freeze({ ...inputConfig });
  for (const name of ['applicationOrigin', 'apiOrigin'] as const) {
    const u = new URL(config[name]);
    if (u.origin !== config[name] || u.protocol !== 'https:')
      throw Error('Hosted HTTPS origin required.');
  }
  if (!id.test(config.tenantId)) throw Error('Invalid hosted company.');
  return Object.freeze({
    tenantId: config.tenantId,
    async handle(request: Request): Promise<Response> {
      try {
        const u = new URL(request.url),
          origin = request.headers.get('origin'),
          site = request.headers.get('sec-fetch-site');
        if (
          u.origin !== config.applicationOrigin ||
          u.hash ||
          (origin !== null && origin !== config.applicationOrigin) ||
          (site !== null && !['same-origin', 'none'].includes(site))
        )
          throw new Refused(403, 'ORIGIN_REFUSED');
        for (const h of [
          'authorization',
          'x-actor-id',
          'x-tenant-id',
          'x-role',
          'range',
          'if-none-match',
        ])
          if (request.headers.has(h)) throw new Refused(400, 'INVALID_REQUEST');
        const path = u.pathname.slice('/api/customer'.length);
        const writes = ['/favourite', '/retry', '/settle', '/sign-out'];
        if (
          !u.pathname.startsWith('/api/customer/') ||
          !['/session', '/state', '/favourites', '/original', ...writes].includes(path)
        )
          throw new Refused(404, 'UNAVAILABLE');
        const post = writes.includes(path);
        if (request.method !== (post ? 'POST' : 'GET'))
          throw new Refused(405, 'METHOD_UNAVAILABLE');
        if (
          post &&
          (origin !== config.applicationOrigin ||
            request.headers.get('x-customer-intent') !== 'session-v1')
        )
          throw new Refused(403, 'ORIGIN_REFUSED');
        if (
          !post &&
          (request.body !== null ||
            request.headers.has('content-type') ||
            request.headers.has('content-length'))
        )
          throw new Refused(400, 'INVALID_REQUEST');
        if (!['/state', '/favourites'].includes(path) && u.search)
          throw new Refused(400, 'INVALID_REQUEST');
        if (path === '/sign-out') {
          exact(await body(request), []);
          const headers = new Headers(request.headers);
          headers.set('x-csrf-token', headers.get('x-customer-csrf') ?? '');
          const result = await identity.handle(
            new Request(config.applicationOrigin + '/auth/logout', {
              method: 'POST',
              headers,
              body: '{}',
              signal: request.signal,
            }),
          );
          if (!result.ok) throw new Refused(503, 'SIGN_OUT_UNCONFIRMED');
          const response = reply(200, { signedOut: true });
          for (const cookie of result.headers.getSetCookie())
            response.headers.append('Set-Cookie', cookie);
          return response;
        }
        const current = await identity.authenticateSession(request);
        if (current.tenantId !== config.tenantId || current.expiresAt <= Date.now())
          throw new Refused(401, 'SIGN_IN_REQUIRED');
        if (post && request.headers.get('x-customer-csrf') !== current.csrf)
          throw new Refused(403, 'CSRF_REFUSED');
        const scope = { tenantId: current.tenantId, actorId: current.actorId };
        const client = new CustomerFavouritesClient({
          baseUrl: config.apiOrigin,
          scope: { tenantId: current.tenantId, customerId: current.actorId },
          fetch: transport,
        });
        const auth = { bearerToken: current.accessToken, signal: request.signal };
        async function live() {
          if (request.signal.aborted) throw new Refused(401, 'SIGN_IN_REQUIRED');
          const next = await identity.authenticateSession(request);
          if (
            next.generation !== current.generation ||
            next.actorId !== current.actorId ||
            next.tenantId !== current.tenantId ||
            next.expiresAt <= Date.now() ||
            next.csrf !== current.csrf
          )
            throw new Refused(401, 'SIGN_IN_REQUIRED');
        }
        // Always check current company/customer membership through the protected API before pending-state access.
        await client.getAccount(auth);
        await live();
        let result: unknown;
        if (path === '/session')
          result = {
            policy: 'hosted-customer-browser-session-v1',
            account: {
              tenantId: current.tenantId,
              customerId: current.actorId,
              label: 'Your account',
              generation: current.generation,
              expiresAt: new Date(current.expiresAt).toISOString(),
            },
            csrf: current.csrf,
            pending: await originals.read(scope),
            choices: [],
          };
        else if (path === '/state') {
          const listing = u.searchParams.get('listing');
          if ([...u.searchParams.keys()].join(',') !== 'listing' || !listing || !id.test(listing))
            throw new Refused(400, 'INVALID_REQUEST');
          result = await client.getFavourite(listing, auth);
        } else if (path === '/favourites') {
          const seen = new Set<string>();
          let limit = 20,
            after: string | undefined;
          for (const [k, v] of u.searchParams) {
            if (seen.has(k) || !['limit', 'after'].includes(k))
              throw new Refused(400, 'INVALID_REQUEST');
            seen.add(k);
            if (k === 'limit') {
              if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(v)) throw new Refused(400, 'INVALID_REQUEST');
              limit = Number(v);
            } else {
              if (!id.test(v)) throw new Refused(400, 'INVALID_REQUEST');
              after = v;
            }
          }
          const page = await client.listFavourites(auth, { limit, ...(after ? { after } : {}) });
          const summaries = [];
          for (const item of page.items) {
            if (!item.available) continue;
            try {
              const summary = await summaryReader(item.listingId);
              if (summary) summaries.push({ listingId: item.listingId, ...summary });
            } catch {
              /* A public summary failure never exposes private listing details. */
            }
          }
          result = { page, summaries };
        } else if (path === '/favourite') {
          const command = validateCustomerFavouriteCommand(await body(request));
          if (!(await originals.reserve(scope, command)))
            throw new Refused(409, 'ORIGINAL_PENDING');
          await live();
          try {
            result = await client.setFavourite(command, auth);
          } catch (e) {
            if (
              e instanceof CustomerApiError &&
              !e.submissionUncertain &&
              ![401, 403].includes(e.status ?? 0)
            )
              await originals.clear(scope, command.operationId);
            throw e;
          }
        } else {
          const pending = await originals.read(scope);
          if (!pending) throw new Refused(404, 'ORIGINAL_UNAVAILABLE');
          if (path === '/original') {
            try {
              result = await client.getFavouriteOriginal(pending, auth);
              await live();
              await originals.recovered(scope, pending.operationId);
            } catch (e) {
              if (e instanceof CustomerApiError && e.status === 404) {
                await live();
                await originals.missing(scope, pending.operationId);
              }
              throw e;
            }
          } else {
            const operation = exact(await body(request), ['operationId']).operationId;
            if (operation !== pending.operationId) throw new Refused(409, 'ORIGINAL_PENDING');
            if (path === '/retry') {
              if (!(await originals.retry(scope, pending.operationId)))
                throw new Refused(409, 'ORIGINAL_PENDING');
              await live();
              result = await client.setFavourite(pending, auth);
            } else {
              await client.getFavouriteOriginal(pending, auth);
              await live();
              await originals.clear(scope, pending.operationId);
              result = { settled: true };
            }
          }
        }
        await client.getAccount(auth);
        await live();
        return reply(200, result);
      } catch (e) {
        if (e instanceof DomainError) return reply(400, { error: 'INVALID_REQUEST' });
        if (e instanceof AuthenticationError) return reply(401, { error: 'SIGN_IN_REQUIRED' });
        if (e instanceof Refused) return reply(e.status, { error: e.code });
        if (e instanceof CustomerApiError)
          return reply(e.submissionUncertain ? 503 : (e.status ?? 503), {
            error: e.submissionUncertain ? 'OUTCOME_UNKNOWN' : 'CUSTOMER_UNAVAILABLE',
            submissionUncertain: e.submissionUncertain,
          });
        return reply(503, { error: 'CUSTOMER_UNAVAILABLE' });
      }
    },
  });
}
