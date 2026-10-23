import { ApiClientError } from '@realtor/api-client';
import {
  validateListingReferenceCatalogue,
  validateSyntheticReferenceRevision,
  validateSyntheticReferenceTransitionCommand,
  validateSyntheticReferenceTransitionReceipt,
  type ListingReferenceCatalogue,
  type SyntheticReferenceRevision,
  type SyntheticReferenceTransitionCommand,
  type SyntheticReferenceTransitionReceipt,
} from '@realtor/domain';
import { createReferenceDraftClient } from './reference-draft-client.ts';
import type { ReferenceDraftScope } from './reference-draft-workspace.ts';
import { readReferenceModerationJson } from './reference-moderation-wire.ts';
export interface ReferenceModerationScope extends ReferenceDraftScope {
  readonly revision: number;
}
export interface ReferenceModerationClient {
  catalogue(version: string, signal?: AbortSignal): Promise<ListingReferenceCatalogue>;
  read(
    kind: 'revision' | 'review',
    version: string,
    catalogue: ListingReferenceCatalogue,
    signal?: AbortSignal,
  ): Promise<SyntheticReferenceRevision>;
  transition(
    command: SyntheticReferenceTransitionCommand,
    catalogue: ListingReferenceCatalogue,
    signal?: AbortSignal,
  ): Promise<SyntheticReferenceTransitionReceipt>;
  recover(
    command: SyntheticReferenceTransitionCommand,
    catalogue: ListingReferenceCatalogue,
    signal?: AbortSignal,
  ): Promise<SyntheticReferenceTransitionReceipt>;
}
function fail(): never {
  throw new ApiClientError('VALIDATION', 'Invalid synthetic moderation facts.');
}
function own(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return fail();
  const actual = Reflect.ownKeys(input);
  if (
    actual.length !== keys.length ||
    actual.some((k) => typeof k !== 'string' || !keys.includes(k))
  )
    return fail();
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(input, k);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return fail();
    out[k] = d.value;
  }
  return out;
}
/** Browser never receives a bearer token. Scope headers only detect stale server sessions. */
export function createReferenceModerationClient(
  input: ReferenceModerationScope,
  transport: typeof fetch = (...args) => globalThis.fetch(...args),
): ReferenceModerationClient {
  const r = own(input, ['instanceId', 'tenantId', 'actorId', 'listingId', 'revision']);
  const uuid = (v: unknown): string => {
    if (
      typeof v !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)
    )
      return fail();
    return v;
  };
  if (
    typeof transport !== 'function' ||
    typeof r.revision !== 'number' ||
    !Number.isInteger(r.revision) ||
    r.revision < 1 ||
    r.revision > 2147483647
  )
    return fail();
  const scope = Object.freeze({
    instanceId: uuid(r.instanceId),
    tenantId: uuid(r.tenantId),
    actorId: uuid(r.actorId),
    listingId: uuid(r.listingId),
    revision: r.revision,
  });
  const catalogueClient = createReferenceDraftClient(
    {
      instanceId: scope.instanceId,
      tenantId: scope.tenantId,
      actorId: scope.actorId,
      listingId: scope.listingId,
    },
    transport,
  );
  async function request(path: string, command: unknown, caller?: AbortSignal) {
    if (caller !== undefined && !(caller instanceof AbortSignal)) return fail();
    const deadline = new AbortController(),
      timer = setTimeout(() => deadline.abort(), 15000),
      signal = caller ? AbortSignal.any([caller, deadline.signal]) : deadline.signal;
    const writing = command !== undefined && !path.endsWith('/recover');
    let dispatched = false,
      abort = () => {};
    try {
      if (signal.aborted) throw new ApiClientError('CANCELLED', 'Cancelled.');
      const body = command === undefined ? undefined : JSON.stringify(command);
      if (body !== undefined && new TextEncoder().encode(body).byteLength > 131072) return fail();
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(new ApiClientError('CANCELLED', 'Cancelled.'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      dispatched = writing;
      const pending = transport(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'X-Preview-Instance': scope.instanceId,
          'X-Reference-Actor': scope.actorId,
          'X-Reference-Tenant': scope.tenantId,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body }),
        signal,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      });
      void pending.then(
        (response) => {
          if (signal.aborted) void response.body?.cancel().catch(() => {});
        },
        () => {},
      );
      const response = await Promise.race([pending, cancelled]);
      if (signal.aborted) throw Error();
      const data = await readReferenceModerationJson(response, signal);
      if (!response.ok) {
        let uncertain: boolean;
        try {
          const e = own(data, ['error', 'submissionUncertain']),
            detail = own(e.error, ['code', 'message']);
          if (
            typeof e.submissionUncertain !== 'boolean' ||
            typeof detail.code !== 'string' ||
            typeof detail.message !== 'string' ||
            detail.code.length > 128 ||
            detail.message.length > 1024
          )
            throw Error();
          uncertain = e.submissionUncertain;
        } catch {
          throw Error('Invalid error response.');
        }
        throw new ApiClientError('HTTP', 'Reference moderation unavailable.', {
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
        'Reference moderation unconfirmed.',
        { submissionUncertain: writing && dispatched },
      );
    } finally {
      signal.removeEventListener('abort', abort);
      clearTimeout(timer);
    }
  }
  async function operation(
    input: SyntheticReferenceTransitionCommand,
    cat: ListingReferenceCatalogue,
    signal: AbortSignal | undefined,
    recover: boolean,
  ) {
    const catalogue = validateListingReferenceCatalogue(cat),
      command = validateSyntheticReferenceTransitionCommand(input, catalogue);
    if (command.listingId !== scope.listingId || command.revision !== scope.revision) return fail();
    const data = await request(
      `/api/staff/listings/${scope.listingId}/reference-transition-operations/${command.operationId}${recover ? '/recover' : ''}`,
      command,
      signal,
    );
    try {
      return validateSyntheticReferenceTransitionReceipt(data, command, catalogue, scope.actorId);
    } catch {
      throw new ApiClientError('INVALID_RESPONSE', 'Original moderation result unconfirmed.', {
        submissionUncertain: !recover,
      });
    }
  }
  return Object.freeze({
    catalogue: catalogueClient.catalogue,
    async read(kind, version, cat, signal) {
      if (
        !['revision', 'review'].includes(kind) ||
        typeof version !== 'string' ||
        !/^[1-9]\d{0,15}$/.test(version) ||
        BigInt(version) > 9007199254740991n
      )
        return fail();
      const catalogue = validateListingReferenceCatalogue(cat),
        data = await request(
          `/api/staff/${kind === 'review' ? 'reviews' : 'listings'}/${scope.listingId}/reference-revisions/${scope.revision}/${version}/${catalogue.version}`,
          undefined,
          signal,
        );
      try {
        const review = validateSyntheticReferenceRevision(
          data,
          catalogue,
          scope.listingId,
          scope.revision,
          version,
        );
        if (kind === 'review' && review.state !== 'pending') throw Error();
        return review;
      } catch {
        throw new ApiClientError('INVALID_RESPONSE', 'Reference revision unconfirmed.');
      }
    },
    transition: (command, cat, signal) => operation(command, cat, signal, false),
    recover: (command, cat, signal) => operation(command, cat, signal, true),
  } satisfies ReferenceModerationClient);
}
