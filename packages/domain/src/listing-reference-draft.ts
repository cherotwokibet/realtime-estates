import { DomainError } from './errors.js';
import { normalizeStaffDraftContentV2, type StaffDraftContentV2 } from './staff-draft-content.js';
import {
  selectListingReferenceAttributes,
  snapshotListingReferenceAttributes,
  type ListingReferenceSelection,
} from './listing-reference-catalogue.js';

export interface SyntheticReferenceDraftCommand {
  readonly policy: 'synthetic-reference-draft-v1';
  readonly operationId: string;
  readonly listingId: string;
  readonly revision: number;
  readonly expectedVersion: string;
  readonly content: StaffDraftContentV2;
  readonly selection: ListingReferenceSelection;
}
export interface SyntheticReferenceDraftReceipt extends SyntheticReferenceDraftCommand {
  readonly actorId: string;
  readonly revisionVersion: string;
  readonly attributes: ReturnType<typeof snapshotListingReferenceAttributes>;
}
const fields = [
  'policy',
  'operationId',
  'listingId',
  'revision',
  'expectedVersion',
  'content',
  'selection',
] as const;
const invalid = (): never => {
  throw new DomainError('INVALID_REFERENCE_DRAFT', 'Invalid synthetic reference draft facts.');
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
function uuid(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input.length !== 36 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input)
  )
    return invalid();
  return input;
}
/** Compare only against a bounded validated shape; never enumerate an unbounded input tree or execute its getters. */
function same(input: unknown, expected: unknown): void {
  if (Array.isArray(expected)) {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return invalid();
    const length = Object.getOwnPropertyDescriptor(input, 'length')?.value;
    if (length !== expected.length || Reflect.ownKeys(input).length !== expected.length + 1)
      return invalid();
    for (let i = 0; i < expected.length; i++) {
      const d = Object.getOwnPropertyDescriptor(input, String(i));
      if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
      same(d.value, expected[i]);
    }
  } else if (expected !== null && typeof expected === 'object') {
    const keys = Object.keys(expected),
      captured = own(input, keys);
    for (const key of keys) same(captured[key], (expected as Record<string, unknown>)[key]);
  } else if (input !== expected) return invalid();
}
/** Catalogue must be server-controlled for writes. This contract grants no access or publication authority. */
export function validateSyntheticReferenceDraftCommand(
  input: unknown,
  catalogueInput: unknown,
): SyntheticReferenceDraftCommand {
  const value = own(input, fields);
  if (
    value.policy !== 'synthetic-reference-draft-v1' ||
    typeof value.revision !== 'number' ||
    !Number.isInteger(value.revision) ||
    value.revision < 1 ||
    value.revision > 2147483647 ||
    typeof value.expectedVersion !== 'string' ||
    value.expectedVersion.length > 16 ||
    !/^[1-9]\d*$/.test(value.expectedVersion) ||
    BigInt(value.expectedVersion) >= 9007199254740991n
  )
    return invalid();
  const content = normalizeStaffDraftContentV2(value.content, true);
  same(value.content, content); // Require explicit canonical full replacement, not defaulting or silent trimming.
  const selection = selectListingReferenceAttributes(
    value.selection,
    catalogueInput,
    content.propertyType,
  );
  const attributes = snapshotListingReferenceAttributes(
    selection,
    catalogueInput,
    content.propertyType,
  );
  const location = Object.freeze({
    county: attributes.location.county?.label ?? null,
    town: attributes.location.locality?.label ?? null,
    area: attributes.location.neighbourhood?.label ?? null,
  });
  same(content.location, location);
  // Explicit adoption removes the old independent locality fact, rather than silently retaining contradictory text.
  if (content.locality !== (location.area ?? location.town ?? location.county)) return invalid();
  return Object.freeze({
    policy: 'synthetic-reference-draft-v1',
    operationId: uuid(value.operationId),
    listingId: uuid(value.listingId),
    revision: value.revision,
    expectedVersion: value.expectedVersion,
    content,
    selection,
  });
}
/** Pass the retained ORIGINAL catalogue for recovery, never the latest catalogue. Actor comes from verified context. */
export function validateSyntheticReferenceDraftReceipt(
  input: unknown,
  commandInput: unknown,
  originalCatalogue: unknown,
  expectedActorId: string,
): SyntheticReferenceDraftReceipt {
  const command = validateSyntheticReferenceDraftCommand(commandInput, originalCatalogue);
  const expected = Object.freeze({
    ...command,
    actorId: uuid(expectedActorId),
    revisionVersion: (BigInt(command.expectedVersion) + 1n).toString(),
    attributes: snapshotListingReferenceAttributes(
      command.selection,
      originalCatalogue,
      command.content.propertyType,
    ),
  });
  same(input, expected);
  return expected;
}
