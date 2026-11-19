import { parseBearerHeader, AuthenticationError } from './auth.js';
import {
  createFirebaseSubjectVerifier,
  type FirebaseVerifiedSubject,
} from './firebase-identity.js';
import { readCloudRunInvocationEnvironment } from './cloud-run-invocation.js';
import {
  parseCustomerFavouriteJson,
  validateCustomerAccount,
  validateCustomerFavouriteCommand,
  validateCustomerFavouriteReceipt,
  validateCustomerFavouriteState,
  validateCustomerFavouritesPage,
  type CustomerFavouriteCommand,
} from '@realtor/domain';

export interface NativeCustomerGatewayConfig {
  readonly policy: 'native-customer-gateway-v1';
  readonly projectId: string;
  readonly tenantId: string;
  readonly applicationOrigin: string;
  readonly apiOrigin: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const failConfig = (): never => {
  throw Error('Native customer gateway configuration unavailable.');
};
export function validateNativeCustomerGatewayConfig(value: unknown): NativeCustomerGatewayConfig {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    return failConfig();
  const keys = ['policy', 'projectId', 'tenantId', 'applicationOrigin', 'apiOrigin'];
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length) return failConfig();
  const c: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const d = descriptors[key];
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return failConfig();
    c[key] = d.value;
  }
  if (
    c.policy !== 'native-customer-gateway-v1' ||
    typeof c.projectId !== 'string' ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(c.projectId) ||
    typeof c.tenantId !== 'string' ||
    !uuid.test(c.tenantId)
  )
    return failConfig();
  for (const name of ['applicationOrigin', 'apiOrigin']) {
    if (typeof c[name] !== 'string') return failConfig();
    let url: URL;
    try {
      url = new URL(c[name] as string);
    } catch {
      return failConfig();
    }
    if (url.protocol !== 'https:' || url.origin !== c[name] || url.port) return failConfig();
  }
  if (c.applicationOrigin === c.apiOrigin) return failConfig();
  return Object.freeze({ ...c }) as unknown as NativeCustomerGatewayConfig;
}
/** No credentials, preview fallback or unprotected run.app fetch. Disabled unless explicitly selected. */
export function readNativeCustomerGatewayEnvironment(
  env: Readonly<Record<string, string | undefined>>,
) {
  const raw = env.NATIVE_CUSTOMER_GATEWAY_CONFIG;
  if (raw === undefined) return null;
  try {
    if (
      raw.length > 4096 ||
      env.NODE_ENV !== 'production' ||
      env.APP_ENV !== 'staging' ||
      !env.K_SERVICE ||
      env.GOOGLE_APPLICATION_CREDENTIALS !== undefined ||
      env.FIREBASE_AUTH_EMULATOR_HOST !== undefined ||
      env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
      Object.entries(env).some(
        ([key, value]) =>
          value !== undefined &&
          (key.startsWith('STAFF_PREVIEW_') ||
            ['WEB_CUSTOMER_PREVIEW_CONFIG', 'API_MODE'].includes(key)),
      )
    )
      return failConfig();
    const config = validateNativeCustomerGatewayConfig(JSON.parse(raw));
    if (
      env.GOOGLE_CLOUD_PROJECT !== config.projectId ||
      !new URL(config.apiOrigin).hostname.endsWith('.run.app') ||
      !readCloudRunInvocationEnvironment(env, config.apiOrigin, config.projectId)
    )
      return failConfig();
    return config;
  } catch {
    return failConfig();
  }
}
class Refused extends Error {
  constructor(readonly status: number) {
    super('Customer request unavailable.');
  }
}
const reply = (status: number, value: unknown) =>
  Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      Vary: 'Authorization',
      'X-Content-Type-Options': 'nosniff',
    },
  });
const error = (status: number) =>
  reply(status, {
    error: { code: status === 401 ? 'UNAUTHENTICATED' : 'CUSTOMER_REQUEST_UNAVAILABLE' },
  });
/** Public bearer ingress, customer routes only. Backend still owns live company/actor binding. */
export function createNativeCustomerGateway(
  input: NativeCustomerGatewayConfig,
  dependencies: {
    transport: typeof fetch;
    verifySubject?: (token: string) => Promise<FirebaseVerifiedSubject>;
    timeoutMs?: number;
  },
) {
  const config = validateNativeCustomerGatewayConfig(input);
  const verify =
    dependencies.verifySubject ?? createFirebaseSubjectVerifier({ projectId: config.projectId });
  const timeout = dependencies.timeoutMs ?? 8000;
  if (
    typeof dependencies.transport !== 'function' ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 15000
  )
    return failConfig();
  return async (request: Request): Promise<Response> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new AbortController(),
      signal = AbortSignal.any([request.signal, deadline.signal]);
    let abort: (() => void) | undefined;
    const cancellation = new Promise<never>((_, reject) => {
      abort = () => reject(new Refused(request.signal.aborted ? 408 : 504));
    });
    // A listener is attached only once cancellation participates in a race.
    const race = <T>(pending: Promise<T>): Promise<T> => Promise.race([pending, cancellation]);
    async function json(stream: ReadableStream<Uint8Array> | null, max: number) {
      const reader = stream?.getReader();
      if (!reader) throw new Refused(400);
      try {
        const bytes = new Uint8Array(max);
        let size = 0,
          complete = false;
        for (let chunks = 0; chunks < 128; chunks++) {
          const next = await race(reader.read());
          if (next.done) {
            complete = true;
            break;
          }
          if (size + next.value.byteLength > max) throw new Refused(413);
          bytes.set(next.value, size);
          size += next.value.byteLength;
        }
        if (!complete) throw new Refused(413);
        return {
          value: parseCustomerFavouriteJson(
            new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)),
          ),
          size,
        };
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    try {
      if (signal.aborted) return error(408);
      const url = new URL(request.url);
      if (
        url.origin !== config.applicationOrigin ||
        url.hash ||
        url.pathname.includes('%') ||
        (request.headers.has('host') &&
          request.headers.get('host') !== new URL(config.applicationOrigin).host) ||
        (request.headers.has('origin') &&
          request.headers.get('origin') !== config.applicationOrigin) ||
        request.headers.get('sec-fetch-site') === 'cross-site'
      )
        return error(403);
      const headerNames: string[] = [];
      request.headers.forEach((_, key) => headerNames.push(key));
      for (const key of headerNames)
        if (
          [
            'cookie',
            'x-actor-id',
            'x-tenant-id',
            'x-role',
            'x-company-id',
            'x-serverless-authorization',
            'x-forwarded-authorization',
          ].includes(key) ||
          key.startsWith('x-realtor-') ||
          key.startsWith('x-preview-')
        )
          return error(400);
      const account = url.pathname === '/v2/customer/account';
      const list = url.pathname === '/v2/customer/favourites';
      const state = /^\/v2\/customer\/favourites\/([^/]+)$/.exec(url.pathname);
      const original = /^\/v2\/customer\/favourite-operations\/([^/]+)$/.exec(url.pathname);
      if (!(
        account ||
        list ||
        (state && uuid.test(state[1]!)) ||
        (original && uuid.test(original[1]!))
      ))
        return error(404);
      if (!(request.method === 'GET' || (original && request.method === 'POST'))) return error(405);
      let limit = 20,
        after: string | null = null;
      if (list) {
        for (const key of url.searchParams.keys())
          if (!['limit', 'after'].includes(key) || url.searchParams.getAll(key).length !== 1)
            return error(400);
        const raw = url.searchParams.get('limit');
        if (raw !== null && (!/^[1-9]\d?$/.test(raw) || Number(raw) > 50)) return error(400);
        limit = raw === null ? 20 : Number(raw);
        after = url.searchParams.get('after');
        if (after !== null && !uuid.test(after)) return error(400);
      } else if (url.search) return error(400);
      if (request.headers.has('content-encoding') || request.headers.has('transfer-encoding'))
        return error(400);
      const length = request.headers.get('content-length');
      if (request.method === 'GET' && (request.body || (length !== null && length !== '0')))
        return error(400);
      const token = parseBearerHeader(request.headers.get('authorization') ?? undefined);
      if (
        request.method === 'POST' &&
        (request.headers.get('content-type') !== 'application/json' ||
          (length !== null && (!/^(0|[1-9]\d{0,3})$/.test(length) || Number(length) > 2048)))
      )
        return error(400);
      signal.addEventListener('abort', abort!, { once: true });
      timer = setTimeout(() => deadline.abort(), timeout);
      if (signal.aborted) throw new Refused(408);
      let command: CustomerFavouriteCommand | undefined;
      if (request.method === 'POST') {
        let body: Awaited<ReturnType<typeof json>>;
        try {
          body = await json(request.body, 2048);
        } catch (e) {
          if (e instanceof Refused) throw e;
          throw new Refused(400);
        }
        if (length !== null && Number(length) !== body.size) throw new Refused(400);
        try {
          command = validateCustomerFavouriteCommand(body.value);
        } catch {
          throw new Refused(400);
        }
        if (command.operationId !== original![1]) throw new Refused(400);
      }
      const verified = await race(verify(token));
      if (
        verified.subject.projectId !== config.projectId ||
        verified.subject.authTenantId !== null ||
        typeof verified.subject.uid !== 'string' ||
        !verified.subject.uid ||
        verified.expiresAt <= Date.now()
      )
        throw new AuthenticationError();
      if (signal.aborted) throw new Refused(408);
      const target =
        config.apiOrigin +
        url.pathname +
        (list ? '?limit=' + limit + (after ? '&after=' + after : '') : '');
      const headers = {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json',
        ...(command ? { 'Content-Type': 'application/json' } : {}),
      };
      const pending = dependencies.transport(target, {
        method: request.method,
        headers,
        signal,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        ...(command ? { body: JSON.stringify(command) } : {}),
      });
      void pending.then(
        (response) => {
          if (signal.aborted) void response.body?.cancel().catch(() => {});
        },
        () => {},
      );
      const response = await race(pending);
      if (
        response.redirected ||
        (response.url && response.url !== target) ||
        (response.status >= 300 && response.status < 400)
      ) {
        void response.body?.cancel().catch(() => {});
        throw new Refused(502);
      }
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {});
        return error(
          [400, 401, 403, 404, 405, 409, 413, 429, 503].includes(response.status)
            ? response.status
            : 502,
        );
      }
      if (
        !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
          response.headers.get('content-type') ?? '',
        ) ||
        !response.headers
          .get('cache-control')
          ?.split(',')
          .some((v) => v.trim().toLowerCase() === 'no-store') ||
        response.headers.has('set-cookie')
      ) {
        void response.body?.cancel().catch(() => {});
        throw new Refused(502);
      }
      let value: unknown;
      try {
        const body = (await json(response.body, 32768)).value as Record<string, unknown>;
        const scope = { tenantId: config.tenantId, customerId: body.customerId as string };
        if (account) value = validateCustomerAccount(body, scope);
        else if (list) value = validateCustomerFavouritesPage(body, scope, limit, after);
        else if (state) value = validateCustomerFavouriteState(body, scope, state[1]!);
        else {
          const expected =
            command ??
            validateCustomerFavouriteCommand({
              policy: 'customer-favourite-command-v1',
              operationId: original![1],
              listingId: body.listingId,
              expectedVersion: body.expectedVersion,
              saved: body.requestedSaved,
            });
          value = validateCustomerFavouriteReceipt(body, expected, scope);
        }
      } catch (e) {
        if (e instanceof Refused && [408, 504].includes(e.status)) throw e;
        throw new Refused(502);
      }
      return reply(200, value);
    } catch (e) {
      return error(e instanceof AuthenticationError ? 401 : e instanceof Refused ? e.status : 502);
    } finally {
      clearTimeout(timer);
      if (abort) signal.removeEventListener('abort', abort);
    }
  };
}
