import { ApiClientError } from '@realtor/api-client';
import {
  validateListingReferenceCatalogue,
  validateSyntheticReferenceTransitionCommand,
  validateSyntheticReferenceTransitionReceipt,
  type ListingReferenceCatalogue,
  type SyntheticReferenceTransitionCommand,
  type SyntheticReferenceTransitionReceipt,
} from '@realtor/domain';
import type {
  ReferenceModerationClient,
  ReferenceModerationScope,
} from './reference-moderation-client.ts';
import { parseReferenceModerationJson } from './reference-moderation-wire.ts';
export interface ReferenceModerationStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export const REFERENCE_MODERATION_ORIGINAL_MAX_BYTES = 163840;
const fail = (): never => {
  throw new ApiClientError('VALIDATION', 'Retain and verify the original moderation command.');
};
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
const uuid = (v: unknown): string => {
  if (
    typeof v !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v)
  )
    return fail();
  return v;
};
const version = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[1-9]\d{0,15}$/.test(v) || BigInt(v) > 9007199254740991n)
    return fail();
  return v;
};
/** Use tab sessionStorage. Contains private original facts, never bearer tokens or the whole catalogue. */
export function referenceModerationSession(
  store: ReferenceModerationStore,
  input: ReferenceModerationScope,
) {
  const r = own(input, ['instanceId', 'tenantId', 'actorId', 'listingId', 'revision']);
  if (
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
  const key = `synthetic-reference-moderation-original-v1:${scope.instanceId}:${scope.tenantId}:${scope.actorId}:${scope.listingId}:${scope.revision}`;
  const bounded = (raw: string) => {
    if (
      typeof raw !== 'string' ||
      raw.length > REFERENCE_MODERATION_ORIGINAL_MAX_BYTES ||
      new TextEncoder().encode(raw).byteLength > REFERENCE_MODERATION_ORIGINAL_MAX_BYTES
    )
      return fail();
  };
  const envelope = (command: SyntheticReferenceTransitionCommand) =>
    JSON.stringify({ schema: 'synthetic-reference-moderation-attempt-v1', ...scope, command });
  function inspect(raw: string) {
    bounded(raw);
    const row = own(parseReferenceModerationJson(raw), [
      'schema',
      'instanceId',
      'tenantId',
      'actorId',
      'listingId',
      'revision',
      'command',
    ]);
    if (
      row.schema !== 'synthetic-reference-moderation-attempt-v1' ||
      Object.keys(scope).some((k) => row[k] !== scope[k as keyof typeof scope])
    )
      return fail();
    const c = own(row.command, [
      'policy',
      'operationId',
      'listingId',
      'revision',
      'action',
      'review',
      'reason',
    ]);
    if (
      c.policy !== 'synthetic-reference-transition-v1' ||
      c.listingId !== scope.listingId ||
      c.revision !== scope.revision
    )
      return fail();
    uuid(c.operationId);
    const review = own(c.review, [
      'policy',
      'listingId',
      'revision',
      'listingVersion',
      'revisionVersion',
      'state',
      'availability',
      'availabilityConfirmedAt',
      'publicationStatus',
      'publishedRevision',
      'content',
      'attributes',
      'photos',
    ]);
    if (review.listingId !== scope.listingId || review.revision !== scope.revision) return fail();
    const attributes = own(review.attributes, [
      'catalogueVersion',
      'country',
      'location',
      'amenities',
    ]);
    // Only this bounded version hint may be used before loading the immutable catalogue.
    return Object.freeze({ raw, catalogueVersion: version(attributes.catalogueVersion) });
  }
  return Object.freeze({
    scope,
    load() {
      const raw = store.getItem(key);
      return raw === null ? null : inspect(raw);
    },
    retain(command: SyntheticReferenceTransitionCommand, catalogue: ListingReferenceCatalogue) {
      const original = validateSyntheticReferenceTransitionCommand(command, catalogue);
      if (original.listingId !== scope.listingId || original.revision !== scope.revision)
        return fail();
      const raw = envelope(original);
      bounded(raw);
      // Even an identical prepared handle cannot claim an already retained operation for another POST.
      if (store.getItem(key) !== null) return fail();
      store.setItem(key, raw);
      if (store.getItem(key) !== raw) return fail();
    },
    verify(command: SyntheticReferenceTransitionCommand) {
      if (store.getItem(key) !== envelope(command)) return fail();
    },
    clear(command: SyntheticReferenceTransitionCommand) {
      if (store.getItem(key) !== envelope(command)) return fail();
      store.removeItem(key);
      if (store.getItem(key) !== null) return fail();
    },
  });
}
type Session = ReturnType<typeof referenceModerationSession>;
export interface ReferenceModerationAttempt {
  readonly original: SyntheticReferenceTransitionCommand;
  readonly status: 'ready' | 'sending' | 'uncertain' | 'received' | 'rejected';
  readonly receipt: SyntheticReferenceTransitionReceipt | null;
  readonly canDiscard: boolean;
  submit(signal?: AbortSignal): Promise<SyntheticReferenceTransitionReceipt>;
  recoverOriginal(signal?: AbortSignal): Promise<SyntheticReferenceTransitionReceipt>;
  discard(): void;
}
function attempt(
  client: ReferenceModerationClient,
  session: Session,
  input: unknown,
  catalogueInput: unknown,
  restored: boolean,
): ReferenceModerationAttempt {
  const catalogue = validateListingReferenceCatalogue(catalogueInput),
    original = validateSyntheticReferenceTransitionCommand(input, catalogue);
  if (
    original.listingId !== session.scope.listingId ||
    original.revision !== session.scope.revision
  )
    return fail();
  const transition = client.transition.bind(client),
    recover = client.recover.bind(client);
  let status: ReferenceModerationAttempt['status'] = restored ? 'uncertain' : 'ready',
    receipt: SyntheticReferenceTransitionReceipt | null = null,
    discarded = false,
    retained = restored;
  async function run(mode: 'submit' | 'recover', signal?: AbortSignal) {
    if (
      discarded ||
      status !== (mode === 'submit' ? 'ready' : 'uncertain') ||
      (signal !== undefined && !(signal instanceof AbortSignal))
    )
      return fail();
    if (signal?.aborted) throw new ApiClientError('CANCELLED', 'Request cancelled.');
    if (mode === 'submit') {
      session.retain(original, catalogue);
      retained = true;
    } else session.verify(original);
    status = 'sending';
    try {
      const result = await (mode === 'submit' ? transition : recover)(original, catalogue, signal);
      if (signal?.aborted)
        throw new ApiClientError('CANCELLED', 'Request cancelled.', { submissionUncertain: true });
      let checked: SyntheticReferenceTransitionReceipt;
      try {
        checked = validateSyntheticReferenceTransitionReceipt(
          result,
          original,
          catalogue,
          session.scope.actorId,
        );
        session.verify(original);
      } catch {
        throw new ApiClientError('INVALID_RESPONSE', 'Original moderation remains unconfirmed.', {
          submissionUncertain: true,
        });
      }
      receipt = checked;
      status = 'received';
      return checked;
    } catch (error) {
      status =
        mode === 'recover' || !(error instanceof ApiClientError) || error.submissionUncertain
          ? 'uncertain'
          : 'rejected';
      throw error;
    }
  }
  return Object.freeze({
    original,
    get status() {
      return status;
    },
    get receipt() {
      return receipt;
    },
    get canDiscard() {
      return !discarded && status !== 'sending' && status !== 'uncertain';
    },
    submit: (s?: AbortSignal) => run('submit', s),
    recoverOriginal: (s?: AbortSignal) => run('recover', s),
    discard() {
      if (discarded || status === 'sending' || status === 'uncertain') return fail();
      if (retained) session.clear(original);
      discarded = true;
    },
  });
}
export function prepareReferenceModerationAttempt(
  client: ReferenceModerationClient,
  session: Session,
  input: SyntheticReferenceTransitionCommand,
  catalogue: ListingReferenceCatalogue,
): ReferenceModerationAttempt {
  if (session.load() !== null) return fail();
  return attempt(client, session, input, catalogue, false);
}
/** Recreate only an uncertain original. No automatic transition or recovery request. */
export async function restoreReferenceModerationAttempt(
  client: ReferenceModerationClient,
  session: Session,
  signal?: AbortSignal,
): Promise<ReferenceModerationAttempt | null> {
  if (signal !== undefined && !(signal instanceof AbortSignal)) return fail();
  if (signal?.aborted) throw new ApiClientError('CANCELLED', 'Request cancelled.');
  const retained = session.load();
  if (retained === null) return null;
  const catalogue = await client.catalogue(retained.catalogueVersion, signal);
  if (signal?.aborted) throw new ApiClientError('CANCELLED', 'Request cancelled.');
  const row = own(parseReferenceModerationJson(retained.raw), [
    'schema',
    'instanceId',
    'tenantId',
    'actorId',
    'listingId',
    'revision',
    'command',
  ]);
  const restored = attempt(client, session, row.command, catalogue, true);
  session.verify(restored.original);
  return restored;
}
