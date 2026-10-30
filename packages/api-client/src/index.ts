import {
  parseStaffInvitationJson,
  validateStaffInvitationIntent,
  validateStaffInvitationRequestRecord,
  validateStaffInvitationState,
  validateStaffInvitationRevocationCommand,
  validateStaffInvitationRevocationRecord,
  type StaffInvitationIntent,
  type StaffInvitationRequestRecord,
  type StaffInvitationState,
  type StaffInvitationRevocationCommand,
  type StaffInvitationRevocationRecord,
  validateListingReportCommand,
  validateListingReportReceipt,
  validateListingReportDecisionCommand,
  validateListingReportDecisionReceipt,
  validateListingReportQueue,
  parseListingReportJson,
  type ListingReportCommand,
  type ListingReportReceipt,
  type ListingReportDecisionCommand,
  type ListingReportDecisionReceipt,
  type ListingReportQueue,
  PROPERTY_TYPES,
  validateStaffOperationsOverview,
  type StaffOperationsOverview,
  validateStaffViewingCalendar,
  validateViewingCalendarWindow,
  type StaffViewingCalendar,
  type ViewingCalendarWindow,
  kesFromMajor,
  parseSearchAreaPolygon,
  type RentalPeriod,
  type SearchAreaPolygon,
} from '@realtor/domain';
export { validateStaffOperationsOverview, type StaffOperationsOverview } from '@realtor/domain';
export {
  validateStaffViewingCalendar,
  validateViewingCalendarWindow,
  type StaffViewingCalendar,
  type ViewingCalendarWindow,
} from '@realtor/domain';
import {
  validateRevisionProtocol,
  validateRevisionProtocolTarget,
  type RevisionProtocol,
  validateListingReferenceCatalogue,
  validateSyntheticReferenceDraftCommand,
  validateSyntheticReferenceDraftReceipt,
  validateSyntheticReferenceCreationCommand,
  validateSyntheticReferenceCreationReceipt,
  SYNTHETIC_REFERENCE_CREATION_MAX_BYTES,
  validateSyntheticReferenceSuccessorCommand,
  validateSyntheticReferenceSuccessorReceipt,
  SYNTHETIC_REFERENCE_SUCCESSOR_MAX_BYTES,
  type SyntheticReferenceSuccessorCommand,
  type SyntheticReferenceSuccessorReceipt,
  type SyntheticReferenceCreationCommand,
  type SyntheticReferenceCreationReceipt,
  validateSyntheticReferenceRevision,
  validateSyntheticReferenceContext,
  SYNTHETIC_REFERENCE_CONTEXT_MAX_BYTES,
  type SyntheticReferenceContext,
  validateSyntheticReferencePublicSnapshot,
  type SyntheticReferencePublicSnapshot,
  validateSyntheticReferenceTransitionCommand,
  validateSyntheticReferenceTransitionReceipt,
  type SyntheticReferenceRevision,
  type SyntheticReferenceTransitionCommand,
  type SyntheticReferenceTransitionReceipt,
  type ListingReferenceCatalogue,
  type SyntheticReferenceDraftCommand,
  type SyntheticReferenceDraftReceipt,
  validateListingVerificationCommand,
  validateListingVerificationReceipt,
  validateListingVerificationOriginal,
  validateListingVerificationHistory,
  type ListingVerificationCommand,
  type ListingVerificationReceipt,
  type ListingVerificationHistory,
  validateListingDuplicateRequest,
  validateListingDuplicateCandidates,
  type ListingDuplicateRequest,
  type ListingDuplicateCandidates,
  previewListingImport,
  validateListingImportPreview,
  type ListingImportPreview,
  validateReviewMediaGallery,
  type ReviewMediaGallery,
  validateListingControlCommand,
  validateListingControlReceipt,
  validateListingControlSnapshot,
  type ListingControlCommand,
  type ListingControlReceipt,
  validateListingSuccessorCommand,
  validateListingSuccessorReceipt,
  validateListingSuccessorSnapshot,
  type ListingSuccessorCommand,
  type ListingSuccessorReceipt,
} from '@realtor/domain';
export type {
  RevisionProtocol,
  SyntheticReferenceContext,
  SyntheticReferencePublicSnapshot,
  SyntheticReferenceRevision,
  SyntheticReferenceTransitionCommand,
  SyntheticReferenceTransitionReceipt,
  ListingReferenceCatalogue,
  SyntheticReferenceDraftCommand,
  SyntheticReferenceDraftReceipt,
  SyntheticReferenceCreationCommand,
  SyntheticReferenceCreationReceipt,
} from '@realtor/domain';
export {
  validateListingControlCommand,
  validateListingControlReceipt,
  validateListingControlSnapshot,
  validateListingSuccessorCommand,
  validateListingSuccessorReceipt,
  validateListingSuccessorSnapshot,
} from '@realtor/domain';
export type { ListingSuccessorCommand, ListingSuccessorReceipt } from '@realtor/domain';
export type { ListingControlCommand, ListingControlReceipt } from '@realtor/domain';
import {
  normalizeStaffDraftContentV2,
  STAFF_DRAFT_CONTENT_FIELDS,
  type StaffDraftContentV2,
  type StaffDraftContentInputV2,
} from '@realtor/domain';
import {
  validateListingCreationCommand,
  validateListingCreationReceipt,
  validateListingCreationSnapshot,
  type ListingCreationCommand,
  type ListingCreationReceipt,
} from '@realtor/domain';
export {
  validateListingCreationCommand,
  validateListingCreationReceipt,
  validateListingCreationSnapshot,
} from '@realtor/domain';
export type { ListingCreationCommand, ListingCreationReceipt } from '@realtor/domain';
import {
  validateStaffListingPage,
  validateStaffListingSummary,
  type StaffListingPage,
  type StaffListingSummary,
  validateViewingOutcomeCommand,
  validateViewingOutcomeReceipt,
  type ViewingOutcomeCommand,
  type ViewingOutcomeKind,
  type ViewingOutcomeReceipt,
} from '@realtor/domain';
export { validateStaffListingPage, validateStaffListingSummary } from '@realtor/domain';
export type { StaffListingPage, StaffListingSummary } from '@realtor/domain';
import {
  validateViewingReminderAdmissionCommand,
  validateViewingReminderAdmissionReceipt,
  validateViewingReminderAdmissionSnapshot,
  validateViewingReminderCaptureCommand,
  validateViewingReminderCaptureReceipt,
  type ViewingReminderAdmissionCommand,
  type ViewingReminderAdmissionReceipt,
  type ViewingReminderCaptureCommand,
  type ViewingReminderCaptureReceipt,
} from '@realtor/domain';
export {
  validateViewingReminderAdmissionCommand,
  validateViewingReminderAdmissionReceipt,
  validateViewingReminderAdmissionSnapshot,
  validateViewingReminderCaptureCommand,
  validateViewingReminderCaptureReceipt,
} from '@realtor/domain';
export type {
  ViewingReminderCandidate,
  ViewingReminderAdmissionCommand,
  ViewingReminderAdmissionReceipt,
  ViewingReminderCaptureCommand,
  ViewingReminderCaptureReceipt,
  SyntheticViewingReminderCapture,
} from '@realtor/domain';
export { validateViewingOutcomeCommand, validateViewingOutcomeReceipt } from '@realtor/domain';
export type {
  ViewingOutcomeCommand,
  ViewingOutcomeKind,
  ViewingOutcomeFacts,
  ViewingOutcomeReceipt,
} from '@realtor/domain';
import {
  validateViewingRescheduleCommand,
  validateViewingRescheduleReceipt,
  type ViewingRescheduleCommand,
  type ViewingRescheduleReceipt,
  validateViewingHistoryPage,
  type ViewingHistoryPage,
  validateViewingTerminationCommand,
  validateViewingTerminationReceipt,
  type ViewingTerminationKind,
  type ViewingTerminationCommand,
  type ViewingTerminationReceipt,
  validateViewingConfirmationCommand,
  validateViewingConfirmationReceipt,
  type ViewingConfirmationCommand,
  type ViewingConfirmationReceipt,
  validateViewingOriginal,
  validateViewingRequestCommand,
  validateViewingProposalCommand,
  validateViewingReceipt,
  validateViewingDetail,
  validateViewingPage,
  type ViewingOriginal,
  type ViewingRequestCommand,
  type ViewingProposalCommand,
  type ViewingReceipt,
  type ViewingDetail,
  type ViewingPage,
  validateContactCommand,
  validateContactReceipt,
  validateContactPage,
  type ContactCommand,
  type ContactReceipt,
  type ContactPage,
  validateEnquiryActivityPage,
  type EnquiryActivityPage,
  calculateWirePricingV2,
  kesFromMinor,
  parseListingJsonV2,
  parseListingSuccessorJsonV2,
  validatePricingInputV2,
  validatePublicLocationV2,
  type PricingDisclosure,
  type PricingInputV2,
  type PublicLocationV2,
} from '@realtor/domain';

export { validateEnquiryActivityPage } from '@realtor/domain';
export type { EnquiryActivityPage, EnquiryActivityEvent } from '@realtor/domain';

export {
  validateContactCommand,
  validateContactReceipt,
  validateContactPage,
} from '@realtor/domain';
export type {
  ContactCommand,
  ContactReceipt,
  ContactPage,
  ContactEntry,
  ContactFacts,
  ContactChannel,
  ContactOutcome,
} from '@realtor/domain';
export {
  validateViewingRescheduleCommand,
  validateViewingRescheduleReceipt,
  validateViewingHistoryPage,
  validateViewingTerminationCommand,
  validateViewingTerminationReceipt,
  validateViewingConfirmationCommand,
  validateViewingConfirmationReceipt,
  validateViewingOriginal,
  validateViewingRequestCommand,
  validateViewingProposalCommand,
  validateViewingReceipt,
  validateViewingDetail,
  validateViewingPage,
} from '@realtor/domain';
export type {
  ViewingCycle,
  ViewingRescheduleCommand,
  ViewingRescheduleReceipt,
  ViewingHistoryEntry,
  ViewingHistoryPage,
  ViewingTerminationKind,
  ViewingTerminationCommand,
  ViewingTerminationReceipt,
  ViewingConfirmationCommand,
  ViewingConfirmationReceipt,
  ViewingOriginal,
  ViewingSlot,
  ViewingRequestCommand,
  ViewingProposalCommand,
  ViewingSchedule,
  ViewingReceipt,
  ViewingDetail,
  ViewingPage,
} from '@realtor/domain';

/** Narrow, explicitly validated public API contracts. Identity and tenant selection remain server concerns. */
export interface PublicPhoto {
  readonly key: string;
  readonly alt: string;
}
export type PropertyType =
  | 'apartment'
  | 'bedsitter'
  | 'studio'
  | 'bungalow'
  | 'maisonette'
  | 'townhouse'
  | 'villa'
  | 'commercial'
  | 'land';
export interface PublicProperty {
  readonly id: string;
  readonly slug: string;
  readonly revision: number;
  readonly title: string;
  readonly description: string;
  readonly purpose: 'rent' | 'sale';
  readonly propertyType: PropertyType;
  readonly currency: 'KES';
  readonly amountMinor: number;
  readonly rentPeriod: 'day' | 'week' | 'month' | 'year' | null;
  readonly bedrooms: number | null;
  readonly privateBathrooms: number | null;
  readonly sharedBathrooms: number | null;
  readonly country: 'KE';
  readonly locality: string;
  readonly publicPrecision: 'area' | 'exact';
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly photos: readonly PublicPhoto[];
}
export interface PropertyPage {
  readonly items: readonly PublicProperty[];
  readonly limit: number;
}
/** V2 derives known subtotals from validated inputs; undeclared or quote-required costs stay unresolved. */
export interface PublicPropertyV2 extends PublicProperty {
  readonly pricing: PricingDisclosure;
  readonly location: PublicLocationV2;
}
export interface SyntheticReferencePublicPropertyV3 extends PublicPropertyV2 {
  readonly reference: SyntheticReferencePublicSnapshot;
}
export interface SyntheticReferencePropertyPageV3 {
  readonly policy: 'synthetic-reference-public-v1';
  readonly items: readonly SyntheticReferencePublicPropertyV3[];
  readonly limit: number;
}
export interface PropertyPageV2 {
  readonly items: readonly PublicPropertyV2[];
  readonly limit: number;
}
export interface PublicSearchInput {
  readonly location?: string;
  readonly purpose?: 'rent' | 'sale';
  readonly type?: PropertyType;
  readonly period?: RentalPeriod;
  readonly min?: string;
  readonly minMode?: 'over';
  readonly max?: string;
  readonly beds?: string;
  readonly bedsMode?: 'at_least';
  readonly privateBaths?: string;
  readonly sharedBaths?: string;
  readonly sort?: 'catalogue' | 'title' | 'price_low' | 'price_high';
  readonly limit?: number;
  readonly offset?: number;
  readonly id?: string;
  readonly countyId?: string;
  readonly localityId?: string;
  readonly neighbourhoodId?: string;
  readonly amenityId?: string;
  readonly area?: SearchAreaPolygon;
}
export interface PublicSearchPage<T> {
  readonly policy: 'public-search-v1' | 'synthetic-reference-search-v1';
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly sort: string;
  readonly hasMore: boolean;
  readonly maxOffset: 10000;
}
export type PublicReferenceSearchOptions = Readonly<
  Record<
    'countyId' | 'localityId' | 'neighbourhoodId' | 'amenityId',
    readonly Readonly<{ id: string; label: string }>[]
  >
>;
export type {
  PricingDisclosure,
  PricingInputV2,
  PricingChargeV2,
  PublicLocationV2,
} from '@realtor/domain';
export type { StaffDraftContentV2, StaffDraftContentInputV2 } from '@realtor/domain';
export interface StaffDraftV2 {
  readonly revision: number;
  readonly state: 'draft' | 'pending' | 'approved' | 'rejected';
  readonly version: string;
  readonly content: StaffDraftContentV2;
}
/** Current staff-only gallery metadata, including unfinished legacy associations. */
export interface StaffGalleryPhotoV2 {
  readonly id: string;
  readonly position: number;
  readonly altText: string;
  readonly accepted: boolean;
  readonly provenance: 'sealed' | 'legacy';
}
/** One authorized statement snapshot; the version belongs to this exact draft and gallery. */
export interface StaffDraftWorkspaceV2 {
  readonly listingId: string;
  readonly draft: StaffDraftV2;
  readonly photos: readonly StaffGalleryPhotoV2[];
}
/** Private saved-version image bytes. The caller owns data and must release any derived Blob URLs. */
export interface StaffMediaPreviewV2 {
  readonly listingId: string;
  readonly revision: number;
  readonly mediaId: string;
  readonly version: string;
  readonly mimeType: 'image/webp';
  readonly data: Uint8Array<ArrayBuffer>;
}
export interface StaffVersionReceipt {
  readonly version: string;
}
export interface StaffDraftSaveV2 {
  readonly expectedVersion: string;
  readonly content: StaffDraftContentInputV2;
}
export interface StaffDraftSubmitV2 {
  readonly expectedVersion: string;
}
export interface ReviewMetadataV2 {
  readonly listingId: string;
  readonly slug: string;
  readonly revision: number;
  readonly version: string;
  readonly listingVersion: string;
  readonly publicationStatus: 'unpublished' | 'published' | 'paused' | 'archived';
  readonly publishedRevision: number | null;
  readonly availability: 'available' | 'reserved' | 'rented' | 'sold' | 'withdrawn';
  readonly lastAvailabilityConfirmedAt: string | null;
  readonly acceptedPhotoCount: number;
}
export interface ReviewSummaryV2 extends ReviewMetadataV2 {
  readonly state: 'pending';
  readonly title: string;
  readonly purpose: 'rent' | 'sale';
  readonly propertyType: PropertyType;
  readonly amountMinor: number;
  readonly rentPeriod: PublicProperty['rentPeriod'];
  readonly submittedAt: string;
  readonly submittedBy: string;
}
export interface ReviewPageV2 {
  readonly items: readonly ReviewSummaryV2[];
  readonly limit: number;
}
export interface ReviewDetailV2 extends ReviewMetadataV2 {
  readonly state: StaffDraftV2['state'];
  readonly title: string | null;
  readonly purpose: 'rent' | 'sale' | null;
  readonly propertyType: PropertyType | null;
  readonly amountMinor: number | null;
  readonly rentPeriod: PublicProperty['rentPeriod'];
  readonly submittedAt: string | null;
  readonly submittedBy: string | null;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly decisionReason: string | null;
  readonly content: StaffDraftContentV2;
  readonly photos: readonly PublicPhoto[];
}
export interface ReviewDecisionInputV2 {
  readonly expectedVersion: string;
  readonly decision: 'approve' | 'reject';
  readonly reason: string | null;
}
export interface ReviewDecisionReceiptV2 {
  readonly version: string;
  readonly state: 'approved' | 'rejected';
}
/** Registration creates private job metadata only; it grants no upload or attachment capability. */
export interface MediaRegistrationInputV2 {
  readonly registrationId: string;
  readonly expectedVersion: string;
  readonly altText: string;
}
export interface MediaRegistrationFactsV2 {
  readonly kind: 'register_media_upload';
  readonly operationId: string;
  readonly jobId: string;
  readonly listingId: string;
  readonly revision: number;
  readonly expectedVersion: string;
  readonly altText: string;
  readonly registeredAt: string;
  readonly expiresAt: string;
}
/** A historical immutable result; expiry or later draft changes do not rewrite this receipt. */
export interface MediaRegistrationReceiptV2 extends MediaRegistrationFactsV2 {
  readonly outcome: 'registered';
}
/** Current bounded job projection, separate from the historical registration result. */
export interface MediaJobV2 extends MediaRegistrationFactsV2 {
  readonly state: 'registered' | 'expired';
}
export interface MediaAttachIntentInputV2 {
  readonly operationId: string;
  readonly jobId: string;
  readonly expectedVersion: string;
}
export interface MediaAttachFactsV2 {
  readonly kind: 'attach_media';
  readonly operationId: string;
  readonly jobId: string;
  readonly listingId: string;
  readonly revision: number;
  readonly expectedVersion: string;
}
export type MediaAttachFailureReasonV2 =
  | 'VERSION_CONFLICT'
  | 'ASSIGNMENT_CHANGED'
  | 'REVISION_NOT_DRAFT'
  | 'JOB_EXPIRED'
  | 'DUPLICATE_OUTPUT'
  | 'CAPACITY_REACHED'
  | 'JOB_ALREADY_ATTACHED'
  | 'PROVENANCE_CHANGED';
export type MediaAttachReceiptV2 = MediaAttachFactsV2 &
  (
    | Readonly<{
        version: string;
        outcome: 'applied';
        reason: null;
        mediaId: string;
        position: number;
        completedAt: string;
      }>
    | Readonly<{
        version: string;
        outcome: 'conflict' | 'rejected' | 'expired';
        reason: MediaAttachFailureReasonV2;
        mediaId: null;
        position: null;
        completedAt: string;
      }>
  );
/** Ready is an acknowledgement only. Applied media exists only in the immutable terminal receipt. */
export type MediaAttachIntentV2 = MediaAttachFactsV2 &
  Readonly<{ altText: string }> &
  (
    | Readonly<{ status: 'ready'; receipt: null }>
    | Readonly<{
        status: 'applied' | 'conflict' | 'rejected' | 'expired';
        receipt: MediaAttachReceiptV2;
      }>
  );
export interface MediaRemovalInputV2 {
  readonly operationId: string;
  readonly mediaId: string;
  readonly expectedVersion: string;
}
export interface MediaReorderInputV2 {
  readonly operationId: string;
  readonly orderedIds: readonly string[];
  readonly expectedVersion: string;
}
export type MediaOperationFailureReasonV2 =
  'VERSION_CONFLICT' | 'REVISION_NOT_DRAFT' | 'MEDIA_NOT_FOUND' | 'MEDIA_SET_CHANGED';
/** Immutable historical order, not the current gallery. Removed objects remain retained. */
export type MediaOperationReceiptV2 = Readonly<{
  operationId: string;
  listingId: string;
  revision: number;
  expectedVersion: string;
  version: string;
  orderedIds: readonly string[];
  completedAt: string;
}> &
  (
    | (Readonly<{ kind: 'remove_media'; mediaId: string }> &
        (
          | Readonly<{ outcome: 'applied'; reason: null }>
          | Readonly<{ outcome: 'conflict'; reason: 'VERSION_CONFLICT' }>
          | Readonly<{
              outcome: 'rejected';
              reason: 'REVISION_NOT_DRAFT' | 'MEDIA_NOT_FOUND' | 'MEDIA_SET_CHANGED';
            }>
        ))
    | (Readonly<{ kind: 'reorder_media'; mediaId: null }> &
        (
          | Readonly<{ outcome: 'applied' | 'noop'; reason: null }>
          | Readonly<{ outcome: 'conflict'; reason: 'VERSION_CONFLICT' }>
          | Readonly<{ outcome: 'rejected'; reason: 'REVISION_NOT_DRAFT' | 'MEDIA_SET_CHANGED' }>
        ))
  );
export interface EnquiryInput {
  readonly listingId?: string | null;
  readonly name: string;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly message: string;
  readonly origin: 'web' | 'mobile';
  readonly noticeVersion: string;
  readonly noticeAcknowledged: true;
}
export interface EnquiryReceipt {
  readonly id: string;
}
/** In-memory public intake intent. Explicit replay retains the exact original key and values. */
export interface PublicEnquiryAttempt {
  readonly input: EnquiryInput;
  readonly idempotencyKey: string;
  readonly state: Readonly<{
    status: 'ready' | 'sending' | 'uncertain' | 'received' | 'rejected';
    receipt: EnquiryReceipt | null;
  }>;
  submit(options?: Readonly<{ signal?: AbortSignal; timeoutMs?: number }>): Promise<EnquiryReceipt>;
  /** May create the original enquiry if the first request never reached the server. Not a read-only lookup. */
  retryOriginal(
    options?: Readonly<{ signal?: AbortSignal; timeoutMs?: number }>,
  ): Promise<EnquiryReceipt>;
}
/** Server derives staff origin and requester; callers cannot select attribution. */
export type StaffEnquiryInput = Omit<EnquiryInput, 'origin'>;
export interface StaffEnquiryAttempt extends Omit<PublicEnquiryAttempt, 'input'> {
  readonly input: StaffEnquiryInput;
}
/** Persisted staff workflow vocabulary; deliberately separate from the legacy domain exports. */
export type StaffEnquiryStatusV2 =
  'new' | 'assigned' | 'contacted' | 'qualified' | 'closed_won' | 'closed_lost' | 'spam';
export interface StaffEnquirySummaryV2 {
  readonly id: string;
  readonly listingId: string | null;
  readonly contactedRevision: number | null;
  readonly name: string;
  readonly origin: 'web' | 'mobile' | 'staff';
  readonly status: StaffEnquiryStatusV2;
  readonly assignedAgentId: string | null;
  readonly nextActionAt: string | null;
  readonly version: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface StaffEnquiryDetailV2 extends StaffEnquirySummaryV2 {
  readonly phone: string | null;
  readonly email: string | null;
  readonly message: string;
  readonly noticeVersion: string;
  readonly closureReason: string | null;
}
/** A bounded visible slice, not a count of every company enquiry. */
export interface StaffEnquiryPageV2 {
  readonly items: readonly StaffEnquirySummaryV2[];
  readonly limit: number;
  readonly truncated: boolean;
}
export type StaffEnquiryQueueFilterV3 = 'all' | 'open' | 'overdue' | 'today';
export interface StaffEnquiryQueueInputV3 {
  readonly limit?: number;
  readonly filter?: StaffEnquiryQueueFilterV3;
  readonly after?: string;
}
/** Current authorized keyset page, without a company-wide or cross-request count. */
export interface StaffEnquiryQueuePageV3 {
  readonly policy: 'staff-enquiry-queue-v3';
  readonly items: readonly StaffEnquirySummaryV2[];
  readonly limit: number;
  readonly filter: StaffEnquiryQueueFilterV3;
  readonly after: string | null;
  readonly hasMore: boolean;
  readonly nextAfter: string | null;
  readonly asOf: string;
  readonly timeZone: 'Africa/Nairobi';
}
export interface EnquiryAssigneeV2 {
  readonly userId: string;
  readonly role: 'agent' | 'admin';
}
export interface EnquiryAssigneePageV2 {
  readonly items: readonly EnquiryAssigneeV2[];
  readonly limit: number;
  readonly truncated: boolean;
}
export type EnquiryOperationKindV2 = 'assign' | 'transition' | 'reschedule';
export interface EnquiryOperationRequestV2 {
  readonly assignedAgentId: string | null;
  readonly status: StaffEnquiryStatusV2 | null;
  readonly nextActionAt: string | null;
  readonly reason: string | null;
}
/** Every unused field is explicitly null; keep the original UUID/body until its result is known. */
export interface EnquiryOperationInputV2 extends EnquiryOperationRequestV2 {
  readonly operationId: string;
  readonly kind: EnquiryOperationKindV2;
  readonly expectedVersion: string;
}
export interface EnquiryOperationResultV2 {
  readonly version: string;
  readonly status: StaffEnquiryStatusV2;
  readonly assignedAgentId: string | null;
  readonly nextActionAt: string | null;
  readonly closureReason: string | null;
}
/** Immutable historical facts only. This result never adopts the current enquiry version. */
export interface EnquiryOperationReceiptV2 {
  readonly operationId: string;
  readonly enquiryId: string;
  readonly kind: EnquiryOperationKindV2;
  readonly expectedVersion: string;
  readonly request: EnquiryOperationRequestV2;
  readonly outcome: 'applied' | 'noop' | 'conflict' | 'rejected';
  readonly reason: null | 'VERSION_CONFLICT' | 'ASSIGNEE_UNAVAILABLE' | 'INVALID_TRANSITION';
  readonly result: EnquiryOperationResultV2;
  readonly completedAt: string;
}
export interface RequestOptions {
  /** Raw bearer token for this call only. Never put credentials in baseUrl or a public brand configuration. */
  readonly bearerToken?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
export interface EnquiryRequestOptions extends RequestOptions {
  readonly idempotencyKey: string;
}
export interface StaffRequestOptions extends RequestOptions {
  readonly bearerToken: string;
}
/** Local development ingress status. Verification alone neither attaches nor publishes a photo. */
export interface MediaUploadStatusV2 {
  readonly uploadId: string;
  readonly jobId: string;
  readonly listingId: string;
  readonly revision: number;
  readonly state: 'verified' | 'processing' | 'blocked' | 'native_failed';
}
export type ClientErrorKind =
  | 'CONFIGURATION'
  | 'VALIDATION'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'HTTP'
  | 'INVALID_RESPONSE'
  | 'REDIRECT';
export interface ClientErrorDetails {
  readonly status?: number;
  readonly serverCode?: string;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
  /** A failed write can have committed. Enquiries use their original key; staff writes require reconciliation before retry. */
  readonly submissionUncertain?: boolean;
}
export class ApiClientError extends Error {
  readonly kind: ClientErrorKind;
  readonly status: number | undefined;
  readonly serverCode: string | undefined;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly submissionUncertain: boolean;
  constructor(kind: ClientErrorKind, message: string, details: ClientErrorDetails = {}) {
    super(message);
    this.name = 'ApiClientError';
    this.kind = kind;
    this.status = details.status;
    this.serverCode = details.serverCode;
    this.requestId = details.requestId;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.submissionUncertain = details.submissionUncertain ?? false;
  }
}
export interface ApiClientOptions {
  readonly baseUrl: string;
  readonly privacyNoticeVersion: string;
  /** Explicitly opt into HTTP on localhost/127.0.0.1/[::1] for local development only. */
  readonly allowLoopbackHttp?: boolean;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES: readonly string[] = [
  'apartment',
  'bedsitter',
  'studio',
  'bungalow',
  'maisonette',
  'townhouse',
  'villa',
  'commercial',
  'land',
];
const RESIDENTIAL: readonly string[] = [
  'apartment',
  'bedsitter',
  'studio',
  'bungalow',
  'maisonette',
  'townhouse',
  'villa',
];
const PUBLIC_FIELDS = [
  'id',
  'slug',
  'revision',
  'title',
  'description',
  'purpose',
  'propertyType',
  'currency',
  'amountMinor',
  'rentPeriod',
  'bedrooms',
  'privateBathrooms',
  'sharedBathrooms',
  'country',
  'locality',
  'publicPrecision',
  'latitude',
  'longitude',
  'photos',
] as const;
const STAFF_CONTENT_FIELDS = STAFF_DRAFT_CONTENT_FIELDS;
const REVIEW_FIELDS = [
  'listingId',
  'slug',
  'revision',
  'state',
  'version',
  'listingVersion',
  'title',
  'purpose',
  'propertyType',
  'amountMinor',
  'rentPeriod',
  'submittedAt',
  'submittedBy',
  'publicationStatus',
  'publishedRevision',
  'availability',
  'lastAvailabilityConfirmedAt',
  'acceptedPhotoCount',
] as const;
const MAX_JSON_CHARACTERS = 3 * 1024 * 1024;
const SERVER_CODES = new Set([
  'INVALID_INPUT',
  'NOTICE_ACKNOWLEDGEMENT_REQUIRED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'CONFLICT',
  'BODY_TOO_LARGE',
  'JSON_REQUIRED',
  'INVALID_JSON',
  'INVALID_STATE',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
]);
const UPLOAD_SERVER_STATUS = new Map<string, number>([
  ['NOT_FOUND', 404],
  ['METHOD_NOT_ALLOWED', 405],
  ['INVALID_UPLOAD', 400],
  ['UNAUTHENTICATED', 401],
  ['EXPECTATION_FAILED', 417],
  ['BINARY_REQUIRED', 415],
  ['BODY_TOO_LARGE', 413],
  ['UPLOAD_BUSY', 409],
  ['UPLOAD_UNCONFIRMED', 409],
  ['SERVICE_UNAVAILABLE', 503],
  ['UPLOAD_TIMEOUT', 408],
  ['UPLOAD_ABORTED', 400],
]);
const UPLOAD_PATH =
  /^\/v2\/staff\/listings\/[^/]+\/revisions\/[^/]+\/media-jobs\/[^/]+\/uploads\/[^/]+$/;
const FINALIZE_SERVER_STATUS = new Map<string, number>([
  ['NOT_FOUND', 404],
  ['METHOD_NOT_ALLOWED', 405],
  ['INVALID_INPUT', 400],
  ['FORBIDDEN', 403],
  ['UNAUTHENTICATED', 401],
  ['REQUEST_ABORTED', 400],
  ['ATTACHMENT_UNCONFIRMED', 503],
  ['SERVICE_UNAVAILABLE', 503],
]);
const FINALIZE_PATH =
  /^\/v2\/staff\/listings\/[^/]+\/revisions\/[^/]+\/media-attach-intents\/[^/]+\/finalize$/;
const PREVIEW_SERVER_STATUS = new Map<string, number>([
  ['NOT_FOUND', 404],
  ['METHOD_NOT_ALLOWED', 405],
  ['INVALID_INPUT', 400],
  ['FORBIDDEN', 403],
  ['UNAUTHENTICATED', 401],
  ['VERSION_CONFLICT', 409],
  ['REQUEST_ABORTED', 400],
  ['SERVICE_UNAVAILABLE', 503],
]);
const ENQUIRY_SERVER_STATUS = new Map<string, number>([
  ['INVALID_INPUT', 400],
  ['INVALID_JSON', 400],
  ['UNAUTHENTICATED', 401],
  ['FORBIDDEN', 403],
  ['NOT_FOUND', 404],
  ['METHOD_NOT_ALLOWED', 405],
  ['CONFLICT', 409],
  ['INVALID_STATE', 422],
  ['JSON_REQUIRED', 415],
  ['BODY_TOO_LARGE', 413],
  ['RATE_LIMITED', 429],
  ['SERVICE_UNAVAILABLE', 503],
]);
const STAFF_ENQUIRY_PATH =
  /^\/v2\/staff\/(?:enquiries(?:\/[^/?]+(?:\/(?:operations(?:\/[^/?]+)?|viewings(?:\/[^/?]+(?:\/(?:proposals|confirmations|cancellations|declines|reschedules|completions|no-shows|history|reminder-admissions))?)?|viewing-operations\/[^/?]+|viewing-reminder-admissions\/[^/?]+(?:\/(?:captures|capture-operations\/[^/?]+))?))?)?|enquiry-assignees)(?:\?limit=[1-9]\d*)?$/;
const MAX_PREVIEW_BYTES = 10485760;
const nativeTypedArray = Object.getPrototypeOf(Uint8Array.prototype) as object;
const nativeTypedArrayBuffer = Object.getOwnPropertyDescriptor(nativeTypedArray, 'buffer')!.get!;
const nativeTypedArrayOffset = Object.getOwnPropertyDescriptor(
  nativeTypedArray,
  'byteOffset',
)!.get!;
const nativeTypedArrayLength = Object.getOwnPropertyDescriptor(
  nativeTypedArray,
  'byteLength',
)!.get!;
const nativeTypedArrayKind = Object.getOwnPropertyDescriptor(
  nativeTypedArray,
  Symbol.toStringTag,
)!.get!;
const nativeArrayBufferLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
)!.get!;
const nativeByteCopy = Uint8Array.prototype.set;
const invalid = (
  kind: 'VALIDATION' | 'INVALID_RESPONSE' | 'CONFIGURATION',
  message: string,
): never => {
  throw new ApiClientError(kind, message);
};
function record(
  input: unknown,
  fields: readonly string[],
  kind: 'VALIDATION' | 'INVALID_RESPONSE' | 'CONFIGURATION',
): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !fields.includes(key))
  )
    return invalid(kind, 'Unsupported or malformed fields.');
  return input as Record<string, unknown>;
}
function text(
  input: unknown,
  max: number,
  kind: 'VALIDATION' | 'INVALID_RESPONSE' | 'CONFIGURATION',
  label: string,
  codePointBound = false,
): string {
  if (typeof input !== 'string') return invalid(kind, `${label} is missing or invalid.`);
  const trimmed = input.trim();
  const length = codePointBound ? [...trimmed].length : trimmed.length;
  if (
    length < 1 ||
    length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input) ||
    (codePointBound && /[\ud800-\udfff]/u.test(input))
  )
    return invalid(kind, `${label} is missing or invalid.`);
  return trimmed;
}
function uuid(input: unknown, kind: 'VALIDATION' | 'INVALID_RESPONSE', label: string): string {
  if (typeof input !== 'string' || !UUID.test(input))
    return invalid(kind, `${label} must be a UUID.`);
  return input.toLowerCase();
}
function integer(
  input: unknown,
  min: number,
  max: number,
  kind: 'VALIDATION' | 'INVALID_RESPONSE',
  label: string,
): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max)
    return invalid(kind, `${label} is outside its supported range.`);
  return input;
}
function count(input: unknown): number | null {
  return input === null ? null : integer(input, 0, 100, 'INVALID_RESPONSE', 'Room count');
}
function coordinate(input: unknown, min: number, max: number): number | null {
  if (input === null) return null;
  if (typeof input !== 'number' || !Number.isFinite(input) || input < min || input > max)
    return invalid('INVALID_RESPONSE', 'Invalid coordinates.');
  return input;
}
function timeout(input: unknown, kind: 'VALIDATION' | 'CONFIGURATION'): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 1 || input > 120000)
    return invalid(kind, 'Timeout must be 1ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“120000 milliseconds.');
  return input;
}
function origin(options: ApiClientOptions): string {
  if (typeof options.baseUrl !== 'string' || options.baseUrl.trim() !== options.baseUrl)
    return invalid('CONFIGURATION', 'Use an absolute API origin.');
  let url: URL;
  try {
    url = new URL(options.baseUrl);
  } catch {
    return invalid('CONFIGURATION', 'Use an absolute API origin.');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    return invalid(
      'CONFIGURATION',
      'API origin cannot contain credentials, a path, query or fragment.',
    );
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && options.allowLoopbackHttp === true && loopback)
  )
    return invalid(
      'CONFIGURATION',
      'Use HTTPS; local HTTP requires explicit loopback development opt-in.',
    );
  return url.origin;
}
function publicProperty(input: unknown, codePointDisplayBounds = false): PublicProperty {
  const value = record(input, PUBLIC_FIELDS, 'INVALID_RESPONSE');
  const id = uuid(value.id, 'INVALID_RESPONSE', 'Property ID');
  const slug = text(value.slug, 160, 'INVALID_RESPONSE', 'Property slug');
  if (!/^[a-z\d]+(?:-[a-z\d]+)*$/.test(slug))
    return invalid('INVALID_RESPONSE', 'Invalid property slug.');
  const revision = integer(value.revision, 1, 2147483647, 'INVALID_RESPONSE', 'Revision');
  const title = text(value.title, 160, 'INVALID_RESPONSE', 'Title', codePointDisplayBounds),
    description = text(
      value.description,
      10000,
      'INVALID_RESPONSE',
      'Description',
      codePointDisplayBounds,
    );
  if (value.purpose !== 'rent' && value.purpose !== 'sale')
    return invalid('INVALID_RESPONSE', 'Invalid purpose.');
  if (typeof value.propertyType !== 'string' || !TYPES.includes(value.propertyType))
    return invalid('INVALID_RESPONSE', 'Invalid property type.');
  if (value.currency !== 'KES' || value.country !== 'KE')
    return invalid('INVALID_RESPONSE', 'Unsupported currency or country.');
  const amountMinor = integer(value.amountMinor, 1, 100000000000000, 'INVALID_RESPONSE', 'Price');
  if (
    (value.purpose === 'sale' && value.rentPeriod !== null) ||
    (value.purpose === 'rent' &&
      (typeof value.rentPeriod !== 'string' ||
        !['day', 'week', 'month', 'year'].includes(value.rentPeriod)))
  )
    return invalid('INVALID_RESPONSE', 'Invalid rental period.');
  const bedrooms = count(value.bedrooms),
    privateBathrooms = count(value.privateBathrooms),
    sharedBathrooms = count(value.sharedBathrooms);
  if (
    (value.propertyType === 'land' && bedrooms !== null) ||
    (RESIDENTIAL.includes(value.propertyType) && bedrooms === null) ||
    (['studio', 'bedsitter'].includes(value.propertyType) && bedrooms !== 0)
  )
    return invalid('INVALID_RESPONSE', 'Rooms do not match the property type.');
  const locality = text(
    value.locality,
    160,
    'INVALID_RESPONSE',
    'Locality',
    codePointDisplayBounds,
  );
  if (value.publicPrecision !== 'area' && value.publicPrecision !== 'exact')
    return invalid('INVALID_RESPONSE', 'Invalid public precision.');
  const latitude = coordinate(value.latitude, -90, 90),
    longitude = coordinate(value.longitude, -180, 180);
  if (
    (latitude === null) !== (longitude === null) ||
    (value.publicPrecision === 'area' && latitude !== null)
  )
    return invalid('INVALID_RESPONSE', 'Unexpected precise or incomplete coordinates.');
  if (!Array.isArray(value.photos) || value.photos.length < 4 || value.photos.length > 12)
    return invalid('INVALID_RESPONSE', 'Expected 4ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“12 reviewed photos.');
  const keys = new Set<string>();
  const photos = value.photos.map((inputPhoto) => {
    const photo = record(inputPhoto, ['key', 'alt'], 'INVALID_RESPONSE');
    const key = text(photo.key, 1024, 'INVALID_RESPONSE', 'Photo key');
    if (!/^[A-Za-z\d][A-Za-z\d/_-]*\.(?:webp|jpg|png)$/.test(key) || keys.has(key))
      return invalid('INVALID_RESPONSE', 'Unsafe or repeated photo key.');
    keys.add(key);
    return Object.freeze({
      key,
      alt: text(photo.alt, 300, 'INVALID_RESPONSE', 'Photo description', codePointDisplayBounds),
    });
  });
  return Object.freeze({
    id,
    slug,
    revision,
    title,
    description,
    purpose: value.purpose,
    propertyType: value.propertyType as PropertyType,
    currency: 'KES',
    amountMinor,
    rentPeriod: value.rentPeriod as PublicProperty['rentPeriod'],
    bedrooms,
    privateBathrooms,
    sharedBathrooms,
    country: 'KE',
    locality,
    publicPrecision: value.publicPrecision,
    latitude,
    longitude,
    photos: Object.freeze(photos),
  });
}
function publicPropertyV2(input: unknown): PublicPropertyV2 {
  const value = record(input, [...PUBLIC_FIELDS, 'pricing', 'location'], 'INVALID_RESPONSE');
  const { pricing: rawPricing, location: rawLocation, ...baseInput } = value;
  const base = publicProperty(baseInput, true);
  try {
    const pricingInput = validatePricingInputV2(rawPricing);
    const pricing = calculateWirePricingV2(
      kesFromMinor(base.amountMinor),
      base.purpose,
      base.rentPeriod,
      pricingInput,
    );
    const location = validatePublicLocationV2(rawLocation);
    return Object.freeze({ ...base, pricing, location });
  } catch {
    return invalid('INVALID_RESPONSE', 'Invalid public pricing or location disclosure.');
  }
}
function publicReferenceProperty(input: unknown): SyntheticReferencePublicPropertyV3 {
  const value = attachRecord(
    input,
    [...PUBLIC_FIELDS, 'pricing', 'location', 'reference'],
    'INVALID_RESPONSE',
  );
  const { reference: rawReference, ...baseInput } = value;
  const base = publicPropertyV2(baseInput);
  try {
    const reference = validateSyntheticReferencePublicSnapshot(rawReference);
    if (reference.attributes) {
      const l = reference.attributes.location;
      if (
        base.location.county !== (l.county?.label ?? null) ||
        base.location.town !== (l.locality?.label ?? null) ||
        base.location.area !== (l.neighbourhood?.label ?? null)
      )
        throw Error();
      const deepest = l.neighbourhood?.label ?? l.locality?.label ?? l.county?.label;
      if (deepest !== undefined && base.locality !== deepest) throw Error();
    }
    return Object.freeze({ ...base, reference });
  } catch {
    return invalid('INVALID_RESPONSE', 'Invalid public historical reference snapshot.');
  }
}
function staffVersion(
  input: unknown,
  kind: 'VALIDATION' | 'INVALID_RESPONSE',
  allowNew = false,
): string {
  if (
    typeof input !== 'string' ||
    !/^(?:0|[1-9]\d{0,18})$/.test(input) ||
    BigInt(input) > 9223372036854775807n ||
    (!allowNew && input === '0')
  )
    return invalid(kind, 'Use a canonical decimal version string.');
  return input;
}
function expectedStaffVersion(input: unknown, allowNew: boolean): number {
  const version = staffVersion(input, 'VALIDATION', allowNew);
  if (BigInt(version) > BigInt(Number.MAX_SAFE_INTEGER))
    return invalid('VALIDATION', 'This version cannot be sent safely by the current API contract.');
  return Number(version);
}
function staffContent(
  input: unknown,
  kind: 'VALIDATION' | 'INVALID_RESPONSE',
  requireAll = false,
): StaffDraftContentV2 {
  try {
    return normalizeStaffDraftContentV2(input, requireAll);
  } catch {
    return invalid(kind, 'Invalid staff draft content.');
  }
}
export function validateStaffDraftContentV2(input: unknown): StaffDraftContentV2 {
  return staffContent(input, 'VALIDATION');
}
function staffDraft(input: unknown, revision: number): StaffDraftV2 {
  const value = record(input, ['revision', 'state', 'version', 'content'], 'INVALID_RESPONSE');
  if (integer(value.revision, 1, 2147483647, 'INVALID_RESPONSE', 'Revision') !== revision)
    return invalid('INVALID_RESPONSE', 'Unexpected staff revision.');
  if (
    typeof value.state !== 'string' ||
    !['draft', 'pending', 'approved', 'rejected'].includes(value.state)
  )
    return invalid('INVALID_RESPONSE', 'Invalid staff revision state.');
  const version = staffVersion(value.version, 'INVALID_RESPONSE'),
    content = staffContent(value.content, 'INVALID_RESPONSE', true);
  if (
    value.state !== 'draft' &&
    (content.title === null ||
      content.description === null ||
      content.purpose === null ||
      content.propertyType === null ||
      content.amountMinor === null ||
      content.locality === null ||
      (content.purpose === 'rent' && content.rentPeriod === null) ||
      (RESIDENTIAL.includes(content.propertyType) && content.bedrooms === null))
  )
    return invalid('INVALID_RESPONSE', 'Incomplete reviewed staff revision.');
  return Object.freeze({ revision, state: value.state as StaffDraftV2['state'], version, content });
}
function staffPath(listingId: unknown, revision: unknown): string {
  return `/v2/staff/listings/${uuid(listingId, 'VALIDATION', 'Listing ID')}/drafts/${integer(revision, 1, 2147483647, 'VALIDATION', 'Revision')}`;
}
/** Validate an untrusted staff BFF response without retaining identity or transport state. */
export function validateStaffDraftWorkspaceV2(
  input: unknown,
  listingId: string,
  revision: number,
): StaffDraftWorkspaceV2 {
  const id = uuid(listingId, 'VALIDATION', 'Listing ID'),
    number = integer(revision, 1, 2147483647, 'VALIDATION', 'Revision');
  const value = attachRecord(input, ['listingId', 'draft', 'photos'], 'INVALID_RESPONSE');
  if (uuid(value.listingId, 'INVALID_RESPONSE', 'Listing ID') !== id)
    return invalid('INVALID_RESPONSE', 'Unexpected staff workspace.');
  const draftValue = attachRecord(
    value.draft,
    ['revision', 'state', 'version', 'content'],
    'INVALID_RESPONSE',
  );
  attachRecord(draftValue.content, STAFF_CONTENT_FIELDS, 'INVALID_RESPONSE');
  const draft = staffDraft(draftValue, number);
  if (
    !Array.isArray(value.photos) ||
    Object.getPrototypeOf(value.photos) !== Array.prototype ||
    value.photos.length > 12 ||
    Reflect.ownKeys(value.photos).length !== value.photos.length + 1
  )
    return invalid('INVALID_RESPONSE', 'Invalid staff gallery.');
  let previous = -1;
  const ids = new Set<string>();
  const photos = Array.from({ length: value.photos.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value.photos, index);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
      return invalid('INVALID_RESPONSE', 'Invalid staff gallery entries.');
    const input = descriptor.value;
    const photo = attachRecord(
      input,
      ['id', 'position', 'altText', 'accepted', 'provenance'],
      'INVALID_RESPONSE',
    );
    const photoId = uuid(photo.id, 'INVALID_RESPONSE', 'Photo ID'),
      position = integer(photo.position, 0, 11, 'INVALID_RESPONSE', 'Photo position');
    if (
      ids.has(photoId) ||
      position <= previous ||
      typeof photo.accepted !== 'boolean' ||
      (photo.provenance !== 'sealed' && photo.provenance !== 'legacy') ||
      (photo.provenance === 'sealed' && !photo.accepted)
    )
      return invalid('INVALID_RESPONSE', 'Invalid staff gallery order or provenance.');
    ids.add(photoId);
    previous = position;
    // Old associations used btrim/length checks. Preserve their original labels so
    // staff can explicitly remove or repair them instead of hiding those rows.
    const altText =
      photo.provenance === 'sealed'
        ? mediaAltText(photo.altText, 'INVALID_RESPONSE')
        : photo.altText;
    if (
      typeof altText !== 'string' ||
      altText.length > 4096 ||
      altText.replace(/^ +| +$/g, '').length < 1 ||
      [...altText.replace(/^ +| +$/g, '')].length > 300
    )
      return invalid('INVALID_RESPONSE', 'Invalid legacy photo description.');
    return Object.freeze({
      id: photoId,
      position,
      altText,
      accepted: photo.accepted,
      provenance: photo.provenance as StaffGalleryPhotoV2['provenance'],
    });
  });
  return Object.freeze({ listingId: id, draft, photos: Object.freeze(photos) });
}
function staffOptions(options: StaffRequestOptions, extra: readonly string[] = []): void {
  requestOptions(options, extra);
  if (typeof options.bearerToken !== 'string' || !options.bearerToken)
    return invalid('VALIDATION', 'A bearer token is required for each staff call.');
}
function timestamp(input: unknown, nullable = false): string | null {
  if (nullable && input === null) return null;
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input))
    return invalid('INVALID_RESPONSE', 'Invalid review timestamp.');
  const parsed = new Date(input);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== input)
    return invalid('INVALID_RESPONSE', 'Invalid review timestamp.');
  return input;
}
function decisionReason(input: unknown, kind: 'VALIDATION' | 'INVALID_RESPONSE'): string {
  if (
    typeof input !== 'string' ||
    input !== input.trim() ||
    [...input].length < 1 ||
    [...input].length > 1000 ||
    /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(input)
  )
    return invalid(kind, 'Provide a trimmed rejection reason within the supported length.');
  return input;
}
function reviewMetadata(value: Record<string, unknown>): ReviewMetadataV2 {
  const slug = text(value.slug, 160, 'INVALID_RESPONSE', 'Listing slug');
  if (!/^[a-z\d]+(?:-[a-z\d]+)*$/.test(slug))
    return invalid('INVALID_RESPONSE', 'Invalid listing slug.');
  const publicationStatus = value.publicationStatus,
    availability = value.availability;
  if (
    typeof publicationStatus !== 'string' ||
    !['unpublished', 'published', 'paused', 'archived'].includes(publicationStatus)
  )
    return invalid('INVALID_RESPONSE', 'Invalid publication status.');
  if (
    typeof availability !== 'string' ||
    !['available', 'reserved', 'rented', 'sold', 'withdrawn'].includes(availability)
  )
    return invalid('INVALID_RESPONSE', 'Invalid availability.');
  return Object.freeze({
    listingId: uuid(value.listingId, 'INVALID_RESPONSE', 'Listing ID'),
    slug,
    revision: integer(value.revision, 1, 2147483647, 'INVALID_RESPONSE', 'Revision'),
    version: staffVersion(value.version, 'INVALID_RESPONSE'),
    listingVersion: staffVersion(value.listingVersion, 'INVALID_RESPONSE'),
    publicationStatus: publicationStatus as ReviewMetadataV2['publicationStatus'],
    publishedRevision:
      value.publishedRevision === null
        ? null
        : integer(value.publishedRevision, 1, 2147483647, 'INVALID_RESPONSE', 'Published revision'),
    availability: availability as ReviewMetadataV2['availability'],
    lastAvailabilityConfirmedAt: timestamp(value.lastAvailabilityConfirmedAt, true),
    acceptedPhotoCount: integer(
      value.acceptedPhotoCount,
      0,
      12,
      'INVALID_RESPONSE',
      'Accepted photo count',
    ),
  });
}
function reviewFields(value: Record<string, unknown>, state: StaffDraftV2['state']) {
  const nullable = state === 'draft';
  const title =
    nullable && value.title === null
      ? null
      : text(value.title, 160, 'INVALID_RESPONSE', 'Review title', true);
  const purpose = value.purpose;
  if (purpose !== 'rent' && purpose !== 'sale' && !(nullable && purpose === null))
    return invalid('INVALID_RESPONSE', 'Invalid review purpose.');
  const propertyType = value.propertyType;
  if (
    !(nullable && propertyType === null) &&
    (typeof propertyType !== 'string' || !TYPES.includes(propertyType))
  )
    return invalid('INVALID_RESPONSE', 'Invalid review property type.');
  const amountMinor =
    nullable && value.amountMinor === null
      ? null
      : integer(value.amountMinor, 1, 100000000000000, 'INVALID_RESPONSE', 'Review price');
  const rentPeriod = value.rentPeriod;
  if (
    rentPeriod !== null &&
    (typeof rentPeriod !== 'string' || !['day', 'week', 'month', 'year'].includes(rentPeriod))
  )
    return invalid('INVALID_RESPONSE', 'Invalid review rental period.');
  if (
    (purpose === 'sale' && rentPeriod !== null) ||
    (!nullable && purpose === 'rent' && rentPeriod === null)
  )
    return invalid('INVALID_RESPONSE', 'Invalid review rental period.');
  const submittedAt = timestamp(value.submittedAt, nullable),
    submittedBy =
      nullable && value.submittedBy === null
        ? null
        : uuid(value.submittedBy, 'INVALID_RESPONSE', 'Submitted actor');
  if ((submittedAt === null) !== (submittedBy === null))
    return invalid('INVALID_RESPONSE', 'Incomplete submission metadata.');
  return {
    title,
    purpose: purpose as ReviewDetailV2['purpose'],
    propertyType: propertyType as PropertyType | null,
    amountMinor,
    rentPeriod: rentPeriod as PublicProperty['rentPeriod'],
    submittedAt,
    submittedBy,
  };
}
function reviewSummary(input: unknown): ReviewSummaryV2 {
  const value = record(input, REVIEW_FIELDS, 'INVALID_RESPONSE');
  if (REVIEW_FIELDS.some((field) => !Object.hasOwn(value, field)) || value.state !== 'pending')
    return invalid('INVALID_RESPONSE', 'Invalid pending review fields.');
  const fields = reviewFields(value, 'pending');
  return Object.freeze({
    ...reviewMetadata(value),
    ...fields,
    state: 'pending',
  }) as ReviewSummaryV2;
}
function reviewDetail(input: unknown, listingId: string, revision: number): ReviewDetailV2 {
  const fields = [
    ...REVIEW_FIELDS,
    'decidedAt',
    'decidedBy',
    'decisionReason',
    'content',
    'photos',
  ];
  const value = record(input, fields, 'INVALID_RESPONSE');
  if (fields.some((field) => !Object.hasOwn(value, field)))
    return invalid('INVALID_RESPONSE', 'Incomplete review detail.');
  const draft = staffDraft(
    {
      revision: value.revision,
      state: value.state,
      version: value.version,
      content: value.content,
    },
    revision,
  );
  const metadata = reviewMetadata(value);
  if (metadata.listingId !== listingId.toLowerCase())
    return invalid('INVALID_RESPONSE', 'Unexpected review listing.');
  const base = reviewFields(value, draft.state);
  for (const field of ['title', 'purpose', 'propertyType', 'amountMinor', 'rentPeriod'] as const)
    if (base[field] !== draft.content[field])
      return invalid('INVALID_RESPONSE', 'Conflicting review content.');
  const decidedAt = timestamp(value.decidedAt, true),
    decidedBy =
      value.decidedBy === null ? null : uuid(value.decidedBy, 'INVALID_RESPONSE', 'Decision actor');
  if (
    (decidedAt === null) !== (decidedBy === null) ||
    ['approved', 'rejected'].includes(draft.state) !== (decidedAt !== null)
  )
    return invalid('INVALID_RESPONSE', 'Invalid decision metadata.');
  let reason: string | null = null;
  if (draft.state === 'rejected') reason = decisionReason(value.decisionReason, 'INVALID_RESPONSE');
  else if (value.decisionReason !== null)
    return invalid('INVALID_RESPONSE', 'Unexpected decision reason.');
  if (!Array.isArray(value.photos) || value.photos.length !== metadata.acceptedPhotoCount)
    return invalid('INVALID_RESPONSE', 'Conflicting accepted photo metadata.');
  const keys = new Set<string>();
  const photos = value.photos.map((input) => {
    const photo = record(input, ['key', 'alt'], 'INVALID_RESPONSE'),
      key = text(photo.key, 1024, 'INVALID_RESPONSE', 'Photo key');
    if (!/^[A-Za-z\d][A-Za-z\d/_-]*\.(?:webp|jpg|png)$/.test(key) || keys.has(key))
      return invalid('INVALID_RESPONSE', 'Unsafe or repeated photo key.');
    keys.add(key);
    return Object.freeze({
      key,
      alt: text(photo.alt, 300, 'INVALID_RESPONSE', 'Photo description', true),
    });
  });
  return Object.freeze({
    ...metadata,
    ...base,
    state: draft.state,
    decidedAt,
    decidedBy,
    decisionReason: reason,
    content: draft.content,
    photos: Object.freeze(photos),
  });
}
function reviewPath(listingId: unknown, revision: unknown): string {
  return `/v2/staff/reviews/${uuid(listingId, 'VALIDATION', 'Listing ID')}/revisions/${integer(revision, 1, 2147483647, 'VALIDATION', 'Revision')}`;
}
function mediaPath(listingId: unknown, revision: unknown): string {
  return `/v2/staff/listings/${uuid(listingId, 'VALIDATION', 'Listing ID')}/revisions/${integer(revision, 1, 2147483647, 'VALIDATION', 'Revision')}`;
}
function mediaAltText(input: unknown, kind: 'VALIDATION' | 'INVALID_RESPONSE'): string {
  if (
    typeof input !== 'string' ||
    input !== input.trim() ||
    [...input].length < 1 ||
    [...input].length > 300 ||
    /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(input)
  )
    return invalid(kind, 'Provide a trimmed photo description within the supported length.');
  return input;
}
function mediaVersion(input: unknown): string {
  const value = staffVersion(input, 'INVALID_RESPONSE');
  if (BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER))
    return invalid('INVALID_RESPONSE', 'Unsupported registration version.');
  return value;
}
function mediaFacts(
  value: Record<string, unknown>,
  listingId: string,
  revision: number,
): MediaRegistrationFactsV2 {
  if (
    value.kind !== 'register_media_upload' ||
    uuid(value.listingId, 'INVALID_RESPONSE', 'Listing ID') !== listingId.toLowerCase() ||
    integer(value.revision, 1, 2147483647, 'INVALID_RESPONSE', 'Revision') !== revision
  )
    return invalid('INVALID_RESPONSE', 'Unexpected media resource.');
  const registeredAt = timestamp(value.registeredAt),
    expiresAt = timestamp(value.expiresAt);
  if (
    registeredAt === null ||
    expiresAt === null ||
    Date.parse(expiresAt) - Date.parse(registeredAt) !== 86400000
  )
    return invalid('INVALID_RESPONSE', 'Invalid registration expiry.');
  const operationId = uuid(value.operationId, 'INVALID_RESPONSE', 'Registration ID'),
    jobId = uuid(value.jobId, 'INVALID_RESPONSE', 'Job ID');
  if (operationId === jobId)
    return invalid('INVALID_RESPONSE', 'Registration and job identities must differ.');
  return Object.freeze({
    kind: 'register_media_upload',
    operationId,
    jobId,
    listingId: listingId.toLowerCase(),
    revision,
    expectedVersion: mediaVersion(value.expectedVersion),
    altText: mediaAltText(value.altText, 'INVALID_RESPONSE'),
    registeredAt,
    expiresAt,
  });
}
const MEDIA_FACT_FIELDS = [
  'kind',
  'operationId',
  'jobId',
  'listingId',
  'revision',
  'expectedVersion',
  'altText',
  'registeredAt',
  'expiresAt',
] as const;
function mediaRegistration(
  input: unknown,
  listingId: string,
  revision: number,
  registrationId: string,
  request?: MediaRegistrationInputV2,
): MediaRegistrationReceiptV2 {
  const fields = [...MEDIA_FACT_FIELDS, 'outcome'],
    value = record(input, fields, 'INVALID_RESPONSE');
  if (fields.some((field) => !Object.hasOwn(value, field)) || value.outcome !== 'registered')
    return invalid('INVALID_RESPONSE', 'Invalid registration receipt.');
  const facts = mediaFacts(value, listingId, revision);
  if (
    facts.operationId !== registrationId.toLowerCase() ||
    (request &&
      (facts.expectedVersion !== request.expectedVersion || facts.altText !== request.altText))
  )
    return invalid('INVALID_RESPONSE', 'Conflicting registration receipt.');
  return Object.freeze({ ...facts, outcome: 'registered' });
}
function mediaJob(input: unknown, listingId: string, revision: number, jobId: string): MediaJobV2 {
  const fields = [...MEDIA_FACT_FIELDS, 'state'],
    value = record(input, fields, 'INVALID_RESPONSE');
  if (
    fields.some((field) => !Object.hasOwn(value, field)) ||
    (value.state !== 'registered' && value.state !== 'expired')
  )
    return invalid('INVALID_RESPONSE', 'Invalid media job.');
  const facts = mediaFacts(value, listingId, revision);
  if (facts.jobId !== jobId.toLowerCase())
    return invalid('INVALID_RESPONSE', 'Unexpected media job.');
  return Object.freeze({ ...facts, state: value.state });
}
function attachRecord(
  input: unknown,
  fields: readonly string[],
  kind: 'VALIDATION' | 'INVALID_RESPONSE',
): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
  )
    return invalid(kind, 'Malformed attachment fields.');
  const own = Reflect.ownKeys(input),
    value: Record<string, unknown> = {};
  if (own.length !== fields.length) return invalid(kind, 'Malformed attachment fields.');
  for (const key of own) {
    if (typeof key !== 'string' || !fields.includes(key))
      return invalid(kind, 'Malformed attachment fields.');
    const field = Object.getOwnPropertyDescriptor(input, key);
    if (!field?.enumerable || !Object.hasOwn(field, 'value'))
      return invalid(kind, 'Malformed attachment fields.');
    // Keep every captured key as data. Assignment to __proto__ would silently
    // drop or reinterpret it before the caller's exact allowlist validation.
    Object.defineProperty(value, key, {
      value: field.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return value;
}
const ATTACH_FACT_FIELDS = [
  'kind',
  'operationId',
  'jobId',
  'listingId',
  'revision',
  'expectedVersion',
] as const;
const ATTACH_REASONS = {
  conflict: ['VERSION_CONFLICT', 'ASSIGNMENT_CHANGED'],
  rejected: [
    'REVISION_NOT_DRAFT',
    'DUPLICATE_OUTPUT',
    'CAPACITY_REACHED',
    'JOB_ALREADY_ATTACHED',
    'PROVENANCE_CHANGED',
  ],
  expired: ['JOB_EXPIRED'],
} as const;
function mediaAttachIntent(
  input: unknown,
  listingId: string,
  revision: number,
  operationId: string,
  request?: MediaAttachIntentInputV2,
): MediaAttachIntentV2 {
  const value = attachRecord(
    input,
    [...ATTACH_FACT_FIELDS, 'altText', 'status', 'receipt'],
    'INVALID_RESPONSE',
  );
  const jobId = uuid(value.jobId, 'INVALID_RESPONSE', 'Job ID'),
    expectedVersion = mediaVersion(value.expectedVersion);
  if (
    value.kind !== 'attach_media' ||
    uuid(value.operationId, 'INVALID_RESPONSE', 'Operation ID') !== operationId ||
    jobId === operationId ||
    uuid(value.listingId, 'INVALID_RESPONSE', 'Listing ID') !== listingId.toLowerCase() ||
    integer(value.revision, 1, 2147483647, 'INVALID_RESPONSE', 'Revision') !== revision ||
    BigInt(expectedVersion) > BigInt(Number.MAX_SAFE_INTEGER - 1) ||
    (request && (request.jobId !== jobId || request.expectedVersion !== expectedVersion))
  )
    return invalid('INVALID_RESPONSE', 'Conflicting attachment intent.');
  const facts = Object.freeze({
      kind: 'attach_media' as const,
      operationId,
      jobId,
      listingId: listingId.toLowerCase(),
      revision,
      expectedVersion,
    }),
    altText = mediaAltText(value.altText, 'INVALID_RESPONSE');
  if (value.status === 'ready') {
    if (value.receipt !== null)
      return invalid('INVALID_RESPONSE', 'Ready intent cannot carry a receipt.');
    return Object.freeze({ ...facts, altText, status: 'ready', receipt: null });
  }
  if (!['applied', 'conflict', 'rejected', 'expired'].includes(value.status as string))
    return invalid('INVALID_RESPONSE', 'Invalid attachment status.');
  const raw = attachRecord(
    value.receipt,
    [...ATTACH_FACT_FIELDS, 'version', 'outcome', 'reason', 'mediaId', 'position', 'completedAt'],
    'INVALID_RESPONSE',
  );
  if (
    ATTACH_FACT_FIELDS.some((field) => raw[field] !== facts[field]) ||
    raw.outcome !== value.status
  )
    return invalid('INVALID_RESPONSE', 'Conflicting attachment receipt.');
  const version = mediaVersion(raw.version),
    completedAt = timestamp(raw.completedAt);
  if (completedAt === null) return invalid('INVALID_RESPONSE', 'Invalid attachment timestamp.');
  let receipt: MediaAttachReceiptV2;
  if (value.status === 'applied') {
    if (raw.reason !== null || BigInt(version) !== BigInt(expectedVersion) + 1n)
      return invalid('INVALID_RESPONSE', 'Invalid applied attachment.');
    const mediaId = uuid(raw.mediaId, 'INVALID_RESPONSE', 'Media ID');
    if (mediaId === operationId || mediaId === jobId)
      return invalid('INVALID_RESPONSE', 'Conflicting attachment media identity.');
    receipt = Object.freeze({
      ...facts,
      version,
      outcome: 'applied',
      reason: null,
      mediaId,
      position: integer(raw.position, 0, 11, 'INVALID_RESPONSE', 'Photo position'),
      completedAt,
    });
  } else {
    const status = value.status as 'conflict' | 'rejected' | 'expired';
    if (
      raw.mediaId !== null ||
      raw.position !== null ||
      !ATTACH_REASONS[status].includes(raw.reason as never)
    )
      return invalid('INVALID_RESPONSE', 'Invalid attachment failure.');
    receipt = Object.freeze({
      ...facts,
      version,
      outcome: status,
      reason: raw.reason as MediaAttachFailureReasonV2,
      mediaId: null,
      position: null,
      completedAt,
    });
  }
  return Object.freeze({
    ...facts,
    altText,
    status: value.status as 'applied' | 'conflict' | 'rejected' | 'expired',
    receipt,
  });
}
function galleryIds(input: unknown, kind: 'VALIDATION' | 'INVALID_RESPONSE'): readonly string[] {
  if (
    !Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Array.prototype ||
    input.length > 12 ||
    Reflect.ownKeys(input).length !== input.length + 1
  )
    return invalid(kind, 'Use a dense array of at most 12 distinct photo UUIDs.');
  const ids: string[] = [];
  for (let index = 0; index < input.length; index++) {
    const field = Object.getOwnPropertyDescriptor(input, String(index));
    if (!field?.enumerable || !Object.hasOwn(field, 'value'))
      return invalid(kind, 'Use ordinary own photo IDs.');
    ids.push(uuid(field.value, kind, 'Media ID'));
  }
  if (new Set(ids).size !== ids.length) return invalid(kind, 'Photo IDs must be distinct.');
  return Object.freeze(ids);
}
interface GalleryRequest {
  readonly kind: 'remove_media' | 'reorder_media';
  readonly expectedVersion: string;
  readonly mediaId: string | null;
  readonly orderedIds: readonly string[];
}
function mediaOperation(
  input: unknown,
  listingId: string,
  revision: number,
  operationId: string,
  request?: GalleryRequest,
): MediaOperationReceiptV2 {
  const value = attachRecord(
    input,
    [
      'kind',
      'operationId',
      'listingId',
      'revision',
      'expectedVersion',
      'version',
      'outcome',
      'reason',
      'mediaId',
      'orderedIds',
      'completedAt',
    ],
    'INVALID_RESPONSE',
  );
  const expectedVersion = mediaVersion(value.expectedVersion),
    version = mediaVersion(value.version),
    orderedIds = galleryIds(value.orderedIds, 'INVALID_RESPONSE'),
    completedAt = timestamp(value.completedAt);
  if (
    (value.kind !== 'remove_media' && value.kind !== 'reorder_media') ||
    uuid(value.operationId, 'INVALID_RESPONSE', 'Operation ID') !== operationId ||
    uuid(value.listingId, 'INVALID_RESPONSE', 'Listing ID') !== listingId.toLowerCase() ||
    integer(value.revision, 1, 2147483647, 'INVALID_RESPONSE', 'Revision') !== revision ||
    BigInt(expectedVersion) > BigInt(Number.MAX_SAFE_INTEGER - 1) ||
    completedAt === null
  )
    return invalid('INVALID_RESPONSE', 'Unexpected gallery receipt identity.');
  const mediaId =
    value.kind === 'remove_media'
      ? uuid(value.mediaId, 'INVALID_RESPONSE', 'Media ID')
      : value.mediaId === null
        ? null
        : invalid('INVALID_RESPONSE', 'Unexpected reorder media ID.');
  if (
    request &&
    (value.kind !== request.kind ||
      expectedVersion !== request.expectedVersion ||
      mediaId !== request.mediaId ||
      (request.kind === 'reorder_media' &&
        JSON.stringify(orderedIds) !== JSON.stringify(request.orderedIds)))
  )
    return invalid('INVALID_RESPONSE', 'Conflicting gallery receipt.');
  if (value.outcome === 'applied') {
    if (
      value.reason !== null ||
      BigInt(version) !== BigInt(expectedVersion) + 1n ||
      (value.kind === 'remove_media' && orderedIds.includes(mediaId!))
    )
      return invalid('INVALID_RESPONSE', 'Invalid applied gallery receipt.');
  } else if (value.outcome === 'noop') {
    if (value.kind !== 'reorder_media' || value.reason !== null || version !== expectedVersion)
      return invalid('INVALID_RESPONSE', 'Invalid gallery noop.');
  } else if (value.outcome === 'conflict') {
    if (value.reason !== 'VERSION_CONFLICT' || version === expectedVersion)
      return invalid('INVALID_RESPONSE', 'Invalid gallery conflict.');
  } else if (value.outcome === 'rejected') {
    if (
      ![
        'REVISION_NOT_DRAFT',
        'MEDIA_SET_CHANGED',
        ...(value.kind === 'remove_media' ? ['MEDIA_NOT_FOUND'] : []),
      ].includes(String(value.reason)) ||
      (value.reason === 'MEDIA_NOT_FOUND' && orderedIds.includes(mediaId!))
    )
      return invalid('INVALID_RESPONSE', 'Invalid gallery rejection.');
  } else return invalid('INVALID_RESPONSE', 'Invalid gallery outcome.');
  return Object.freeze({
    kind: value.kind,
    operationId,
    listingId: listingId.toLowerCase(),
    revision,
    expectedVersion,
    version,
    outcome: value.outcome,
    reason: value.reason,
    mediaId,
    orderedIds,
    completedAt,
  }) as MediaOperationReceiptV2;
}
function assertMediaJsonTokens(source: string): void {
  // The existing v2 parser checks syntax and money tokens. Media projections also
  // reject decoded duplicate keys and revision tokens before numeric rounding.
  const tokens =
    source.match(
      /"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g,
    ) ?? [];
  const containers: (Set<string> | null)[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token === '{') containers.push(new Set());
    else if (token === '[') containers.push(null);
    else if (token === '}' || token === ']') containers.pop();
    else if (token.startsWith('"') && tokens[index + 1] === ':') {
      const keys = containers.at(-1),
        key = JSON.parse(token) as string;
      if (!keys || keys.has(key)) throw new Error('Duplicate media response key.');
      keys.add(key);
      if (key === 'revision' && !/^[1-9]\d*$/.test(tokens[index + 2] ?? ''))
        throw new Error('Invalid media revision token.');
      if (key === 'position' && !/^(?:null|0|[1-9]\d*)$/.test(tokens[index + 2] ?? ''))
        throw new Error('Invalid media position token.');
    }
  }
}
function uncertainWriteError(error: unknown): never {
  if (
    error instanceof ApiClientError &&
    error.kind === 'INVALID_RESPONSE' &&
    !error.submissionUncertain
  )
    throw new ApiClientError(error.kind, error.message, {
      status: error.status,
      submissionUncertain: true,
    });
  throw error;
}
const ENQUIRY_SUMMARY_FIELDS = [
  'id',
  'listingId',
  'contactedRevision',
  'name',
  'origin',
  'status',
  'assignedAgentId',
  'nextActionAt',
  'version',
  'createdAt',
  'updatedAt',
] as const;
const ENQUIRY_DETAIL_FIELDS = [
  ...ENQUIRY_SUMMARY_FIELDS,
  'phone',
  'email',
  'message',
  'noticeVersion',
  'closureReason',
] as const;
const ENQUIRY_REQUEST_FIELDS = ['assignedAgentId', 'status', 'nextActionAt', 'reason'] as const;
const ENQUIRY_STATUSES: readonly StaffEnquiryStatusV2[] = [
  'new',
  'assigned',
  'contacted',
  'qualified',
  'closed_won',
  'closed_lost',
  'spam',
];
type EnquiryValidationKind = 'VALIDATION' | 'INVALID_RESPONSE';
function enquiryVersion(
  input: unknown,
  kind: EnquiryValidationKind,
  incrementable = false,
): string {
  if (
    typeof input !== 'string' ||
    !/^[1-9]\d{0,15}$/.test(input) ||
    BigInt(input) > (incrementable ? 9007199254740990n : 9007199254740991n)
  )
    return invalid(kind, 'Unsupported enquiry version.');
  return input;
}
function enquiryTime(input: unknown, kind: EnquiryValidationKind, nullable = false): string | null {
  if (input === null && nullable) return null;
  if (
    typeof input !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input) ||
    input.startsWith('0000-') ||
    !Number.isFinite(Date.parse(input)) ||
    new Date(input).toISOString() !== input
  )
    return invalid(kind, 'Invalid enquiry timestamp.');
  return input;
}
function enquiryStatus(input: unknown, kind: EnquiryValidationKind): StaffEnquiryStatusV2 {
  if (typeof input !== 'string' || !ENQUIRY_STATUSES.includes(input as StaffEnquiryStatusV2))
    return invalid(kind, 'Invalid enquiry status.');
  return input as StaffEnquiryStatusV2;
}
function enquiryText(
  input: unknown,
  maximum: number,
  kind: EnquiryValidationKind,
  trimmed = false,
  multiline = false,
): string {
  const controls = multiline
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u
    : /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u;
  if (
    typeof input !== 'string' ||
    input.trim().length === 0 ||
    [...input].length > maximum ||
    (trimmed && input !== input.trim()) ||
    controls.test(input)
  )
    return invalid(kind, 'Invalid enquiry text.');
  return input;
}
function enquiryNullableId(input: unknown, kind: EnquiryValidationKind): string | null {
  return input === null ? null : uuid(input, kind, 'Staff ID');
}
function enquirySummary(value: Record<string, unknown>): StaffEnquirySummaryV2 {
  const id = uuid(value.id, 'INVALID_RESPONSE', 'Enquiry ID'),
    listingId =
      value.listingId === null ? null : uuid(value.listingId, 'INVALID_RESPONSE', 'Listing ID'),
    contactedRevision =
      value.contactedRevision === null
        ? null
        : integer(value.contactedRevision, 1, 2147483647, 'INVALID_RESPONSE', 'Contacted revision');
  if (
    (listingId === null) !== (contactedRevision === null) ||
    !['web', 'mobile', 'staff'].includes(value.origin as string)
  )
    return invalid('INVALID_RESPONSE', 'Invalid enquiry reference or origin.');
  const status = enquiryStatus(value.status, 'INVALID_RESPONSE'),
    nextActionAt = enquiryTime(value.nextActionAt, 'INVALID_RESPONSE', true),
    createdAt = enquiryTime(value.createdAt, 'INVALID_RESPONSE')!,
    updatedAt = enquiryTime(value.updatedAt, 'INVALID_RESPONSE')!;
  if (
    (['contacted', 'qualified'].includes(status) && nextActionAt === null) ||
    Date.parse(updatedAt) < Date.parse(createdAt)
  )
    return invalid('INVALID_RESPONSE', 'Conflicting enquiry state or timestamps.');
  return Object.freeze({
    id,
    listingId,
    contactedRevision,
    name: enquiryText(value.name, 160, 'INVALID_RESPONSE'),
    origin: value.origin as StaffEnquirySummaryV2['origin'],
    status,
    assignedAgentId: enquiryNullableId(value.assignedAgentId, 'INVALID_RESPONSE'),
    nextActionAt,
    version: enquiryVersion(value.version, 'INVALID_RESPONSE'),
    createdAt,
    updatedAt,
  });
}
/** A safe list row with no phone, email or private message. */
export function validateStaffEnquirySummaryV2(input: unknown): StaffEnquirySummaryV2 {
  return enquirySummary(attachRecord(input, ENQUIRY_SUMMARY_FIELDS, 'INVALID_RESPONSE'));
}
export function validateStaffEnquiryDetailV2(
  input: unknown,
  enquiryId: string,
): StaffEnquiryDetailV2 {
  const id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID'),
    value = attachRecord(input, ENQUIRY_DETAIL_FIELDS, 'INVALID_RESPONSE'),
    summary = enquirySummary(value);
  if (summary.id !== id) return invalid('INVALID_RESPONSE', 'Unexpected enquiry identity.');
  const phone = value.phone,
    email = value.email;
  if (phone !== null && (typeof phone !== 'string' || !/^\+[1-9][0-9]{7,14}$/.test(phone)))
    return invalid('INVALID_RESPONSE', 'Invalid enquiry phone.');
  if (
    email !== null &&
    (typeof email !== 'string' ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(email))
  )
    return invalid('INVALID_RESPONSE', 'Invalid enquiry email.');
  if (phone === null && email === null)
    return invalid('INVALID_RESPONSE', 'Enquiry contact is missing.');
  const closureReason =
    value.closureReason === null
      ? null
      : enquiryText(value.closureReason, 1000, 'INVALID_RESPONSE', true);
  if (['closed_lost', 'spam'].includes(summary.status) && closureReason === null)
    return invalid('INVALID_RESPONSE', 'Enquiry closure reason is missing.');
  return Object.freeze({
    ...summary,
    phone: phone as string | null,
    email: email as string | null,
    message: enquiryText(value.message, 2000, 'INVALID_RESPONSE', false, true),
    noticeVersion: enquiryText(value.noticeVersion, 100, 'INVALID_RESPONSE'),
    closureReason,
  });
}
function enquiryRequest(
  input: unknown,
  kind: EnquiryOperationKindV2,
  validation: EnquiryValidationKind,
): EnquiryOperationRequestV2 {
  const value = attachRecord(input, ENQUIRY_REQUEST_FIELDS, validation),
    assignedAgentId = enquiryNullableId(value.assignedAgentId, validation),
    status = value.status === null ? null : enquiryStatus(value.status, validation),
    nextActionAt = enquiryTime(value.nextActionAt, validation, true),
    reason = value.reason === null ? null : enquiryText(value.reason, 1000, validation, true);
  if (kind === 'assign') {
    if (assignedAgentId === null || status !== null || nextActionAt !== null || reason !== null)
      return invalid(validation, 'Invalid assignment request.');
  } else if (kind === 'reschedule') {
    if (assignedAgentId !== null || status !== null || nextActionAt === null || reason !== null)
      return invalid(validation, 'Invalid reschedule request.');
  } else {
    if (
      assignedAgentId !== null ||
      status === null ||
      ['contacted', 'qualified'].includes(status) !== (nextActionAt !== null) ||
      ['new', 'assigned', 'closed_lost', 'spam'].includes(status) !== (reason !== null)
    )
      return invalid(validation, 'Invalid transition request.');
  }
  return Object.freeze({ assignedAgentId, status, nextActionAt, reason });
}
function enquiryCommand(
  input: unknown,
  validation: EnquiryValidationKind,
): EnquiryOperationInputV2 {
  const value = attachRecord(
    input,
    ['operationId', 'kind', 'expectedVersion', ...ENQUIRY_REQUEST_FIELDS],
    validation,
  );
  if (!['assign', 'transition', 'reschedule'].includes(value.kind as string))
    return invalid(validation, 'Invalid enquiry operation.');
  const kind = value.kind as EnquiryOperationKindV2,
    request = enquiryRequest(
      Object.fromEntries(ENQUIRY_REQUEST_FIELDS.map((field) => [field, value[field]])),
      kind,
      validation,
    );
  return Object.freeze({
    operationId: uuid(value.operationId, validation, 'Operation ID'),
    kind,
    expectedVersion: enquiryVersion(value.expectedVersion, validation, true),
    ...request,
  });
}
function enquiryOperation(
  input: unknown,
  enquiryId: string,
  operationId: string,
  original?: EnquiryOperationInputV2,
): EnquiryOperationReceiptV2 {
  const value = attachRecord(
    input,
    [
      'operationId',
      'enquiryId',
      'kind',
      'expectedVersion',
      'request',
      'outcome',
      'reason',
      'result',
      'completedAt',
    ],
    'INVALID_RESPONSE',
  );
  if (
    uuid(value.operationId, 'INVALID_RESPONSE', 'Operation ID') !== operationId ||
    uuid(value.enquiryId, 'INVALID_RESPONSE', 'Enquiry ID') !== enquiryId ||
    !['assign', 'transition', 'reschedule'].includes(value.kind as string)
  )
    return invalid('INVALID_RESPONSE', 'Unexpected enquiry operation identity.');
  const kind = value.kind as EnquiryOperationKindV2,
    expectedVersion = enquiryVersion(value.expectedVersion, 'INVALID_RESPONSE', true),
    request = enquiryRequest(value.request, kind, 'INVALID_RESPONSE'),
    raw = attachRecord(
      value.result,
      ['version', 'status', 'assignedAgentId', 'nextActionAt', 'closureReason'],
      'INVALID_RESPONSE',
    );
  if (
    original &&
    (original.operationId !== operationId ||
      original.kind !== kind ||
      original.expectedVersion !== expectedVersion ||
      ENQUIRY_REQUEST_FIELDS.some((field) => request[field] !== original[field]))
  )
    return invalid('INVALID_RESPONSE', 'Conflicting original enquiry request.');
  const result = Object.freeze({
    version: enquiryVersion(raw.version, 'INVALID_RESPONSE'),
    status: enquiryStatus(raw.status, 'INVALID_RESPONSE'),
    assignedAgentId: enquiryNullableId(raw.assignedAgentId, 'INVALID_RESPONSE'),
    nextActionAt: enquiryTime(raw.nextActionAt, 'INVALID_RESPONSE', true),
    closureReason:
      raw.closureReason === null
        ? null
        : enquiryText(raw.closureReason, 1000, 'INVALID_RESPONSE', true),
  });
  if (
    (['contacted', 'qualified'].includes(result.status) && result.nextActionAt === null) ||
    (['closed_lost', 'spam'].includes(result.status) && result.closureReason === null)
  )
    return invalid('INVALID_RESPONSE', 'Invalid operation result state.');
  if (value.outcome === 'applied') {
    if (value.reason !== null || BigInt(result.version) !== BigInt(expectedVersion) + 1n)
      return invalid('INVALID_RESPONSE', 'Invalid applied enquiry operation.');
  } else if (value.outcome === 'noop') {
    if (kind === 'transition' || value.reason !== null || result.version !== expectedVersion)
      return invalid('INVALID_RESPONSE', 'Invalid enquiry noop.');
  } else if (value.outcome === 'conflict') {
    if (value.reason !== 'VERSION_CONFLICT' || result.version === expectedVersion)
      return invalid('INVALID_RESPONSE', 'Invalid enquiry conflict.');
  } else if (value.outcome === 'rejected') {
    if (
      value.reason !== (kind === 'assign' ? 'ASSIGNEE_UNAVAILABLE' : 'INVALID_TRANSITION') ||
      result.version !== expectedVersion
    )
      return invalid('INVALID_RESPONSE', 'Invalid enquiry rejection.');
  } else return invalid('INVALID_RESPONSE', 'Invalid enquiry outcome.');
  if (value.outcome === 'applied' || value.outcome === 'noop') {
    if (
      kind === 'assign' &&
      (result.assignedAgentId !== request.assignedAgentId || result.status === 'new')
    )
      return invalid('INVALID_RESPONSE', 'Conflicting assignment result.');
    if (
      kind === 'reschedule' &&
      (!['contacted', 'qualified'].includes(result.status) ||
        result.nextActionAt !== request.nextActionAt)
    )
      return invalid('INVALID_RESPONSE', 'Conflicting reschedule result.');
    if (
      kind === 'transition' &&
      (result.status !== request.status ||
        result.nextActionAt !== request.nextActionAt ||
        result.closureReason !== request.reason)
    )
      return invalid('INVALID_RESPONSE', 'Conflicting transition result.');
  }
  return Object.freeze({
    operationId,
    enquiryId,
    kind,
    expectedVersion,
    request,
    outcome: value.outcome,
    reason: value.reason,
    result,
    completedAt: enquiryTime(value.completedAt, 'INVALID_RESPONSE')!,
  }) as EnquiryOperationReceiptV2;
}
/** Optionally bind the complete retained command; history alone is not a current enquiry snapshot. */
export function validateEnquiryOperationReceiptV2(
  input: unknown,
  enquiryId: string,
  operationId: string,
  request?: EnquiryOperationInputV2,
): EnquiryOperationReceiptV2 {
  const id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID'),
    operation = uuid(operationId, 'VALIDATION', 'Operation ID'),
    original = request === undefined ? undefined : enquiryCommand(request, 'VALIDATION');
  if (original && original.operationId !== operation)
    return invalid('VALIDATION', 'Original operation identity differs.');
  return enquiryOperation(input, id, operation, original);
}
function enquiryArray(input: unknown, maximum: number): readonly unknown[] {
  if (
    !Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Array.prototype ||
    input.length > maximum ||
    Reflect.ownKeys(input).length !== input.length + 1
  )
    return invalid('INVALID_RESPONSE', 'Invalid bounded enquiry page.');
  const items: unknown[] = [];
  for (let index = 0; index < input.length; index++) {
    const item = Object.getOwnPropertyDescriptor(input, String(index));
    if (!item?.enumerable || !Object.hasOwn(item, 'value'))
      return invalid('INVALID_RESPONSE', 'Invalid bounded enquiry page.');
    items.push(item.value);
  }
  return items;
}
function enquiryOptions(
  input: StaffRequestOptions & { readonly limit?: number },
  defaultLimit: number,
): Readonly<{ options: StaffRequestOptions; limit: number }> {
  if (!input || typeof input !== 'object')
    return invalid('VALIDATION', 'Staff options are required.');
  const keys = Reflect.ownKeys(input);
  if (
    keys.some(
      (key) =>
        typeof key !== 'string' || !['bearerToken', 'signal', 'timeoutMs', 'limit'].includes(key),
    )
  )
    return invalid('VALIDATION', 'Invalid staff enquiry options.');
  const value = attachRecord(input, keys as string[], 'VALIDATION'),
    limit = integer(
      value.limit === undefined ? defaultLimit : value.limit,
      1,
      100,
      'VALIDATION',
      'Limit',
    );
  delete value.limit;
  return Object.freeze({ options: uploadOptions(value as unknown as StaffRequestOptions), limit });
}
export function validateStaffEnquiryQueueInputV3(input: unknown): Readonly<{
  limit: number;
  filter: StaffEnquiryQueueFilterV3;
  after: string | null;
}> {
  if (!input || typeof input !== 'object')
    return invalid('VALIDATION', 'Use enquiry queue fields.');
  const q = attachRecord(input, Object.keys(input), 'VALIDATION');
  if (Object.keys(q).some((key) => !['limit', 'filter', 'after'].includes(key)))
    return invalid('VALIDATION', 'Unsupported enquiry queue field.');
  const limit = Object.hasOwn(q, 'limit') ? integer(q.limit, 1, 100, 'VALIDATION', 'Limit') : 50;
  const filter = Object.hasOwn(q, 'filter') ? q.filter : 'all';
  if (typeof filter !== 'string' || !['all', 'open', 'overdue', 'today'].includes(filter))
    return invalid('VALIDATION', 'Invalid enquiry queue filter.');
  const after = Object.hasOwn(q, 'after') ? uuid(q.after, 'VALIDATION', 'Enquiry cursor') : null;
  if (after !== null && after !== q.after)
    return invalid('VALIDATION', 'Use a canonical enquiry cursor.');
  return Object.freeze({ limit, filter: filter as StaffEnquiryQueueFilterV3, after });
}
export function validateStaffEnquiryQueuePageV3(
  input: unknown,
  selection: StaffEnquiryQueueInputV3 = {},
): StaffEnquiryQueuePageV3 {
  const expected = validateStaffEnquiryQueueInputV3(selection);
  const value = attachRecord(
    input,
    ['policy', 'items', 'limit', 'filter', 'after', 'hasMore', 'nextAfter', 'asOf', 'timeZone'],
    'INVALID_RESPONSE',
  );
  const items = enquiryArray(value.items, expected.limit).map(validateStaffEnquirySummaryV2);
  const asOf = enquiryTime(value.asOf, 'INVALID_RESPONSE')!;
  if (
    value.policy !== 'staff-enquiry-queue-v3' ||
    value.limit !== expected.limit ||
    value.filter !== expected.filter ||
    value.after !== expected.after ||
    value.timeZone !== 'Africa/Nairobi' ||
    typeof value.hasMore !== 'boolean' ||
    (value.hasMore && items.length !== expected.limit)
  )
    return invalid('INVALID_RESPONSE', 'Inconsistent enquiry queue metadata.');
  if (
    new Set(items.map((item) => item.id)).size !== items.length ||
    items.some((item) => item.id === expected.after) ||
    value.nextAfter !== (value.hasMore ? items.at(-1)?.id : null)
  )
    return invalid('INVALID_RESPONSE', 'Invalid enquiry queue cursor.');
  const instant = Date.parse(asOf),
    nextMidnight = Math.floor((instant + 10800000) / 86400000) * 86400000 - 10800000 + 86400000;
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    // Millisecond DTO dates cannot establish UUID tie order for distinct database microseconds.
    if (index > 0 && item.createdAt > items[index - 1]!.createdAt)
      return invalid('INVALID_RESPONSE', 'Invalid enquiry queue ordering.');
    const open = ['new', 'assigned', 'contacted', 'qualified'].includes(item.status),
      due = item.nextActionAt === null ? null : Date.parse(item.nextActionAt);
    if (
      expected.filter !== 'all' &&
      (!open ||
        (expected.filter === 'overdue' && (due === null || due >= instant)) ||
        (expected.filter === 'today' && (due === null || due < instant || due >= nextMidnight)))
    )
      return invalid('INVALID_RESPONSE', 'Enquiry does not match the queue filter.');
  }
  return Object.freeze({
    policy: 'staff-enquiry-queue-v3',
    items: Object.freeze(items),
    limit: expected.limit,
    filter: expected.filter,
    after: expected.after,
    hasMore: value.hasMore,
    nextAfter: value.nextAfter as string | null,
    asOf,
    timeZone: 'Africa/Nairobi',
  });
}
function assertEnquiryJsonTokens(source: string): void {
  assertMediaJsonTokens(source);
  const tokens =
    source.match(
      /"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g,
    ) ?? [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (!token.startsWith('"') || tokens[index + 1] !== ':') continue;
    const key = JSON.parse(token) as string,
      value = tokens[index + 2] ?? '';
    if (
      (key === 'limit' && !/^[1-9]\d*$/.test(value)) ||
      (key === 'contactedRevision' && !/^(?:null|[1-9]\d*)$/.test(value))
    )
      throw new Error('Invalid enquiry integer token.');
  }
}
/** Validate historical facts only. Bind original write intent separately before recovery. */
export function validateMediaOperationReceiptV2(
  input: unknown,
  listingId: string,
  revision: number,
  operationId: string,
): MediaOperationReceiptV2 {
  const id = uuid(listingId, 'VALIDATION', 'Listing ID'),
    number = integer(revision, 1, 2147483647, 'VALIDATION', 'Revision'),
    operation = uuid(operationId, 'VALIDATION', 'Operation ID');
  return mediaOperation(input, id, number, operation);
}
/** Parse safe registration history, optionally bound to the exact original command. */
export function validateMediaRegistrationReceiptV2(
  input: unknown,
  listingId: string,
  revision: number,
  registrationId: string,
  request?: MediaRegistrationInputV2,
): MediaRegistrationReceiptV2 {
  const listing = uuid(listingId, 'VALIDATION', 'Listing ID'),
    number = integer(revision, 1, 2147483647, 'VALIDATION', 'Revision'),
    registration = uuid(registrationId, 'VALIDATION', 'Registration ID');
  let original: MediaRegistrationInputV2 | undefined;
  if (request !== undefined) {
    const row = attachRecord(
        request,
        ['registrationId', 'expectedVersion', 'altText'],
        'VALIDATION',
      ),
      id = uuid(row.registrationId, 'VALIDATION', 'Registration ID'),
      expectedVersion = staffVersion(row.expectedVersion, 'VALIDATION'),
      altText = mediaAltText(row.altText, 'VALIDATION');
    if (id !== registration || BigInt(expectedVersion) > BigInt(Number.MAX_SAFE_INTEGER))
      return invalid('VALIDATION', 'Invalid original registration command.');
    original = Object.freeze({ registrationId: id, expectedVersion, altText });
  }
  return mediaRegistration(
    attachRecord(input, [...MEDIA_FACT_FIELDS, 'outcome'], 'INVALID_RESPONSE'),
    listing,
    number,
    registration,
    original,
  );
}
/** Parse safe attachment history, optionally bound to the exact original command. */
export function validateMediaAttachIntentV2(
  input: unknown,
  listingId: string,
  revision: number,
  operationId: string,
  request?: MediaAttachIntentInputV2,
): MediaAttachIntentV2 {
  const listing = uuid(listingId, 'VALIDATION', 'Listing ID'),
    number = integer(revision, 1, 2147483647, 'VALIDATION', 'Revision'),
    operation = uuid(operationId, 'VALIDATION', 'Operation ID');
  let original: MediaAttachIntentInputV2 | undefined;
  if (request !== undefined) {
    const row = attachRecord(request, ['operationId', 'jobId', 'expectedVersion'], 'VALIDATION'),
      id = uuid(row.operationId, 'VALIDATION', 'Operation ID'),
      jobId = uuid(row.jobId, 'VALIDATION', 'Job ID'),
      expectedVersion = staffVersion(row.expectedVersion, 'VALIDATION');
    if (
      id !== operation ||
      jobId === operation ||
      BigInt(expectedVersion) > BigInt(Number.MAX_SAFE_INTEGER - 1)
    )
      return invalid('VALIDATION', 'Invalid original attachment command.');
    original = Object.freeze({ operationId: id, jobId, expectedVersion });
  }
  return mediaAttachIntent(input, listing, number, operation, original);
}
/** Pure parser for an untrusted BFF status; resource/principal authorization remains server-owned. */
export function validateMediaUploadStatusV2(
  input: unknown,
  listingId: string,
  revision: number,
  jobId: string,
  uploadId: string,
): MediaUploadStatusV2 {
  const listing = uuid(listingId, 'VALIDATION', 'Listing ID'),
    number = integer(revision, 1, 2147483647, 'VALIDATION', 'Revision'),
    job = uuid(jobId, 'VALIDATION', 'Job ID'),
    upload = uuid(uploadId, 'VALIDATION', 'Upload ID');
  const row = attachRecord(
    input,
    ['uploadId', 'jobId', 'listingId', 'revision', 'state'],
    'INVALID_RESPONSE',
  );
  if (
    uuid(row.uploadId, 'INVALID_RESPONSE', 'Upload ID') !== upload ||
    uuid(row.jobId, 'INVALID_RESPONSE', 'Job ID') !== job ||
    uuid(row.listingId, 'INVALID_RESPONSE', 'Listing ID') !== listing ||
    integer(row.revision, 1, 2147483647, 'INVALID_RESPONSE', 'Revision') !== number ||
    typeof row.state !== 'string' ||
    !['verified', 'processing', 'blocked', 'native_failed'].includes(row.state)
  )
    return invalid('INVALID_RESPONSE', 'Unexpected private upload status.');
  return Object.freeze({
    uploadId: upload,
    jobId: job,
    listingId: listing,
    revision: number,
    state: row.state as MediaUploadStatusV2['state'],
  });
}
function uploadBytes(input: unknown): Uint8Array<ArrayBuffer> {
  try {
    if (
      !ArrayBuffer.isView(input) ||
      Reflect.apply(nativeTypedArrayKind, input, []) !== 'Uint8Array'
    )
      return invalid('VALIDATION', 'Supply an ordinary byte array within the upload limit.');
    const backing = Reflect.apply(nativeTypedArrayBuffer, input, []) as ArrayBuffer,
      offset = Reflect.apply(nativeTypedArrayOffset, input, []) as number,
      length = Reflect.apply(nativeTypedArrayLength, input, []) as number;
    // The ArrayBuffer intrinsic rejects SharedArrayBuffer without relying on a
    // browser exposing that constructor or caller-owned .buffer/.length fields.
    Reflect.apply(nativeArrayBufferLength, backing, []);
    if (length < 1 || length > 10485760)
      return invalid('VALIDATION', 'Private uploads require 1 byte through 10 MiB.');
    const snapshot = new Uint8Array(length);
    Reflect.apply(nativeByteCopy, snapshot, [new Uint8Array(backing, offset, length), 0]);
    return snapshot;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    return invalid('VALIDATION', 'Supply an ordinary byte array within the upload limit.');
  }
}
function reportQueueInput(input: unknown): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return invalid('VALIDATION', 'Exact report queue fields required.');
  const keys = Reflect.ownKeys(input);
  if (keys.some((k) => typeof k !== 'string' || !['limit', 'before', 'status'].includes(k)))
    return invalid('VALIDATION', 'Unsupported report queue field.');
  return attachRecord(input, keys as string[], 'VALIDATION');
}
function anonymousReportOptions(input: Omit<RequestOptions, 'bearerToken'>): RequestOptions {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return invalid('VALIDATION', 'Exact anonymous report options required.');
  const keys = Reflect.ownKeys(input);
  if (keys.some((k) => typeof k !== 'string' || !['signal', 'timeoutMs'].includes(k)))
    return invalid('VALIDATION', 'Anonymous report options accept no authority.');
  const snapshot = attachRecord(input, keys as string[], 'VALIDATION') as RequestOptions;
  requestOptions(snapshot);
  return Object.freeze(snapshot);
}
function uploadOptions(input: StaffRequestOptions): StaffRequestOptions {
  if (
    !input ||
    typeof input !== 'object' ||
    (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
  )
    return invalid('VALIDATION', 'Supply exact staff request options.');
  const keys = Reflect.ownKeys(input);
  if (
    keys.some(
      (key) => typeof key !== 'string' || !['bearerToken', 'signal', 'timeoutMs'].includes(key),
    )
  )
    return invalid('VALIDATION', 'Supply exact staff request options.');
  const snapshot = attachRecord(
    input,
    keys as string[],
    'VALIDATION',
  ) as unknown as StaffRequestOptions;
  staffOptions(snapshot);
  return Object.freeze(snapshot);
}
function appendPreviewBytes(
  destination: Uint8Array<ArrayBuffer>,
  offset: number,
  input: unknown,
): number {
  try {
    if (
      !ArrayBuffer.isView(input) ||
      Reflect.apply(nativeTypedArrayKind, input, []) !== 'Uint8Array'
    )
      return invalid('INVALID_RESPONSE', 'Malformed private image response bytes.');
    const backing = Reflect.apply(nativeTypedArrayBuffer, input, []) as ArrayBuffer,
      start = Reflect.apply(nativeTypedArrayOffset, input, []) as number,
      length = Reflect.apply(nativeTypedArrayLength, input, []) as number;
    Reflect.apply(nativeArrayBufferLength, backing, []);
    if (length > destination.byteLength - offset)
      return invalid('INVALID_RESPONSE', 'Private image response exceeded its supported length.');
    Reflect.apply(nativeByteCopy, destination, [new Uint8Array(backing, start, length), offset]);
    return offset + length;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    return invalid('INVALID_RESPONSE', 'Malformed private image response bytes.');
  }
}
function previewLength(input: string | null, min: number, max: number): number {
  if (input === null || !/^(?:0|[1-9]\d{0,7})$/.test(input))
    return invalid('INVALID_RESPONSE', 'Invalid private image response length.');
  const length = Number(input);
  if (length < min || length > max)
    return invalid('INVALID_RESPONSE', 'Invalid private image response length.');
  return length;
}
function previewContainer(data: Uint8Array<ArrayBuffer>): void {
  if (
    data.byteLength < 20 ||
    data[0] !== 82 ||
    data[1] !== 73 ||
    data[2] !== 70 ||
    data[3] !== 70 ||
    data[8] !== 87 ||
    data[9] !== 69 ||
    data[10] !== 66 ||
    data[11] !== 80 ||
    new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4, true) !==
      data.byteLength - 8
  )
    return invalid('INVALID_RESPONSE', 'Malformed private WebP image container.');
}
function requestOptions(input: RequestOptions, extra: readonly string[] = []): void {
  record(input, ['bearerToken', 'signal', 'timeoutMs', ...extra], 'VALIDATION');
  if (
    input.bearerToken !== undefined &&
    (typeof input.bearerToken !== 'string' ||
      input.bearerToken.length > 8192 ||
      !/^[A-Za-z\d\-._~+/]+=*$/.test(input.bearerToken))
  )
    invalid('VALIDATION', 'Invalid bearer token.');
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal))
    invalid('VALIDATION', 'Use a valid cancellation signal.');
  if (input.timeoutMs !== undefined) timeout(input.timeoutMs, 'VALIDATION');
}
function enquiryBody(input: EnquiryInput, currentNotice: string): Record<string, unknown> {
  const value = record(
    input,
    [
      'listingId',
      'name',
      'phone',
      'email',
      'message',
      'origin',
      'noticeVersion',
      'noticeAcknowledged',
    ],
    'VALIDATION',
  );
  const listingId =
    value.listingId == null ? null : uuid(value.listingId, 'VALIDATION', 'Listing ID');
  const name = text(value.name, 160, 'VALIDATION', 'Name'),
    message = text(value.message, 2000, 'VALIDATION', 'Message');
  const noticeVersion = text(value.noticeVersion, 100, 'VALIDATION', 'Privacy notice version');
  if (noticeVersion !== currentNotice || value.noticeAcknowledged !== true)
    return invalid('VALIDATION', 'Acknowledge the current enquiry privacy notice.');
  if (value.origin !== 'web' && value.origin !== 'mobile')
    return invalid('VALIDATION', 'Choose web or mobile enquiry origin.');
  const phone = value.phone == null ? null : text(value.phone, 40, 'VALIDATION', 'Phone');
  const email =
    value.email == null ? null : text(value.email, 254, 'VALIDATION', 'Email').toLowerCase();
  if ((!phone && !email) || (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
    return invalid('VALIDATION', 'Provide a phone number or valid email.');
  return {
    listingId,
    name,
    phone,
    email,
    message,
    origin: value.origin,
    noticeVersion,
    noticeAcknowledged: true,
  };
}

/** Shared source-free staff input validation; does not confer identity or perform network work. */
export function validateStaffEnquiryInput(
  input: StaffEnquiryInput,
  currentNotice: string,
): Readonly<Record<string, unknown>> {
  record(
    input,
    ['listingId', 'name', 'phone', 'email', 'message', 'noticeVersion', 'noticeAcknowledged'],
    'VALIDATION',
  );
  const { origin: ignored, ...body } = enquiryBody({ ...input, origin: 'web' }, currentNotice);
  return Object.freeze(body);
}

export class RealtorApiClient {
  private readonly apiOrigin: string;
  private readonly currentNotice: string;
  private readonly defaultTimeout: number;
  private readonly transport: typeof globalThis.fetch;
  constructor(options: ApiClientOptions) {
    record(
      options,
      ['baseUrl', 'privacyNoticeVersion', 'allowLoopbackHttp', 'timeoutMs', 'fetch'],
      'CONFIGURATION',
    );
    if (options.allowLoopbackHttp !== undefined && typeof options.allowLoopbackHttp !== 'boolean')
      invalid('CONFIGURATION', 'Development HTTP opt-in must be boolean.');
    this.apiOrigin = origin(options);
    this.currentNotice = text(
      options.privacyNoticeVersion,
      100,
      'CONFIGURATION',
      'Configured privacy notice version',
    );
    this.defaultTimeout = timeout(options.timeoutMs ?? 10000, 'CONFIGURATION');
    if (options.fetch !== undefined && typeof options.fetch !== 'function')
      invalid('CONFIGURATION', 'A Fetch-compatible transport is required.');
    if (!options.fetch && typeof globalThis.fetch !== 'function')
      invalid('CONFIGURATION', 'A Fetch-compatible transport is required.');
    this.transport = options.fetch ?? globalThis.fetch.bind(globalThis);
  }
  async listProperties(
    options: RequestOptions & { readonly limit?: number } = {},
  ): Promise<PropertyPage> {
    requestOptions(options, ['limit']);
    const limit = integer(options.limit ?? 50, 1, 100, 'VALIDATION', 'Limit');
    const data = record(
      await this.request(`/v1/properties?limit=${limit}`, 'GET', options),
      ['items', 'limit'],
      'INVALID_RESPONSE',
    );
    if (data.limit !== limit || !Array.isArray(data.items) || data.items.length > limit)
      return invalid('INVALID_RESPONSE', 'Invalid property page.');
    return Object.freeze({
      items: Object.freeze(data.items.map((input) => publicProperty(input))),
      limit,
    });
  }
  async listPropertiesV2(
    options: RequestOptions & { readonly limit?: number } = {},
  ): Promise<PropertyPageV2> {
    requestOptions(options, ['limit']);
    const limit = integer(options.limit ?? 50, 1, 100, 'VALIDATION', 'Limit');
    const data = record(
      await this.request(`/v2/properties?limit=${limit}`, 'GET', options),
      ['items', 'limit'],
      'INVALID_RESPONSE',
    );
    if (data.limit !== limit || !Array.isArray(data.items) || data.items.length > limit)
      return invalid('INVALID_RESPONSE', 'Invalid property page.');
    return Object.freeze({ items: Object.freeze(data.items.map(publicPropertyV2)), limit });
  }
  async searchPropertiesV2(
    input: PublicSearchInput = {},
    options: RequestOptions = {},
  ): Promise<PublicSearchPage<PublicPropertyV2>> {
    return this.publicSearch(input, options, false) as Promise<PublicSearchPage<PublicPropertyV2>>;
  }
  async getSyntheticReferenceSearchOptions(
    options: RequestOptions = {},
  ): Promise<PublicReferenceSearchOptions> {
    requestOptions(options);
    if (options.bearerToken !== undefined)
      return invalid('VALIDATION', 'Public reference choices are anonymous.');
    const data = attachRecord(
      await this.request('/v3/property-reference-options', 'GET', options),
      ['policy', 'options', 'maximumPerCategory'],
      'INVALID_RESPONSE',
    );
    if (data.policy !== 'synthetic-reference-options-v1' || data.maximumPerCategory !== 5000)
      return invalid('INVALID_RESPONSE', 'Invalid public reference choices.');
    const keys = ['countyId', 'localityId', 'neighbourhoodId', 'amenityId'] as const,
      captured = attachRecord(data.options, keys, 'INVALID_RESPONSE'),
      seen = new Set<string>();
    const result = {} as Record<
      (typeof keys)[number],
      readonly Readonly<{ id: string; label: string }>[]
    >;
    for (const key of keys) {
      const rows = captured[key];
      if (!Array.isArray(rows) || rows.length > 5000)
        return invalid('INVALID_RESPONSE', 'Public reference choice limit exceeded.');
      result[key] = Object.freeze(
        rows.map((input) => {
          const row = attachRecord(input, ['id', 'label'], 'INVALID_RESPONSE'),
            id = uuid(row.id, 'INVALID_RESPONSE', 'Reference ID'),
            label = text(row.label, 512, 'INVALID_RESPONSE', 'Public reference label', true);
          if (seen.has(id) || label !== row.label || label.normalize('NFC') !== label)
            return invalid('INVALID_RESPONSE', 'Duplicate or malformed public reference choices.');
          seen.add(id);
          return Object.freeze({ id, label });
        }),
      );
    }
    return Object.freeze(result);
  }
  async searchSyntheticReferencePropertiesV3(
    input: PublicSearchInput = {},
    options: RequestOptions = {},
  ): Promise<PublicSearchPage<SyntheticReferencePublicPropertyV3>> {
    return this.publicSearch(input, options, true) as Promise<
      PublicSearchPage<SyntheticReferencePublicPropertyV3>
    >;
  }
  private async publicSearch(
    input: PublicSearchInput,
    options: RequestOptions,
    reference: boolean,
  ): Promise<PublicSearchPage<PublicPropertyV2 | SyntheticReferencePublicPropertyV3>> {
    requestOptions(options);
    if (!input || typeof input !== 'object')
      return invalid('VALIDATION', 'Use public search fields.');
    if (options.bearerToken !== undefined) invalid('VALIDATION', 'Public search is anonymous.');
    const q = attachRecord(input, Object.keys(input), 'VALIDATION');
    const allowed = [
      'location',
      'purpose',
      'type',
      'period',
      'min',
      'minMode',
      'max',
      'beds',
      'bedsMode',
      'privateBaths',
      'sharedBaths',
      'sort',
      'limit',
      'offset',
      'id',
      'area',
      ...(reference ? ['countyId', 'localityId', 'neighbourhoodId', 'amenityId'] : []),
    ];
    if (Object.keys(q).some((key) => !allowed.includes(key)))
      invalid('VALIDATION', 'Unsupported search field.');
    const limit = integer(q.limit ?? 24, 1, 100, 'VALIDATION', 'Limit'),
      offset = integer(q.offset ?? 0, 0, 10000, 'VALIDATION', 'Offset'),
      sort = q.sort ?? 'catalogue';
    const params = new URLSearchParams();
    const prices: Partial<Record<'min' | 'max', number>> = {};
    for (const [key, value] of Object.entries(q)) {
      if (key === 'limit' || key === 'offset') continue;
      if (key === 'area') {
        const area = parseSearchAreaPolygon(value);
        if (!area) invalid('VALIDATION', 'Invalid search area.');
        params.set(key, JSON.stringify(area));
        continue;
      }
      if (typeof value !== 'string') return invalid('VALIDATION', 'Search values must be text.');
      if (value === '') continue;
      if (key === 'id' || key.endsWith('Id')) uuid(value, 'VALIDATION', 'Reference ID');
      if (
        key === 'location' &&
        ([...value].length > 160 || !value.trim() || /[\u0000-\u001f\u007f-\u009f]/u.test(value))
      )
        invalid('VALIDATION', 'Invalid location search.');
      if (key === 'purpose' && !['rent', 'sale'].includes(value))
        invalid('VALIDATION', 'Invalid purpose.');
      if (key === 'type' && !PROPERTY_TYPES.includes(value as PropertyType))
        invalid('VALIDATION', 'Invalid property type.');
      if (key === 'period' && !['day', 'week', 'month', 'year'].includes(value))
        invalid('VALIDATION', 'Invalid period.');
      if (key === 'minMode' && value !== 'over')
        invalid('VALIDATION', 'Invalid minimum price mode.');
      if (key === 'bedsMode' && value !== 'at_least')
        invalid('VALIDATION', 'Invalid bedroom count mode.');
      if (
        ['beds', 'privateBaths', 'sharedBaths'].includes(key) &&
        (!/^(0|[1-9]\d{0,2})$/.test(value) || Number(value) > 100)
      )
        invalid('VALIDATION', 'Invalid room count.');
      if (key === 'min' || key === 'max') {
        try {
          prices[key] = kesFromMajor(value).minorUnits;
          if (prices[key]! <= 0) throw Error();
        } catch {
          invalid('VALIDATION', 'Invalid price ' + (key === 'min' ? 'minimum.' : 'maximum.'));
        }
      }
      params.set(key, value);
    }
    if (!['catalogue', 'title', 'price_low', 'price_high'].includes(sort as string))
      invalid('VALIDATION', 'Invalid order.');
    if (
      (q.min || q.max || String(sort).startsWith('price_')) &&
      !(q.purpose === 'sale' || (q.purpose === 'rent' && q.period))
    )
      invalid('VALIDATION', 'Choose a price basis.');
    if (prices.min !== undefined && prices.max !== undefined && prices.min > prices.max)
      invalid('VALIDATION', 'Minimum price must not exceed maximum price.');
    if (q.minMode === 'over' && prices.min === undefined)
      invalid('VALIDATION', 'Over requires a positive minimum price.');
    if (q.bedsMode === 'at_least' && (q.beds === undefined || q.beds === ''))
      invalid('VALIDATION', 'At least requires a bedroom count.');
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    if (new TextEncoder().encode(params.toString()).byteLength > 8192)
      invalid('VALIDATION', 'Search query too large.');
    const data = attachRecord(
      await this.request(`/v${reference ? 3 : 2}/properties/search?${params}`, 'GET', options),
      ['policy', 'items', 'total', 'limit', 'offset', 'sort', 'hasMore', 'maxOffset'],
      'INVALID_RESPONSE',
    );
    const total = integer(data.total, 0, Number.MAX_SAFE_INTEGER, 'INVALID_RESPONSE', 'Total');
    const policy = reference ? 'synthetic-reference-search-v1' : 'public-search-v1';
    if (
      data.policy !== policy ||
      data.limit !== limit ||
      data.offset !== offset ||
      data.sort !== sort ||
      data.maxOffset !== 10000 ||
      !Array.isArray(data.items) ||
      data.items.length !== Math.min(limit, Math.max(0, total - offset)) ||
      data.hasMore !== offset + data.items.length < total
    )
      return invalid('INVALID_RESPONSE', 'Inconsistent public search page.');
    const items = data.items.map(reference ? publicReferenceProperty : publicPropertyV2);
    if (q.id && (total > 1 || items.some((item) => item.id !== q.id)))
      return invalid('INVALID_RESPONSE', 'Wrong property lookup.');
    if (new Set(items.map((item) => item.id)).size !== items.length)
      invalid('INVALID_RESPONSE', 'Duplicate search results.');
    return Object.freeze({
      policy,
      items: Object.freeze(items),
      total,
      limit,
      offset,
      sort: sort as string,
      hasMore: data.hasMore as boolean,
      maxOffset: 10000,
    });
  }
  async getStaffDraftV2(
    listingId: string,
    revision: number,
    options: StaffRequestOptions,
  ): Promise<StaffDraftV2> {
    staffOptions(options);
    const path = staffPath(listingId, revision);
    return staffDraft(await this.request(path, 'GET', options), revision);
  }
  /** Default-off synthetic extension; public facts only, with explicit legacy absence. */
  async getSyntheticReferencePropertiesV3(
    options: RequestOptions & { limit?: number } = {},
  ): Promise<SyntheticReferencePropertyPageV3> {
    requestOptions(options, ['limit']);
    const limit = integer(options.limit ?? 50, 1, 100, 'VALIDATION', 'Limit');
    const data = attachRecord(
      await this.request(`/v3/properties?limit=${limit}`, 'GET', options),
      ['policy', 'items', 'limit'],
      'INVALID_RESPONSE',
    );
    if (
      data.policy !== 'synthetic-reference-public-v1' ||
      data.limit !== limit ||
      !Array.isArray(data.items) ||
      data.items.length > limit
    )
      return invalid('INVALID_RESPONSE', 'Invalid public reference page.');
    return Object.freeze({
      policy: 'synthetic-reference-public-v1',
      limit,
      items: Object.freeze(data.items.map(publicReferenceProperty)),
    });
  }
  async getStaffDraftWorkspaceV2(
    listingId: string,
    revision: number,
    options: StaffRequestOptions,
  ): Promise<StaffDraftWorkspaceV2> {
    staffOptions(options);
    const path = mediaPath(listingId, revision);
    return validateStaffDraftWorkspaceV2(
      await this.request(`${path}/workspace`, 'GET', options),
      listingId,
      revision,
    );
  }
  /** Read one current authorized saved-version image. This never processes or mutates media and never retries. */
  async getStaffMediaPreviewV2(
    listingId: string,
    revision: number,
    mediaId: string,
    expectedVersion: string,
    options: StaffRequestOptions,
  ): Promise<StaffMediaPreviewV2> {
    const captured = uploadOptions(options),
      listing = uuid(listingId, 'VALIDATION', 'Listing ID'),
      number = integer(revision, 1, 2147483647, 'VALIDATION', 'Revision'),
      media = uuid(mediaId, 'VALIDATION', 'Media ID'),
      version = staffVersion(expectedVersion, 'VALIDATION');
    if (BigInt(version) > BigInt(Number.MAX_SAFE_INTEGER))
      return invalid('VALIDATION', 'Unsupported private image version.');
    const data = await this.previewRequest(
      `${mediaPath(listing, number)}/media/${media}/preview`,
      version,
      captured,
    );
    return Object.freeze({
      listingId: listing,
      revision: number,
      mediaId: media,
      version,
      mimeType: 'image/webp',
      data,
    });
  }
  async getListingDuplicateCandidatesV2(
    input: ListingDuplicateRequest,
    options: StaffRequestOptions,
  ): Promise<ListingDuplicateCandidates> {
    const captured = uploadOptions(options);
    let lookup: ListingDuplicateRequest;
    try {
      lookup = validateListingDuplicateRequest(input);
    } catch {
      return invalid('VALIDATION', 'Invalid duplicate lookup target.');
    }
    const path = `/v2/staff/listings/${lookup.listingId}/duplicate-candidates?listingVersion=${lookup.listingVersion}&revision=${lookup.revision}&revisionVersion=${lookup.revisionVersion}&limit=${lookup.limit}`;
    const data = await this.request(path, 'GET', captured);
    try {
      return validateListingDuplicateCandidates(data, lookup);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid listing duplicate candidates.');
    }
  }
  async previewListingImportV2(
    csv: string,
    options: StaffRequestOptions,
  ): Promise<ListingImportPreview> {
    const captured = uploadOptions(options);
    try {
      previewListingImport(csv);
    } catch {
      return invalid('VALIDATION', 'Use a valid bounded listing CSV file.');
    }
    const data = await this.request('/v2/staff/listing-import-preview', 'POST', captured, { csv });
    try {
      return validateListingImportPreview(data, csv);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid listing import preview.');
    }
  }
  async getReviewMediaGalleryV2(
    listingId: string,
    revision: number,
    expectedVersion: string,
    options: StaffRequestOptions,
  ): Promise<ReviewMediaGallery> {
    const captured = uploadOptions(options),
      listing = uuid(listingId, 'VALIDATION', 'Listing ID'),
      number = integer(revision, 1, 2147483647, 'VALIDATION', 'Revision'),
      version = staffVersion(expectedVersion, 'VALIDATION');
    if (BigInt(version) > BigInt(Number.MAX_SAFE_INTEGER))
      return invalid('VALIDATION', 'Unsupported review version.');
    const data = await this.request(
      `/v2/staff/reviews/${listing}/revisions/${number}/media-gallery`,
      'GET',
      captured,
      undefined,
      undefined,
      undefined,
      version,
    );
    try {
      return validateReviewMediaGallery(data, listing, number, version);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid reviewer gallery.');
    }
  }
  async getReviewMediaPreviewV2(
    listingId: string,
    revision: number,
    mediaId: string,
    expectedVersion: string,
    options: StaffRequestOptions,
  ): Promise<StaffMediaPreviewV2> {
    const captured = uploadOptions(options),
      listing = uuid(listingId, 'VALIDATION', 'Listing ID'),
      number = integer(revision, 1, 2147483647, 'VALIDATION', 'Revision'),
      media = uuid(mediaId, 'VALIDATION', 'Media ID'),
      version = staffVersion(expectedVersion, 'VALIDATION');
    if (BigInt(version) > BigInt(Number.MAX_SAFE_INTEGER))
      return invalid('VALIDATION', 'Unsupported review version.');
    const data = await this.previewRequest(
      `/v2/staff/reviews/${listing}/${number}/media/${media}/preview`,
      version,
      captured,
    );
    return Object.freeze({
      listingId: listing,
      revision: number,
      mediaId: media,
      version,
      mimeType: 'image/webp',
      data,
    });
  }
  async saveStaffDraftV2(
    listingId: string,
    revision: number,
    input: StaffDraftSaveV2,
    options: StaffRequestOptions,
  ): Promise<StaffVersionReceipt> {
    staffOptions(options);
    const path = staffPath(listingId, revision);
    const value = record(input, ['expectedVersion', 'content'], 'VALIDATION');
    const expectedVersion = expectedStaffVersion(value.expectedVersion, false),
      content = validateStaffDraftContentV2(value.content);
    try {
      const data = record(
        await this.request(path, 'PUT', options, { expectedVersion, content }),
        ['version'],
        'INVALID_RESPONSE',
      );
      return Object.freeze({ version: staffVersion(data.version, 'INVALID_RESPONSE') });
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async submitStaffDraftV2(
    listingId: string,
    revision: number,
    input: StaffDraftSubmitV2,
    options: StaffRequestOptions,
  ): Promise<StaffVersionReceipt> {
    staffOptions(options);
    const path = staffPath(listingId, revision) + '/submit';
    const value = record(input, ['expectedVersion'], 'VALIDATION');
    const expectedVersion = expectedStaffVersion(value.expectedVersion, false);
    try {
      const data = record(
        await this.request(path, 'POST', options, { expectedVersion }),
        ['version'],
        'INVALID_RESPONSE',
      );
      return Object.freeze({ version: staffVersion(data.version, 'INVALID_RESPONSE') });
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async listReviewsV2(
    options: StaffRequestOptions & { readonly limit?: number },
  ): Promise<ReviewPageV2> {
    staffOptions(options, ['limit']);
    const limit = integer(options.limit ?? 50, 1, 100, 'VALIDATION', 'Limit');
    const data = record(
      await this.request(`/v2/staff/reviews?limit=${limit}`, 'GET', options),
      ['items', 'limit'],
      'INVALID_RESPONSE',
    );
    if (data.limit !== limit || !Array.isArray(data.items) || data.items.length > limit)
      return invalid('INVALID_RESPONSE', 'Invalid review page.');
    const keys = new Set<string>();
    const items = data.items.map((input) => {
      const item = reviewSummary(input),
        key = `${item.listingId}:${item.revision}`;
      if (keys.has(key)) return invalid('INVALID_RESPONSE', 'Repeated review revision.');
      keys.add(key);
      return item;
    });
    return Object.freeze({ items: Object.freeze(items), limit });
  }
  async getReviewV2(
    listingId: string,
    revision: number,
    options: StaffRequestOptions,
  ): Promise<ReviewDetailV2> {
    staffOptions(options);
    const path = reviewPath(listingId, revision);
    return reviewDetail(await this.request(path, 'GET', options), listingId, revision);
  }
  async decideReviewV2(
    listingId: string,
    revision: number,
    input: ReviewDecisionInputV2,
    options: StaffRequestOptions,
  ): Promise<ReviewDecisionReceiptV2> {
    staffOptions(options);
    const path = reviewPath(listingId, revision) + '/decision',
      value = record(input, ['expectedVersion', 'decision', 'reason'], 'VALIDATION');
    const expectedVersion = expectedStaffVersion(value.expectedVersion, false);
    const decision = value.decision;
    if (decision !== 'approve' && decision !== 'reject')
      return invalid('VALIDATION', 'Choose approve or reject.');
    const reason =
      decision === 'reject'
        ? decisionReason(value.reason, 'VALIDATION')
        : value.reason === null
          ? null
          : invalid('VALIDATION', 'Approval requires a null reason.');
    try {
      const receipt = record(
        await this.request(path, 'POST', options, { expectedVersion, decision, reason }),
        ['version', 'state'],
        'INVALID_RESPONSE',
      );
      const state = decision === 'approve' ? 'approved' : 'rejected';
      if (receipt.state !== state)
        return invalid('INVALID_RESPONSE', 'Unexpected decision receipt state.');
      return Object.freeze({ version: staffVersion(receipt.version, 'INVALID_RESPONSE'), state });
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  /** Supply and retain the original UUID/body for explicit retry; no automatic retry or version refresh occurs. */
  async registerMediaUploadV2(
    listingId: string,
    revision: number,
    input: MediaRegistrationInputV2,
    options: StaffRequestOptions,
  ): Promise<MediaRegistrationReceiptV2> {
    staffOptions(options);
    const path = mediaPath(listingId, revision) + '/media-registrations',
      value = record(input, ['registrationId', 'expectedVersion', 'altText'], 'VALIDATION');
    const registrationId = uuid(value.registrationId, 'VALIDATION', 'Registration ID'),
      expectedVersion = expectedStaffVersion(value.expectedVersion, false),
      altText = mediaAltText(value.altText, 'VALIDATION');
    const canonical = Object.freeze({
      registrationId,
      expectedVersion: String(expectedVersion),
      altText,
    });
    try {
      return mediaRegistration(
        await this.request(path, 'POST', options, { registrationId, expectedVersion, altText }),
        listingId,
        revision,
        registrationId,
        canonical,
      );
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async getMediaRegistrationV2(
    listingId: string,
    revision: number,
    registrationId: string,
    options: StaffRequestOptions,
  ): Promise<MediaRegistrationReceiptV2> {
    staffOptions(options);
    const path = mediaPath(listingId, revision),
      id = uuid(registrationId, 'VALIDATION', 'Registration ID');
    return mediaRegistration(
      await this.request(`${path}/media-registrations/${id}`, 'GET', options),
      listingId,
      revision,
      id,
    );
  }
  async getMediaJobV2(
    listingId: string,
    revision: number,
    jobId: string,
    options: StaffRequestOptions,
  ): Promise<MediaJobV2> {
    staffOptions(options);
    const path = mediaPath(listingId, revision),
      id = uuid(jobId, 'VALIDATION', 'Job ID');
    return mediaJob(
      await this.request(`${path}/media-jobs/${id}`, 'GET', options),
      listingId,
      revision,
      id,
    );
  }
  /** Retain the original UUID/job/version; explicit replay never adopts a newer version or finalizes media. */
  async createMediaAttachIntentV2(
    listingId: string,
    revision: number,
    input: MediaAttachIntentInputV2,
    options: StaffRequestOptions,
  ): Promise<MediaAttachIntentV2> {
    staffOptions(options);
    const path = mediaPath(listingId, revision) + '/media-attach-intents',
      value = attachRecord(input, ['operationId', 'jobId', 'expectedVersion'], 'VALIDATION');
    const operationId = uuid(value.operationId, 'VALIDATION', 'Operation ID'),
      jobId = uuid(value.jobId, 'VALIDATION', 'Job ID'),
      expectedVersion = expectedStaffVersion(value.expectedVersion, false);
    if (operationId === jobId || expectedVersion > Number.MAX_SAFE_INTEGER - 1)
      return invalid('VALIDATION', 'Unsupported attachment identity or version.');
    const canonical = Object.freeze({
      operationId,
      jobId,
      expectedVersion: String(expectedVersion),
    });
    try {
      return mediaAttachIntent(
        await this.request(path, 'POST', options, { operationId, jobId, expectedVersion }),
        listingId,
        revision,
        operationId,
        canonical,
      );
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async getMediaAttachIntentV2(
    listingId: string,
    revision: number,
    operationId: string,
    options: StaffRequestOptions,
  ): Promise<MediaAttachIntentV2> {
    staffOptions(options);
    const path = mediaPath(listingId, revision),
      id = uuid(operationId, 'VALIDATION', 'Operation ID');
    return mediaAttachIntent(
      await this.request(`${path}/media-attach-intents/${id}`, 'GET', options),
      listingId,
      revision,
      id,
    );
  }
  /** Explicitly finalize the retained original intent once. Uncertain results require status readback. */
  async finalizeMediaAttachIntentV2(
    listingId: string,
    revision: number,
    operationId: string,
    options: StaffRequestOptions,
  ): Promise<MediaAttachIntentV2> {
    const captured = uploadOptions(options),
      path = mediaPath(listingId, revision),
      id = uuid(operationId, 'VALIDATION', 'Operation ID');
    try {
      const value = validateMediaAttachIntentV2(
        await this.request(`${path}/media-attach-intents/${id}/finalize`, 'POST', captured),
        listingId,
        revision,
        id,
      );
      if (value.status === 'ready')
        return invalid('INVALID_RESPONSE', 'Attachment finalization was not confirmed.');
      return value;
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  /** Send once with the original operation/body; reconcile uncertainty through getMediaOperationV2. */
  async removeDraftMediaV2(
    listingId: string,
    revision: number,
    input: MediaRemovalInputV2,
    options: StaffRequestOptions,
  ): Promise<MediaOperationReceiptV2> {
    staffOptions(options);
    const path = mediaPath(listingId, revision) + '/media-removals',
      value = attachRecord(input, ['operationId', 'mediaId', 'expectedVersion'], 'VALIDATION');
    const operationId = uuid(value.operationId, 'VALIDATION', 'Operation ID'),
      mediaId = uuid(value.mediaId, 'VALIDATION', 'Media ID'),
      expectedVersion = expectedStaffVersion(value.expectedVersion, false);
    if (expectedVersion > Number.MAX_SAFE_INTEGER - 1)
      return invalid('VALIDATION', 'Unsupported incrementable photo version.');
    const canonical = Object.freeze({
      kind: 'remove_media' as const,
      mediaId,
      expectedVersion: String(expectedVersion),
      orderedIds: Object.freeze([]),
    });
    try {
      return mediaOperation(
        await this.request(path, 'POST', options, { operationId, mediaId, expectedVersion }),
        listingId,
        revision,
        operationId,
        canonical,
      );
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async reorderDraftMediaV2(
    listingId: string,
    revision: number,
    input: MediaReorderInputV2,
    options: StaffRequestOptions,
  ): Promise<MediaOperationReceiptV2> {
    staffOptions(options);
    const path = mediaPath(listingId, revision) + '/media-reorders',
      value = attachRecord(input, ['operationId', 'orderedIds', 'expectedVersion'], 'VALIDATION');
    const operationId = uuid(value.operationId, 'VALIDATION', 'Operation ID'),
      orderedIds = galleryIds(value.orderedIds, 'VALIDATION'),
      expectedVersion = expectedStaffVersion(value.expectedVersion, false);
    if (expectedVersion > Number.MAX_SAFE_INTEGER - 1)
      return invalid('VALIDATION', 'Unsupported incrementable photo version.');
    const canonical = Object.freeze({
      kind: 'reorder_media' as const,
      mediaId: null,
      expectedVersion: String(expectedVersion),
      orderedIds,
    });
    try {
      return mediaOperation(
        await this.request(path, 'POST', options, { operationId, orderedIds, expectedVersion }),
        listingId,
        revision,
        operationId,
        canonical,
      );
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async getMediaOperationV2(
    listingId: string,
    revision: number,
    operationId: string,
    options: StaffRequestOptions,
  ): Promise<MediaOperationReceiptV2> {
    staffOptions(options);
    const path = mediaPath(listingId, revision),
      id = uuid(operationId, 'VALIDATION', 'Operation ID');
    return mediaOperation(
      await this.request(`${path}/media-operations/${id}`, 'GET', options),
      listingId,
      revision,
      id,
    );
  }
  /** Send one snapshotted binary body. Retain the original job/upload UUIDs and reconcile uncertainty explicitly. */
  async uploadMediaInputV2(
    listingId: string,
    revision: number,
    jobId: string,
    uploadId: string,
    input: Uint8Array,
    options: StaffRequestOptions,
  ): Promise<MediaUploadStatusV2> {
    const captured = uploadOptions(options),
      path = mediaPath(listingId, revision),
      job = uuid(jobId, 'VALIDATION', 'Job ID'),
      upload = uuid(uploadId, 'VALIDATION', 'Upload ID'),
      bytes = uploadBytes(input);
    try {
      return validateMediaUploadStatusV2(
        await this.request(
          `${path}/media-jobs/${job}/uploads/${upload}`,
          'PUT',
          captured,
          undefined,
          undefined,
          bytes,
        ),
        listingId,
        revision,
        job,
        upload,
      );
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  /** Current authorized original-status readback; never resends bytes or restarts processing. */
  async getMediaUploadStatusV2(
    listingId: string,
    revision: number,
    jobId: string,
    uploadId: string,
    options: StaffRequestOptions,
  ): Promise<MediaUploadStatusV2> {
    const captured = uploadOptions(options),
      path = mediaPath(listingId, revision),
      job = uuid(jobId, 'VALIDATION', 'Job ID'),
      upload = uuid(uploadId, 'VALIDATION', 'Upload ID');
    return validateMediaUploadStatusV2(
      await this.request(`${path}/media-jobs/${job}/uploads/${upload}`, 'GET', captured),
      listingId,
      revision,
      job,
      upload,
    );
  }
  /** A bounded current authorized slice; truncated is not a count of all enquiries. */
  async listStaffEnquiriesV2(
    options: StaffRequestOptions & { readonly limit?: number },
  ): Promise<StaffEnquiryPageV2> {
    const captured = enquiryOptions(options, 50),
      data = attachRecord(
        await this.request(`/v2/staff/enquiries?limit=${captured.limit}`, 'GET', captured.options),
        ['items', 'limit', 'truncated'],
        'INVALID_RESPONSE',
      );
    const rows = enquiryArray(data.items, captured.limit);
    if (
      data.limit !== captured.limit ||
      typeof data.truncated !== 'boolean' ||
      (data.truncated && rows.length !== captured.limit)
    )
      return invalid('INVALID_RESPONSE', 'Invalid bounded enquiry page.');
    const items = rows.map(validateStaffEnquirySummaryV2);
    if (new Set(items.map((item) => item.id)).size !== items.length)
      return invalid('INVALID_RESPONSE', 'Repeated enquiry identity.');
    return Object.freeze({
      items: Object.freeze(items),
      limit: captured.limit,
      truncated: data.truncated,
    });
  }
  async listStaffEnquiriesV3(
    input: StaffEnquiryQueueInputV3,
    options: StaffRequestOptions,
  ): Promise<StaffEnquiryQueuePageV3> {
    const selected = validateStaffEnquiryQueueInputV3(input),
      captured = uploadOptions(options);
    const params = new URLSearchParams({ limit: String(selected.limit), filter: selected.filter });
    if (selected.after !== null) params.set('after', selected.after);
    return validateStaffEnquiryQueuePageV3(
      await this.request(`/v3/staff/enquiries?${params}`, 'GET', captured),
      {
        limit: selected.limit,
        filter: selected.filter,
        ...(selected.after === null ? {} : { after: selected.after }),
      },
    );
  }
  /** Current authorized bounded queue only; open and re-read a revision before editing it. */
  async getStaffListingV2(
    listingId: string,
    options: StaffRequestOptions,
  ): Promise<StaffListingSummary> {
    const captured = uploadOptions(options),
      listing = uuid(listingId, 'VALIDATION', 'Listing ID');
    const data = await this.request(`/v2/staff/listings/${listing}`, 'GET', captured);
    try {
      return validateStaffListingSummary(data, listing);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid current listing detail.');
    }
  }
  async captureListingReport(
    input: ListingReportCommand,
    options: Omit<RequestOptions, 'bearerToken'> = {},
  ): Promise<ListingReportReceipt> {
    const captured = anonymousReportOptions(options);
    let command: ListingReportCommand;
    try {
      command = validateListingReportCommand(input);
    } catch {
      return invalid('VALIDATION', 'Invalid listing report.');
    }
    const data = await this.request(
      `/v2/public/listings/${command.listingId}/reports/${command.operationId}`,
      'POST',
      captured,
      { ...command },
    );
    try {
      return validateListingReportReceipt(data, command);
    } catch {
      throw new ApiClientError(
        'INVALID_RESPONSE',
        'Original report acknowledgment could not be verified.',
        { submissionUncertain: true },
      );
    }
  }
  async getListingReportReceipt(
    listingId: string,
    operationId: string,
    options: Omit<RequestOptions, 'bearerToken'> = {},
  ): Promise<ListingReportReceipt> {
    const captured = anonymousReportOptions(options),
      listing = uuid(listingId, 'VALIDATION', 'Listing ID'),
      operation = uuid(operationId, 'VALIDATION', 'Operation ID');
    if (listing !== listingId || operation !== operationId)
      return invalid('VALIDATION', 'Canonical report IDs required.');
    const data = await this.request(
      `/v2/public/listings/${listing}/reports/${operation}`,
      'GET',
      captured,
    );
    try {
      return validateListingReportReceipt(data, { listingId: listing, operationId: operation });
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original report acknowledgment.');
    }
  }
  async listListingReports(
    input: {
      readonly limit?: number;
      readonly before?: string;
      readonly status?: ListingReportQueue['status'];
    },
    options: StaffRequestOptions,
  ): Promise<ListingReportQueue> {
    const captured = uploadOptions(options),
      q = reportQueueInput(input),
      limit = integer(q.limit ?? 50, 1, 50, 'VALIDATION', 'Limit'),
      status = q.status ?? 'new';
    if (typeof status !== 'string' || !['all', 'new', 'reviewed', 'dismissed'].includes(status))
      return invalid('VALIDATION', 'Invalid report queue status.');
    const before = q.before === undefined ? null : uuid(q.before, 'VALIDATION', 'Report cursor');
    if (before !== null && before !== q.before)
      return invalid('VALIDATION', 'Canonical report cursor required.');
    const data = await this.request(
      `/v2/staff/listing-reports?limit=${limit}&status=${status}${before === null ? '' : '&before=' + before}`,
      'GET',
      captured,
    );
    try {
      return validateListingReportQueue(data, {
        limit,
        status: status as ListingReportQueue['status'],
      });
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid report queue.');
    }
  }
  async decideListingReport(
    input: ListingReportDecisionCommand,
    options: StaffRequestOptions,
  ): Promise<ListingReportDecisionReceipt> {
    const captured = uploadOptions(options);
    let command: ListingReportDecisionCommand;
    try {
      command = validateListingReportDecisionCommand(input);
    } catch {
      return invalid('VALIDATION', 'Invalid report review.');
    }
    const data = await this.request(
      `/v2/staff/listing-reports/${command.reportId}/operations/${command.operationId}`,
      'POST',
      captured,
      { ...command },
    );
    try {
      return validateListingReportDecisionReceipt(data, command);
    } catch {
      throw new ApiClientError(
        'INVALID_RESPONSE',
        'Original report review result could not be verified.',
        { submissionUncertain: true },
      );
    }
  }
  async getListingReportDecision(
    reportId: string,
    operationId: string,
    options: StaffRequestOptions,
  ): Promise<ListingReportDecisionReceipt> {
    const captured = uploadOptions(options),
      report = uuid(reportId, 'VALIDATION', 'Report ID'),
      operation = uuid(operationId, 'VALIDATION', 'Operation ID');
    if (report !== reportId || operation !== operationId)
      return invalid('VALIDATION', 'Canonical report IDs required.');
    const data = await this.request(
      `/v2/staff/listing-reports/${report}/operations/${operation}`,
      'GET',
      captured,
    );
    try {
      const value = validateListingReportDecisionReceipt(data);
      if (value.reportId !== report || value.operationId !== operation) throw Error();
      return value;
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original report review.');
    }
  }
  async recordStaffInvitationRequest(
    input: StaffInvitationIntent,
    options: StaffRequestOptions,
  ): Promise<StaffInvitationRequestRecord> {
    const captured = uploadOptions(options);
    let command: StaffInvitationIntent;
    try {
      command = validateStaffInvitationIntent(input);
    } catch {
      return invalid('VALIDATION', 'Invalid invitation intent.');
    }
    const data = await this.request(
      `/v2/staff/invitation-requests/operations/${command.operationId}`,
      'POST',
      captured,
      { ...command },
    );
    try {
      return validateStaffInvitationRequestRecord(data, command);
    } catch {
      throw new ApiClientError(
        'INVALID_RESPONSE',
        'Invitation request result could not be verified.',
        { submissionUncertain: true },
      );
    }
  }
  async getStaffInvitationRequest(
    operationId: string,
    options: StaffRequestOptions,
  ): Promise<StaffInvitationRequestRecord> {
    const captured = uploadOptions(options),
      operation = uuid(operationId, 'VALIDATION', 'Operation ID');
    if (operation !== operationId)
      return invalid('VALIDATION', 'Canonical invitation operation required.');
    const data = await this.request(
      `/v2/staff/invitation-requests/operations/${operation}`,
      'GET',
      captured,
    );
    try {
      const value = validateStaffInvitationRequestRecord(data);
      if (value.operationId !== operation) throw Error();
      return value;
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original invitation request.');
    }
  }
  async getStaffInvitationState(
    invitationId: string,
    options: StaffRequestOptions,
  ): Promise<StaffInvitationState> {
    const captured = uploadOptions(options),
      invitation = uuid(invitationId, 'VALIDATION', 'Invitation ID');
    if (invitation !== invitationId) return invalid('VALIDATION', 'Canonical invitation required.');
    const data = await this.request(`/v2/staff/invitation-requests/${invitation}`, 'GET', captured);
    try {
      return validateStaffInvitationState(data, invitation);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid invitation state.');
    }
  }
  async revokeStaffInvitationRequest(
    input: StaffInvitationRevocationCommand,
    options: StaffRequestOptions,
  ): Promise<StaffInvitationRevocationRecord> {
    const captured = uploadOptions(options);
    let command: StaffInvitationRevocationCommand;
    try {
      command = validateStaffInvitationRevocationCommand(input);
    } catch {
      return invalid('VALIDATION', 'Invalid invitation revocation.');
    }
    const data = await this.request(
      `/v2/staff/invitation-requests/${command.invitationId}/revocations/${command.operationId}`,
      'POST',
      captured,
      { ...command },
    );
    try {
      return validateStaffInvitationRevocationRecord(data, command);
    } catch {
      throw new ApiClientError(
        'INVALID_RESPONSE',
        'Invitation revocation result could not be verified.',
        { submissionUncertain: true },
      );
    }
  }
  async getStaffInvitationRevocation(
    invitationId: string,
    operationId: string,
    options: StaffRequestOptions,
  ): Promise<StaffInvitationRevocationRecord> {
    const captured = uploadOptions(options),
      invitation = uuid(invitationId, 'VALIDATION', 'Invitation ID'),
      operation = uuid(operationId, 'VALIDATION', 'Operation ID');
    if (invitation !== invitationId || operation !== operationId)
      return invalid('VALIDATION', 'Canonical invitation operation required.');
    const data = await this.request(
      `/v2/staff/invitation-requests/${invitation}/revocations/${operation}`,
      'GET',
      captured,
    );
    try {
      const value = validateStaffInvitationRevocationRecord(data);
      if (value.operationId !== operation || value.invitationId !== invitation) throw Error();
      return value;
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original invitation revocation.');
    }
  }
  async getStaffOperationsOverview(options: StaffRequestOptions): Promise<StaffOperationsOverview> {
    const captured = uploadOptions(options);
    const data = await this.request('/v2/staff/operations/overview', 'GET', captured);
    try {
      return validateStaffOperationsOverview(data);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid operations overview.');
    }
  }
  async getStaffViewingCalendar(
    window: ViewingCalendarWindow,
    options: StaffRequestOptions,
  ): Promise<StaffViewingCalendar> {
    const captured = uploadOptions(options);
    let range: ViewingCalendarWindow;
    try {
      range = validateViewingCalendarWindow(window);
    } catch {
      return invalid('VALIDATION', 'Invalid calendar window.');
    }
    const data = await this.request(
      `/v2/staff/viewings/calendar?fromAt=${encodeURIComponent(range.fromAt)}&untilAt=${encodeURIComponent(range.untilAt)}`,
      'GET',
      captured,
    );
    try {
      return validateStaffViewingCalendar(data, range);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid viewing calendar.');
    }
  }
  async listStaffListingsV2(
    options: StaffRequestOptions & { readonly limit?: number },
  ): Promise<StaffListingPage> {
    const captured = enquiryOptions(options, 25);
    if (captured.limit > 50)
      return invalid('VALIDATION', 'Listing limit must be between 1 and 50.');
    const data = await this.request(
      `/v2/staff/listings?limit=${captured.limit}`,
      'GET',
      captured.options,
    );
    try {
      return validateStaffListingPage(data, captured.limit);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid bounded listing queue.');
    }
  }
  async requestViewingV2(
    enquiryId: string,
    input: ViewingRequestCommand,
    options: StaffRequestOptions,
  ): Promise<ViewingReceipt> {
    const captured = uploadOptions(options),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID');
    let command: ViewingRequestCommand;
    try {
      command = validateViewingRequestCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the viewing request.');
    }
    try {
      const data = await this.request(`/v2/staff/enquiries/${id}/viewings`, 'POST', captured, {
        ...command,
        expectedEnquiryVersion: Number(command.expectedEnquiryVersion),
      });
      try {
        return validateViewingReceipt(data, id, { kind: 'request', command });
      } catch {
        return invalid('INVALID_RESPONSE', 'Invalid viewing request receipt.');
      }
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async proposeViewingV2(
    enquiryId: string,
    viewingId: string,
    input: ViewingProposalCommand,
    options: StaffRequestOptions,
  ): Promise<ViewingReceipt> {
    const captured = uploadOptions(options),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID'),
      viewing = uuid(viewingId, 'VALIDATION', 'Viewing ID');
    let command: ViewingProposalCommand;
    try {
      command = validateViewingProposalCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the viewing proposal.');
    }
    try {
      const data = await this.request(
        `/v2/staff/enquiries/${id}/viewings/${viewing}/proposals`,
        'POST',
        captured,
        { ...command, expectedVersion: Number(command.expectedVersion) },
      );
      try {
        return validateViewingReceipt(data, id, { kind: 'propose', viewingId: viewing, command });
      } catch {
        return invalid('INVALID_RESPONSE', 'Invalid viewing proposal receipt.');
      }
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async recordViewingOutcomeV2(
    enquiryId: string,
    viewingId: string,
    kind: ViewingOutcomeKind,
    input: ViewingOutcomeCommand,
    options: StaffRequestOptions,
  ): Promise<ViewingOutcomeReceipt> {
    const captured = uploadOptions(options),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID'),
      viewing = uuid(viewingId, 'VALIDATION', 'Viewing ID');
    let command: ViewingOutcomeCommand;
    try {
      if (kind !== 'complete' && kind !== 'no_show') throw new Error();
      command = validateViewingOutcomeCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the viewing outcome time and reason.');
    }
    try {
      const data = await this.request(
        `/v2/staff/enquiries/${id}/viewings/${viewing}/${kind === 'complete' ? 'completions' : 'no-shows'}`,
        'POST',
        captured,
        { ...command, expectedVersion: Number(command.expectedVersion) },
      );
      try {
        return validateViewingOutcomeReceipt(data, id, viewing, kind, command);
      } catch {
        return invalid('INVALID_RESPONSE', 'Invalid viewing outcome receipt.');
      }
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async getCurrentStaffSessionV2(options: StaffRequestOptions): Promise<{
    readonly policy: 'current-staff-session-v2';
    readonly tenantId: string;
    readonly actorId: string;
  }> {
    const data = await this.request('/v2/staff/session', 'GET', uploadOptions(options));
    const values = record(data, ['policy', 'tenantId', 'actorId'], 'INVALID_RESPONSE');
    if (values.policy !== 'current-staff-session-v2')
      return invalid('INVALID_RESPONSE', 'Invalid current staff context.');
    return Object.freeze({
      policy: 'current-staff-session-v2',
      tenantId: uuid(values.tenantId, 'INVALID_RESPONSE', 'Tenant'),
      actorId: uuid(values.actorId, 'INVALID_RESPONSE', 'Actor'),
    });
  }
  async getSyntheticReferenceSessionV3(options: StaffRequestOptions): Promise<{
    readonly policy: 'synthetic-reference-session-v1';
    readonly tenantId: string;
    readonly actorId: string;
  }> {
    const data = await this.request('/v3/staff/reference-session', 'GET', uploadOptions(options));
    try {
      if (
        !data ||
        typeof data !== 'object' ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(data)) ||
        Reflect.ownKeys(data).length !== 3
      )
        throw Error();
      const values: Record<string, unknown> = {};
      for (const key of ['policy', 'tenantId', 'actorId']) {
        const d = Object.getOwnPropertyDescriptor(data, key);
        if (!d?.enumerable || !Object.hasOwn(d, 'value')) throw Error();
        values[key] = d.value;
      }
      if (values.policy !== 'synthetic-reference-session-v1') throw Error();
      return Object.freeze({
        policy: 'synthetic-reference-session-v1',
        tenantId: uuid(values.tenantId, 'INVALID_RESPONSE', 'Tenant'),
        actorId: uuid(values.actorId, 'INVALID_RESPONSE', 'Actor'),
      });
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid synthetic reference session.');
    }
  }
  async getRevisionProtocolV3(
    listingId: string,
    revision: number,
    options: StaffRequestOptions,
  ): Promise<RevisionProtocol> {
    let target;
    try {
      target = validateRevisionProtocolTarget({ listingId, revision });
    } catch {
      return invalid('VALIDATION', 'Invalid revision protocol target.');
    }
    const captured = uploadOptions(options);
    const data = await this.request(
      `/v3/staff/listings/${target.listingId}/revision-protocol/${target.revision}`,
      'GET',
      captured,
    );
    try {
      return validateRevisionProtocol(data, target);
    } catch {
      return invalid('INVALID_RESPONSE', 'Revision protocol is unavailable.');
    }
  }
  async getSyntheticReferenceCatalogueV3(
    version: string,
    options: StaffRequestOptions,
  ): Promise<ListingReferenceCatalogue> {
    const captured = uploadOptions(options);
    if (
      version !== 'current' &&
      (typeof version !== 'string' ||
        version.length > 16 ||
        !/^[1-9]\d*$/.test(version) ||
        BigInt(version) > 9007199254740991n)
    )
      return invalid('VALIDATION', 'Invalid synthetic catalogue version.');
    const data = await this.request(`/v3/staff/reference-catalogues/${version}`, 'GET', captured);
    try {
      const catalogue = validateListingReferenceCatalogue(data);
      if (version !== 'current' && catalogue.version !== version) throw Error();
      return catalogue;
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid synthetic reference catalogue.');
    }
  }
  async getSyntheticReferenceRevisionV3(
    listingId: string,
    revision: number,
    expectedVersion: string,
    originalCatalogue: ListingReferenceCatalogue,
    options: StaffRequestOptions,
  ): Promise<SyntheticReferenceRevision> {
    return this.referenceRevision(
      'listings',
      listingId,
      revision,
      expectedVersion,
      originalCatalogue,
      options,
    );
  }
  async getSyntheticReferenceReviewV3(
    listingId: string,
    revision: number,
    expectedVersion: string,
    originalCatalogue: ListingReferenceCatalogue,
    options: StaffRequestOptions,
  ): Promise<SyntheticReferenceRevision> {
    return this.referenceRevision(
      'reviews',
      listingId,
      revision,
      expectedVersion,
      originalCatalogue,
      options,
    );
  }
  /** Read a saved revision and its authoritative historical catalogue in one authorized snapshot. */
  async getSyntheticReferenceRevisionContextV3(
    listingId: string,
    revision: number,
    expectedVersion: string,
    options: StaffRequestOptions,
  ): Promise<SyntheticReferenceContext> {
    return this.referenceContext('listings', listingId, revision, expectedVersion, options);
  }
  async getSyntheticReferenceReviewContextV3(
    listingId: string,
    revision: number,
    expectedVersion: string,
    options: StaffRequestOptions,
  ): Promise<SyntheticReferenceContext> {
    return this.referenceContext('reviews', listingId, revision, expectedVersion, options);
  }
  private async referenceContext(
    kind: 'listings' | 'reviews',
    listingId: string,
    revision: number,
    expectedVersion: string,
    options: StaffRequestOptions,
  ): Promise<SyntheticReferenceContext> {
    const captured = uploadOptions(options),
      listing = uuid(listingId, 'VALIDATION', 'Listing ID'),
      number = integer(revision, 1, 2147483647, 'VALIDATION', 'Revision'),
      version = staffVersion(expectedVersion, 'VALIDATION');
    if (listing !== listingId || BigInt(version) > 9007199254740991n)
      return invalid('VALIDATION', 'Use canonical reference identity and version.');
    const data = await this.request(
      `/v3/staff/${kind}/${listing}/reference-revisions/${number}/${version}/context`,
      'GET',
      captured,
    );
    try {
      return validateSyntheticReferenceContext(
        data,
        listing,
        number,
        version,
        kind === 'reviews' ? 'review' : 'revision',
      );
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid synthetic reference context.');
    }
  }
  private async referenceRevision(
    kind: 'listings' | 'reviews',
    listingId: string,
    revision: number,
    expectedVersion: string,
    originalCatalogue: ListingReferenceCatalogue,
    options: StaffRequestOptions,
  ): Promise<SyntheticReferenceRevision> {
    const captured = uploadOptions(options),
      listing = uuid(listingId, 'VALIDATION', 'Listing ID'),
      number = integer(revision, 1, 2147483647, 'VALIDATION', 'Revision'),
      version = staffVersion(expectedVersion, 'VALIDATION');
    if (listing !== listingId || BigInt(version) > 9007199254740991n)
      return invalid('VALIDATION', 'Use canonical reference identity and version.');
    let catalogue: ListingReferenceCatalogue;
    try {
      catalogue = validateListingReferenceCatalogue(originalCatalogue);
    } catch {
      return invalid('VALIDATION', 'Review the original reference catalogue.');
    }
    const data = await this.request(
      `/v3/staff/${kind}/${listing}/reference-revisions/${number}/${version}`,
      'GET',
      captured,
    );
    try {
      const review = validateSyntheticReferenceRevision(data, catalogue, listing, number, version);
      if (kind === 'reviews' && review.state !== 'pending') throw Error();
      return review;
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid synthetic reference revision.');
    }
  }
  async transitionSyntheticReferenceRevisionV3(
    input: SyntheticReferenceTransitionCommand,
    originalCatalogue: ListingReferenceCatalogue,
    expectedActorId: string,
    options: StaffRequestOptions,
  ): Promise<SyntheticReferenceTransitionReceipt> {
    const captured = uploadOptions(options),
      actor = uuid(expectedActorId, 'VALIDATION', 'Expected actor');
    let catalogue: ListingReferenceCatalogue, command: SyntheticReferenceTransitionCommand;
    try {
      catalogue = validateListingReferenceCatalogue(originalCatalogue);
      command = validateSyntheticReferenceTransitionCommand(input, catalogue);
    } catch {
      return invalid('VALIDATION', 'Review the retained original transition and catalogue.');
    }
    try {
      const data = await this.request(
        `/v3/staff/listings/${command.listingId}/reference-transition-operations/${command.operationId}`,
        'POST',
        captured,
        { ...command },
      );
      try {
        return validateSyntheticReferenceTransitionReceipt(data, command, catalogue, actor);
      } catch {
        return invalid('INVALID_RESPONSE', 'Invalid synthetic reference transition receipt.');
      }
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async getSyntheticReferenceTransitionReceiptV3(
    input: SyntheticReferenceTransitionCommand,
    originalCatalogue: ListingReferenceCatalogue,
    expectedActorId: string,
    options: StaffRequestOptions,
  ): Promise<SyntheticReferenceTransitionReceipt> {
    const captured = uploadOptions(options),
      actor = uuid(expectedActorId, 'VALIDATION', 'Expected actor');
    let catalogue: ListingReferenceCatalogue, command: SyntheticReferenceTransitionCommand;
    try {
      catalogue = validateListingReferenceCatalogue(originalCatalogue);
      command = validateSyntheticReferenceTransitionCommand(input, catalogue);
    } catch {
      return invalid('VALIDATION', 'Review the retained original transition and catalogue.');
    }
    const data = await this.request(
      `/v3/staff/listings/${command.listingId}/reference-transition-operations/${command.operationId}`,
      'GET',
      captured,
    );
    try {
      return validateSyntheticReferenceTransitionReceipt(data, command, catalogue, actor);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original reference transition receipt.');
    }
  }
  async saveSyntheticReferenceDraftV3(
    input: SyntheticReferenceDraftCommand,
    originalCatalogue: ListingReferenceCatalogue,
    expectedActorId: string,
    options: StaffRequestOptions,
  ): Promise<SyntheticReferenceDraftReceipt> {
    const captured = uploadOptions(options),
      actor = uuid(expectedActorId, 'VALIDATION', 'Expected actor');
    let catalogue: ListingReferenceCatalogue, command: SyntheticReferenceDraftCommand;
    try {
      catalogue = validateListingReferenceCatalogue(originalCatalogue);
      command = validateSyntheticReferenceDraftCommand(input, catalogue);
      if (new TextEncoder().encode(JSON.stringify(command)).byteLength > 131072) throw Error();
    } catch {
      return invalid('VALIDATION', 'Review the retained synthetic draft and catalogue.');
    }
    try {
      const data = await this.request(
        `/v3/staff/listings/${command.listingId}/reference-draft-operations/${command.operationId}`,
        'POST',
        captured,
        { ...command },
      );
      try {
        return validateSyntheticReferenceDraftReceipt(data, command, catalogue, actor);
      } catch {
        return invalid('INVALID_RESPONSE', 'Invalid synthetic reference draft receipt.');
      }
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async createSyntheticReferenceListingV3(
    input: SyntheticReferenceCreationCommand,
    originalCatalogue: ListingReferenceCatalogue,
    expectedActorId: string,
    options: StaffRequestOptions,
  ): Promise<SyntheticReferenceCreationReceipt> {
    const captured = uploadOptions(options),
      actor = uuid(expectedActorId, 'VALIDATION', 'Expected actor');
    let catalogue: ListingReferenceCatalogue, command: SyntheticReferenceCreationCommand;
    try {
      catalogue = validateListingReferenceCatalogue(originalCatalogue);
      command = validateSyntheticReferenceCreationCommand(input, catalogue);
    } catch {
      return invalid('VALIDATION', 'Review the retained creation command and original catalogue.');
    }
    try {
      const data = await this.request(
        `/v3/staff/listings/${command.listingId}/reference-creation-operations/${command.operationId}`,
        'POST',
        captured,
        { ...command },
      );
      try {
        return validateSyntheticReferenceCreationReceipt(data, command, catalogue, actor);
      } catch {
        return invalid('INVALID_RESPONSE', 'Invalid reference creation receipt.');
      }
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async getSyntheticReferenceCreationReceiptV3(
    input: SyntheticReferenceCreationCommand,
    originalCatalogue: ListingReferenceCatalogue,
    expectedActorId: string,
    options: StaffRequestOptions,
  ): Promise<SyntheticReferenceCreationReceipt> {
    const captured = uploadOptions(options),
      actor = uuid(expectedActorId, 'VALIDATION', 'Expected actor');
    let catalogue: ListingReferenceCatalogue, command: SyntheticReferenceCreationCommand;
    try {
      catalogue = validateListingReferenceCatalogue(originalCatalogue);
      command = validateSyntheticReferenceCreationCommand(input, catalogue);
    } catch {
      return invalid('VALIDATION', 'Review the retained original creation and catalogue.');
    }
    const data = await this.request(
      `/v3/staff/listings/${command.listingId}/reference-creation-operations/${command.operationId}`,
      'GET',
      captured,
    );
    try {
      return validateSyntheticReferenceCreationReceipt(data, command, catalogue, actor);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original reference creation receipt.');
    }
  }
  async startSyntheticReferenceSuccessorV3(
    input: SyntheticReferenceSuccessorCommand,
    originalCatalogue: ListingReferenceCatalogue,
    expectedActorId: string,
    options: StaffRequestOptions,
  ): Promise<SyntheticReferenceSuccessorReceipt> {
    const captured = uploadOptions(options),
      actor = uuid(expectedActorId, 'VALIDATION', 'Expected actor');
    let catalogue: ListingReferenceCatalogue, command: SyntheticReferenceSuccessorCommand;
    try {
      catalogue = validateListingReferenceCatalogue(originalCatalogue);
      command = validateSyntheticReferenceSuccessorCommand(input, catalogue);
    } catch {
      return invalid('VALIDATION', 'Review the retained successor command and original catalogue.');
    }
    try {
      const data = await this.request(
        `/v3/staff/listings/${command.listingId}/reference-successor-operations/${command.operationId}`,
        'POST',
        captured,
        { ...command },
      );
      try {
        return validateSyntheticReferenceSuccessorReceipt(data, command, catalogue, actor);
      } catch {
        return invalid('INVALID_RESPONSE', 'Invalid reference successor receipt.');
      }
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async getSyntheticReferenceSuccessorReceiptV3(
    input: SyntheticReferenceSuccessorCommand,
    originalCatalogue: ListingReferenceCatalogue,
    expectedActorId: string,
    options: StaffRequestOptions,
  ): Promise<SyntheticReferenceSuccessorReceipt> {
    const captured = uploadOptions(options),
      actor = uuid(expectedActorId, 'VALIDATION', 'Expected actor');
    let catalogue: ListingReferenceCatalogue, command: SyntheticReferenceSuccessorCommand;
    try {
      catalogue = validateListingReferenceCatalogue(originalCatalogue);
      command = validateSyntheticReferenceSuccessorCommand(input, catalogue);
    } catch {
      return invalid('VALIDATION', 'Review the retained original successor and catalogue.');
    }
    const data = await this.request(
      `/v3/staff/listings/${command.listingId}/reference-successor-operations/${command.operationId}`,
      'GET',
      captured,
    );
    try {
      return validateSyntheticReferenceSuccessorReceipt(data, command, catalogue, actor);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original reference successor receipt.');
    }
  }
  async getSyntheticReferenceDraftReceiptV3(
    input: SyntheticReferenceDraftCommand,
    originalCatalogue: ListingReferenceCatalogue,
    expectedActorId: string,
    options: StaffRequestOptions,
  ): Promise<SyntheticReferenceDraftReceipt> {
    const captured = uploadOptions(options),
      actor = uuid(expectedActorId, 'VALIDATION', 'Expected actor');
    let catalogue: ListingReferenceCatalogue, command: SyntheticReferenceDraftCommand;
    try {
      catalogue = validateListingReferenceCatalogue(originalCatalogue);
      command = validateSyntheticReferenceDraftCommand(input, catalogue);
    } catch {
      return invalid('VALIDATION', 'Review the retained original draft and catalogue.');
    }
    const data = await this.request(
      `/v3/staff/listings/${command.listingId}/reference-draft-operations/${command.operationId}`,
      'GET',
      captured,
    );
    try {
      return validateSyntheticReferenceDraftReceipt(data, command, catalogue, actor);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original reference draft receipt.');
    }
  }
  async recordSyntheticListingVerificationV2(
    input: ListingVerificationCommand,
    options: StaffRequestOptions,
  ): Promise<ListingVerificationReceipt> {
    const captured = uploadOptions(options);
    let command: ListingVerificationCommand;
    try {
      command = validateListingVerificationCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the original synthetic check facts.');
    }
    try {
      const data = await this.request(
        `/v2/staff/listings/${command.target.listingId}/verification-operations/${command.operationId}`,
        'POST',
        captured,
        { ...command },
      );
      try {
        return validateListingVerificationReceipt(data, command);
      } catch {
        return invalid('INVALID_RESPONSE', 'Invalid private check receipt.');
      }
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async getListingVerificationReceiptV2(
    input: ListingVerificationCommand,
    options: StaffRequestOptions,
  ): Promise<ListingVerificationReceipt> {
    const captured = uploadOptions(options);
    let command: ListingVerificationCommand;
    try {
      command = validateListingVerificationCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the retained original check.');
    }
    const data = await this.request(
      `/v2/staff/listings/${command.target.listingId}/verification-operations/${command.operationId}`,
      'GET',
      captured,
    );
    try {
      return validateListingVerificationReceipt(data, command);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original check receipt.');
    }
  }
  async getListingVerificationOriginalV2(
    listingId: string,
    operationId: string,
    options: StaffRequestOptions,
  ): Promise<ListingVerificationReceipt> {
    const captured = uploadOptions(options),
      listing = uuid(listingId, 'VALIDATION', 'Listing ID'),
      operation = uuid(operationId, 'VALIDATION', 'Operation ID');
    const data = await this.request(
      `/v2/staff/listings/${listing}/verification-operations/${operation}`,
      'GET',
      captured,
    );
    try {
      return validateListingVerificationOriginal(data, listing, operation);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original private check.');
    }
  }
  async getListingVerificationHistoryV2(
    listingId: string,
    pageLimit: number,
    options: StaffRequestOptions,
    beforeVersion: string | null = null,
  ): Promise<ListingVerificationHistory> {
    const captured = uploadOptions(options),
      listing = uuid(listingId, 'VALIDATION', 'Listing ID'),
      limit = integer(pageLimit, 1, 25, 'VALIDATION', 'History limit');
    if (
      beforeVersion !== null &&
      (typeof beforeVersion !== 'string' ||
        !/^[1-9]\d{0,15}$/.test(beforeVersion) ||
        BigInt(beforeVersion) > 9007199254740991n)
    )
      return invalid('VALIDATION', 'Invalid history cursor.');
    const data = await this.request(
      `/v2/staff/listings/${listing}/verification-history?limit=${limit}${beforeVersion === null ? '' : `&beforeVersion=${beforeVersion}`}`,
      'GET',
      captured,
    );
    try {
      return validateListingVerificationHistory(data, listing, limit, beforeVersion);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid private check history.');
    }
  }
  async controlListingV2(
    input: ListingControlCommand,
    options: StaffRequestOptions,
  ): Promise<ListingControlReceipt> {
    const captured = uploadOptions(options);
    let command: ListingControlCommand;
    try {
      command = validateListingControlCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the retained listing control facts.');
    }
    const segment = command.kind === 'confirm_availability' ? 'availability' : 'publication';
    try {
      const data = await this.request(
        `/v2/staff/listings/${command.listingId}/${segment}-operations/${command.operationId}`,
        'POST',
        captured,
        {
          expectedListingVersion: command.expectedListingVersion,
          ...(command.kind === 'confirm_availability'
            ? { availability: command.availability }
            : { publicationStatus: command.publicationStatus }),
        },
      );
      try {
        return validateListingControlReceipt(data, command);
      } catch {
        return invalid('INVALID_RESPONSE', 'Invalid listing control receipt.');
      }
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async getListingControlReceiptV2(
    input: ListingControlCommand,
    options: StaffRequestOptions,
  ): Promise<ListingControlReceipt> {
    const captured = uploadOptions(options);
    let command: ListingControlCommand;
    try {
      command = validateListingControlCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the original listing control facts.');
    }
    const segment = command.kind === 'confirm_availability' ? 'availability' : 'publication';
    const data = await this.request(
      `/v2/staff/listings/${command.listingId}/${segment}-operations/${command.operationId}`,
      'GET',
      captured,
    );
    try {
      return validateListingControlReceipt(data, command);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original listing control receipt.');
    }
  }
  async getListingControlSnapshotV2(
    listingId: string,
    operationId: string,
    kind: ListingControlCommand['kind'],
    options: StaffRequestOptions,
  ): Promise<ListingControlReceipt> {
    const captured = uploadOptions(options),
      listing = uuid(listingId, 'VALIDATION', 'Listing ID'),
      operation = uuid(operationId, 'VALIDATION', 'Operation ID');
    if (kind !== 'confirm_availability' && kind !== 'set_publication')
      return invalid('VALIDATION', 'Review the listing control kind.');
    const segment = kind === 'confirm_availability' ? 'availability' : 'publication';
    const data = await this.request(
      `/v2/staff/listings/${listing}/${segment}-operations/${operation}`,
      'GET',
      captured,
    );
    try {
      return validateListingControlSnapshot(data, listing, operation, kind);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid stored listing control receipt.');
    }
  }
  async startListingRevisionV2(
    input: ListingSuccessorCommand,
    options: StaffRequestOptions,
  ): Promise<ListingSuccessorReceipt> {
    const captured = uploadOptions(options);
    let command: ListingSuccessorCommand;
    try {
      command = validateListingSuccessorCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the retained successor revision facts.');
    }
    try {
      const data = await this.request(
        `/v2/staff/listings/${command.listingId}/revision-operations/${command.operationId}`,
        'POST',
        captured,
        {
          expectedListingVersion: command.expectedListingVersion,
          predecessor: command.predecessor,
          content: command.content,
        },
      );
      try {
        return validateListingSuccessorReceipt(data, command);
      } catch {
        return invalid('INVALID_RESPONSE', 'Invalid successor revision receipt.');
      }
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async getListingSuccessorReceiptV2(
    input: ListingSuccessorCommand,
    options: StaffRequestOptions,
  ): Promise<ListingSuccessorReceipt> {
    const captured = uploadOptions(options);
    let command: ListingSuccessorCommand;
    try {
      command = validateListingSuccessorCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the original successor revision facts.');
    }
    const data = await this.request(
      `/v2/staff/listings/${command.listingId}/revision-operations/${command.operationId}`,
      'GET',
      captured,
    );
    try {
      return validateListingSuccessorReceipt(data, command);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original successor revision receipt.');
    }
  }
  async getListingSuccessorSnapshotV2(
    listingId: string,
    operationId: string,
    options: StaffRequestOptions,
  ): Promise<ListingSuccessorReceipt> {
    const captured = uploadOptions(options),
      listing = uuid(listingId, 'VALIDATION', 'Listing ID'),
      operation = uuid(operationId, 'VALIDATION', 'Operation ID');
    const data = await this.request(
      `/v2/staff/listings/${listing}/revision-operations/${operation}`,
      'GET',
      captured,
    );
    try {
      return validateListingSuccessorSnapshot(data, listing, operation);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid stored successor revision receipt.');
    }
  }
  async createListingV2(
    input: ListingCreationCommand,
    options: StaffRequestOptions,
  ): Promise<ListingCreationReceipt> {
    const captured = uploadOptions(options);
    let command: ListingCreationCommand;
    try {
      command = validateListingCreationCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the retained listing creation facts.');
    }
    try {
      const data = await this.request(
        `/v2/staff/listings/${command.listingId}/creation-operations/${command.operationId}`,
        'POST',
        captured,
        { slug: command.slug, content: command.content },
      );
      try {
        return validateListingCreationReceipt(data, command);
      } catch {
        return invalid('INVALID_RESPONSE', 'Invalid listing creation receipt.');
      }
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async getListingCreationReceiptV2(
    input: ListingCreationCommand,
    options: StaffRequestOptions,
  ): Promise<ListingCreationReceipt> {
    const captured = uploadOptions(options);
    let command: ListingCreationCommand;
    try {
      command = validateListingCreationCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the original listing creation facts.');
    }
    const data = await this.request(
      `/v2/staff/listings/${command.listingId}/creation-operations/${command.operationId}`,
      'GET',
      captured,
    );
    try {
      return validateListingCreationReceipt(data, command);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original listing creation receipt.');
    }
  }
  async getListingCreationSnapshotV2(
    listingId: string,
    operationId: string,
    options: StaffRequestOptions,
  ): Promise<ListingCreationReceipt> {
    const captured = uploadOptions(options),
      listing = uuid(listingId, 'VALIDATION', 'Listing ID'),
      operation = uuid(operationId, 'VALIDATION', 'Operation ID');
    const data = await this.request(
      `/v2/staff/listings/${listing}/creation-operations/${operation}`,
      'GET',
      captured,
    );
    try {
      return validateListingCreationSnapshot(data, listing, operation);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid stored listing creation receipt.');
    }
  }
  async admitViewingReminderV2(
    enquiryId: string,
    viewingId: string,
    input: ViewingReminderAdmissionCommand,
    options: StaffRequestOptions,
  ): Promise<ViewingReminderAdmissionReceipt> {
    const captured = uploadOptions(options),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID'),
      viewing = uuid(viewingId, 'VALIDATION', 'Viewing ID');
    let command: ViewingReminderAdmissionCommand;
    try {
      command = validateViewingReminderAdmissionCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the explicit reminder window.');
    }
    try {
      const data = await this.request(
        `/v2/staff/enquiries/${id}/viewings/${viewing}/reminder-admissions`,
        'POST',
        captured,
        { ...command, expectedVersion: Number(command.expectedVersion) },
      );
      try {
        return validateViewingReminderAdmissionReceipt(data, id, viewing, command);
      } catch {
        return invalid('INVALID_RESPONSE', 'Invalid reminder admission receipt.');
      }
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async getViewingReminderAdmissionReceiptV2(
    enquiryId: string,
    viewingId: string,
    input: ViewingReminderAdmissionCommand,
    options: StaffRequestOptions,
  ): Promise<ViewingReminderAdmissionReceipt> {
    const captured = uploadOptions(options),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID'),
      viewing = uuid(viewingId, 'VALIDATION', 'Viewing ID');
    let command: ViewingReminderAdmissionCommand;
    try {
      command = validateViewingReminderAdmissionCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the original reminder window.');
    }
    const data = await this.request(
      `/v2/staff/enquiries/${id}/viewing-reminder-admissions/${command.operationId}`,
      'GET',
      captured,
    );
    try {
      return validateViewingReminderAdmissionReceipt(data, id, viewing, command);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original reminder admission.');
    }
  }
  async getViewingReminderAdmissionSnapshotV2(
    enquiryId: string,
    admissionOperationId: string,
    options: StaffRequestOptions,
  ): Promise<ViewingReminderAdmissionReceipt> {
    const captured = uploadOptions(options),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID'),
      admission = uuid(admissionOperationId, 'VALIDATION', 'Admission operation ID');
    const data = await this.request(
      `/v2/staff/enquiries/${id}/viewing-reminder-admissions/${admission}`,
      'GET',
      captured,
    );
    try {
      return validateViewingReminderAdmissionSnapshot(data, id, admission);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid stored reminder admission.');
    }
  }
  async captureViewingReminderV2(
    admissionInput: ViewingReminderAdmissionReceipt,
    input: ViewingReminderCaptureCommand,
    options: StaffRequestOptions,
  ): Promise<ViewingReminderCaptureReceipt> {
    const captured = uploadOptions(options);
    let admission: ViewingReminderAdmissionReceipt, command: ViewingReminderCaptureCommand;
    try {
      admission = validateViewingReminderAdmissionSnapshot(admissionInput);
      if (admission.outcome !== 'admitted') throw new Error();
      command = validateViewingReminderCaptureCommand(input);
    } catch {
      return invalid('VALIDATION', 'Select an admitted capture-only reminder.');
    }
    try {
      const data = await this.request(
        `/v2/staff/enquiries/${admission.enquiryId}/viewing-reminder-admissions/${admission.operationId}/captures`,
        'POST',
        captured,
        { ...command },
      );
      try {
        return validateViewingReminderCaptureReceipt(data, admission, command);
      } catch {
        return invalid('INVALID_RESPONSE', 'Invalid synthetic reminder capture receipt.');
      }
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async getViewingReminderCaptureReceiptV2(
    admissionInput: ViewingReminderAdmissionReceipt,
    input: ViewingReminderCaptureCommand,
    options: StaffRequestOptions,
  ): Promise<ViewingReminderCaptureReceipt> {
    const captured = uploadOptions(options);
    let admission: ViewingReminderAdmissionReceipt, command: ViewingReminderCaptureCommand;
    try {
      admission = validateViewingReminderAdmissionSnapshot(admissionInput);
      if (admission.outcome !== 'admitted') throw new Error();
      command = validateViewingReminderCaptureCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the original capture-only reminder.');
    }
    const data = await this.request(
      `/v2/staff/enquiries/${admission.enquiryId}/viewing-reminder-admissions/${admission.operationId}/capture-operations/${command.operationId}`,
      'GET',
      captured,
    );
    try {
      return validateViewingReminderCaptureReceipt(data, admission, command);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original synthetic capture receipt.');
    }
  }
  async getViewingOutcomeReceiptV2(
    enquiryId: string,
    viewingId: string,
    kind: ViewingOutcomeKind,
    input: ViewingOutcomeCommand,
    options: StaffRequestOptions,
  ): Promise<ViewingOutcomeReceipt> {
    const captured = uploadOptions(options),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID'),
      viewing = uuid(viewingId, 'VALIDATION', 'Viewing ID');
    let command: ViewingOutcomeCommand;
    try {
      if (kind !== 'complete' && kind !== 'no_show') throw new Error();
      command = validateViewingOutcomeCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the original viewing outcome.');
    }
    const data = await this.request(
      `/v2/staff/enquiries/${id}/viewing-operations/${command.operationId}`,
      'GET',
      captured,
    );
    try {
      return validateViewingOutcomeReceipt(data, id, viewing, kind, command);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original viewing outcome receipt.');
    }
  }
  async rescheduleViewingV2(
    enquiryId: string,
    viewingId: string,
    input: ViewingRescheduleCommand,
    options: StaffRequestOptions,
  ): Promise<ViewingRescheduleReceipt> {
    const captured = uploadOptions(options),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID'),
      viewing = uuid(viewingId, 'VALIDATION', 'Viewing ID');
    let command: ViewingRescheduleCommand;
    try {
      command = validateViewingRescheduleCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the new viewing time and reason.');
    }
    try {
      const data = await this.request(
        `/v2/staff/enquiries/${id}/viewings/${viewing}/reschedules`,
        'POST',
        captured,
        { ...command, expectedVersion: Number(command.expectedVersion) },
      );
      try {
        return validateViewingRescheduleReceipt(data, id, viewing, command);
      } catch {
        return invalid('INVALID_RESPONSE', 'Invalid viewing reschedule receipt.');
      }
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async getViewingRescheduleReceiptV2(
    enquiryId: string,
    viewingId: string,
    input: ViewingRescheduleCommand,
    options: StaffRequestOptions,
  ): Promise<ViewingRescheduleReceipt> {
    const captured = uploadOptions(options),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID'),
      viewing = uuid(viewingId, 'VALIDATION', 'Viewing ID');
    let command: ViewingRescheduleCommand;
    try {
      command = validateViewingRescheduleCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the original viewing reschedule.');
    }
    const data = await this.request(
      `/v2/staff/enquiries/${id}/viewing-operations/${command.operationId}`,
      'GET',
      captured,
    );
    try {
      return validateViewingRescheduleReceipt(data, id, viewing, command);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original viewing reschedule receipt.');
    }
  }
  async terminateViewingV2(
    enquiryId: string,
    viewingId: string,
    kind: ViewingTerminationKind,
    input: ViewingTerminationCommand,
    options: StaffRequestOptions,
  ): Promise<ViewingTerminationReceipt> {
    const captured = uploadOptions(options),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID'),
      viewing = uuid(viewingId, 'VALIDATION', 'Viewing ID');
    let command: ViewingTerminationCommand;
    try {
      if (kind !== 'cancel' && kind !== 'decline') throw new Error();
      command = validateViewingTerminationCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the viewing ending reason.');
    }
    try {
      const data = await this.request(
        `/v2/staff/enquiries/${id}/viewings/${viewing}/${kind === 'cancel' ? 'cancellations' : 'declines'}`,
        'POST',
        captured,
        { ...command, expectedVersion: Number(command.expectedVersion) },
      );
      try {
        return validateViewingTerminationReceipt(data, id, viewing, kind, command);
      } catch {
        return invalid('INVALID_RESPONSE', 'Invalid viewing terminal receipt.');
      }
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async getViewingTerminationReceiptV2(
    enquiryId: string,
    viewingId: string,
    kind: ViewingTerminationKind,
    input: ViewingTerminationCommand,
    options: StaffRequestOptions,
  ): Promise<ViewingTerminationReceipt> {
    const captured = uploadOptions(options),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID'),
      viewing = uuid(viewingId, 'VALIDATION', 'Viewing ID');
    let command: ViewingTerminationCommand;
    try {
      if (kind !== 'cancel' && kind !== 'decline') throw new Error();
      command = validateViewingTerminationCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the original viewing ending reason.');
    }
    const data = await this.request(
      `/v2/staff/enquiries/${id}/viewing-operations/${command.operationId}`,
      'GET',
      captured,
    );
    try {
      return validateViewingTerminationReceipt(data, id, viewing, kind, command);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original viewing terminal receipt.');
    }
  }
  async confirmViewingV2(
    enquiryId: string,
    viewingId: string,
    input: ViewingConfirmationCommand,
    options: StaffRequestOptions,
  ): Promise<ViewingConfirmationReceipt> {
    const captured = uploadOptions(options),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID'),
      viewing = uuid(viewingId, 'VALIDATION', 'Viewing ID');
    let command: ViewingConfirmationCommand;
    try {
      command = validateViewingConfirmationCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the viewing phone agreement.');
    }
    try {
      const data = await this.request(
        `/v2/staff/enquiries/${id}/viewings/${viewing}/confirmations`,
        'POST',
        captured,
        { ...command, expectedVersion: Number(command.expectedVersion) },
      );
      try {
        return validateViewingConfirmationReceipt(data, id, viewing, command);
      } catch {
        return invalid('INVALID_RESPONSE', 'Invalid viewing confirmation receipt.');
      }
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async getViewingConfirmationReceiptV2(
    enquiryId: string,
    viewingId: string,
    input: ViewingConfirmationCommand,
    options: StaffRequestOptions,
  ): Promise<ViewingConfirmationReceipt> {
    const captured = uploadOptions(options),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID'),
      viewing = uuid(viewingId, 'VALIDATION', 'Viewing ID');
    let command: ViewingConfirmationCommand;
    try {
      command = validateViewingConfirmationCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the original viewing phone agreement.');
    }
    const data = await this.request(
      `/v2/staff/enquiries/${id}/viewing-operations/${command.operationId}`,
      'GET',
      captured,
    );
    try {
      return validateViewingConfirmationReceipt(data, id, viewing, command);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original viewing confirmation receipt.');
    }
  }
  async getViewingReceiptV2(
    enquiryId: string,
    input: ViewingOriginal,
    options: StaffRequestOptions,
  ): Promise<ViewingReceipt> {
    const captured = uploadOptions(options),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID');
    let original: ViewingOriginal;
    try {
      original = validateViewingOriginal(input);
    } catch {
      return invalid('VALIDATION', 'Review the original viewing command.');
    }
    const data = await this.request(
      `/v2/staff/enquiries/${id}/viewing-operations/${original.command.operationId}`,
      'GET',
      captured,
    );
    try {
      return validateViewingReceipt(data, id, original);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original viewing receipt.');
    }
  }
  async getViewingHistoryV2(
    enquiryId: string,
    viewingId: string,
    options: StaffRequestOptions & { readonly limit?: number },
  ): Promise<ViewingHistoryPage> {
    const captured = enquiryOptions(options, 25),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID'),
      viewing = uuid(viewingId, 'VALIDATION', 'Viewing ID');
    if (captured.limit > 25)
      return invalid('VALIDATION', 'Viewing history limit cannot exceed 25.');
    const data = await this.request(
      `/v2/staff/enquiries/${id}/viewings/${viewing}/history?limit=${captured.limit}`,
      'GET',
      captured.options,
    );
    try {
      return validateViewingHistoryPage(data, id, viewing, captured.limit);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid private viewing history.');
    }
  }
  async getViewingV2(
    enquiryId: string,
    viewingId: string,
    options: StaffRequestOptions,
  ): Promise<ViewingDetail> {
    const captured = uploadOptions(options),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID'),
      viewing = uuid(viewingId, 'VALIDATION', 'Viewing ID');
    const data = await this.request(
      `/v2/staff/enquiries/${id}/viewings/${viewing}`,
      'GET',
      captured,
    );
    try {
      return validateViewingDetail(data, id, viewing);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid private viewing detail.');
    }
  }
  async listViewingsV2(
    enquiryId: string,
    options: StaffRequestOptions & { readonly limit?: number },
  ): Promise<ViewingPage> {
    const captured = enquiryOptions(options, 25),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID');
    if (captured.limit > 25) return invalid('VALIDATION', 'Viewing limit cannot exceed 25.');
    const data = await this.request(
      `/v2/staff/enquiries/${id}/viewings?limit=${captured.limit}`,
      'GET',
      captured.options,
    );
    try {
      return validateViewingPage(data, id, captured.limit);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid private viewing feed.');
    }
  }
  async recordContactV2(
    enquiryId: string,
    input: ContactCommand,
    options: StaffRequestOptions,
  ): Promise<ContactReceipt> {
    const captured = uploadOptions(options),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID');
    let command: ContactCommand;
    try {
      command = validateContactCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the contact entry.');
    }
    try {
      const data = await this.request(`/v2/staff/enquiries/${id}/contacts`, 'POST', captured, {
        ...command,
        expectedVersion: Number(command.expectedVersion),
      });
      try {
        return validateContactReceipt(data, id, command.operationId, command);
      } catch {
        return invalid('INVALID_RESPONSE', 'Invalid contact receipt.');
      }
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  async getContactReceiptV2(
    enquiryId: string,
    input: ContactCommand,
    options: StaffRequestOptions,
  ): Promise<ContactReceipt> {
    const captured = uploadOptions(options),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID');
    let command: ContactCommand;
    try {
      command = validateContactCommand(input);
    } catch {
      return invalid('VALIDATION', 'Review the original contact entry.');
    }
    const data = await this.request(
      `/v2/staff/enquiries/${id}/contacts/operations/${command.operationId}`,
      'GET',
      captured,
    );
    try {
      return validateContactReceipt(data, id, command.operationId, command);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid original contact receipt.');
    }
  }
  async listContactsV2(
    enquiryId: string,
    options: StaffRequestOptions & { readonly limit?: number },
  ): Promise<ContactPage> {
    const captured = enquiryOptions(options, 50),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID'),
      data = await this.request(
        `/v2/staff/enquiries/${id}/contacts?limit=${captured.limit}`,
        'GET',
        captured.options,
      );
    try {
      return validateContactPage(data, captured.limit);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid contact feed.');
    }
  }
  async listEnquiryActivityV2(
    enquiryId: string,
    options: StaffRequestOptions & { readonly limit?: number },
  ): Promise<EnquiryActivityPage> {
    const { options: captured, limit } = enquiryOptions(options, 50),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID');
    const data = await this.request(
      `/v2/staff/enquiries/${id}/activity?limit=${limit}`,
      'GET',
      captured,
    );
    try {
      return validateEnquiryActivityPage(data, limit);
    } catch {
      return invalid('INVALID_RESPONSE', 'Invalid enquiry activity.');
    }
  }
  async getStaffEnquiryV2(
    enquiryId: string,
    options: StaffRequestOptions,
  ): Promise<StaffEnquiryDetailV2> {
    const captured = uploadOptions(options),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID');
    return validateStaffEnquiryDetailV2(
      await this.request(`/v2/staff/enquiries/${id}`, 'GET', captured),
      id,
    );
  }
  /** The authorized role picker exposes only active staff IDs and roles. */
  async listEnquiryAssigneesV2(
    options: StaffRequestOptions & { readonly limit?: number },
  ): Promise<EnquiryAssigneePageV2> {
    const captured = enquiryOptions(options, 100),
      data = attachRecord(
        await this.request(
          `/v2/staff/enquiry-assignees?limit=${captured.limit}`,
          'GET',
          captured.options,
        ),
        ['items', 'limit', 'truncated'],
        'INVALID_RESPONSE',
      );
    const rows = enquiryArray(data.items, captured.limit);
    if (
      data.limit !== captured.limit ||
      typeof data.truncated !== 'boolean' ||
      (data.truncated && rows.length !== captured.limit)
    )
      return invalid('INVALID_RESPONSE', 'Invalid bounded assignee page.');
    const items = rows.map((input) => {
      const value = attachRecord(input, ['userId', 'role'], 'INVALID_RESPONSE');
      if (value.role !== 'agent' && value.role !== 'admin')
        return invalid('INVALID_RESPONSE', 'Invalid enquiry assignee role.');
      return Object.freeze({
        userId: uuid(value.userId, 'INVALID_RESPONSE', 'Staff ID'),
        role: value.role,
      });
    });
    if (new Set(items.map((item) => item.userId)).size !== items.length)
      return invalid('INVALID_RESPONSE', 'Repeated enquiry assignee identity.');
    return Object.freeze({
      items: Object.freeze(items),
      limit: captured.limit,
      truncated: data.truncated,
    });
  }
  /** Send the retained original command once; uncertainty is reconciled with a read, never an automatic retry. */
  async applyEnquiryOperationV2(
    enquiryId: string,
    input: EnquiryOperationInputV2,
    options: StaffRequestOptions,
  ): Promise<EnquiryOperationReceiptV2> {
    const captured = uploadOptions(options),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID'),
      command = enquiryCommand(input, 'VALIDATION');
    try {
      return enquiryOperation(
        await this.request(`/v2/staff/enquiries/${id}/operations`, 'POST', captured, {
          ...command,
          expectedVersion: Number(command.expectedVersion),
        }),
        id,
        command.operationId,
        command,
      );
    } catch (error) {
      return uncertainWriteError(error);
    }
  }
  /** Historical original-operation proof only; no current enquiry version is adopted. */
  async getEnquiryOperationV2(
    enquiryId: string,
    operationId: string,
    options: StaffRequestOptions,
  ): Promise<EnquiryOperationReceiptV2> {
    const captured = uploadOptions(options),
      id = uuid(enquiryId, 'VALIDATION', 'Enquiry ID'),
      operation = uuid(operationId, 'VALIDATION', 'Operation ID');
    return enquiryOperation(
      await this.request(`/v2/staff/enquiries/${id}/operations/${operation}`, 'GET', captured),
      id,
      operation,
    );
  }
  async captureStaffEnquiryV2(
    input: StaffEnquiryInput,
    options: StaffRequestOptions & { readonly idempotencyKey: string },
  ): Promise<EnquiryReceipt> {
    record(
      input,
      ['listingId', 'name', 'phone', 'email', 'message', 'noticeVersion', 'noticeAcknowledged'],
      'VALIDATION',
    );
    staffOptions(options, ['idempotencyKey']);
    const key = uuid(options.idempotencyKey, 'VALIDATION', 'Idempotency key');
    const { origin: ignored, ...body } = enquiryBody(
      { ...input, origin: 'web' },
      this.currentNotice,
    );
    try {
      const data = record(
        await this.request('/v2/staff/enquiry-captures', 'POST', options, body, key),
        ['id'],
        'INVALID_RESPONSE',
      );
      return Object.freeze({ id: uuid(data.id, 'INVALID_RESPONSE', 'Receipt ID') });
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.kind === 'INVALID_RESPONSE' &&
        !error.submissionUncertain
      )
        throw new ApiClientError(error.kind, error.message, {
          status: error.status,
          submissionUncertain: true,
        });
      throw error;
    }
  }
  prepareStaffEnquiryV2(
    input: StaffEnquiryInput,
    idempotencyKey: string,
    identity: Readonly<{ bearerToken: string }>,
  ): StaffEnquiryAttempt {
    record(identity, ['bearerToken'], 'VALIDATION');
    staffOptions(identity);
    const bearerToken = identity.bearerToken;
    record(
      input,
      ['listingId', 'name', 'phone', 'email', 'message', 'noticeVersion', 'noticeAcknowledged'],
      'VALIDATION',
    );
    const captured = Object.freeze({ ...input });
    enquiryBody({ ...captured, origin: 'web' }, this.currentNotice);
    const key = uuid(idempotencyKey, 'VALIDATION', 'Idempotency key');
    let state: PublicEnquiryAttempt['state'] = Object.freeze({ status: 'ready', receipt: null });
    const run = async (
      replay: boolean,
      options: Readonly<{ signal?: AbortSignal; timeoutMs?: number }> = {},
    ) => {
      record(options, ['signal', 'timeoutMs'], 'VALIDATION');
      requestOptions(options, []);
      if (state.status !== (replay ? 'uncertain' : 'ready'))
        throw new ApiClientError(
          'VALIDATION',
          'This enquiry attempt cannot be sent in its current state.',
        );
      const wasUncertain = state.status === 'uncertain';
      state = Object.freeze({ status: 'sending', receipt: null });
      try {
        const receipt = await this.captureStaffEnquiryV2(captured, {
          bearerToken,
          idempotencyKey: key,
          signal: options.signal,
          timeoutMs: options.timeoutMs,
        });
        state = Object.freeze({ status: 'received', receipt });
        return receipt;
      } catch (error) {
        const uncertain =
          wasUncertain || !(error instanceof ApiClientError) || error.submissionUncertain;
        state = Object.freeze({ status: uncertain ? 'uncertain' : 'rejected', receipt: null });
        throw error;
      }
    };
    return Object.freeze({
      input: captured,
      idempotencyKey: key,
      get state() {
        return state;
      },
      submit: (options?: Readonly<{ signal?: AbortSignal; timeoutMs?: number }>) =>
        run(false, options),
      retryOriginal: (options?: Readonly<{ signal?: AbortSignal; timeoutMs?: number }>) =>
        run(true, options),
    });
  }
  preparePublicEnquiry(input: EnquiryInput, idempotencyKey: string): PublicEnquiryAttempt {
    // Validate and copy before any network work; raw spelling/spacing stays available to the form.
    record(
      input,
      [
        'listingId',
        'name',
        'phone',
        'email',
        'message',
        'origin',
        'noticeVersion',
        'noticeAcknowledged',
      ],
      'VALIDATION',
    );
    const captured = Object.freeze({ ...input });
    enquiryBody(captured, this.currentNotice);
    const key = uuid(idempotencyKey, 'VALIDATION', 'Idempotency key');
    let state: PublicEnquiryAttempt['state'] = Object.freeze({ status: 'ready', receipt: null });
    const run = async (
      replay: boolean,
      options: Readonly<{ signal?: AbortSignal; timeoutMs?: number }> = {},
    ) => {
      record(options, ['signal', 'timeoutMs'], 'VALIDATION');
      requestOptions(options, []);
      if (state.status !== (replay ? 'uncertain' : 'ready'))
        throw new ApiClientError(
          'VALIDATION',
          'This enquiry attempt cannot be sent in its current state.',
        );
      const wasUncertain = state.status === 'uncertain',
        request = { signal: options.signal, timeoutMs: options.timeoutMs, idempotencyKey: key };
      state = Object.freeze({ status: 'sending', receipt: null });
      try {
        const receipt = await this.submitEnquiry(captured, request);
        state = Object.freeze({ status: 'received', receipt });
        return receipt;
      } catch (error) {
        // A later denial/validation error cannot disprove an earlier uncertain commit.
        const uncertain =
          wasUncertain || !(error instanceof ApiClientError) || error.submissionUncertain;
        state = Object.freeze({ status: uncertain ? 'uncertain' : 'rejected', receipt: null });
        throw error;
      }
    };
    return Object.freeze({
      input: captured,
      idempotencyKey: key,
      get state() {
        return state;
      },
      submit: (options?: Readonly<{ signal?: AbortSignal; timeoutMs?: number }>) =>
        run(false, options),
      retryOriginal: (options?: Readonly<{ signal?: AbortSignal; timeoutMs?: number }>) =>
        run(true, options),
    });
  }
  async submitEnquiry(
    input: EnquiryInput,
    options: EnquiryRequestOptions,
  ): Promise<EnquiryReceipt> {
    requestOptions(options, ['idempotencyKey']);
    const key = uuid(options.idempotencyKey, 'VALIDATION', 'Idempotency key');
    const body = enquiryBody(input, this.currentNotice);
    try {
      const data = record(
        await this.request('/v1/enquiries', 'POST', options, body, key),
        ['id'],
        'INVALID_RESPONSE',
      );
      return Object.freeze({ id: uuid(data.id, 'INVALID_RESPONSE', 'Receipt ID') });
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.kind === 'INVALID_RESPONSE' &&
        !error.submissionUncertain
      )
        throw new ApiClientError(error.kind, error.message, {
          status: error.status,
          submissionUncertain: true,
        });
      throw error;
    }
  }
  private async previewRequest(
    path: string,
    version: string,
    options: StaffRequestOptions,
  ): Promise<Uint8Array<ArrayBuffer>> {
    if (options.signal?.aborted) throw new ApiClientError('CANCELLED', 'Request was cancelled.');
    const controller = new AbortController(),
      duration = options.timeoutMs ?? this.defaultTimeout;
    const now = () => globalThis.performance?.now() ?? Date.now(),
      started = now();
    let interruption: 'CANCELLED' | 'TIMEOUT' | undefined,
      response: Response | undefined,
      reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let rejectInterruption: (reason: ApiClientError) => void = () => {};
    const interrupted = new Promise<never>((_, reject) => {
      rejectInterruption = reject;
    });
    const cancelBody = () => {
      try {
        const pending = reader ? reader.cancel() : response?.body?.cancel();
        if (pending) void pending.catch(() => undefined);
      } catch {
        /* Cancellation must not delay or replace the safe result. */
      }
    };
    const stopped = () =>
      new ApiClientError(
        interruption ?? 'CANCELLED',
        interruption === 'TIMEOUT' ? 'Request timed out.' : 'Request was cancelled.',
      );
    const stop = (kind: 'CANCELLED' | 'TIMEOUT') => {
      if (interruption) return;
      interruption = kind;
      controller.abort();
      cancelBody();
      try {
        reader?.releaseLock();
      } catch {
        /* Cancellation still settles independently of transport cleanup. */
      }
      rejectInterruption(stopped());
    };
    const check = () => {
      if (options.signal?.aborted) stop('CANCELLED');
      if (!interruption && now() - started >= duration) stop('TIMEOUT');
      if (interruption) throw stopped();
    };
    const timer = setTimeout(() => stop('TIMEOUT'), duration),
      cancel = () => stop('CANCELLED');
    options.signal?.addEventListener('abort', cancel, { once: true });
    const collect = async (cap: number, exact?: number): Promise<Uint8Array<ArrayBuffer>> => {
      check();
      if (!response?.body || typeof response.body.getReader !== 'function')
        return invalid(
          'INVALID_RESPONSE',
          'A bounded readable private image response is required.',
        );
      reader = response.body.getReader();
      const data = new Uint8Array(exact ?? cap);
      let used = 0;
      while (true) {
        check();
        let part: ReadableStreamReadResult<Uint8Array>;
        try {
          part = await reader.read();
        } catch {
          check();
          throw new ApiClientError('NETWORK', 'Private image response could not be read.');
        }
        check();
        if (!part || typeof part.done !== 'boolean')
          return invalid('INVALID_RESPONSE', 'Malformed private image response stream.');
        if (part.done) break;
        used = appendPreviewBytes(data, used, part.value);
      }
      if (exact !== undefined && used !== exact)
        return invalid(
          'INVALID_RESPONSE',
          'Private image response length did not match its declaration.',
        );
      return used === data.byteLength ? data : data.slice(0, used);
    };
    try {
      const operation = (async () => {
        try {
          check();
          const url = this.apiOrigin + path;
          try {
            response = await this.transport(url, {
              method: 'GET',
              headers: {
                Accept: 'image/webp',
                Authorization: `Bearer ${options.bearerToken}`,
                'X-Revision-Version': version,
              },
              credentials: 'omit',
              redirect: 'error',
              cache: 'no-store',
              signal: controller.signal,
            });
          } catch {
            check();
            throw new ApiClientError('NETWORK', 'Private image API could not be reached.');
          }
          check();
          if (
            response.redirected ||
            (response.status >= 300 && response.status < 400) ||
            (response.url && new URL(response.url).href !== new URL(url).href)
          )
            throw new ApiClientError('REDIRECT', 'API redirects are not permitted.');
          if (response.headers.has('content-encoding') || response.headers.has('content-range'))
            return invalid(
              'INVALID_RESPONSE',
              'Unsupported private image response encoding or range.',
            );
          if (response.ok) {
            if (response.status !== 200 || response.headers.get('content-type') !== 'image/webp')
              return invalid('INVALID_RESPONSE', 'Expected a private WebP image response.');
            const length = previewLength(
                response.headers.get('content-length'),
                20,
                MAX_PREVIEW_BYTES,
              ),
              data = await collect(MAX_PREVIEW_BYTES, length);
            check();
            previewContainer(data);
            return data;
          }
          if (
            !/^application\/json(?:\s*;[^\r\n]*)?$/i.test(
              response.headers.get('content-type') ?? '',
            )
          )
            return invalid('INVALID_RESPONSE', 'Expected a safe private image error response.');
          const length = response.headers.get('content-length');
          if (length !== null) previewLength(length, 1, 4096);
          const data = await collect(4096, length === null ? undefined : Number(length));
          let payload: unknown;
          try {
            const raw = new TextDecoder('utf-8', { fatal: true }).decode(data);
            assertMediaJsonTokens(raw);
            payload = JSON.parse(raw);
          } catch {
            return invalid('INVALID_RESPONSE', 'Malformed private image error JSON.');
          }
          const envelope = attachRecord(payload, ['error', 'requestId'], 'INVALID_RESPONSE'),
            serverError = attachRecord(envelope.error, ['code', 'message'], 'INVALID_RESPONSE');
          const code = serverError.code,
            requestId = uuid(envelope.requestId, 'INVALID_RESPONSE', 'Request ID'),
            headerId = uuid(response.headers.get('x-request-id'), 'INVALID_RESPONSE', 'Request ID');
          if (
            typeof code !== 'string' ||
            PREVIEW_SERVER_STATUS.get(code) !== response.status ||
            typeof serverError.message !== 'string' ||
            serverError.message.length < 1 ||
            serverError.message.length > 1024 ||
            requestId !== headerId
          )
            return invalid('INVALID_RESPONSE', 'Malformed private image error.');
          throw new ApiClientError('HTTP', 'Private image preview is unavailable.', {
            status: response.status,
            serverCode: code,
            requestId,
          });
        } finally {
          cancelBody();
          try {
            reader?.releaseLock();
          } catch {
            /* A cancelled transport may still hold a pending read. */
          }
        }
      })();
      return await Promise.race([operation, interrupted]);
    } catch (error) {
      if (interruption) throw stopped();
      if (error instanceof ApiClientError) throw error;
      throw new ApiClientError('NETWORK', 'Private image API could not be reached.');
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
    }
  }
  private async request(
    path: string,
    method: 'GET' | 'POST' | 'PUT',
    options: RequestOptions,
    body?: Record<string, unknown>,
    key?: string,
    binary?: Uint8Array<ArrayBuffer>,
    revisionVersion?: string,
  ): Promise<unknown> {
    const anonymousReport = /^\/v2\/public\/listings\/[0-9a-f-]{36}\/reports\/[0-9a-f-]{36}$/.test(
      path,
    );
    const invitationCapture = /^\/v2\/staff\/invitation-requests\/operations\/[0-9a-f-]{36}$/.test(
      path,
    );
    const staffInvitation =
      invitationCapture ||
      /^\/v2\/staff\/invitation-requests\/[0-9a-f-]{36}(?:\/revocations\/[0-9a-f-]{36})?$/.test(
        path,
      );
    const reportQueue = /^\/v2\/staff\/listing-reports\?/.test(path);
    const listingReport =
      staffInvitation ||
      anonymousReport ||
      reportQueue ||
      /^\/v2\/staff\/listing-reports\/[0-9a-f-]{36}\/operations\/[0-9a-f-]{36}$/.test(path);
    const importPreview = path === '/v2/staff/listing-import-preview' && method === 'POST';
    const publicReference = /^\/v3\/properties\?limit=(?:[1-9]\d?|100)$/.test(path);
    const publicSearch = /^\/v[23]\/properties\/search\?/.test(path);
    const enquiryQueue =
      /^\/v3\/staff\/enquiries\?limit=(?:[1-9]\d?|100)&filter=(?:all|open|overdue|today)(?:&after=[0-9a-f-]{36})?$/.test(
        path,
      );
    const publicReferenceOptions = path === '/v3/property-reference-options';
    const referenceCatalogue =
      /^\/v3\/staff\/reference-catalogues\/(?:current|[1-9]\d{0,15})$/.test(path);
    const referenceDraft =
      /^\/v3\/staff\/listings\/[0-9a-f-]+\/reference-draft-operations\/[0-9a-f-]+$/.test(path);
    const referenceCreation =
      /^\/v3\/staff\/listings\/[0-9a-f-]+\/reference-creation-operations\/[0-9a-f-]+$/.test(path);
    const referenceSuccessor =
      /^\/v3\/staff\/listings\/[0-9a-f-]+\/reference-successor-operations\/[0-9a-f-]+$/.test(path);
    const referenceContext =
      /^\/v3\/staff\/(?:listings|reviews)\/[0-9a-f-]+\/reference-revisions\/[1-9]\d{0,9}\/[1-9]\d{0,15}\/context$/.test(
        path,
      );
    const referenceModeration =
      referenceContext ||
      /^\/v3\/staff\/listings\/[0-9a-f-]+\/reference-transition-operations\/[0-9a-f-]+$/.test(
        path,
      ) ||
      /^\/v3\/staff\/(?:listings|reviews)\/[0-9a-f-]+\/reference-revisions\/[1-9]\d{0,9}\/[1-9]\d{0,15}$/.test(
        path,
      );
    const staffSession = path === '/v2/staff/session';
    const revisionProtocol =
      /^\/v3\/staff\/listings\/[0-9a-f-]{36}\/revision-protocol\/[1-9]\d{0,9}$/.test(path);
    const reference =
      staffSession ||
      revisionProtocol ||
      publicReference ||
      publicSearch ||
      publicReferenceOptions ||
      referenceCatalogue ||
      referenceDraft ||
      referenceCreation ||
      referenceSuccessor ||
      referenceModeration ||
      path === '/v3/staff/reference-session';
    const verification =
      /^\/v2\/staff\/listings\/[0-9a-f-]+\/verification-(?:operations\/[0-9a-f-]+|history\?limit=[1-9]\d?(?:&beforeVersion=[1-9]\d{0,15})?)$/.test(
        path,
      );
    const strictRead = reference || enquiryQueue || listingReport;
    const boundedRead =
      listingReport ||
      enquiryQueue ||
      publicSearch ||
      importPreview ||
      (method === 'GET' &&
        /^\/v2\/staff\/listings\/[0-9a-f-]+\/duplicate-candidates\?/.test(path)) ||
      verification ||
      reference;
    const writes = method !== 'GET' && !importPreview;
    const upload = UPLOAD_PATH.test(path),
      finalization = FINALIZE_PATH.test(path),
      enquiry = STAFF_ENQUIRY_PATH.test(path) || enquiryQueue,
      listingQueue = /^\/v2\/staff\/listings\?limit=[1-9]\d?$/.test(path);
    const expectedStatus =
      (anonymousReport || invitationCapture) && method === 'POST'
        ? 202
        : (path === '/v1/enquiries' || path === '/v2/staff/enquiry-captures') && method === 'POST'
          ? 201
          : 200;
    if (options.signal?.aborted) throw new ApiClientError('CANCELLED', 'Request was cancelled.');
    const controller = new AbortController();
    let interruption: 'CANCELLED' | 'TIMEOUT' | undefined;
    let started = false;
    let rejectInterruption: (reason: ApiClientError) => void = () => {};
    const interrupted = new Promise<never>((_, reject) => {
      rejectInterruption = reject;
    });
    const stop = (kind: 'CANCELLED' | 'TIMEOUT') => {
      interruption = kind;
      controller.abort();
      rejectInterruption(
        new ApiClientError(
          kind,
          kind === 'TIMEOUT' ? 'Request timed out.' : 'Request was cancelled.',
          { submissionUncertain: writes && started },
        ),
      );
    };
    const timer = setTimeout(() => stop('TIMEOUT'), options.timeoutMs ?? this.defaultTimeout);
    const cancel = () => stop('CANCELLED');
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      const operation = (async () => {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (revisionVersion !== undefined) headers['X-Revision-Version'] = revisionVersion;
        if (options.bearerToken) headers.Authorization = `Bearer ${options.bearerToken}`;
        if (body) {
          headers['Content-Type'] = 'application/json';
          if (key !== undefined) headers['Idempotency-Key'] = key;
        }
        if (binary) headers['Content-Type'] = 'application/octet-stream';
        const url = this.apiOrigin + path;
        started = true;
        const result = await this.transport(url, {
          method,
          headers,
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          signal: controller.signal,
          ...(binary ? { body: binary } : body ? { body: JSON.stringify(body) } : {}),
        });
        if (boundedRead && controller.signal.aborted) {
          if (strictRead) void result.body?.cancel().catch(() => {});
          else await result.body?.cancel();
          throw new ApiClientError(
            interruption ?? 'CANCELLED',
            'Import preview request was interrupted.',
          );
        }
        if (
          result.redirected ||
          (result.status >= 300 && result.status < 400) ||
          (result.url && new URL(result.url).href !== new URL(url).href)
        ) {
          if (boundedRead) {
            if (strictRead) void result.body?.cancel().catch(() => {});
            else await result.body?.cancel();
          }
          throw new ApiClientError('REDIRECT', 'API redirects are not permitted.', {
            submissionUncertain: writes,
          });
        }
        if (
          !/^application\/json(?:\s*;[^\r\n]*)?$/i.test(result.headers.get('content-type') ?? '')
        ) {
          if (boundedRead) {
            if (strictRead) void result.body?.cancel().catch(() => {});
            else await result.body?.cancel();
          }
          throw new ApiClientError('INVALID_RESPONSE', 'Expected a JSON API response.', {
            status: result.status,
            submissionUncertain: writes,
          });
        }
        let raw: string;
        if (boundedRead) {
          const maximum = listingReport
              ? reportQueue
                ? 524288
                : 8192
              : staffSession || revisionProtocol
                ? 8192
                : publicReference || publicSearch || publicReferenceOptions
                  ? 3 * 1024 * 1024
                  : referenceCreation || referenceSuccessor
                    ? result.ok
                      ? referenceSuccessor
                        ? SYNTHETIC_REFERENCE_SUCCESSOR_MAX_BYTES
                        : SYNTHETIC_REFERENCE_CREATION_MAX_BYTES
                      : 131072
                    : referenceContext && result.ok
                      ? SYNTHETIC_REFERENCE_CONTEXT_MAX_BYTES
                      : referenceModeration
                        ? 131072
                        : (referenceCatalogue ? 6 : 1) * 1024 * 1024,
            declared = result.headers.get('content-length');
          if (
            result.headers.has('content-encoding') ||
            ((enquiryQueue || listingReport) && result.headers.has('content-range')) ||
            (declared !== null &&
              (!/^(0|[1-9]\d*)$/.test(declared) || Number(declared) > maximum)) ||
            !result.body
          ) {
            if (strictRead) void result.body?.cancel().catch(() => {});
            else await result.body?.cancel();
            throw new ApiClientError(
              'INVALID_RESPONSE',
              'Invalid import preview response framing.',
            );
          }
          const reader = result.body.getReader(),
            chunks: Uint8Array[] = [];
          let size = 0;
          let emptyFrames = 0;
          const cancelBody = () => {
            void reader.cancel().catch(() => {});
          };
          controller.signal.addEventListener('abort', cancelBody, { once: true });
          try {
            for (;;) {
              const part = await reader.read();
              if (part.done) break;
              if (strictRead && !part.value.byteLength) {
                if (++emptyFrames > 1024) {
                  void reader.cancel().catch(() => {});
                  throw new ApiClientError('INVALID_RESPONSE', 'Too many empty response frames.');
                }
                if (emptyFrames % 64 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
                continue;
              }
              emptyFrames = 0;
              size += part.value.byteLength;
              if (size > maximum) {
                if (strictRead) void reader.cancel().catch(() => {});
                else await reader.cancel();
                throw new ApiClientError(
                  'INVALID_RESPONSE',
                  'Import preview response is too large.',
                );
              }
              chunks.push(part.value);
            }
            if (declared !== null && Number(declared) !== size)
              throw new ApiClientError(
                'INVALID_RESPONSE',
                'Invalid import preview response length.',
              );
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.byteLength;
            }
            try {
              raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            } catch {
              throw new ApiClientError(
                'INVALID_RESPONSE',
                'Invalid import preview response encoding.',
              );
            }
          } finally {
            controller.signal.removeEventListener('abort', cancelBody);
            reader.releaseLock();
          }
        } else raw = await result.text();
        if (
          raw.length >
          (upload || finalization
            ? 4096
            : referenceCreation || referenceSuccessor
              ? referenceSuccessor
                ? SYNTHETIC_REFERENCE_SUCCESSOR_MAX_BYTES
                : SYNTHETIC_REFERENCE_CREATION_MAX_BYTES
              : referenceContext
                ? SYNTHETIC_REFERENCE_CONTEXT_MAX_BYTES
                : referenceCatalogue
                  ? 6 * 1024 * 1024
                  : MAX_JSON_CHARACTERS)
        )
          throw new ApiClientError(
            'INVALID_RESPONSE',
            'API response exceeded the supported size.',
            { status: result.status, submissionUncertain: writes },
          );
        let payload: unknown;
        try {
          if (
            referenceModeration ||
            publicReference ||
            publicSearch ||
            publicReferenceOptions ||
            referenceCreation ||
            referenceSuccessor
          ) {
            // Guard nullable public-pointer and room counts before JSON numeric rounding.
            const tokens =
              raw.match(
                /"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g,
              ) ?? [];
            for (let i = 0; i < tokens.length; i++)
              if (
                tokens[i]?.startsWith('"') &&
                tokens[i + 1] === ':' &&
                [
                  'publishedRevision',
                  'bedrooms',
                  'privateBathrooms',
                  'sharedBathrooms',
                  ...(publicSearch ? ['total', 'limit', 'offset', 'maxOffset'] : []),
                  ...(publicReferenceOptions ? ['maximumPerCategory'] : []),
                ].includes(JSON.parse(tokens[i]!)) &&
                !/^(?:null|0|[1-9]\d*)$/.test(tokens[i + 2] ?? '')
              )
                throw Error('Invalid reference integer token.');
          }
          if (verification || reference) assertMediaJsonTokens(raw);
          else if (enquiry) assertEnquiryJsonTokens(raw);
          else if (
            upload ||
            /^\/v2\/staff\/listings\/[^/]+\/revisions\/[^/]+\/(?:workspace|media-registrations|media-jobs|media-attach-intents|media-removals|media-reorders|media-operations)(?:\/[^/]+)?(?:\/finalize)?$/.test(
              path,
            )
          )
            assertMediaJsonTokens(raw);
          payload = staffInvitation
            ? parseStaffInvitationJson(raw)
            : listingReport
              ? parseListingReportJson(raw)
              : verification ||
                  reference ||
                  /^\/v2\/staff\/listings\/[^/]+(?:\/revision-operations\/[^/]+)?$/.test(path)
                ? parseListingSuccessorJsonV2(raw)
                : path.startsWith('/v2/')
                  ? parseListingJsonV2(raw)
                  : JSON.parse(raw);
        } catch {
          throw new ApiClientError('INVALID_RESPONSE', 'Malformed API JSON.', {
            status: result.status,
            submissionUncertain: writes,
          });
        }
        if (!result.ok) {
          if (upload) {
            const envelope = attachRecord(payload, ['error'], 'INVALID_RESPONSE'),
              code = envelope.error;
            if (typeof code !== 'string' || UPLOAD_SERVER_STATUS.get(code) !== result.status)
              return invalid('INVALID_RESPONSE', 'Malformed private upload error.');
            const requestId = uuid(
              result.headers.get('x-request-id'),
              'INVALID_RESPONSE',
              'Request ID',
            );
            throw new ApiClientError('HTTP', 'Private upload request could not be completed.', {
              status: result.status,
              serverCode: code,
              requestId,
              submissionUncertain:
                writes && (result.status >= 500 || code === 'UPLOAD_UNCONFIRMED'),
            });
          }
          if (finalization) {
            const hasUncertain =
              payload !== null &&
              typeof payload === 'object' &&
              Object.hasOwn(payload, 'submissionUncertain');
            const envelope = attachRecord(
                payload,
                ['error', 'requestId', ...(hasUncertain ? ['submissionUncertain'] : [])],
                'INVALID_RESPONSE',
              ),
              serverError = attachRecord(envelope.error, ['code', 'message'], 'INVALID_RESPONSE');
            const code = serverError.code,
              requestId = uuid(envelope.requestId, 'INVALID_RESPONSE', 'Request ID'),
              headerId = uuid(result.headers.get('x-request-id'), 'INVALID_RESPONSE', 'Request ID');
            if (
              typeof code !== 'string' ||
              FINALIZE_SERVER_STATUS.get(code) !== result.status ||
              typeof serverError.message !== 'string' ||
              serverError.message.length < 1 ||
              serverError.message.length > 1024 ||
              requestId !== headerId ||
              (hasUncertain && envelope.submissionUncertain !== true)
            )
              return invalid('INVALID_RESPONSE', 'Malformed attachment finalization error.');
            throw new ApiClientError('HTTP', 'Attachment finalization could not be confirmed.', {
              status: result.status,
              serverCode: code,
              requestId,
              submissionUncertain: result.status >= 500 || envelope.submissionUncertain === true,
            });
          }
          if (enquiry || listingQueue || listingReport) {
            const envelope = attachRecord(payload, ['error', 'requestId'], 'INVALID_RESPONSE'),
              serverError = attachRecord(envelope.error, ['code', 'message'], 'INVALID_RESPONSE');
            const code = serverError.code,
              requestId = uuid(envelope.requestId, 'INVALID_RESPONSE', 'Request ID'),
              headerId = uuid(result.headers.get('x-request-id'), 'INVALID_RESPONSE', 'Request ID');
            if (
              typeof code !== 'string' ||
              (listingReport && code === 'REQUEST_TIMEOUT'
                ? 408
                : listingReport && code === 'REQUEST_ABORTED'
                  ? 400
                  : ENQUIRY_SERVER_STATUS.get(code)) !== result.status ||
              typeof serverError.message !== 'string' ||
              serverError.message.length < 1 ||
              serverError.message.length > 1024 ||
              requestId !== headerId
            )
              return invalid('INVALID_RESPONSE', 'Malformed staff enquiry error.');
            const retry = result.headers.get('retry-after'),
              retryAfterSeconds =
                retry !== null && /^\d{1,8}$/.test(retry) ? Number(retry) : undefined;
            if (
              listingReport &&
              (result.status === 429
                ? retryAfterSeconds === undefined ||
                  retryAfterSeconds < 1 ||
                  retryAfterSeconds > 3600
                : retry !== null)
            )
              throw new ApiClientError('INVALID_RESPONSE', 'Invalid report retry budget.', {
                submissionUncertain: writes,
              });
            throw new ApiClientError('HTTP', 'Staff enquiry request could not be completed.', {
              status: result.status,
              serverCode: code,
              requestId,
              ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
              submissionUncertain: writes && result.status >= 500,
            });
          }
          const envelope = record(payload, ['error', 'requestId'], 'INVALID_RESPONSE');
          const serverError = record(envelope.error, ['code', 'message'], 'INVALID_RESPONSE');
          const requestId = uuid(envelope.requestId, 'INVALID_RESPONSE', 'Request ID');
          if (typeof serverError.code !== 'string' || typeof serverError.message !== 'string')
            return invalid('INVALID_RESPONSE', 'Malformed API error.');
          const headerId = result.headers.get('x-request-id');
          if (headerId !== null && headerId.toLowerCase() !== requestId)
            invalid('INVALID_RESPONSE', 'Conflicting API request reference.');
          const retry = result.headers.get('retry-after');
          const retryAfterSeconds =
            retry !== null && /^\d{1,8}$/.test(retry) ? Number(retry) : undefined;
          throw new ApiClientError('HTTP', 'API request could not be completed.', {
            status: result.status,
            serverCode: SERVER_CODES.has(serverError.code) ? serverError.code : undefined,
            requestId,
            ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
            submissionUncertain: writes && result.status >= 500,
          });
        }
        if (result.status !== expectedStatus)
          throw new ApiClientError('INVALID_RESPONSE', 'Unexpected API success status.', {
            status: result.status,
            submissionUncertain: writes,
          });
        return payload;
      })();
      return await Promise.race([operation, interrupted]);
    } catch (error) {
      if (interruption)
        throw new ApiClientError(
          interruption,
          interruption === 'TIMEOUT' ? 'Request timed out.' : 'Request was cancelled.',
          { submissionUncertain: writes && started },
        );
      if (error instanceof ApiClientError) {
        if (listingReport && writes && started && error.kind === 'INVALID_RESPONSE')
          throw new ApiClientError('INVALID_RESPONSE', 'Report result could not be verified.', {
            status: error.status,
            submissionUncertain: true,
          });
        throw error;
      }
      throw new ApiClientError('NETWORK', 'API could not be reached.', {
        submissionUncertain: writes && started,
      });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
    }
  }
}
export { createEnquiryProxyTransport } from './enquiry-proxy.js';

export { handleSyntheticEnquiry } from './synthetic-enquiry-handler.js';
