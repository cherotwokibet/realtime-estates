import { DomainError, requireTimestamp } from './errors.js';
import {
  normalizeStaffDraftContentV2,
  type StaffDraftPropertyTypeV2,
} from './staff-draft-content.js';
import {
  snapshotListingReferenceAttributes,
  validateListingReferenceCatalogue,
  type ListingReferenceCatalogue,
} from './listing-reference-catalogue.js';
import type { StaffListingSummary } from './staff-listings.js';

export const SYNTHETIC_REFERENCE_MODERATION_MAX_BYTES = 131072;
export const SYNTHETIC_REFERENCE_CONTEXT_MAX_BYTES = 6 * 1024 * 1024 + 131072 + 128;
const invalid = (): never => {
  throw new DomainError(
    'INVALID_REFERENCE_MODERATION',
    'Invalid synthetic reference moderation facts.',
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
function array(input: unknown, max: number): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return invalid();
  const length = Object.getOwnPropertyDescriptor(input, 'length')?.value;
  if (
    !Number.isInteger(length) ||
    length < 0 ||
    length > max ||
    Reflect.ownKeys(input).length !== length + 1
  )
    return invalid();
  return Array.from({ length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(input, String(i));
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
    return d.value;
  });
}
function same(input: unknown, expected: unknown): void {
  if (Array.isArray(expected)) {
    const captured = array(input, expected.length);
    if (captured.length !== expected.length) return invalid();
    captured.forEach((v, i) => same(v, expected[i]));
  } else if (expected !== null && typeof expected === 'object') {
    const captured = own(input, Object.keys(expected));
    for (const key of Object.keys(expected))
      same(captured[key], (expected as Record<string, unknown>)[key]);
  } else if (input !== expected) return invalid();
}
function uuid(v: unknown): string {
  if (
    typeof v !== 'string' ||
    v.length !== 36 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)
  )
    return invalid();
  return v;
}
function version(v: unknown): string {
  if (typeof v !== 'string' || !/^[1-9]\d{0,15}$/.test(v) || BigInt(v) > 9007199254740991n)
    return invalid();
  return v;
}
function revision(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 2147483647) return invalid();
  return v;
}
function text(v: unknown, max: number): string {
  if (
    typeof v !== 'string' ||
    v.length > max * 2 ||
    v.trim() !== v ||
    [...v].length < 1 ||
    [...v].length > max ||
    /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(v)
  )
    return invalid();
  return v;
}
/** Serialize only detached, bounded canonical data, never caller-owned objects. Transport must also cap raw bytes before parsing. */
function bounded<T>(v: T): T {
  if (
    new TextEncoder().encode(JSON.stringify(v)).byteLength >
    SYNTHETIC_REFERENCE_MODERATION_MAX_BYTES
  )
    return invalid();
  return v;
}
export interface SyntheticReferenceRevision {
  readonly policy: 'synthetic-reference-revision-v1';
  readonly listingId: string;
  readonly revision: number;
  readonly listingVersion: string;
  readonly revisionVersion: string;
  readonly state: 'draft' | 'pending' | 'approved' | 'rejected';
  readonly availability: StaffListingSummary['availability'];
  readonly availabilityConfirmedAt: string | null;
  readonly publicationStatus: StaffListingSummary['publicationStatus'];
  readonly publishedRevision: number | null;
  readonly content: ReturnType<typeof normalizeStaffDraftContentV2>;
  readonly attributes: ReturnType<typeof snapshotListingReferenceAttributes>;
  readonly photos: readonly Readonly<{
    id: string;
    position: number;
    altText: string;
    accepted: boolean;
    sha256: string;
    sealed: boolean;
  }>[];
}
function attributesFromOriginal(
  input: unknown,
  originalCatalogue: unknown,
  propertyType: StaffDraftPropertyTypeV2 | null,
) {
  const a = own(input, ['catalogueVersion', 'country', 'location', 'amenities']);
  const location = own(a.location, ['county', 'locality', 'neighbourhood']);
  const locationId = (v: unknown) => (v === null ? null : uuid(own(v, ['id', 'label']).id));
  const selection = {
    catalogueVersion: a.catalogueVersion,
    location: {
      countyId: locationId(location.county),
      localityId: locationId(location.locality),
      neighbourhoodId: locationId(location.neighbourhood),
    },
    amenityIds: array(a.amenities, 50).map((v) => uuid(own(v, ['id', 'code', 'label']).id)),
  };
  const attributes = snapshotListingReferenceAttributes(selection, originalCatalogue, propertyType);
  same(input, attributes);
  return attributes;
}
/** Only the two-field public reference extension, never a complete listing or private review. Public listing validation and SQL publication/tenant gating remain mandatory. */
export function validateSyntheticReferencePublicAttributes(
  input: unknown,
  originalCatalogue: unknown,
  propertyType: StaffDraftPropertyTypeV2 | null,
) {
  const p = own(input, ['attributes', 'revisionVersion']);
  if (p.attributes === null) {
    if (p.revisionVersion !== null) return invalid();
    return Object.freeze({ attributes: null, revisionVersion: null });
  }
  const revisionVersion = version(p.revisionVersion);
  if (BigInt(revisionVersion) < 2n) return invalid();
  return bounded(
    Object.freeze({
      attributes: attributesFromOriginal(p.attributes, originalCatalogue, propertyType),
      revisionVersion,
    }),
  );
}
/** Private staff projection. Original catalogue is server-controlled historical data, never the latest catalogue or caller authority. */
export function validateSyntheticReferenceRevision(
  input: unknown,
  originalCatalogue: unknown,
  listingId: string,
  revisionNo: number,
  expectedVersion: string,
): SyntheticReferenceRevision {
  const r = own(input, [
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
  if (
    r.policy !== 'synthetic-reference-revision-v1' ||
    r.listingId !== uuid(listingId) ||
    r.revision !== revision(revisionNo) ||
    r.revisionVersion !== version(expectedVersion) ||
    !['draft', 'pending', 'approved', 'rejected'].includes(r.state as string) ||
    !['available', 'reserved', 'rented', 'sold', 'withdrawn'].includes(r.availability as string) ||
    !['unpublished', 'published', 'paused', 'archived'].includes(r.publicationStatus as string)
  )
    return invalid();
  const listingVersion = version(r.listingVersion),
    content = normalizeStaffDraftContentV2(r.content, true);
  same(r.content, content);
  const attributes = attributesFromOriginal(r.attributes, originalCatalogue, content.propertyType);
  const labels = {
    county: attributes.location.county?.label ?? null,
    town: attributes.location.locality?.label ?? null,
    area: attributes.location.neighbourhood?.label ?? null,
  };
  same(content.location, labels);
  if (content.locality !== (labels.area ?? labels.town ?? labels.county)) return invalid();
  const publishedRevision = r.publishedRevision === null ? null : revision(r.publishedRevision);
  if (r.publicationStatus === 'published' && publishedRevision === null) return invalid();
  let availabilityConfirmedAt: string | null = null;
  if (r.availabilityConfirmedAt !== null) {
    if (
      typeof r.availabilityConfirmedAt !== 'string' ||
      r.availabilityConfirmedAt.length !== 24 ||
      requireTimestamp(r.availabilityConfirmedAt) !== r.availabilityConfirmedAt
    )
      return invalid();
    availabilityConfirmedAt = r.availabilityConfirmedAt;
  }
  const ids = new Set<string>();
  let previous = -1;
  const photos = array(r.photos, 12).map((v) => {
    const p = own(v, ['id', 'position', 'altText', 'accepted', 'sha256', 'sealed']),
      id = uuid(p.id);
    if (
      ids.has(id) ||
      typeof p.position !== 'number' ||
      !Number.isInteger(p.position) ||
      p.position < 0 ||
      p.position > 11 ||
      p.position <= previous ||
      typeof p.accepted !== 'boolean' ||
      typeof p.sealed !== 'boolean' ||
      typeof p.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(p.sha256)
    )
      return invalid();
    ids.add(id);
    previous = p.position;
    return Object.freeze({
      id,
      position: p.position,
      altText: text(p.altText, 300),
      accepted: p.accepted,
      sha256: p.sha256,
      sealed: p.sealed,
    });
  });
  return bounded(
    Object.freeze({
      policy: 'synthetic-reference-revision-v1',
      listingId,
      revision: revisionNo,
      listingVersion,
      revisionVersion: expectedVersion,
      state: r.state as SyntheticReferenceRevision['state'],
      availability: r.availability as SyntheticReferenceRevision['availability'],
      availabilityConfirmedAt,
      publicationStatus: r.publicationStatus as SyntheticReferenceRevision['publicationStatus'],
      publishedRevision,
      content,
      attributes,
      photos: Object.freeze(photos),
    }),
  );
}
export interface SyntheticReferenceContext {
  readonly policy: 'synthetic-reference-context-v1';
  readonly review: SyntheticReferenceRevision;
  readonly catalogue: ListingReferenceCatalogue;
}
/** Initial discovery uses the saved snapshot's catalogue, never the active catalogue pointer. */
export function validateSyntheticReferenceContext(
  input: unknown,
  listingId: string,
  revisionNo: number,
  expectedVersion: string,
  kind: 'revision' | 'review',
): SyntheticReferenceContext {
  const c = own(input, ['policy', 'review', 'catalogue']);
  if (c.policy !== 'synthetic-reference-context-v1' || !['revision', 'review'].includes(kind))
    return invalid();
  const catalogue = validateListingReferenceCatalogue(c.catalogue);
  if (new TextEncoder().encode(JSON.stringify(catalogue)).byteLength > 6 * 1024 * 1024)
    return invalid();
  const review = validateSyntheticReferenceRevision(
    c.review,
    catalogue,
    listingId,
    revisionNo,
    expectedVersion,
  );
  if (kind === 'review' && review.state !== 'pending') return invalid();
  return Object.freeze({ policy: 'synthetic-reference-context-v1', review, catalogue });
}
export type SyntheticReferenceAction = 'submit' | 'withdraw' | 'approve' | 'reject';
export interface SyntheticReferenceTransitionCommand {
  readonly policy: 'synthetic-reference-transition-v1';
  readonly operationId: string;
  readonly action: SyntheticReferenceAction;
  readonly listingId: string;
  readonly revision: number;
  readonly review: SyntheticReferenceRevision;
  readonly reason: string | null;
}
export interface SyntheticReferenceTransitionReceipt extends SyntheticReferenceTransitionCommand {
  readonly actorId: string;
  readonly revisionVersion: string;
  readonly state: SyntheticReferenceRevision['state'];
}
/** This validates facts, not staff authorization, completeness, sealed bytes, freshness or publication eligibility. */
export function validateSyntheticReferenceTransitionCommand(
  input: unknown,
  originalCatalogue: unknown,
): SyntheticReferenceTransitionCommand {
  const c = own(input, [
    'policy',
    'operationId',
    'action',
    'listingId',
    'revision',
    'review',
    'reason',
  ]);
  if (
    c.policy !== 'synthetic-reference-transition-v1' ||
    !['submit', 'withdraw', 'approve', 'reject'].includes(c.action as string)
  )
    return invalid();
  const listingId = uuid(c.listingId),
    revisionNo = revision(c.revision);
  const reviewFields = own(c.review, [
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
  const review = validateSyntheticReferenceRevision(
    c.review,
    originalCatalogue,
    listingId,
    revisionNo,
    version(reviewFields.revisionVersion),
  );
  if (
    review.state !== (c.action === 'submit' ? 'draft' : 'pending') ||
    BigInt(review.revisionVersion) >= 9007199254740991n ||
    BigInt(review.listingVersion) >= 9007199254740991n
  )
    return invalid();
  const reason = c.action === 'reject' ? text(c.reason, 2000) : null;
  if (c.action !== 'reject' && c.reason !== null) return invalid();
  return bounded(
    Object.freeze({
      policy: 'synthetic-reference-transition-v1',
      operationId: uuid(c.operationId),
      action: c.action as SyntheticReferenceAction,
      listingId,
      revision: revisionNo,
      review,
      reason,
    }),
  );
}
/** Recover only against the retained ORIGINAL command/catalogue and currently verified actor. Never synthesize success after an uncertain response. */
export function validateSyntheticReferenceTransitionReceipt(
  input: unknown,
  originalCommand: unknown,
  originalCatalogue: unknown,
  expectedActorId: string,
): SyntheticReferenceTransitionReceipt {
  const command = validateSyntheticReferenceTransitionCommand(originalCommand, originalCatalogue);
  const state: SyntheticReferenceRevision['state'] = (
    { submit: 'pending', withdraw: 'draft', approve: 'approved', reject: 'rejected' } as const
  )[command.action];
  const expected = Object.freeze({
    ...command,
    actorId: uuid(expectedActorId),
    revisionVersion: (BigInt(command.review.revisionVersion) + 1n).toString(),
    state,
  });
  same(input, expected);
  return bounded(expected);
}
