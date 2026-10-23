import { ApiClientError } from '@realtor/api-client';
import {
  normalizeStaffDraftContentV2,
  validateListingReferenceCatalogue,
  selectListingReferenceAttributes,
  snapshotListingReferenceAttributes,
  validateSyntheticReferenceDraftCommand,
  validateSyntheticReferenceDraftReceipt,
  type ListingReferenceCatalogue,
  type ListingReferenceSelection,
  type StaffDraftContentV2,
  type SyntheticReferenceDraftCommand,
  type SyntheticReferenceDraftReceipt,
} from '@realtor/domain';
import { parseVerificationJson } from './listing-verification-wire.ts';
export interface ReferenceDraftScope {
  readonly instanceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly listingId: string;
}
export interface ReferenceDraftClient {
  catalogue(version: string, signal?: AbortSignal): Promise<ListingReferenceCatalogue>;
  create(
    command: SyntheticReferenceDraftCommand,
    catalogue: ListingReferenceCatalogue,
    actorId: string,
    signal?: AbortSignal,
  ): Promise<SyntheticReferenceDraftReceipt>;
  recover(
    command: SyntheticReferenceDraftCommand,
    catalogue: ListingReferenceCatalogue,
    actorId: string,
    signal?: AbortSignal,
  ): Promise<SyntheticReferenceDraftReceipt>;
}
interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail = (): never => {
  throw new ApiClientError('VALIDATION', 'Retain and review the original reference draft.');
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
function version(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input.length > 16 ||
    !/^[1-9]\d*$/.test(input) ||
    BigInt(input) > 9007199254740991n
  )
    return fail();
  return input;
}
/** Explicit picker adoption: derive labels from selected IDs; never infer IDs from legacy text. */
export function buildReferenceDraftCommand(
  input: Omit<SyntheticReferenceDraftCommand, 'policy'>,
  catalogueInput: unknown,
): SyntheticReferenceDraftCommand {
  const fields = own(input, [
    'operationId',
    'listingId',
    'revision',
    'expectedVersion',
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
  return validateSyntheticReferenceDraftCommand(
    {
      ...fields,
      policy: 'synthetic-reference-draft-v1',
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
export function referenceDraftSession(store: Store, input: ReferenceDraftScope) {
  const rawScope = own(input, ['instanceId', 'tenantId', 'actorId', 'listingId']);
  const scope = Object.freeze({
    instanceId: uuid(rawScope.instanceId),
    tenantId: uuid(rawScope.tenantId),
    actorId: uuid(rawScope.actorId),
    listingId: uuid(rawScope.listingId),
  });
  const key = `synthetic-reference-original-v1:${scope.instanceId}:${scope.tenantId}:${scope.actorId}:${scope.listingId}`;
  const bounded = (raw: string) => {
    if (raw.length > 163840 || new TextEncoder().encode(raw).byteLength > 163840) return fail();
  };
  const envelope = (command: SyntheticReferenceDraftCommand) =>
    JSON.stringify({ schema: 'synthetic-reference-attempt-v1', ...scope, command });
  function inspect(raw: string) {
    bounded(raw);
    const row = own(parseVerificationJson(raw), [
      'schema',
      'instanceId',
      'tenantId',
      'actorId',
      'listingId',
      'command',
    ]);
    if (
      row.schema !== 'synthetic-reference-attempt-v1' ||
      Object.keys(scope).some((k) => row[k] !== scope[k as keyof ReferenceDraftScope])
    )
      return fail();
    const candidate = own(row.command, [
      'policy',
      'operationId',
      'listingId',
      'revision',
      'expectedVersion',
      'content',
      'selection',
    ]);
    if (
      candidate.policy !== 'synthetic-reference-draft-v1' ||
      uuid(candidate.listingId) !== scope.listingId ||
      !Number.isInteger(candidate.revision) ||
      Number(candidate.revision) < 1 ||
      Number(candidate.revision) > 2147483647
    )
      return fail();
    uuid(candidate.operationId);
    if (BigInt(version(candidate.expectedVersion)) >= 9007199254740991n) return fail();
    normalizeStaffDraftContentV2(candidate.content, true);
    const selected = own(candidate.selection, ['catalogueVersion', 'location', 'amenityIds']),
      catalogueVersion = version(selected.catalogueVersion);
    const location = own(selected.location, ['countyId', 'localityId', 'neighbourhoodId']);
    for (const value of Object.values(location)) if (value !== null) uuid(value);
    const ids = selected.amenityIds;
    if (
      !Array.isArray(ids) ||
      Object.getPrototypeOf(ids) !== Array.prototype ||
      ids.length > 50 ||
      Reflect.ownKeys(ids).length !== ids.length + 1
    )
      return fail();
    const captured: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const d = Object.getOwnPropertyDescriptor(ids, String(i));
      if (!d?.enumerable || !Object.hasOwn(d, 'value')) return fail();
      captured.push(uuid(d.value));
    }
    if (new Set(captured).size !== captured.length) return fail();
    return Object.freeze({ candidate: row.command, catalogueVersion }); // Deliberately untrusted until checked against the historical catalogue.
  }
  return Object.freeze({
    scope,
    load() {
      const raw = store.getItem(key);
      return raw === null ? null : inspect(raw);
    },
    retain(command: SyntheticReferenceDraftCommand, catalogue: ListingReferenceCatalogue) {
      const original = validateSyntheticReferenceDraftCommand(command, catalogue);
      if (original.listingId !== scope.listingId) return fail();
      const raw = envelope(original);
      bounded(raw);
      const previous = store.getItem(key);
      if (previous !== null && previous !== raw) return fail();
      store.setItem(key, raw);
      if (store.getItem(key) !== raw) return fail();
    },
    verify(command: SyntheticReferenceDraftCommand) {
      if (store.getItem(key) !== envelope(command)) return fail();
    },
    clear(command: SyntheticReferenceDraftCommand) {
      if (store.getItem(key) !== envelope(command)) return fail();
      store.removeItem(key);
      if (store.getItem(key) !== null) return fail();
    },
  });
}
type Session = ReturnType<typeof referenceDraftSession>;
export interface ReferenceDraftAttempt {
  readonly original: SyntheticReferenceDraftCommand;
  readonly status: 'ready' | 'sending' | 'uncertain' | 'received' | 'rejected';
  readonly receipt: SyntheticReferenceDraftReceipt | null;
  readonly canDiscard: boolean;
  submit(signal?: AbortSignal): Promise<SyntheticReferenceDraftReceipt>;
  recoverOriginal(signal?: AbortSignal): Promise<SyntheticReferenceDraftReceipt>;
  replayOriginal(signal?: AbortSignal): Promise<SyntheticReferenceDraftReceipt>;
  discard(): void;
}
function attempt(
  client: ReferenceDraftClient,
  session: Session,
  input: unknown,
  catalogueInput: unknown,
  restored: boolean,
): ReferenceDraftAttempt {
  const catalogue = validateListingReferenceCatalogue(catalogueInput),
    original = validateSyntheticReferenceDraftCommand(input, catalogue),
    actorId = session.scope.actorId;
  if (original.listingId !== session.scope.listingId) return fail();
  const create = client.create.bind(client),
    recover = client.recover.bind(client);
  let status: ReferenceDraftAttempt['status'] = restored ? 'uncertain' : 'ready',
    receipt: SyntheticReferenceDraftReceipt | null = null,
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
    if (mode === 'submit') session.retain(original, catalogue);
    else session.verify(original);
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
        receipt = validateSyntheticReferenceDraftReceipt(value, original, catalogue, actorId);
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
      if (session.load() !== null) session.clear(original);
      discarded = true;
    },
  });
}
export function prepareReferenceDraftAttempt(
  client: ReferenceDraftClient,
  session: Session,
  input: SyntheticReferenceDraftCommand,
  catalogue: ListingReferenceCatalogue,
): ReferenceDraftAttempt {
  if (session.load() !== null) return fail();
  return attempt(client, session, input, catalogue, false);
}
export async function restoreReferenceDraftAttempt(
  client: ReferenceDraftClient,
  session: Session,
  signal?: AbortSignal,
): Promise<ReferenceDraftAttempt | null> {
  const retained = session.load();
  if (retained === null) return null;
  if (signal?.aborted) throw new ApiClientError('CANCELLED', 'Request cancelled.');
  const catalogue = await client.catalogue(retained.catalogueVersion, signal);
  if (signal?.aborted) throw new ApiClientError('CANCELLED', 'Request cancelled.');
  const restored = attempt(client, session, retained.candidate, catalogue, true);
  session.verify(restored.original);
  return restored;
}
