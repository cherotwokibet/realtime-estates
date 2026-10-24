import { DomainError } from './errors.js';
import {
  validateListingCreationCommand,
  validateListingCreationReceipt,
  type ListingCreationCommand,
  type ListingCreationReceipt,
} from './listing-creation.js';
import {
  validateSyntheticReferenceDraftCommand,
  validateSyntheticReferenceDraftReceipt,
  type SyntheticReferenceDraftCommand,
  type SyntheticReferenceDraftReceipt,
} from './listing-reference-draft.js';
import {
  snapshotListingReferenceAttributes,
  type ListingReferenceSelection,
} from './listing-reference-catalogue.js';

export const SYNTHETIC_REFERENCE_CREATION_REQUEST_MAX_BYTES = 131072;
export const SYNTHETIC_REFERENCE_CREATION_MAX_BYTES = 2 * 131072 + 128;
export interface SyntheticReferenceCreationCommand extends ListingCreationCommand {
  readonly policy: 'synthetic-reference-creation-v1';
  readonly selection: ListingReferenceSelection;
}
export interface SyntheticReferenceCreationReceipt {
  readonly policy: 'synthetic-reference-creation-v1';
  readonly creation: Extract<ListingCreationReceipt, { outcome: 'created' }>;
  readonly referenceDraft: SyntheticReferenceDraftReceipt;
}
const invalid = (): never => {
  throw new DomainError(
    'INVALID_REFERENCE_CREATION',
    'Invalid synthetic reference creation facts.',
  );
};
function own(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return invalid();
  const actual = Reflect.ownKeys(input);
  if (
    actual.length !== keys.length ||
    actual.some((k) => typeof k !== 'string' || !keys.includes(k))
  )
    return invalid();
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
    out[key] = d.value;
  }
  return out;
}
const bytes = (input: unknown) => new TextEncoder().encode(JSON.stringify(input)).byteLength;
/** Initial immutable allocation and reference adoption have distinct editorial versions. */
export function syntheticReferenceCreationDraftCommand(
  command: SyntheticReferenceCreationCommand,
): SyntheticReferenceDraftCommand {
  return Object.freeze({
    policy: 'synthetic-reference-draft-v1',
    operationId: command.operationId,
    listingId: command.listingId,
    revision: 1,
    expectedVersion: '2',
    content: command.content,
    selection: command.selection,
  });
}
export function validateSyntheticReferenceCreationCommand(
  input: unknown,
  originalCatalogue: unknown,
): SyntheticReferenceCreationCommand {
  const v = own(input, ['policy', 'operationId', 'listingId', 'slug', 'content', 'selection']);
  if (v.policy !== 'synthetic-reference-creation-v1') return invalid();
  const base = validateListingCreationCommand({
    operationId: v.operationId,
    listingId: v.listingId,
    slug: v.slug,
    content: v.content,
  });
  if (base.operationId !== v.operationId || base.listingId !== v.listingId) return invalid();
  const draft = validateSyntheticReferenceDraftCommand(
    {
      policy: 'synthetic-reference-draft-v1',
      operationId: v.operationId,
      listingId: v.listingId,
      revision: 1,
      expectedVersion: '2',
      content: v.content,
      selection: v.selection,
    },
    originalCatalogue,
  );
  const command = Object.freeze({
    policy: 'synthetic-reference-creation-v1' as const,
    ...base,
    content: draft.content,
    selection: draft.selection,
  });
  // Reserve enough response capacity before a write. This prevents a valid large
  // request committing an original that could never pass its recovery parser.
  const actor = '00000000-0000-4000-8000-000000000001';
  const referenceDraft = Object.freeze({
    ...draft,
    actorId: actor,
    revisionVersion: '3',
    attributes: snapshotListingReferenceAttributes(
      draft.selection,
      originalCatalogue,
      draft.content.propertyType,
    ),
  });
  const creation = {
    operationId: base.operationId,
    listingId: base.listingId,
    actorId: actor,
    kind: 'create_listing',
    request: { slug: base.slug, content: draft.content },
    outcome: 'created',
    reason: null,
    result: { listingVersion: '1', revision: 1, revisionVersion: '2' },
    completedAt: '2000-01-01T00:00:00.000000Z',
  };
  if (
    bytes(command) > SYNTHETIC_REFERENCE_CREATION_REQUEST_MAX_BYTES ||
    bytes(referenceDraft) > 131072 ||
    bytes(creation) > 131072 ||
    bytes({ policy: command.policy, creation, referenceDraft }) >
      SYNTHETIC_REFERENCE_CREATION_MAX_BYTES
  )
    return invalid();
  return command;
}
/** Match the full retained command, original catalogue and current verified actor. */
export function validateSyntheticReferenceCreationReceipt(
  input: unknown,
  commandInput: unknown,
  originalCatalogue: unknown,
  expectedActorId: string,
): SyntheticReferenceCreationReceipt {
  const command = validateSyntheticReferenceCreationCommand(commandInput, originalCatalogue),
    v = own(input, ['policy', 'creation', 'referenceDraft']);
  if (v.policy !== command.policy) return invalid();
  const creation = validateListingCreationReceipt(
    v.creation,
    {
      operationId: command.operationId,
      listingId: command.listingId,
      slug: command.slug,
      content: command.content,
    },
    expectedActorId,
  );
  if (creation.outcome !== 'created') return invalid();
  const referenceDraft = validateSyntheticReferenceDraftReceipt(
    v.referenceDraft,
    syntheticReferenceCreationDraftCommand(command),
    originalCatalogue,
    expectedActorId,
  );
  const receipt = Object.freeze({ policy: command.policy, creation, referenceDraft });
  if (bytes(receipt) > SYNTHETIC_REFERENCE_CREATION_MAX_BYTES) return invalid();
  return receipt;
}
