import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { isProxy, isSharedArrayBuffer, isUint8Array } from 'node:util/types';

export type SyntheticUploadBodyErrorCode =
  | 'INVALID_INPUT'
  | 'EMPTY_INPUT'
  | 'INPUT_TOO_LARGE'
  | 'LENGTH_MISMATCH'
  | 'ABORTED'
  | 'TIMED_OUT'
  | 'READ_FAILED';
export class SyntheticUploadBodyError extends Error {
  override readonly name = 'SyntheticUploadBodyError';
  constructor(readonly code: SyntheticUploadBodyErrorCode) {
    super(`Synthetic upload body: ${code}.`);
  }
}
export interface SyntheticUploadBodyOptions {
  readonly signal?: AbortSignal;
  readonly declaredBytes?: number;
  readonly timeoutMs?: number;
}

const MAX_BYTES = 10 * 1024 * 1024,
  DEFAULT_TIMEOUT_MS = 15000,
  MAX_TIMEOUT_MS = 30000;
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const addEvent = EventTarget.prototype.addEventListener,
  removeEvent = EventTarget.prototype.removeEventListener;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const arrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!;
const byteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')!.get!;
const byteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!;
const copyBytes = Uint8Array.prototype.set;
const clock = performance.now.bind(performance);
function fail(code: SyntheticUploadBodyErrorCode): never {
  throw new SyntheticUploadBodyError(code);
}
function optionsSnapshot(
  input: SyntheticUploadBodyOptions,
): SyntheticUploadBodyOptions & { readonly timeoutMs: number } {
  try {
    if (
      !input ||
      typeof input !== 'object' ||
      isProxy(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
    )
      fail('INVALID_INPUT');
    const values: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== 'string' || !['signal', 'declaredBytes', 'timeoutMs'].includes(key))
        fail('INVALID_INPUT');
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('INVALID_INPUT');
      values[key] = descriptor.value;
    }
    const timeout = values.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : values.timeoutMs;
    if (
      typeof timeout !== 'number' ||
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > MAX_TIMEOUT_MS
    )
      fail('INVALID_INPUT');
    const declared = values.declaredBytes;
    if (declared !== undefined) {
      if (typeof declared !== 'number' || !Number.isSafeInteger(declared) || declared < 1)
        fail('INVALID_INPUT');
      if (declared > MAX_BYTES) fail('INPUT_TOO_LARGE');
    }
    const signal = values.signal;
    if (signal !== undefined) {
      if (isProxy(signal)) fail('INVALID_INPUT');
      try {
        Reflect.apply(aborted, signal, []);
      } catch {
        fail('INVALID_INPUT');
      }
    }
    return Object.freeze({
      timeoutMs: timeout,
      ...(declared === undefined ? {} : { declaredBytes: declared as number }),
      ...(signal === undefined ? {} : { signal: signal as AbortSignal }),
    });
  } catch (error) {
    if (error instanceof SyntheticUploadBodyError) throw error;
    return fail('INVALID_INPUT');
  }
}

/**
 * Bounded byte collection only: this grants no identity, storage or provenance.
 * The caller must authorize before invoking it and bound concurrent admissions.
 * Deadlines interrupt asynchronous waits, not arbitrary synchronous producer code.
 */
export async function readSyntheticUploadBody(
  source: AsyncIterable<Uint8Array>,
  options: SyntheticUploadBodyOptions = {},
): Promise<Buffer> {
  const config = optionsSnapshot(options),
    signal = config.signal;
  if (signal && Reflect.apply(aborted, signal, [])) fail('ABORTED');
  const deadline = clock() + config.timeoutMs;
  let stopped: SyntheticUploadBodyErrorCode | undefined,
    rejectStopped: (error: SyntheticUploadBodyError) => void = () => undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectStopped = reject;
  });
  // Validation/factory failure can end the call before a race consumes this promise.
  void cancellation.catch(() => undefined);
  const stop = (code: 'ABORTED' | 'TIMED_OUT') => {
    if (!stopped) {
      stopped = code;
      rejectStopped(new SyntheticUploadBodyError(code));
    }
  };
  const onAbort = () => {
    if (signal && Reflect.apply(aborted, signal, [])) stop('ABORTED');
  };
  const timer = setTimeout(() => stop('TIMED_OUT'), config.timeoutMs);
  let iterator: AsyncIterator<Uint8Array> | undefined,
    complete = false,
    listener = false;
  const check = () => {
    if (!stopped && signal && Reflect.apply(aborted, signal, [])) stop('ABORTED');
    if (!stopped && clock() >= deadline) stop('TIMED_OUT');
    if (stopped) fail(stopped);
  };
  try {
    if (signal) {
      Reflect.apply(addEvent, signal, ['abort', onAbort, { once: true }]);
      listener = true;
    }
    check();
    let next: AsyncIterator<Uint8Array>['next'];
    try {
      if (!source || (typeof source !== 'object' && typeof source !== 'function'))
        fail('INVALID_INPUT');
      const factory = source[Symbol.asyncIterator];
      if (typeof factory !== 'function') fail('INVALID_INPUT');
      const created: unknown = Reflect.apply(factory, source, []);
      if (!created || (typeof created !== 'object' && typeof created !== 'function'))
        fail('INVALID_INPUT');
      iterator = created as AsyncIterator<Uint8Array>;
      next = iterator.next;
      if (typeof next !== 'function') fail('INVALID_INPUT');
    } catch (error) {
      if (error instanceof SyntheticUploadBodyError) throw error;
      return fail('READ_FAILED');
    }
    let collected: Buffer | undefined,
      total = 0;
    for (;;) {
      check();
      const pending = Promise.resolve()
        .then(() => {
          check();
          return Reflect.apply(next, iterator, []) as
            PromiseLike<IteratorResult<Uint8Array>> | IteratorResult<Uint8Array>;
        })
        .catch(() => {
          if (stopped) fail(stopped);
          return fail('READ_FAILED');
        });
      // A losing producer rejection remains handled after abort/deadline has won.
      const result = await Promise.race([pending, cancellation]);
      check();
      let done: unknown, chunk: unknown;
      try {
        if (!result || typeof result !== 'object') fail('READ_FAILED');
        done = result.done;
        if (!done) chunk = result.value;
      } catch {
        return fail('READ_FAILED');
      }
      if (done) {
        complete = true;
        break;
      }
      if (!isUint8Array(chunk)) fail('INVALID_INPUT');
      let bytes: number, view: Uint8Array;
      try {
        const buffer = Reflect.apply(arrayBuffer, chunk, []) as ArrayBuffer;
        bytes = Reflect.apply(byteLength, chunk, []) as number;
        const offset = Reflect.apply(byteOffset, chunk, []) as number;
        if (isSharedArrayBuffer(buffer)) fail('INVALID_INPUT');
        view = new Uint8Array(buffer, offset, bytes);
      } catch {
        return fail('INVALID_INPUT');
      }
      if (bytes > MAX_BYTES - total) fail('INPUT_TOO_LARGE');
      if (config.declaredBytes !== undefined && bytes > config.declaredBytes - total)
        fail('LENGTH_MISMATCH');
      if (bytes === 0) continue;
      collected ??= Buffer.allocUnsafe(config.declaredBytes ?? MAX_BYTES);
      // Native typed-array access avoids caller overrides and snapshots the exact
      // yielded view synchronously, before asking the producer for another chunk.
      try {
        Reflect.apply(copyBytes, collected, [view, total]);
      } catch {
        return fail('INVALID_INPUT');
      }
      total += bytes;
    }
    check();
    if (total === 0) fail('EMPTY_INPUT');
    if (config.declaredBytes !== undefined && total !== config.declaredBytes)
      fail('LENGTH_MISMATCH');
    return Buffer.from(collected!.subarray(0, total));
  } finally {
    clearTimeout(timer);
    if (listener && signal) Reflect.apply(removeEvent, signal, ['abort', onAbort]);
    if (!complete && iterator) {
      // A noncooperative iterator may never settle return(). Request cancellation
      // once and consume its late failure without extending this call's lifetime.
      try {
        const finish = iterator.return;
        if (typeof finish === 'function')
          void Promise.resolve(Reflect.apply(finish, iterator, [])).catch(() => undefined);
      } catch {
        /* Best-effort producer cancellation cannot replace the original error. */
      }
    }
  }
}
