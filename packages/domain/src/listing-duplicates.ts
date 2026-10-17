import { DomainError } from './errors.js';

export interface ListingDuplicateRequest {
  readonly listingId: string;
  readonly listingVersion: string;
  readonly revision: number;
  readonly revisionVersion: string;
  readonly limit: number;
}
export interface ListingDuplicateCandidate {
  readonly listingId: string;
  readonly slug: string;
  readonly listingVersion: string;
  readonly revision: number;
  readonly revisionVersion: string;
  readonly revisionState: 'draft' | 'pending' | 'approved' | 'rejected';
  readonly availability: 'available' | 'reserved' | 'rented' | 'sold' | 'withdrawn';
  readonly publicationStatus: 'unpublished' | 'published' | 'paused' | 'archived';
}
export interface ListingDuplicateCandidates {
  readonly kind: 'listing_duplicate_candidates';
  readonly policy: 'exact-current-work-v1';
  readonly target: Readonly<Omit<ListingDuplicateRequest, 'limit'>>;
  readonly comparison: 'compared' | 'insufficient_facts';
  readonly matches: readonly ListingDuplicateCandidate[];
  readonly hasMore: boolean;
}
function invalid(): never {
  throw new DomainError('INVALID_LISTING_DUPLICATES', 'Invalid listing duplicate candidates.');
}
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
  for (const key of fields) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
    out[key] = d.value;
  }
  return out;
}
function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  )
    return invalid();
  return value;
}
function version(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d{0,15}$/.test(value) ||
    BigInt(value) > 9007199254740991n
  )
    return invalid();
  return value;
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2147483647)
    return invalid();
  return value;
}
function target(row: Record<string, unknown>) {
  return Object.freeze({
    listingId: uuid(row.listingId),
    listingVersion: version(row.listingVersion),
    revision: revision(row.revision),
    revisionVersion: version(row.revisionVersion),
  });
}
const targetFields = ['listingId', 'listingVersion', 'revision', 'revisionVersion'] as const;
export function validateListingDuplicateRequest(input: unknown): ListingDuplicateRequest {
  const row = record(input, [...targetFields, 'limit']);
  if (
    typeof row.limit !== 'number' ||
    !Number.isInteger(row.limit) ||
    row.limit < 1 ||
    row.limit > 25
  )
    return invalid();
  return Object.freeze({ ...target(row), limit: row.limit });
}
export function validateListingDuplicateCandidates(
  input: unknown,
  request: ListingDuplicateRequest,
): ListingDuplicateCandidates {
  const expected = validateListingDuplicateRequest(request);
  const row = record(input, ['kind', 'policy', 'target', 'comparison', 'matches', 'hasMore']);
  const current = target(record(row.target, targetFields));
  if (
    row.kind !== 'listing_duplicate_candidates' ||
    row.policy !== 'exact-current-work-v1' ||
    targetFields.some((key) => current[key] !== expected[key]) ||
    !['compared', 'insufficient_facts'].includes(row.comparison as string) ||
    typeof row.hasMore !== 'boolean'
  )
    return invalid();
  const items = row.matches;
  if (
    !Array.isArray(items) ||
    Object.getPrototypeOf(items) !== Array.prototype ||
    items.length > expected.limit ||
    Reflect.ownKeys(items).length !== items.length + 1 ||
    (row.hasMore && items.length !== expected.limit) ||
    (row.comparison === 'insufficient_facts' && (items.length !== 0 || row.hasMore))
  )
    return invalid();
  let previous = '';
  const matches = Array.from({ length: items.length }, (_, index): ListingDuplicateCandidate => {
    const d = Object.getOwnPropertyDescriptor(items, String(index));
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
    const item = record(d.value, [
      ...targetFields,
      'slug',
      'revisionState',
      'availability',
      'publicationStatus',
    ]);
    const tuple = target(item);
    if (
      tuple.listingId === expected.listingId ||
      tuple.listingId <= previous ||
      typeof item.slug !== 'string' ||
      item.slug.length > 160 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug) ||
      !['draft', 'pending', 'approved', 'rejected'].includes(item.revisionState as string) ||
      !['available', 'reserved', 'rented', 'sold', 'withdrawn'].includes(
        item.availability as string,
      ) ||
      !['unpublished', 'published', 'paused', 'archived'].includes(item.publicationStatus as string)
    )
      return invalid();
    previous = tuple.listingId;
    return Object.freeze({
      ...tuple,
      slug: item.slug,
      revisionState: item.revisionState as ListingDuplicateCandidate['revisionState'],
      availability: item.availability as ListingDuplicateCandidate['availability'],
      publicationStatus: item.publicationStatus as ListingDuplicateCandidate['publicationStatus'],
    });
  });
  return Object.freeze({
    kind: 'listing_duplicate_candidates',
    policy: 'exact-current-work-v1',
    target: current,
    comparison: row.comparison as ListingDuplicateCandidates['comparison'],
    matches: Object.freeze(matches),
    hasMore: row.hasMore,
  });
}
