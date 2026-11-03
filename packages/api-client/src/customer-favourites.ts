import {
  parseCustomerFavouriteJson,
  validateCustomerAccount,
  validateCustomerFavouriteCommand,
  validateCustomerFavouriteReceipt,
  validateCustomerFavouriteState,
  validateCustomerFavouritesPage,
  type CustomerScope,
  type CustomerFavouriteCommand,
  type CustomerFavouriteReceipt,
  type CustomerFavouritesPage,
} from '@realtor/domain';
export class CustomerApiError extends Error {
  constructor(
    readonly kind:
      | 'validation'
      | 'unauthenticated'
      | 'forbidden'
      | 'not_found'
      | 'conflict'
      | 'limit'
      | 'unavailable'
      | 'invalid_response'
      | 'cancelled',
    readonly submissionUncertain = false,
    readonly status?: number,
  ) {
    super('Customer request unavailable.');
    this.name = 'CustomerApiError';
  }
}
export interface CustomerRequestOptions {
  readonly bearerToken: string;
  readonly signal?: AbortSignal;
}
export interface CustomerFavouritesClientOptions {
  readonly baseUrl: string;
  readonly scope: CustomerScope;
  readonly allowLoopbackHttp?: boolean;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}
function own(
  v: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
    throw new CustomerApiError('validation');
  const row: Record<string, unknown> = Object.create(null);
  const ks = Reflect.ownKeys(v);
  if (
    ks.some((k) => typeof k !== 'string' || ![...required, ...optional].includes(k)) ||
    required.some((k) => !ks.includes(k))
  )
    throw new CustomerApiError('validation');
  for (const k of ks) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) throw new CustomerApiError('validation');
    row[k as string] = d.value;
  }
  return row;
}
const id = (v: unknown): string => {
  if (
    typeof v !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)
  )
    throw new CustomerApiError('validation');
  return v;
};
/** Shared transport, no credential persistence, cookie auth, response caching or automatic mutation retry.
 * Expected scope binds replies only; server company/subject authority never comes from these values. */
export class CustomerFavouritesClient {
  private readonly origin: string;
  private readonly scope: CustomerScope;
  private readonly transport: typeof globalThis.fetch;
  private readonly timeout: number;
  constructor(input: CustomerFavouritesClientOptions) {
    const r = own(input, ['baseUrl', 'scope'], ['allowLoopbackHttp', 'timeoutMs', 'fetch']);
    if (typeof r.baseUrl !== 'string' || r.baseUrl !== r.baseUrl.trim() || /[\\\s]/.test(r.baseUrl))
      throw new CustomerApiError('validation');
    let url: URL;
    try {
      url = new URL(r.baseUrl);
    } catch {
      throw new CustomerApiError('validation');
    }
    if (r.allowLoopbackHttp !== undefined && typeof r.allowLoopbackHttp !== 'boolean')
      throw new CustomerApiError('validation');
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      !(
        url.protocol === 'https:' ||
        (r.allowLoopbackHttp === true &&
          url.protocol === 'http:' &&
          ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      )
    )
      throw new CustomerApiError('validation');
    const s = own(r.scope, ['tenantId', 'customerId']);
    this.scope = Object.freeze({ tenantId: id(s.tenantId), customerId: id(s.customerId) });
    this.origin = url.origin;
    this.timeout = r.timeoutMs === undefined ? 10000 : (r.timeoutMs as number);
    if (
      !Number.isSafeInteger(this.timeout) ||
      this.timeout < 1 ||
      this.timeout > 60000 ||
      (r.fetch !== undefined && typeof r.fetch !== 'function')
    )
      throw new CustomerApiError('validation');
    this.transport = (r.fetch as typeof globalThis.fetch | undefined) ?? globalThis.fetch;
  }
  private async request<T>(
    path: string,
    options: CustomerRequestOptions,
    validate: (v: unknown) => T,
    command?: CustomerFavouriteCommand,
  ): Promise<T> {
    const r = own(options, ['bearerToken'], ['signal']);
    if (
      typeof r.bearerToken !== 'string' ||
      r.bearerToken.length > 8192 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(r.bearerToken) ||
      (r.signal !== undefined && !(r.signal instanceof AbortSignal))
    )
      throw new CustomerApiError('validation');
    const signal = r.signal as AbortSignal | undefined;
    if (signal?.aborted) throw new CustomerApiError('cancelled');
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const write = command !== undefined,
      controller = new AbortController(),
      abort = () => {
        controller.abort();
        void activeReader?.cancel().catch(() => {});
      };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, this.timeout);
    let sent = false;
    try {
      sent = true;
      const response = await this.transport(this.origin + path, {
        method: write ? 'POST' : 'GET',
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + r.bearerToken,
          ...(write ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(write ? { body: JSON.stringify(command) } : {}),
      });
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw new CustomerApiError('cancelled', write);
      }
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {});
        const status = response.status;
        const known = [400, 401, 403, 404, 405, 409, 413, 429].includes(status);
        throw new CustomerApiError(
          status === 401
            ? 'unauthenticated'
            : status === 403
              ? 'forbidden'
              : status === 404
                ? 'not_found'
                : status === 409
                  ? 'conflict'
                  : status === 429
                    ? 'limit'
                    : known
                      ? 'validation'
                      : 'unavailable',
          write && !known,
          status,
        );
      }
      if (
        !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
          response.headers.get('content-type') ?? '',
        ) ||
        !response.headers
          .get('cache-control')
          ?.split(',')
          .some((x) => x.trim().toLowerCase() === 'no-store')
      ) {
        void response.body?.cancel().catch(() => {});
        throw new CustomerApiError('invalid_response', write);
      }
      const reader = response.body?.getReader();
      activeReader = reader;
      if (!reader) throw new CustomerApiError('invalid_response', write);
      let size = 0;
      const parts: Uint8Array[] = [];
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 32768) throw new CustomerApiError('invalid_response', write);
          parts.push(next.value);
        }
        const bytes = new Uint8Array(size);
        let at = 0;
        for (const part of parts) {
          bytes.set(part, at);
          at += part.length;
        }
        if (controller.signal.aborted) throw new CustomerApiError('cancelled', write);
        try {
          return validate(
            parseCustomerFavouriteJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
          );
        } catch (e) {
          if (e instanceof CustomerApiError) throw e;
          throw new CustomerApiError('invalid_response', write);
        }
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } catch (e) {
      if (e instanceof CustomerApiError) throw e;
      throw new CustomerApiError(
        controller.signal.aborted ? 'cancelled' : 'unavailable',
        write && sent,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
  async getAccount(options: CustomerRequestOptions) {
    return this.request('/v2/customer/account', options, (v) =>
      validateCustomerAccount(v, this.scope),
    );
  }
  async getFavourite(listingId: string, options: CustomerRequestOptions) {
    const target = id(listingId);
    return this.request('/v2/customer/favourites/' + target, options, (v) =>
      validateCustomerFavouriteState(v, this.scope, target),
    );
  }
  async listFavourites(
    options: CustomerRequestOptions,
    page: { readonly limit?: number; readonly after?: string } = {},
  ): Promise<CustomerFavouritesPage> {
    const p = own(page, [], ['limit', 'after']);
    const limit = p.limit ?? 20;
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new CustomerApiError('validation');
    const after = p.after === undefined ? null : id(p.after);
    return this.request(
      '/v2/customer/favourites?limit=' + limit + (after ? '&after=' + after : ''),
      options,
      (v) => validateCustomerFavouritesPage(v, this.scope, limit, after),
    );
  }
  async setFavourite(
    input: CustomerFavouriteCommand,
    options: CustomerRequestOptions,
  ): Promise<CustomerFavouriteReceipt> {
    let command: CustomerFavouriteCommand;
    try {
      command = validateCustomerFavouriteCommand(input);
    } catch {
      throw new CustomerApiError('validation');
    }
    return this.request(
      '/v2/customer/favourite-operations/' + command.operationId,
      options,
      (v) => validateCustomerFavouriteReceipt(v, command, this.scope),
      command,
    );
  }
  async getFavouriteOriginal(
    input: CustomerFavouriteCommand,
    options: CustomerRequestOptions,
  ): Promise<CustomerFavouriteReceipt> {
    let command: CustomerFavouriteCommand;
    try {
      command = validateCustomerFavouriteCommand(input);
    } catch {
      throw new CustomerApiError('validation');
    }
    return this.request('/v2/customer/favourite-operations/' + command.operationId, options, (v) =>
      validateCustomerFavouriteReceipt(v, command, this.scope),
    );
  }
}
