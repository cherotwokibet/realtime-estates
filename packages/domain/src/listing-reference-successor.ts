import { DomainError } from './errors.js';
import {
  validateListingSuccessorCommand,
  validateListingSuccessorReceipt,
  type ListingSuccessorCommand,
  type ListingSuccessorReceipt,
} from './listing-successor.js';
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

export const SYNTHETIC_REFERENCE_SUCCESSOR_REQUEST_MAX_BYTES = 131072;
export const SYNTHETIC_REFERENCE_SUCCESSOR_MAX_BYTES = 2 * 131072 + 128;
export interface SyntheticReferenceSuccessorCommand extends ListingSuccessorCommand {
  readonly policy: 'synthetic-reference-successor-v1';
  readonly selection: ListingReferenceSelection;
}
export interface SyntheticReferenceSuccessorReceipt {
  readonly policy: 'synthetic-reference-successor-v1';
  readonly successor: Omit<ListingSuccessorReceipt, 'decision'> &
    Readonly<{ decision: Extract<ListingSuccessorReceipt['decision'], { outcome: 'applied' }> }>;
  readonly referenceDraft: SyntheticReferenceDraftReceipt;
}
const invalid = (): never => {
  throw new DomainError(
    'INVALID_REFERENCE_SUCCESSOR',
    'Invalid synthetic reference successor facts.',
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
// Compare against a bounded validated tree without evaluating untrusted getters.
function same(input: unknown, expected: unknown): void {
  if (Array.isArray(expected)) {
    if (
      !Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Array.prototype ||
      Object.getOwnPropertyDescriptor(input, 'length')?.value !== expected.length ||
      Reflect.ownKeys(input).length !== expected.length + 1
    )
      return invalid();
    for (let i = 0; i < expected.length; i++) {
      const d = Object.getOwnPropertyDescriptor(input, String(i));
      if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
      same(d.value, expected[i]);
    }
  } else if (expected !== null && typeof expected === 'object') {
    const keys = Object.keys(expected),
      v = own(input, keys);
    for (const key of keys) same(v[key], (expected as Record<string, unknown>)[key]);
  } else if (input !== expected) return invalid();
}
const bytes = (input: unknown) => new TextEncoder().encode(JSON.stringify(input)).byteLength;
/** Only use a validated command; initial editorial versions are historical facts. */
export function syntheticReferenceSuccessorDraftCommand(
  command: SyntheticReferenceSuccessorCommand,
): SyntheticReferenceDraftCommand {
  return Object.freeze({
    policy: 'synthetic-reference-draft-v1',
    operationId: command.operationId,
    listingId: command.listingId,
    revision: command.predecessor.revision + 1,
    expectedVersion: '2',
    content: command.content,
    selection: command.selection,
  });
}
export function validateSyntheticReferenceSuccessorCommand(
  input: unknown,
  originalCatalogue: unknown,
): SyntheticReferenceSuccessorCommand {
  const v = own(input, [
    'policy',
    'operationId',
    'listingId',
    'expectedListingVersion',
    'predecessor',
    'content',
    'selection',
  ]);
  if (v.policy !== 'synthetic-reference-successor-v1') return invalid();
  const base = validateListingSuccessorCommand({
    operationId: v.operationId,
    listingId: v.listingId,
    expectedListingVersion: v.expectedListingVersion,
    predecessor: v.predecessor,
    content: v.content,
  });
  // This composition has applied originals only. Reject exhausted allocation
  // counters before deriving the new revision or reserving response capacity.
  if (
    base.operationId !== v.operationId ||
    base.listingId !== v.listingId ||
    base.predecessor.revision === 2147483647 ||
    base.expectedListingVersion === '9007199254740991'
  )
    return invalid();
  const draft = validateSyntheticReferenceDraftCommand(
    {
      policy: 'synthetic-reference-draft-v1',
      operationId: v.operationId,
      listingId: v.listingId,
      revision: base.predecessor.revision + 1,
      expectedVersion: '2',
      content: v.content,
      selection: v.selection,
    },
    originalCatalogue,
  );
  const command = Object.freeze({
    policy: 'synthetic-reference-successor-v1' as const,
    ...base,
    content: draft.content,
    selection: draft.selection,
  });
  const actorId = '00000000-0000-4000-8000-000000000001';
  const referenceDraft = {
    ...draft,
    actorId,
    revisionVersion: '3',
    attributes: snapshotListingReferenceAttributes(
      draft.selection,
      originalCatalogue,
      draft.content.propertyType,
    ),
  };
  const successor = {
    operationId: base.operationId,
    listingId: base.listingId,
    actorId,
    kind: 'start_revision',
    request: {
      expectedListingVersion: base.expectedListingVersion,
      predecessor: base.predecessor,
      content: draft.content,
    },
    decision: {
      outcome: 'applied',
      reason: null,
      result: {
        listingVersion: (BigInt(base.expectedListingVersion) + 1n).toString(),
        revision: draft.revision,
        revisionVersion: '2',
      },
    },
    completedAt: '2000-01-01T00:00:00.000000Z',
  };
  if (
    bytes(command) > SYNTHETIC_REFERENCE_SUCCESSOR_REQUEST_MAX_BYTES ||
    bytes(referenceDraft) > 131072 ||
    bytes(successor) > 131072 ||
    bytes({ policy: command.policy, successor, referenceDraft }) >
      SYNTHETIC_REFERENCE_SUCCESSOR_MAX_BYTES
  )
    return invalid();
  return command;
}
/** Supply the retained original catalogue and the currently verified actor. */
export function validateSyntheticReferenceSuccessorReceipt(
  input: unknown,
  commandInput: unknown,
  originalCatalogue: unknown,
  expectedActorId: string,
): SyntheticReferenceSuccessorReceipt {
  const command = validateSyntheticReferenceSuccessorCommand(commandInput, originalCatalogue);
  const v = own(input, ['policy', 'successor', 'referenceDraft']);
  if (v.policy !== command.policy) return invalid();
  const successor = validateListingSuccessorReceipt(
    v.successor,
    {
      operationId: command.operationId,
      listingId: command.listingId,
      expectedListingVersion: command.expectedListingVersion,
      predecessor: command.predecessor,
      content: command.content,
    },
    expectedActorId,
  );
  if (successor.decision.outcome !== 'applied') return invalid();
  // The legacy base validator normalizes some facts. A composed original must
  // instead retain the exact canonical private text, IDs and predecessor shape.
  same(v.successor, successor);
  const referenceDraft = validateSyntheticReferenceDraftReceipt(
    v.referenceDraft,
    syntheticReferenceSuccessorDraftCommand(command),
    originalCatalogue,
    expectedActorId,
  );
  const receipt = Object.freeze({
    policy: command.policy,
    successor: Object.freeze({ ...successor, decision: successor.decision }),
    referenceDraft,
  });
  if (
    bytes(successor) > 131072 ||
    bytes(referenceDraft) > 131072 ||
    bytes(receipt) > SYNTHETIC_REFERENCE_SUCCESSOR_MAX_BYTES
  )
    return invalid();
  return receipt;
}
