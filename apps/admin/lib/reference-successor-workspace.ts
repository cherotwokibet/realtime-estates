import { ApiClientError } from '@realtor/api-client';
import {
  normalizeStaffDraftContentV2,
  validateListingReferenceCatalogue,
  selectListingReferenceAttributes,
  snapshotListingReferenceAttributes,
  validateSyntheticReferenceSuccessorCommand,
  validateSyntheticReferenceSuccessorReceipt,
  type ListingReferenceCatalogue,
  type SyntheticReferenceSuccessorCommand,
  type SyntheticReferenceSuccessorReceipt,
} from '@realtor/domain';
import { parseVerificationJson } from './listing-verification-wire.ts';
export interface ReferenceSuccessorScope {
  readonly instanceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly listingId: string;
}
export interface ReferenceSuccessorClient {
  create(
    command: SyntheticReferenceSuccessorCommand,
    catalogue: ListingReferenceCatalogue,
    actorId: string,
    signal?: AbortSignal,
  ): Promise<SyntheticReferenceSuccessorReceipt>;
  recover(
    command: SyntheticReferenceSuccessorCommand,
    catalogue: ListingReferenceCatalogue,
    actorId: string,
    signal?: AbortSignal,
  ): Promise<SyntheticReferenceSuccessorReceipt>;
}
interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail = (): never => {
  throw new ApiClientError('VALIDATION', 'Retain and review the original reference successor.');
};
function own(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return fail();
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== fields.length ||
    keys.some((k) => typeof k !== 'string' || !fields.includes(k))
  )
    return fail();
  const out: Record<string, unknown> = {};
  for (const k of fields) {
    const d = Object.getOwnPropertyDescriptor(input, k);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return fail();
    out[k] = d.value;
  }
  return out;
}
function uuid(input: unknown): string {
  if (typeof input !== 'string' || input.length !== 36 || !UUID.test(input)) return fail();
  return input;
}
/** Explicit picker adoption: derive labels from selected IDs; never infer IDs from legacy text. */
export function buildReferenceSuccessorCommand(
  input: Omit<SyntheticReferenceSuccessorCommand, 'policy'>,
  catalogueInput: unknown,
): SyntheticReferenceSuccessorCommand {
  const fields = own(input, [
    'operationId',
    'listingId',
    'expectedListingVersion',
    'predecessor',
    'content',
    'selection',
  ]);
  const catalogue = validateListingReferenceCatalogue(catalogueInput),
    content = normalizeStaffDraftContentV2(fields.content, true);
  const selection = selectListingReferenceAttributes(
      fields.selection,
      catalogue,
      content.propertyType,
    ),
    snapshot = snapshotListingReferenceAttributes(selection, catalogue, content.propertyType);
  const location = {
    county: snapshot.location.county?.label ?? null,
    town: snapshot.location.locality?.label ?? null,
    area: snapshot.location.neighbourhood?.label ?? null,
  };
  return validateSyntheticReferenceSuccessorCommand(
    {
      ...fields,
      policy: 'synthetic-reference-successor-v1',
      content: {
        ...content,
        location,
        locality: location.area ?? location.town ?? location.county,
      },
      selection,
    },
    catalogue,
  );
}
/** Retain only selected historical facts. SQL remains the authority for writes. */
export function selectedSuccessorCatalogue(
  command: SyntheticReferenceSuccessorCommand,
  input: unknown,
): ListingReferenceCatalogue {
  const catalogue = validateListingReferenceCatalogue(input);
  const captured = validateSyntheticReferenceSuccessorCommand(command, catalogue);
  const ids = new Set(Object.values(captured.selection.location).filter((v) => v !== null));
  const amenities = new Set(captured.selection.amenityIds);
  return validateListingReferenceCatalogue({
    ...catalogue,
    locations: catalogue.locations.filter((row) => ids.has(row.id)),
    amenities: catalogue.amenities.filter((row) => amenities.has(row.id)),
  });
}
export const REFERENCE_SUCCESSOR_STORAGE_MAX_BYTES = 262144;
export function referenceSuccessorSession(store: Store, input: ReferenceSuccessorScope) {
  const rawScope = own(input, ['instanceId', 'tenantId', 'actorId', 'listingId']);
  const scope = Object.freeze({
    instanceId: uuid(rawScope.instanceId),
    tenantId: uuid(rawScope.tenantId),
    actorId: uuid(rawScope.actorId),
    listingId: uuid(rawScope.listingId),
  });
  const key = `synthetic-reference-successor-original-v1:${scope.instanceId}:${scope.tenantId}:${scope.actorId}:${scope.listingId}`;
  function capture(input: unknown, cat: unknown) {
    const command = validateSyntheticReferenceSuccessorCommand(input, cat);
    if (command.listingId !== scope.listingId) return fail();
    const catalogue = selectedSuccessorCatalogue(command, cat);
    return Object.freeze({ candidate: command, catalogue });
  }
  const envelope = (
    command: SyntheticReferenceSuccessorCommand,
    catalogue: ListingReferenceCatalogue,
  ) =>
    JSON.stringify({
      schema: 'synthetic-reference-successor-attempt-v1',
      ...scope,
      command,
      catalogue,
    });
  const bound = (raw: string) => {
    if (
      raw.length > REFERENCE_SUCCESSOR_STORAGE_MAX_BYTES ||
      new TextEncoder().encode(raw).byteLength > REFERENCE_SUCCESSOR_STORAGE_MAX_BYTES
    )
      return fail();
  };
  function inspect(raw: string) {
    bound(raw);
    const row = own(parseVerificationJson(raw), [
      'schema',
      'instanceId',
      'tenantId',
      'actorId',
      'listingId',
      'command',
      'catalogue',
    ]);
    if (
      row.schema !== 'synthetic-reference-successor-attempt-v1' ||
      Object.keys(scope).some((k) => row[k] !== scope[k as keyof ReferenceSuccessorScope])
    )
      return fail();
    const retained = capture(row.command, row.catalogue);
    if (raw !== envelope(retained.candidate, retained.catalogue)) return fail();
    return retained;
  }
  return Object.freeze({
    scope,
    load() {
      const raw = store.getItem(key);
      return raw === null ? null : inspect(raw);
    },
    retain(input: SyntheticReferenceSuccessorCommand, cat: ListingReferenceCatalogue) {
      const retained = capture(input, cat),
        raw = envelope(retained.candidate, retained.catalogue);
      bound(raw);
      const prior = store.getItem(key);
      if (prior !== null && prior !== raw) return fail();
      store.setItem(key, raw);
      if (store.getItem(key) !== raw) return fail();
    },
    verify(command: SyntheticReferenceSuccessorCommand, cat: ListingReferenceCatalogue) {
      const retained = capture(command, cat);
      if (store.getItem(key) !== envelope(retained.candidate, retained.catalogue)) return fail();
    },
    clear(command: SyntheticReferenceSuccessorCommand, cat: ListingReferenceCatalogue) {
      const retained = capture(command, cat);
      if (store.getItem(key) !== envelope(retained.candidate, retained.catalogue)) return fail();
      store.removeItem(key);
      if (store.getItem(key) !== null) return fail();
    },
  });
}

type Session = ReturnType<typeof referenceSuccessorSession>;
export interface ReferenceSuccessorAttempt {
  readonly original: SyntheticReferenceSuccessorCommand;
  readonly status: 'ready' | 'sending' | 'uncertain' | 'received' | 'rejected';
  readonly receipt: SyntheticReferenceSuccessorReceipt | null;
  readonly canDiscard: boolean;
  readonly catalogue: ListingReferenceCatalogue;
  readonly canLeave: boolean;
  readonly freshDraftTarget: Readonly<{ listingId: string; revision: number }> | null;
  verifyReload(): void;
  submit(signal?: AbortSignal): Promise<SyntheticReferenceSuccessorReceipt>;
  recoverOriginal(signal?: AbortSignal): Promise<SyntheticReferenceSuccessorReceipt>;
  replayOriginal(signal?: AbortSignal): Promise<SyntheticReferenceSuccessorReceipt>;
  discard(): void;
}
function attempt(
  client: ReferenceSuccessorClient,
  session: Session,
  input: unknown,
  catalogueInput: unknown,
  restored: boolean,
): ReferenceSuccessorAttempt {
  const catalogue = selectedSuccessorCatalogue(
      input as SyntheticReferenceSuccessorCommand,
      catalogueInput,
    ),
    original = validateSyntheticReferenceSuccessorCommand(input, catalogue),
    actorId = session.scope.actorId;
  if (original.listingId !== session.scope.listingId) return fail();
  const create = client.create.bind(client),
    recover = client.recover.bind(client);
  let status: ReferenceSuccessorAttempt['status'] = restored ? 'uncertain' : 'ready',
    receipt: SyntheticReferenceSuccessorReceipt | null = null,
    discarded = false;
  async function run(mode: 'submit' | 'recover' | 'replay', signal?: AbortSignal) {
    if (
      discarded ||
      status !== (mode === 'submit' ? 'ready' : 'uncertain') ||
      (signal !== undefined && !(signal instanceof AbortSignal))
    )
      return fail();
    if (signal?.aborted) throw new ApiClientError('CANCELLED', 'Request cancelled.');
    const wasUncertain = status === 'uncertain';
    // Storage/readback must succeed synchronously before any client write can start.
    if (mode === 'submit') {
      if (session.load() !== null) return fail();
      session.retain(original, catalogue);
    } else session.verify(original, catalogue);
    status = 'sending';
    try {
      const value = await (mode === 'recover' ? recover : create)(
        original,
        catalogue,
        actorId,
        signal,
      );
      if (signal?.aborted)
        throw new ApiClientError('CANCELLED', 'Request cancelled.', {
          submissionUncertain: mode !== 'recover',
        });
      try {
        session.verify(original, catalogue);
        receipt = validateSyntheticReferenceSuccessorReceipt(value, original, catalogue, actorId);
      } catch {
        throw new ApiClientError('INVALID_RESPONSE', 'Original reference result is unconfirmed.', {
          submissionUncertain: mode !== 'recover',
        });
      }
      status = 'received';
      return receipt;
    } catch (error) {
      status =
        wasUncertain || !(error instanceof ApiClientError) || error.submissionUncertain
          ? 'uncertain'
          : 'rejected';
      throw error;
    }
  }
  return Object.freeze({
    original,
    catalogue,
    get canLeave() {
      return discarded || (status !== 'sending' && status !== 'uncertain');
    },
    get freshDraftTarget() {
      return !discarded && status === 'received' && receipt
        ? Object.freeze({
            listingId: original.listingId,
            revision: receipt.referenceDraft.revision,
          })
        : null;
    },
    verifyReload() {
      if (discarded || status !== 'uncertain') return fail();
      session.verify(original, catalogue);
    },
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
    replayOriginal: (s?: AbortSignal) => run('replay', s),
    discard() {
      if (discarded || status === 'sending' || status === 'uncertain') return fail();
      if (session.load() !== null) session.clear(original, catalogue);
      discarded = true;
    },
  });
}
export function prepareReferenceSuccessorAttempt(
  client: ReferenceSuccessorClient,
  session: Session,
  input: SyntheticReferenceSuccessorCommand,
  catalogue: ListingReferenceCatalogue,
): ReferenceSuccessorAttempt {
  if (session.load() !== null) return fail();
  return attempt(client, session, input, catalogue, false);
}
export async function restoreReferenceSuccessorAttempt(
  client: ReferenceSuccessorClient,
  session: Session,
  signal?: AbortSignal,
): Promise<ReferenceSuccessorAttempt | null> {
  if (signal !== undefined && !(signal instanceof AbortSignal)) return fail();
  const retained = session.load();
  if (retained === null) return null;
  if (signal?.aborted) throw new ApiClientError('CANCELLED', 'Request cancelled.');
  const restored = attempt(client, session, retained.candidate, retained.catalogue, true);
  session.verify(restored.original, restored.catalogue);
  return restored;
}
