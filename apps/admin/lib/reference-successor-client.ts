import { ApiClientError } from '@realtor/api-client';
import {
  validateListingReferenceCatalogue,
  validateSyntheticReferenceSuccessorCommand,
  validateSyntheticReferenceSuccessorReceipt,
} from '@realtor/domain';
import type {
  ReferenceSuccessorClient,
  ReferenceSuccessorScope,
} from './reference-successor-workspace.ts';
import { readReferenceJson } from './reference-draft-wire.ts';
/** Scope is compared with the current server identity, never forwarded to the API as authority. */
export function createReferenceSuccessorClient(
  input: ReferenceSuccessorScope,
  transport: typeof fetch = (...args) => globalThis.fetch(...args),
  onAccessDenied?: () => void,
): ReferenceSuccessorClient {
  const captured: Record<string, string> = {},
    keys = ['instanceId', 'tenantId', 'actorId', 'listingId'],
    uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (
    !input ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).length !== 4 ||
    typeof transport !== 'function'
  )
    throw new ApiClientError('VALIDATION', 'Invalid reference scope.');
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (
      !d?.enumerable ||
      !Object.hasOwn(d, 'value') ||
      typeof d.value !== 'string' ||
      !uuid.test(d.value)
    )
      throw new ApiClientError('VALIDATION', 'Invalid reference scope.');
    captured[key] = d.value;
  }
  async function request(path: string, command: unknown, maximum: number, caller?: AbortSignal) {
    const deadline = new AbortController(),
      timer = setTimeout(() => deadline.abort(), 15000),
      signal = caller ? AbortSignal.any([caller, deadline.signal]) : deadline.signal;
    let dispatched = false;
    const writing = command !== undefined && !path.endsWith('/recover');
    try {
      if (signal.aborted) throw new ApiClientError('CANCELLED', 'Cancelled.');
      const body = command === undefined ? undefined : JSON.stringify(command);
      if (body !== undefined && new TextEncoder().encode(body).byteLength > 131072)
        throw new ApiClientError('VALIDATION', 'Draft too large.');
      let abort = () => {};
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(new ApiClientError('CANCELLED', 'Cancelled.'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      let response: Response;
      try {
        dispatched = writing;
        response = await Promise.race([
          transport(path, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {
              'X-Preview-Instance': captured.instanceId!,
              'X-Reference-Actor': captured.actorId!,
              'X-Reference-Tenant': captured.tenantId!,
              ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body }),
            signal,
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
          }),
          cancelled,
        ]);
      } finally {
        signal.removeEventListener('abort', abort);
      }
      // Denial closes private rendering even if its error body is absent or malformed.
      if (response.status === 401 || response.status === 403) onAccessDenied?.();
      const data = await readReferenceJson(response, response.ok ? maximum : 131072, signal);
      if (!response.ok) {
        const uncertain = (data as { submissionUncertain?: unknown })?.submissionUncertain;
        if (typeof uncertain !== 'boolean') throw Error('Invalid error envelope.');
        throw new ApiClientError('HTTP', 'Reference request unavailable.', {
          status: response.status,
          submissionUncertain: writing && uncertain,
        });
      }
      if (signal.aborted) throw Error();
      return data;
    } catch (error) {
      if (error instanceof ApiClientError && error.kind === 'HTTP') throw error;
      throw new ApiClientError(
        deadline.signal.aborted
          ? 'TIMEOUT'
          : caller?.aborted
            ? 'CANCELLED'
            : error instanceof ApiClientError
              ? error.kind
              : 'INVALID_RESPONSE',
        'Reference result unconfirmed.',
        { submissionUncertain: writing && dispatched },
      );
    } finally {
      clearTimeout(timer);
    }
  }
  async function operation(
    input: Parameters<ReferenceSuccessorClient['create']>[0],
    cat: Parameters<ReferenceSuccessorClient['create']>[1],
    actor: string,
    signal: AbortSignal | undefined,
    recover: boolean,
  ) {
    const catalogue = validateListingReferenceCatalogue(cat),
      command = validateSyntheticReferenceSuccessorCommand(input, catalogue);
    if (command.listingId !== captured.listingId || actor !== captured.actorId)
      throw new ApiClientError('VALIDATION', 'Changed reference scope.');
    const value = await request(
      `/api/staff/listings/${command.listingId}/reference-successor-operations/${command.operationId}${recover ? '/recover' : ''}`,
      command,
      262272,
      signal,
    );
    try {
      return validateSyntheticReferenceSuccessorReceipt(value, command, catalogue, actor);
    } catch {
      throw new ApiClientError('INVALID_RESPONSE', 'Reference receipt unconfirmed.', {
        submissionUncertain: !recover,
      });
    }
  }
  return Object.freeze({
    async create(input, catalogue, actorId, signal) {
      return operation(input, catalogue, actorId, signal, false);
    },
    async recover(input, catalogue, actorId, signal) {
      return operation(input, catalogue, actorId, signal, true);
    },
  } satisfies ReferenceSuccessorClient);
}
