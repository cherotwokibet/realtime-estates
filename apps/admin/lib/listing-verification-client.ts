import {
  validateListingVerificationCommand,
  validateListingVerificationReceipt,
  validateListingVerificationHistory,
  type ListingVerificationCommand,
  type ListingVerificationReceipt,
  type ListingVerificationHistory,
} from '@realtor/domain';
import { parseVerificationJson } from './listing-verification-wire.ts';

export class ListingVerificationError extends Error {
  constructor(
    readonly kind: 'validation' | 'network' | 'timeout' | 'cancelled' | 'response' | 'http',
    readonly status = 0,
    readonly uncertain = false,
  ) {
    super(
      kind === 'validation'
        ? 'Review the synthetic assessment fields.'
        : 'The private assessment result could not be confirmed.',
    );
    this.name = 'ListingVerificationError';
  }
}
export interface ListingVerificationClient {
  create(
    command: ListingVerificationCommand,
    signal?: AbortSignal,
  ): Promise<ListingVerificationReceipt>;
  recover(
    command: ListingVerificationCommand,
    signal?: AbortSignal,
  ): Promise<ListingVerificationReceipt>;
  history(
    listingId: string,
    limit: number,
    beforeVersion?: string | null,
    signal?: AbortSignal,
  ): Promise<ListingVerificationHistory>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function createListingVerificationClient(input: {
  instanceId: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): ListingVerificationClient {
  if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
    throw new ListingVerificationError('validation');
  const config: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !['instanceId', 'fetch', 'timeoutMs'].includes(key))
      throw new ListingVerificationError('validation');
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value'))
      throw new ListingVerificationError('validation');
    config[key] = d.value;
  }
  const instance = config.instanceId,
    timeout = config.timeoutMs ?? 20000;
  if (
    typeof instance !== 'string' ||
    !uuid.test(instance) ||
    typeof timeout !== 'number' ||
    !Number.isInteger(timeout) ||
    timeout < 1 ||
    timeout > 30000 ||
    (config.fetch !== undefined && typeof config.fetch !== 'function')
  )
    throw new ListingVerificationError('validation');
  const timeoutMs: number = timeout,
    instanceId: string = instance;
  const transport = (config.fetch ??
    ((url: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(url, init))) as typeof fetch;
  async function request<T>(
    path: string,
    write: boolean,
    body: string | undefined,
    validate: (input: unknown) => T,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal !== undefined && !(signal instanceof AbortSignal))
      throw new ListingVerificationError('validation');
    if (signal?.aborted) throw new ListingVerificationError('cancelled');
    const controller = new AbortController();
    let dispatched = false,
      reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
      interrupted: ListingVerificationError | undefined;
    let rejectStop: (error: ListingVerificationError) => void = () => {};
    const stopped = new Promise<never>((_, reject) => {
      rejectStop = reject;
    });
    const stop = (kind: 'timeout' | 'cancelled') => {
      if (interrupted) return;
      interrupted = new ListingVerificationError(kind, 0, write && dispatched);
      controller.abort();
      rejectStop(interrupted);
    };
    const cancel = () => stop('cancelled'),
      timer = setTimeout(() => stop('timeout'), timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    const invalid = (): never => {
      throw new ListingVerificationError('response', 0, write && dispatched);
    };
    try {
      dispatched = true;
      const pending = Promise.resolve()
        .then(() =>
          transport(path, {
            method: write ? 'POST' : 'GET',
            signal: controller.signal,
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
            headers: {
              Accept: 'application/json',
              'X-Preview-Instance': instanceId,
              ...(write ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(write ? { body } : {}),
          }),
        )
        .then(
          (response) => {
            if (interrupted) {
              void response.body?.cancel().catch(() => {});
              throw interrupted;
            }
            return response;
          },
          () => {
            throw new ListingVerificationError('network', 0, write);
          },
        );
      const response = await Promise.race([pending, stopped]);
      reader = response.body?.getReader();
      if (
        response.redirected ||
        response.headers.has('content-range') ||
        response.headers.has('content-encoding') ||
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
          response.headers.get('content-type') ?? '',
        )
      )
        return invalid();
      if (response.url) {
        const actual = new URL(response.url);
        if (
          actual.pathname + actual.search !== path ||
          actual.hash ||
          actual.username ||
          actual.password ||
          !['http:', 'https:'].includes(actual.protocol) ||
          (typeof location !== 'undefined' && actual.origin !== location.origin)
        )
          return invalid();
      }
      const maximum = 1048576,
        declared = response.headers.get('content-length');
      if (declared !== null && (!/^(0|[1-9]\d*)$/.test(declared) || Number(declared) > maximum))
        return invalid();
      if (!reader) return invalid();
      const bytes = new Uint8Array(maximum);
      let size = 0,
        emptyReads = 0;
      for (;;) {
        const part = await Promise.race([reader.read(), stopped]);
        if (part.done) break;
        if (part.value.byteLength === 0) {
          if (++emptyReads % 64 === 0)
            await Promise.race([new Promise((resolve) => setTimeout(resolve, 0)), stopped]);
          continue;
        }
        if (size + part.value.byteLength > maximum) return invalid();
        bytes.set(part.value, size);
        size += part.value.byteLength;
      }
      if (declared !== null && Number(declared) !== size) return invalid();
      let data: unknown;
      try {
        data = parseVerificationJson(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)),
        );
      } catch {
        return invalid();
      }
      if (response.status !== 200) {
        if (response.status < 400 || response.status > 599) return invalid();
        const value = data as { error?: { code?: unknown }; submissionUncertain?: unknown };
        throw new ListingVerificationError(
          'http',
          response.status,
          write &&
            (!value ||
              typeof value.error?.code !== 'string' ||
              value.submissionUncertain !== false),
        );
      }
      try {
        return validate(data);
      } catch {
        return invalid();
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      if (reader) {
        try {
          void reader.cancel().catch(() => {});
          reader.releaseLock();
        } catch {
          /* Cleanup is not an acknowledgement. */
        }
      }
    }
  }
  async function operation(
    write: boolean,
    input: ListingVerificationCommand,
    signal?: AbortSignal,
  ) {
    let command: ListingVerificationCommand;
    try {
      command = validateListingVerificationCommand(input);
    } catch {
      throw new ListingVerificationError('validation');
    }
    return request(
      `/api/staff/listings/${command.target.listingId}/verification-operations/${command.operationId}`,
      write,
      write ? JSON.stringify(command) : undefined,
      (data) => validateListingVerificationReceipt(data, command),
      signal,
    );
  }
  return Object.freeze({
    create: (command: ListingVerificationCommand, signal?: AbortSignal) =>
      operation(true, command, signal),
    recover: (command: ListingVerificationCommand, signal?: AbortSignal) =>
      operation(false, command, signal),
    history: async (
      listingId: string,
      limit: number,
      beforeVersion: string | null = null,
      signal?: AbortSignal,
    ) => {
      if (
        typeof listingId !== 'string' ||
        !uuid.test(listingId) ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 25 ||
        (beforeVersion !== null &&
          (typeof beforeVersion !== 'string' ||
            !/^[1-9]\d{0,15}$/.test(beforeVersion) ||
            BigInt(beforeVersion) > 9007199254740991n))
      )
        throw new ListingVerificationError('validation');
      const path = `/api/staff/listings/${listingId}/verification-history?limit=${limit}${beforeVersion === null ? '' : `&beforeVersion=${beforeVersion}`}`;
      return request(
        path,
        false,
        undefined,
        (data) => validateListingVerificationHistory(data, listingId, limit, beforeVersion),
        signal,
      );
    },
  });
}
