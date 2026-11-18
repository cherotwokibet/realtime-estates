import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import {
  validateStaffBranchCommand,
  validateStaffBranchRecord,
  validateStaffDirectoryQuery,
} from '@realtor/domain';
import { AuthenticationError } from './auth.js';
import { BrowserRequestError as Refused, readHostedBrowserJson } from './hosted-browser-request.js';
import type { HostedCustomerSession as HostedSession } from './hosted-customer-browser.js';
import type { StaffOriginals } from './staff-browser-originals.js';
interface Identity {
  authenticateSession(request: Request): Promise<HostedSession>;
  handle(request: Request): Promise<Response>;
}
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
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Branch administration only. Existing staff/invitation/draft preview boundaries stay separate. */
export function createHostedStaffBrowser(
  input: {
    applicationOrigin: string;
    apiOrigin: string;
    tenantId: string;
    privacyNoticeVersion: string;
  },
  identity: Identity,
  originals: StaffOriginals,
  transport: typeof fetch = fetch,
) {
  const config = Object.freeze({ ...input });
  for (const name of ['applicationOrigin', 'apiOrigin'] as const) {
    const u = new URL(config[name]);
    if (u.origin !== config[name] || u.protocol !== 'https:')
      throw Error('Hosted HTTPS origin required.');
  }
  if (!uuid.test(config.tenantId) || !config.privacyNoticeVersion.trim())
    throw Error('Invalid staff scope.');
  return Object.freeze({
    tenantId: config.tenantId,
    async handle(request: Request): Promise<Response> {
      try {
        const u = new URL(request.url),
          supplied = request.headers.get('origin'),
          site = request.headers.get('sec-fetch-site');
        if (
          u.origin !== config.applicationOrigin ||
          u.hash ||
          (supplied !== null && supplied !== config.applicationOrigin) ||
          (site !== null && !['same-origin', 'none'].includes(site))
        )
          throw new Refused(403, 'ORIGIN_REFUSED');
        for (const h of [
          'authorization',
          'x-role',
          'x-actor-id',
          'x-tenant-id',
          'x-preview-instance',
          'range',
          'if-none-match',
        ])
          if (request.headers.has(h)) throw new Refused(400, 'INVALID_REQUEST');
        const prefix = '/api/hosted-staff/',
          path = u.pathname.slice(prefix.length);
        const writes = ['command', 'retry', 'settle', 'sign-out'];
        if (
          !u.pathname.startsWith(prefix) ||
          !['session', 'branches', 'branch', 'original', ...writes].includes(path)
        )
          throw new Refused(404, 'UNAVAILABLE');
        const post = writes.includes(path);
        if (request.method !== (post ? 'POST' : 'GET'))
          throw new Refused(405, 'METHOD_UNAVAILABLE');
        if (
          post &&
          (supplied !== config.applicationOrigin ||
            request.headers.get('x-staff-intent') !== 'hosted-staff-v1')
        )
          throw new Refused(403, 'ORIGIN_REFUSED');
        if (
          !post &&
          (request.body !== null ||
            request.headers.has('content-type') ||
            request.headers.has('content-length'))
        )
          throw new Refused(400, 'INVALID_REQUEST');
        if (!['branch', 'branches'].includes(path) && u.search)
          throw new Refused(400, 'INVALID_REQUEST');
        if (path === 'sign-out') {
          const value = await readHostedBrowserJson(request);
          if (
            !value ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            Object.keys(value).length
          )
            throw new Refused(400, 'INVALID_REQUEST');
          const headers = new Headers(request.headers);
          headers.set('x-csrf-token', headers.get('x-staff-csrf') ?? '');
          const r = await identity.handle(
            new Request(config.applicationOrigin + '/auth/logout', {
              method: 'POST',
              headers,
              body: '{}',
              signal: request.signal,
            }),
          );
          if (!r.ok) throw new Refused(503, 'SIGN_OUT_UNCONFIRMED');
          const response = reply(200, { signedOut: true });
          for (const cookie of r.headers.getSetCookie())
            response.headers.append('Set-Cookie', cookie);
          return response;
        }
        const session = await identity.authenticateSession(request);
        if (session.tenantId !== config.tenantId || session.expiresAt <= Date.now())
          throw new Refused(401, 'SIGN_IN_REQUIRED');
        if (post && request.headers.get('x-staff-csrf') !== session.csrf)
          throw new Refused(403, 'CSRF_REFUSED');
        const scope = { tenantId: session.tenantId, actorId: session.actorId },
          auth = { bearerToken: session.accessToken, signal: request.signal };
        const api = new RealtorApiClient({
          baseUrl: config.apiOrigin,
          privacyNoticeVersion: config.privacyNoticeVersion,
          fetch: transport,
          timeoutMs: 10000,
        });
        async function live() {
          const next = await identity.authenticateSession(request);
          if (
            request.signal.aborted ||
            next.generation !== session.generation ||
            next.actorId !== session.actorId ||
            next.tenantId !== session.tenantId ||
            next.csrf !== session.csrf ||
            next.expiresAt <= Date.now()
          )
            throw new Refused(401, 'SIGN_IN_REQUIRED');
        }
        async function admin() {
          const current = await api.getCurrentStaffSessionV2(auth);
          if (current.tenantId !== session.tenantId || current.actorId !== session.actorId)
            throw new Refused(403, 'STAFF_SCOPE_REFUSED');
          // This read enforces current company-admin policy in SQL, never a posted/token role.
          await api.listStaffBranches({ limit: 1, after: null }, auth);
          await live();
        }
        await admin();
        let result: unknown;
        const validateReceipt = (
          value: unknown,
          command: Parameters<StaffOriginals['reserve']>[1],
        ) => validateStaffBranchRecord(value, command, session.actorId);
        if (path === 'session')
          result = {
            policy: 'hosted-staff-session-v1',
            account: {
              tenantId: session.tenantId,
              actorId: session.actorId,
              generation: session.generation,
              expiresAt: new Date(session.expiresAt).toISOString(),
            },
            csrf: session.csrf,
            pending: await originals.read(scope),
          };
        else if (path === 'branches') {
          const keys = [...u.searchParams.keys()];
          const rawLimit = u.searchParams.get('limit');
          if (rawLimit !== null && !/^(?:[1-9]|1[0-9]|20)$/.test(rawLimit))
            throw new Refused(400, 'INVALID_REQUEST');
          if (
            keys.some((k) => !['limit', 'after'].includes(k)) ||
            new Set(keys).size !== keys.length
          )
            throw new Refused(400, 'INVALID_REQUEST');
          let query;
          try {
            query = validateStaffDirectoryQuery({
              limit: u.searchParams.has('limit') ? Number(u.searchParams.get('limit')) : 10,
              after: u.searchParams.get('after'),
            });
          } catch {
            throw new Refused(400, 'INVALID_REQUEST');
          }
          result = { page: await api.listStaffBranches(query, auth) };
        } else if (path === 'branch') {
          const id = u.searchParams.get('id');
          if ([...u.searchParams.keys()].join(',') !== 'id' || !id || !uuid.test(id))
            throw new Refused(400, 'INVALID_REQUEST');
          result = { branch: await api.getStaffBranch(id, auth) };
        } else if (path === 'command') {
          let command;
          try {
            command = validateStaffBranchCommand(await readHostedBrowserJson(request, 8192));
          } catch (e) {
            if (e instanceof Refused) throw e;
            throw new Refused(400, 'INVALID_COMMAND');
          }
          if (!(await originals.reserve(scope, command)))
            throw new Refused(409, 'ORIGINAL_PENDING');
          await live();
          try {
            result = {
              receipt: validateReceipt(await api.saveStaffBranch(command, auth), command),
            };
          } catch (e) {
            if (
              e instanceof ApiClientError &&
              !e.submissionUncertain &&
              ![401, 403].includes(e.status ?? 0)
            )
              await originals.clear(scope, command.operationId);
            throw e;
          }
        } else {
          const command = await originals.read(scope);
          if (!command) throw new Refused(404, 'ORIGINAL_UNAVAILABLE');
          if (path === 'original') {
            try {
              result = {
                receipt: validateReceipt(
                  await api.getStaffBranchOperation(command.operationId, auth),
                  command,
                ),
              };
              await live();
              await originals.recovered(scope, command.operationId);
            } catch (e) {
              if (e instanceof ApiClientError && e.status === 404) {
                await live();
                await originals.missing(scope, command.operationId);
              }
              throw e;
            }
          } else {
            const raw = await readHostedBrowserJson(request);
            if (
              !raw ||
              typeof raw !== 'object' ||
              Array.isArray(raw) ||
              Object.keys(raw).join(',') !== 'operationId' ||
              (raw as { operationId: unknown }).operationId !== command.operationId
            )
              throw new Refused(400, 'INVALID_REQUEST');
            if (path === 'retry') {
              if (!(await originals.retry(scope, command.operationId)))
                throw new Refused(409, 'RECOVER_ORIGINAL_FIRST');
              await live();
              result = {
                receipt: validateReceipt(await api.saveStaffBranch(command, auth), command),
              };
            } else {
              validateReceipt(
                await api.getStaffBranchOperation(command.operationId, auth),
                command,
              );
              await admin();
              await originals.clear(scope, command.operationId);
              result = { settled: true };
            }
          }
        }
        await admin();
        return reply(200, result);
      } catch (e) {
        if (e instanceof AuthenticationError) return reply(401, { error: 'SIGN_IN_REQUIRED' });
        if (e instanceof Refused) return reply(e.status, { error: e.code });
        if (e instanceof ApiClientError)
          return reply(e.submissionUncertain ? 503 : (e.status ?? 503), {
            error: e.submissionUncertain ? 'OUTCOME_UNKNOWN' : 'STAFF_UNAVAILABLE',
            submissionUncertain: e.submissionUncertain,
          });
        return reply(503, { error: 'STAFF_UNAVAILABLE' });
      }
    },
  });
}
