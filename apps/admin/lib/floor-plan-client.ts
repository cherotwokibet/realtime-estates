import type { FloorPlanClient } from './floor-plan-session.ts';
import { ApiClientError } from '@realtor/api-client';
import {
  validateFloorPlanPreparationCommand,
  validatePreparedFloorPlan,
  validateFloorPlanAttachmentCommand,
  validateFloorPlanAttachmentRecord,
  type FloorPlanPreparationCommand,
  type FloorPlanAttachmentCommand,
} from '@realtor/domain';
import { captureVideoScope, type VideoScope } from './listing-video-session.ts';
import { readBrowserDecodedJson } from './browser-decoded-json.ts';
const typed = Object.getPrototypeOf(Uint8Array.prototype),
  length = Object.getOwnPropertyDescriptor(typed, 'byteLength')!.get!,
  buffer = Object.getOwnPropertyDescriptor(typed, 'buffer')!.get!,
  kind = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag)!.get!,
  offset = Object.getOwnPropertyDescriptor(typed, 'byteOffset')!.get!,
  arrayLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
/** No source bytes are retained by this adapter. The caller must retain the original command before sending. */
export function createFloorPlanClient(
  input: VideoScope,
  transport: typeof fetch = (...args) => globalThis.fetch(...args),
) {
  const scope = captureVideoScope(input);
  async function run(
    input: FloorPlanPreparationCommand | FloorPlanAttachmentCommand,
    recover: boolean,
    source?: Uint8Array,
    caller?: AbortSignal,
  ) {
    const preparation = input.policy === 'synthetic-floor-plan-preparation-command-v1',
      command = preparation
        ? validateFloorPlanPreparationCommand(input)
        : validateFloorPlanAttachmentCommand(input);
    if (command.listingId !== scope.listingId || command.revision !== scope.revision)
      throw Error('Changed floor-plan target.');
    let bytes: Uint8Array<ArrayBuffer> | undefined;
    if (preparation && !recover) {
      if (!ArrayBuffer.isView(source) || kind.call(source) !== 'Uint8Array')
        throw Error('Choose ordinary bytes.');
      const backing = buffer.call(source);
      arrayLength.call(backing);
      const size = length.call(source);
      if (size < 1 || size > 10485760 || !(buffer.call(source) instanceof ArrayBuffer))
        throw Error('Choose a bounded file.');
      bytes = new Uint8Array(size);
      Uint8Array.prototype.set.call(bytes, new Uint8Array(backing, offset.call(source), size));
    }
    const deadline = new AbortController(),
      timer = setTimeout(() => deadline.abort(), preparation && !recover ? 65000 : 15000),
      signal = caller ? AbortSignal.any([caller, deadline.signal]) : deadline.signal;
    let started = false,
      abort = () => {};
    try {
      if (signal.aborted) throw Error('Cancelled.');
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(Error('Cancelled.'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      const p = preparation ? validateFloorPlanPreparationCommand(command) : null;
      const path = p
        ? `/api/staff/listings/${p.listingId}/floor-plan-inputs/${p.revision}/${p.expectedVersion}/${p.requestId}`
        : `/api/staff/listings/${command.listingId}/floor-plan-operations/${validateFloorPlanAttachmentCommand(command).operationId}${recover ? '/recover' : ''}`;
      started = !recover;
      const response = await Promise.race([
        transport(path, {
          method: p ? (recover ? 'GET' : 'PUT') : 'POST',
          headers: {
            'X-Preview-Instance': scope.instanceId,
            'X-Reference-Actor': scope.actorId,
            'X-Reference-Tenant': scope.tenantId,
            ...(p
              ? recover
                ? {}
                : { 'Content-Type': 'application/octet-stream' }
              : { 'Content-Type': 'application/json' }),
          },
          ...(p ? (recover ? {} : { body: bytes }) : { body: JSON.stringify(command) }),
          signal,
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
        }),
        cancelled,
      ]);
      if (
        response.redirected ||
        !response.headers.get('cache-control')?.split(/[ ,]+/).includes('no-store')
      )
        throw Error('Invalid private response.');
      const data = await readBrowserDecodedJson(response, 8192, signal);
      if (!response.ok) {
        const error = data as { submissionUncertain?: unknown };
        if (typeof error?.submissionUncertain !== 'boolean') throw Error('Invalid refusal.');
        throw new ApiClientError('HTTP', 'Private floor-plan request unavailable.', {
          status: response.status,
          submissionUncertain: !recover && error.submissionUncertain,
        });
      }
      const result = p
        ? validatePreparedFloorPlan(data, p)
        : validateFloorPlanAttachmentRecord(data, validateFloorPlanAttachmentCommand(command));
      if ('actorId' in result && result.actorId !== scope.actorId)
        throw Error('Changed original actor.');
      if (signal.aborted) throw Error('Cancelled.');
      return result;
    } catch (error) {
      if (error instanceof ApiClientError && error.kind === 'HTTP') throw error;
      throw new ApiClientError(
        deadline.signal.aborted ? 'TIMEOUT' : caller?.aborted ? 'CANCELLED' : 'INVALID_RESPONSE',
        'Keep the original floor-plan request.',
        { submissionUncertain: started },
      );
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
  return Object.freeze({
    prepare: async (c: FloorPlanPreparationCommand, bytes: Uint8Array, s?: AbortSignal) =>
      validatePreparedFloorPlan(await run(c, false, bytes, s), c),
    recoverPreparation: async (c: FloorPlanPreparationCommand, s?: AbortSignal) =>
      validatePreparedFloorPlan(await run(c, true, undefined, s), c),
    attach: async (c: FloorPlanAttachmentCommand, s?: AbortSignal) =>
      validateFloorPlanAttachmentRecord(await run(c, false, undefined, s), c),
    recoverAttachment: async (c: FloorPlanAttachmentCommand, s?: AbortSignal) =>
      validateFloorPlanAttachmentRecord(await run(c, true, undefined, s), c),
  } satisfies FloorPlanClient);
}
