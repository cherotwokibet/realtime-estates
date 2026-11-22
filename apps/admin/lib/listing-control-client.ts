import { browserDecodedJsonLength } from './browser-decoded-json.ts';
import {
  validateListingControlCommand,
  validateListingControlReceipt,
  type ListingControlCommand,
  type ListingControlReceipt,
} from '@realtor/api-client';
import { parseControlJson } from './listing-control-wire.ts';
export class ListingControlError extends Error {
  constructor(
    readonly kind: 'validation' | 'network' | 'timeout' | 'cancelled' | 'response' | 'http',
    readonly status = 0,
    readonly uncertain = false,
  ) {
    super(
      kind === 'validation'
        ? 'Review the listing control fields.'
        : 'The listing control result could not be confirmed.',
    );
    this.name = 'ListingControlError';
  }
}
export interface ListingControlClient {
  create(input: ListingControlCommand, signal?: AbortSignal): Promise<ListingControlReceipt>;
  recover(input: ListingControlCommand, signal?: AbortSignal): Promise<ListingControlReceipt>;
}
export function createListingControlClient(input: {
  instanceId: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): ListingControlClient {
  if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
    throw new ListingControlError('validation');
  const c: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !['instanceId', 'fetch', 'timeoutMs'].includes(key))
      throw new ListingControlError('validation');
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) throw new ListingControlError('validation');
    c[key] = d.value;
  }
  if (
    typeof c.instanceId !== 'string' ||
    !/^[-a-f0-9]{36}$/.test(c.instanceId) ||
    (c.fetch !== undefined && typeof c.fetch !== 'function')
  )
    throw new ListingControlError('validation');
  const timeout = c.timeoutMs ?? 20000;
  if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1 || timeout > 30000)
    throw new ListingControlError('validation');
  const timeoutMs: number = timeout;
  const transport = (c.fetch ??
      ((url: RequestInfo | URL, init?: RequestInit) =>
        globalThis.fetch(url, init))) as typeof fetch,
    instance = c.instanceId;
  async function run(
    write: boolean,
    input: ListingControlCommand,
    signal?: AbortSignal,
  ): Promise<ListingControlReceipt> {
    let command: ListingControlCommand;
    try {
      command = validateListingControlCommand(input);
      if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error();
    } catch {
      throw new ListingControlError('validation');
    }
    if (signal?.aborted) throw new ListingControlError('cancelled');
    const path = `/api/staff/listings/${command.listingId}/${command.kind === 'confirm_availability' ? 'availability' : 'publication'}-operations/${command.operationId}`,
      controller = new AbortController();
    let dispatched = false,
      interrupted: ListingControlError | undefined,
      reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let rejectStop: (e: ListingControlError) => void = () => undefined;
    const stopped = new Promise<never>((_, reject) => {
      rejectStop = reject;
    });
    const stop = (kind: 'timeout' | 'cancelled') => {
      if (interrupted) return;
      interrupted = new ListingControlError(kind, 0, write && dispatched);
      controller.abort();
      rejectStop(interrupted);
    };
    const cancel = () => stop('cancelled'),
      timer = setTimeout(() => stop('timeout'), timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    const invalid = (): never => {
      throw new ListingControlError('response', 0, write);
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
                  ...(command.kind === 'confirm_availability'
                    ? { availability: command.availability }
                    : { publicationStatus: command.publicationStatus }),
                }),
              }
            : {}),
        });
      } catch {
        throw new ListingControlError('network', 0, write);
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
        let declared: number | null;
        try {
          declared = browserDecodedJsonLength(response, 16 * 1024);
        } catch {
          return invalid();
        }
        reader = response.body?.getReader();
        if (!reader) return invalid();
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 16 * 1024) return invalid();
          chunks.push(value);
        }
        if (declared !== null && Number(declared) !== size) return invalid();
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const value of chunks) {
          bytes.set(value, offset);
          offset += value.byteLength;
        }
        let data: unknown;
        try {
          data = parseControlJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
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
          throw new ListingControlError(
            'http',
            response.status,
            write && (!known || value.submissionUncertain === true),
          );
        }
        try {
          return validateListingControlReceipt(data, command);
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
    create: (command: ListingControlCommand, signal?: AbortSignal) => run(true, command, signal),
    recover: (command: ListingControlCommand, signal?: AbortSignal) => run(false, command, signal),
  });
}
