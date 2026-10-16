import { DomainError, requireText, requireTimestamp } from './errors.js';
import {
  assertKes,
  calculatePriceBreakdown,
  kesFromMinor,
  RENTAL_PERIODS,
  type KesMoney,
  type ListingFee,
  type RentalPeriod,
} from './money.js';
import type { TenantId } from './permissions.js';

export const PROPERTY_TYPES = Object.freeze([
  'bedsitter',
  'studio',
  'apartment',
  'maisonette',
  'townhouse',
  'bungalow',
  'villa',
  'land',
  'commercial',
] as const);
export type PropertyType = (typeof PROPERTY_TYPES)[number];
export type PropertyPurpose = 'rent' | 'sale';
export const MAX_LISTING_PRICE_MINOR = 100_000_000_000_000;
export interface PropertyLocation {
  readonly county: string;
  readonly town: string;
  readonly area?: string;
  readonly latitude?: number;
  readonly longitude?: number;
}
export interface PropertyImage {
  readonly assetId: string;
  readonly alt: string;
}
export interface PropertyDraft {
  readonly title: string;
  readonly description: string;
  readonly propertyType: PropertyType;
  readonly purpose: PropertyPurpose;
  readonly price: KesMoney;
  readonly rentalPeriod: RentalPeriod | null;
  readonly fees: readonly ListingFee[];
  readonly bedrooms?: number;
  readonly bathrooms?: number;
  readonly location: PropertyLocation;
  /** Only the server may promote validated, durable image assets into this list. */
  readonly images: readonly PropertyImage[];
}
export interface ListingRules {
  readonly minImages: number;
  readonly minTitleLength: number;
  readonly minDescriptionLength: number;
}
export interface ValidationIssue {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}
export type ModerationStatus = 'draft' | 'pending' | 'changes-requested' | 'approved' | 'rejected';
export type PublicationStatus = 'unpublished' | 'published' | 'paused' | 'archived';
export type AvailabilityStatus = 'available' | 'reserved' | 'let' | 'sold' | 'withdrawn';
export type DatabaseAvailabilityStatus = 'available' | 'reserved' | 'rented' | 'sold' | 'withdrawn';
/** Explicit persistence adapter: business/domain 'let' is stored as SQL 'rented'. */
export function availabilityToDatabase(status: AvailabilityStatus): DatabaseAvailabilityStatus {
  if (!['available', 'reserved', 'let', 'sold', 'withdrawn'].includes(status))
    throw new DomainError('INVALID_AVAILABILITY', 'Choose a supported availability status.');
  return status === 'let' ? 'rented' : status;
}
export function availabilityFromDatabase(status: DatabaseAvailabilityStatus): AvailabilityStatus {
  if (!['available', 'reserved', 'rented', 'sold', 'withdrawn'].includes(status))
    throw new DomainError('INVALID_AVAILABILITY', 'Stored availability is unsupported.');
  return status === 'rented' ? 'let' : status;
}
export interface ApprovedSnapshot {
  readonly revision: number;
  readonly data: PropertyDraft;
  readonly approvedAt: string;
  readonly reviewerId: string;
  readonly auditId: string;
}
export interface PublishedSnapshot {
  readonly revision: number;
  readonly data: PropertyDraft;
  readonly publishedAt: string;
}
export interface Listing {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly ownerId: string;
  readonly assignedAgentId: string | null;
  readonly revision: number;
  readonly draft: PropertyDraft;
  readonly moderationStatus: ModerationStatus;
  readonly publicationStatus: PublicationStatus;
  readonly availability: AvailabilityStatus;
  readonly submittedRevision: number | null;
  readonly approvedSnapshot: ApprovedSnapshot | null;
  readonly publishedSnapshot: PublishedSnapshot | null;
  readonly reviewReason: string | null;
}

function copyDraft(draft: PropertyDraft): PropertyDraft {
  assertKes(draft.price);
  for (const fee of draft.fees) assertKes(fee.amount);
  return Object.freeze({
    ...draft,
    price: kesFromMinor(draft.price.minorUnits),
    location: Object.freeze({ ...draft.location }),
    images: Object.freeze(draft.images.map((image) => Object.freeze({ ...image }))),
    fees: Object.freeze(
      draft.fees.map((fee) =>
        Object.freeze({ ...fee, amount: kesFromMinor(fee.amount.minorUnits) }),
      ),
    ),
  });
}
function mutable(listing: Listing): void {
  if (listing.publicationStatus === 'archived')
    throw new DomainError('ARCHIVED_LISTING', 'Archived listings cannot be changed.');
}
function validateRules(rules: ListingRules): void {
  for (const value of [rules.minImages, rules.minTitleLength, rules.minDescriptionLength]) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new DomainError(
        'INVALID_LISTING_RULES',
        'Submission minimums must be positive integers.',
      );
  }
}

export function validateListingDraft(
  draft: PropertyDraft,
  rules: ListingRules,
): readonly ValidationIssue[] {
  validateRules(rules);
  const issues: ValidationIssue[] = [];
  const issue = (field: string, code: string, message: string) => {
    issues.push({ field, code, message });
  };
  if (typeof draft.title !== 'string' || draft.title.trim().length < rules.minTitleLength)
    issue(
      'title',
      'TITLE_REQUIRED',
      `Title must have at least ${rules.minTitleLength} characters.`,
    );
  if (
    typeof draft.description !== 'string' ||
    draft.description.trim().length < rules.minDescriptionLength
  )
    issue(
      'description',
      'DESCRIPTION_REQUIRED',
      `Description must have at least ${rules.minDescriptionLength} characters.`,
    );
  if (!PROPERTY_TYPES.includes(draft.propertyType))
    issue('propertyType', 'INVALID_TYPE', 'Choose a supported property type.');
  if (draft.purpose !== 'rent' && draft.purpose !== 'sale')
    issue('purpose', 'INVALID_PURPOSE', 'Choose rent or sale.');
  try {
    assertKes(draft.price);
    if (draft.price.minorUnits <= 0 || draft.price.minorUnits > MAX_LISTING_PRICE_MINOR)
      issue(
        'price',
        'INVALID_PRICE',
        'Price must be positive and within the supported listing limit.',
      );
  } catch {
    issue('price', 'INVALID_PRICE', 'Price must be a safe integer KES amount.');
  }
  if (
    (draft.purpose === 'rent' && !RENTAL_PERIODS.includes(draft.rentalPeriod as RentalPeriod)) ||
    (draft.purpose === 'sale' && draft.rentalPeriod !== null)
  )
    issue(
      'rentalPeriod',
      'INVALID_RENTAL_PERIOD',
      'Rent needs a period; sale needs a null rental period.',
    );
  try {
    calculatePriceBreakdown(draft.price, draft.fees, draft.purpose);
  } catch {
    issue(
      'fees',
      'INVALID_FEES',
      'Fees need unique IDs, names, positive KES amounts, and supported timing/refundability.',
    );
  }
  for (const field of ['bedrooms', 'bathrooms'] as const) {
    const value = draft[field];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
      issue(
        field,
        'INVALID_COUNT',
        'Use a non-negative integer; zero bedrooms is valid for a studio/bedsitter.',
      );
  }
  if (!draft.location?.county?.trim() || !draft.location?.town?.trim())
    issue('location', 'LOCATION_REQUIRED', 'County and town are required.');
  const { latitude, longitude } = draft.location ?? {};
  if (
    (latitude === undefined) !== (longitude === undefined) ||
    (latitude !== undefined && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
    (longitude !== undefined &&
      (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))
  )
    issue(
      'location.coordinates',
      'INVALID_COORDINATES',
      'Supply both accurate coordinates, or omit both.',
    );
  if (!Array.isArray(draft.images) || draft.images.length < rules.minImages)
    issue(
      'images',
      'IMAGES_REQUIRED',
      `At least ${rules.minImages} durable image assets are required.`,
    );
  if (Array.isArray(draft.images)) {
    const ids = new Set<string>();
    for (const image of draft.images) {
      if (!image.assetId?.trim() || !image.alt?.trim() || ids.has(image.assetId))
        issue('images', 'INVALID_IMAGE', 'Images need unique asset IDs and meaningful alt text.');
      ids.add(image.assetId);
    }
  }
  return issues;
}

/** Incomplete drafts are allowed. Call validateListingDraft at submission, after the server verifies all media assets. */
export function createListing(input: {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly ownerId: string;
  readonly assignedAgentId?: string | null;
  readonly draft: PropertyDraft;
}): Listing {
  return Object.freeze({
    id: requireText(input.id, 'Listing ID'),
    tenantId: requireText(input.tenantId, 'Tenant ID'),
    ownerId: requireText(input.ownerId, 'Record owner ID'),
    assignedAgentId:
      input.assignedAgentId === undefined
        ? requireText(input.ownerId, 'Record creator ID')
        : input.assignedAgentId === null
          ? null
          : requireText(input.assignedAgentId, 'Assigned agent ID'),
    revision: 1,
    draft: copyDraft(input.draft),
    moderationStatus: 'draft',
    publicationStatus: 'unpublished',
    availability: 'available',
    submittedRevision: null,
    approvedSnapshot: null,
    publishedSnapshot: null,
    reviewReason: null,
  });
}

export function reviseListing(listing: Listing, draft: PropertyDraft): Listing {
  mutable(listing);
  if (listing.moderationStatus === 'pending')
    throw new DomainError(
      'REVIEW_PENDING',
      'Withdraw the pending review before changing its revision.',
    );
  if (!Number.isSafeInteger(listing.revision + 1))
    throw new DomainError('INVALID_REVISION', 'Revision exceeds the safe integer limit.');
  return Object.freeze({
    ...listing,
    revision: listing.revision + 1,
    draft: copyDraft(draft),
    moderationStatus: 'draft',
    submittedRevision: null,
    reviewReason: null,
  });
}

/** Authorization adapter must require tenant admin rights before changing assignment. Creator history stays immutable. */
export function assignListingAgent(listing: Listing, assignedAgentId: string | null): Listing {
  mutable(listing);
  return Object.freeze({
    ...listing,
    assignedAgentId:
      assignedAgentId === null ? null : requireText(assignedAgentId, 'Assigned agent ID'),
  });
}

export function submitListing(listing: Listing, rules: ListingRules): Listing {
  mutable(listing);
  if (!['draft', 'changes-requested', 'rejected'].includes(listing.moderationStatus))
    throw new DomainError(
      'INVALID_TRANSITION',
      'Only a draft or returned revision can be submitted.',
    );
  const issues = validateListingDraft(listing.draft, rules);
  if (issues.length)
    throw new DomainError(
      'INVALID_LISTING',
      issues.map((issue) => `${issue.field}: ${issue.message}`).join(' '),
    );
  return Object.freeze({
    ...listing,
    moderationStatus: 'pending',
    submittedRevision: listing.revision,
    reviewReason: null,
  });
}

export function withdrawListingReview(listing: Listing): Listing {
  mutable(listing);
  if (listing.moderationStatus !== 'pending')
    throw new DomainError('INVALID_TRANSITION', 'Only a pending review can be withdrawn.');
  return Object.freeze({ ...listing, moderationStatus: 'draft', submittedRevision: null });
}

export interface ListingReview {
  readonly decision: 'approve' | 'request-changes' | 'reject';
  readonly revision: number;
  readonly reviewerId: string;
  readonly reviewedAt: string;
  readonly auditId: string;
  readonly reason?: string;
  /** The authorization adapter sets this only when an authorized admin knowingly reviews their own record. */
  readonly selfApprovalAcknowledged?: boolean;
}
export function reviewListing(listing: Listing, review: ListingReview): Listing {
  mutable(listing);
  if (
    listing.moderationStatus !== 'pending' ||
    listing.submittedRevision !== listing.revision ||
    review.revision !== listing.revision
  )
    throw new DomainError('STALE_REVIEW', 'A review must match the current pending revision.');
  const reviewerId = requireText(review.reviewerId, 'Reviewer ID');
  const auditId = requireText(review.auditId, 'Audit ID');
  const approvedAt = requireTimestamp(review.reviewedAt);
  if (review.decision === 'approve') {
    if (reviewerId === listing.ownerId && review.selfApprovalAcknowledged !== true)
      throw new DomainError(
        'SELF_APPROVAL_REQUIRES_ACKNOWLEDGEMENT',
        'An authorized admin must explicitly acknowledge and audit self-approval.',
      );
    const approvedSnapshot = Object.freeze({
      revision: listing.revision,
      data: copyDraft(listing.draft),
      approvedAt,
      reviewerId,
      auditId,
    });
    return Object.freeze({
      ...listing,
      moderationStatus: 'approved',
      approvedSnapshot,
      reviewReason: null,
    });
  }
  if (review.decision !== 'request-changes' && review.decision !== 'reject')
    throw new DomainError('INVALID_TRANSITION', 'Choose a supported review decision.');
  const reviewReason = requireText(review.reason ?? '', 'Review reason');
  return Object.freeze({
    ...listing,
    moderationStatus: review.decision === 'reject' ? 'rejected' : 'changes-requested',
    reviewReason,
    submittedRevision: null,
  });
}

export function publishListing(listing: Listing, publishedAt: string): Listing {
  mutable(listing);
  if (
    listing.moderationStatus !== 'approved' ||
    !listing.approvedSnapshot ||
    listing.approvedSnapshot.revision !== listing.revision
  )
    throw new DomainError(
      'APPROVAL_REQUIRED',
      'Only the currently approved revision can be published.',
    );
  if (
    (listing.availability === 'let' && listing.approvedSnapshot.data.purpose !== 'rent') ||
    (listing.availability === 'sold' && listing.approvedSnapshot.data.purpose !== 'sale')
  )
    throw new DomainError(
      'INVALID_AVAILABILITY',
      'Reset availability before publishing a changed listing purpose.',
    );
  const publishedSnapshot = Object.freeze({
    revision: listing.revision,
    data: copyDraft(listing.approvedSnapshot.data),
    publishedAt: requireTimestamp(publishedAt),
  });
  return Object.freeze({ ...listing, publicationStatus: 'published', publishedSnapshot });
}
export function unpublishListing(listing: Listing): Listing {
  mutable(listing);
  return Object.freeze({ ...listing, publicationStatus: 'unpublished' });
}
export function pauseListing(listing: Listing): Listing {
  mutable(listing);
  return Object.freeze({ ...listing, publicationStatus: 'paused' });
}
export function archiveListing(listing: Listing): Listing {
  mutable(listing);
  return Object.freeze({ ...listing, publicationStatus: 'archived' });
}
export function setListingAvailability(
  listing: Listing,
  availability: AvailabilityStatus,
): Listing {
  mutable(listing);
  if (!['available', 'reserved', 'let', 'sold', 'withdrawn'].includes(availability))
    throw new DomainError('INVALID_AVAILABILITY', 'Choose a supported availability status.');
  const purpose =
    listing.publicationStatus === 'published' && listing.publishedSnapshot
      ? listing.publishedSnapshot.data.purpose
      : listing.draft.purpose;
  if (
    (availability === 'let' && purpose !== 'rent') ||
    (availability === 'sold' && purpose !== 'sale')
  )
    throw new DomainError(
      'INVALID_AVAILABILITY',
      'Let applies to rental property; sold applies to sale property.',
    );
  return Object.freeze({ ...listing, availability });
}
export function isListingPublic(listing: Listing): boolean {
  return (
    listing.publicationStatus === 'published' &&
    listing.publishedSnapshot !== null &&
    listing.availability === 'available'
  );
}
