import { DomainError } from './errors.js';
import { normalizeStaffDraftContentV2, type StaffDraftContentV2 } from './staff-draft-content.js';
export interface ListingCreationCommand {
  readonly operationId: string;
  readonly listingId: string;
  readonly slug: string;
  readonly content: StaffDraftContentV2;
}
interface CreationBase {
  readonly operationId: string;
  readonly listingId: string;
  readonly actorId: string;
  readonly kind: 'create_listing';
  readonly request: Readonly<{ slug: string; content: StaffDraftContentV2 }>;
  readonly completedAt: string;
}
export type ListingCreationReceipt = CreationBase &
  (
    | {
        readonly outcome: 'created';
        readonly reason: null;
        readonly result: Readonly<{ listingVersion: '1'; revision: 1; revisionVersion: '2' }>;
      }
    | { readonly outcome: 'refused'; readonly reason: 'TARGET_UNAVAILABLE'; readonly result: null }
  );
const invalid = (): never => {
  throw new DomainError('INVALID_LISTING_CREATION', 'Invalid listing creation facts.');
};
function record(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return invalid();
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== fields.length ||
    keys.some((k) => typeof k !== 'string' || !fields.includes(k))
  )
    return invalid();
  const out: Record<string, unknown> = {};
  for (const k of fields) {
    const d = Object.getOwnPropertyDescriptor(input, k);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
    out[k] = d.value;
  }
  return out;
}
function uuid(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input.length !== 36 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input)
  )
    return invalid();
  return input.toLowerCase();
}
function slug(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input.length < 1 ||
    input.length > 160 ||
    input.trim() !== input ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input)
  )
    return invalid();
  return input;
}
function instant(input: unknown): string {
  if (
    typeof input !== 'string' ||
    ![24, 27].includes(input.length) ||
    !/^(?!0000)\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}(?:\d{3})?Z$/.test(input)
  )
    return invalid();
  const ms = input.slice(0, 23) + 'Z';
  if (!Number.isFinite(Date.parse(ms)) || new Date(ms).toISOString() !== ms) return invalid();
  return input;
}
export function validateListingCreationCommand(input: unknown): ListingCreationCommand {
  const v = record(input, ['operationId', 'listingId', 'slug', 'content']);
  return Object.freeze({
    operationId: uuid(v.operationId),
    listingId: uuid(v.listingId),
    slug: slug(v.slug),
    content: normalizeStaffDraftContentV2(v.content),
  });
}
/** Immutable initial result; never a claim about the current editable or published revision. */
export function validateListingCreationReceipt(
  input: unknown,
  commandInput: ListingCreationCommand,
  expectedActorId?: string,
): ListingCreationReceipt {
  const command = validateListingCreationCommand(commandInput),
    v = record(input, [
      'operationId',
      'listingId',
      'actorId',
      'kind',
      'request',
      'outcome',
      'reason',
      'result',
      'completedAt',
    ]),
    request = record(v.request, ['slug', 'content']),
    content = normalizeStaffDraftContentV2(request.content, true),
    actorId = uuid(v.actorId);
  if (
    v.operationId !== command.operationId ||
    v.listingId !== command.listingId ||
    v.actorId !== actorId ||
    v.kind !== 'create_listing' ||
    request.slug !== command.slug ||
    JSON.stringify(content) !== JSON.stringify(command.content) ||
    (expectedActorId !== undefined && actorId !== uuid(expectedActorId))
  )
    return invalid();
  const base = Object.freeze({
    operationId: command.operationId,
    listingId: command.listingId,
    actorId,
    kind: 'create_listing' as const,
    request: Object.freeze({ slug: command.slug, content }),
    completedAt: instant(v.completedAt),
  });
  if (v.outcome === 'refused') {
    if (v.reason !== 'TARGET_UNAVAILABLE' || v.result !== null) return invalid();
    return Object.freeze({
      ...base,
      outcome: 'refused',
      reason: 'TARGET_UNAVAILABLE',
      result: null,
    });
  }
  if (v.outcome !== 'created' || v.reason !== null) return invalid();
  const result = record(v.result, ['listingVersion', 'revision', 'revisionVersion']);
  if (result.listingVersion !== '1' || result.revision !== 1 || result.revisionVersion !== '2')
    return invalid();
  return Object.freeze({
    ...base,
    outcome: 'created',
    reason: null,
    result: Object.freeze({ listingVersion: '1', revision: 1, revisionVersion: '2' }),
  });
}
export function validateListingCreationSnapshot(
  input: unknown,
  listingId?: string,
  operationId?: string,
): ListingCreationReceipt {
  const v = record(input, [
      'operationId',
      'listingId',
      'actorId',
      'kind',
      'request',
      'outcome',
      'reason',
      'result',
      'completedAt',
    ]),
    request = record(v.request, ['slug', 'content']);
  const command = validateListingCreationCommand({
    operationId: v.operationId,
    listingId: v.listingId,
    slug: request.slug,
    content: normalizeStaffDraftContentV2(request.content, true),
  });
  if (
    (listingId !== undefined && command.listingId !== uuid(listingId)) ||
    (operationId !== undefined && command.operationId !== uuid(operationId))
  )
    return invalid();
  return validateListingCreationReceipt(input, command);
}
