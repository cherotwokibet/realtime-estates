import { DomainError } from './errors.js';
export interface StaffListingSummary {
  readonly listingId: string;
  readonly slug: string;
  readonly assignedAgentId: string;
  readonly version: string;
  readonly availability: 'available' | 'reserved' | 'rented' | 'sold' | 'withdrawn';
  readonly publicationStatus: 'unpublished' | 'published' | 'paused' | 'archived';
  readonly publishedRevision: number | null;
  readonly changedAt: string;
  readonly latest: Readonly<{
    revision: number;
    state: 'draft' | 'pending' | 'approved' | 'rejected';
    version: string;
    title: string | null;
    updatedAt: string;
  }> | null;
}
export interface StaffListingPage {
  readonly items: readonly StaffListingSummary[];
  readonly limit: number;
  readonly truncated: boolean;
}
/** One current authorized projection, bound to an independently selected route target. */
export function validateStaffListingSummary(
  input: unknown,
  expectedListingId: string,
): StaffListingSummary {
  const expected = uuid(expectedListingId);
  const summary = validateStaffListingPage({ items: [input], limit: 1, truncated: false }, 1)
    .items[0]!;
  if (summary.listingId !== expected) return invalid();
  return summary;
}
const invalid = (): never => {
  throw new DomainError('INVALID_STAFF_LISTING_PAGE', 'Invalid bounded staff listing page.');
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
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input)
  )
    return invalid();
  return input;
}
function version(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input.length > 16 ||
    !/^[1-9]\d*$/.test(input) ||
    String(BigInt(input)) !== input ||
    BigInt(input) > 9007199254740991n
  )
    return invalid();
  return input;
}
function revision(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 1 || input > 2147483647)
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
const clock = (s: string) => (s.length === 24 ? s.slice(0, 23) + '000Z' : s);
/** A current authorized read projection, never a total count or authority to edit a revision. */
export function validateStaffListingPage(input: unknown, limit = 25): StaffListingPage {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) return invalid();
  const p = record(input, ['items', 'limit', 'truncated']);
  if (
    p.limit !== limit ||
    typeof p.truncated !== 'boolean' ||
    !Array.isArray(p.items) ||
    Object.getPrototypeOf(p.items) !== Array.prototype ||
    p.items.length > limit ||
    Reflect.ownKeys(p.items).length !== p.items.length + 1 ||
    (p.truncated && p.items.length !== limit)
  )
    return invalid();
  const items: StaffListingSummary[] = [];
  for (let i = 0; i < p.items.length; i++) {
    const d = Object.getOwnPropertyDescriptor(p.items, String(i));
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
    const v = record(d.value, [
      'listingId',
      'slug',
      'assignedAgentId',
      'version',
      'availability',
      'publicationStatus',
      'publishedRevision',
      'changedAt',
      'latest',
    ]);
    const listingId = uuid(v.listingId),
      assignedAgentId = uuid(v.assignedAgentId),
      listingVersion = version(v.version),
      changedAt = instant(v.changedAt);
    if (
      typeof v.slug !== 'string' ||
      v.slug.length < 1 ||
      v.slug.length > 240 ||
      v.slug.trim() !== v.slug ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.slug) ||
      !['available', 'reserved', 'rented', 'sold', 'withdrawn'].includes(
        v.availability as string,
      ) ||
      !['unpublished', 'published', 'paused', 'archived'].includes(v.publicationStatus as string)
    )
      return invalid();
    const publishedRevision = v.publishedRevision === null ? null : revision(v.publishedRevision);
    let latest: StaffListingSummary['latest'] = null;
    if (v.latest !== null) {
      const x = record(v.latest, ['revision', 'state', 'version', 'title', 'updatedAt']),
        updatedAt = instant(x.updatedAt);
      if (
        !['draft', 'pending', 'approved', 'rejected'].includes(x.state as string) ||
        (x.title !== null &&
          (typeof x.title !== 'string' ||
            [...x.title].length > 160 ||
            x.title.trim().length < 1)) ||
        clock(updatedAt) > clock(changedAt)
      )
        return invalid();
      latest = Object.freeze({
        revision: revision(x.revision),
        state: x.state as NonNullable<StaffListingSummary['latest']>['state'],
        version: version(x.version),
        title: x.title as string | null,
        updatedAt,
      });
    }
    if (
      (publishedRevision !== null && (!latest || publishedRevision > latest.revision)) ||
      (v.publicationStatus === 'published' && publishedRevision === null) ||
      (latest && latest.state !== 'draft' && latest.title === null)
    )
      return invalid();
    const previous = items.at(-1);
    if (
      items.some((x) => x.listingId === listingId) ||
      (previous &&
        (clock(previous.changedAt) < clock(changedAt) ||
          (clock(previous.changedAt) === clock(changedAt) && previous.listingId <= listingId)))
    )
      return invalid();
    items.push(
      Object.freeze({
        listingId,
        slug: v.slug,
        assignedAgentId,
        version: listingVersion,
        availability: v.availability as StaffListingSummary['availability'],
        publicationStatus: v.publicationStatus as StaffListingSummary['publicationStatus'],
        publishedRevision,
        changedAt,
        latest,
      }),
    );
  }
  return Object.freeze({ items: Object.freeze(items), limit, truncated: p.truncated });
}
