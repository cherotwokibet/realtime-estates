import {
  validateListingSuccessorCommand,
  validateListingSuccessorReceipt,
  type ListingSuccessorCommand,
  type ListingSuccessorReceipt,
} from '@realtor/api-client';
import { parseSuccessorJson } from './listing-successor-wire.ts';
export class ListingSuccessorError extends Error {
  constructor(
    readonly kind: 'validation' | 'network' | 'timeout' | 'cancelled' | 'response' | 'http',
    readonly status = 0,
    readonly uncertain = false,
  ) {
    super(
      kind === 'validation'
        ? 'Review the successor revision fields.'
        : 'The successor revision result could not be confirmed.',
    );
    this.name = 'ListingSuccessorError';
  }
}
export interface ListingSuccessorClient {
  create(input: ListingSuccessorCommand, signal?: AbortSignal): Promise<ListingSuccessorReceipt>;
  recover(input: ListingSuccessorCommand, signal?: AbortSignal): Promise<ListingSuccessorReceipt>;
}
export function createListingSuccessorClient(input: {
  instanceId: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): ListingSuccessorClient {
  if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
    throw new ListingSuccessorError('validation');
  const c: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !['instanceId', 'fetch', 'timeoutMs'].includes(key))
      throw new ListingSuccessorError('validation');
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) throw new ListingSuccessorError('validation');
    c[key] = d.value;
  }
  if (
    typeof c.instanceId !== 'string' ||
    !/^[-a-f0-9]{36}$/.test(c.instanceId) ||
    (c.fetch !== undefined && typeof c.fetch !== 'function')
  )
    throw new ListingSuccessorError('validation');
  const timeout = c.timeoutMs ?? 20000;
  if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1 || timeout > 30000)
    throw new ListingSuccessorError('validation');
  const timeoutMs: number = timeout;
  const transport = (c.fetch ??
      ((url: RequestInfo | URL, init?: RequestInit) =>
        globalThis.fetch(url, init))) as typeof fetch,
    instance = c.instanceId;
  async function run(
    write: boolean,
    input: ListingSuccessorCommand,
    signal?: AbortSignal,
  ): Promise<ListingSuccessorReceipt> {
    let command: ListingSuccessorCommand;
    try {
      command = validateListingSuccessorCommand(input);
      if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error();
    } catch {
      throw new ListingSuccessorError('validation');
    }
    if (signal?.aborted) throw new ListingSuccessorError('cancelled');
    const path = `/api/staff/listings/${command.listingId}/revision-operations/${command.operationId}`,
      controller = new AbortController();
    let dispatched = false,
      interrupted: ListingSuccessorError | undefined,
      reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let rejectStop: (e: ListingSuccessorError) => void = () => undefined;
    const stopped = new Promise<never>((_, reject) => {
      rejectStop = reject;
    });
    const stop = (kind: 'timeout' | 'cancelled') => {
      if (interrupted) return;
      interrupted = new ListingSuccessorError(kind, 0, write && dispatched);
      controller.abort();
      rejectStop(interrupted);
    };
    const cancel = () => stop('cancelled'),
      timer = setTimeout(() => stop('timeout'), timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    const invalid = (): never => {
      throw new ListingSuccessorError('response', 0, write);
    };
    const operation = (async () => {
      dispatched = true;
      let response: Response;
      try {
        response = await transport(path, {
          method: write ? 'POST' : 'GET',
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            'X-Preview-Instance': instance,
            ...(write ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(write
            ? {
                body: JSON.stringify({
                  expectedListingVersion: command.expectedListingVersion,
                  predecessor: command.predecessor,
                  content: command.content,
                }),
              }
            : {}),
        });
      } catch {
        throw new ListingSuccessorError('network', 0, write);
      }
      if (interrupted) {
        void response.body?.cancel().catch(() => undefined);
        throw interrupted;
      }
      try {
        if (
          response.redirected ||
          (response.status >= 300 && response.status < 400) ||
          response.headers.has('content-range') ||
          !/^application\/json(?:\s*;[^\r\n]*)?$/i.test(response.headers.get('content-type') ?? '')
        )
          return invalid();
        if (response.url) {
          const actual = new URL(response.url);
          if (
            actual.pathname + actual.search !== path ||
            actual.hash ||
            actual.username ||
            actual.password ||
            (typeof location !== 'undefined' && actual.origin !== location.origin)
          )
            return invalid();
        }
        const declared = response.headers.get('content-length'),
          encoding = response.headers.get('content-encoding');
        if (
          declared !== null &&
          (!/^(?:0|[1-9]\d*)$/.test(declared) || Number(declared) > 256 * 1024)
        )
          return invalid();
        reader = response.body?.getReader();
        if (!reader) return invalid();
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 256 * 1024) return invalid();
          chunks.push(value);
        }
        if (
          declared !== null &&
          (!encoding || encoding === 'identity') &&
          Number(declared) !== size
        )
          return invalid();
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const value of chunks) {
          bytes.set(value, offset);
          offset += value.byteLength;
        }
        let data: unknown;
        try {
          data = parseSuccessorJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        } catch {
          return invalid();
        }
        if (!response.ok) {
          const value = data as { error?: { code?: unknown }; submissionUncertain?: unknown };
          const known =
            value &&
            typeof value === 'object' &&
            typeof value.error?.code === 'string' &&
            typeof value.submissionUncertain === 'boolean';
          throw new ListingSuccessorError(
            'http',
            response.status,
            write && (!known || value.submissionUncertain === true),
          );
        }
        try {
          return validateListingSuccessorReceipt(data, command);
        } catch {
          return invalid();
        }
      } finally {
        try {
          void reader?.cancel().catch(() => undefined);
        } catch {
          /* Cleanup is not an acknowledgement. */
        }
      }
    })();
    try {
      return await Promise.race([operation, stopped]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      try {
        void reader?.cancel().catch(() => undefined);
      } catch {
        /* no-op */
      }
    }
  }
  return Object.freeze({
    create: (command: ListingSuccessorCommand, signal?: AbortSignal) => run(true, command, signal),
    recover: (command: ListingSuccessorCommand, signal?: AbortSignal) =>
      run(false, command, signal),
  });
}
