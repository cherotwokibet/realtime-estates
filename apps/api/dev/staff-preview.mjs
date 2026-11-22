import { seedHistoricalConfirmedViewing } from '../../../database/test-helpers/historical-confirmed-viewing.mjs';
/**
 * Independently authored local staff fixture, never a provider/login implementation.
 * Ephemeral RS256 keys, loopback JWKS, disposable PGlite and synthetic metadata only.
 * Fabricated sealed SQL provenance is not actual workflow/decoder/native/storage proof.
 * Tokens/private keys are never logged, persisted or returned from an HTTP endpoint.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { publicSearchQuery } from '../dist/public-search.js';
import { staffEnquiryQueueQuery } from '../dist/enquiry-queue.js';
import { viewingCalendarRequest } from '../dist/viewing-calendar.js';
import {
  journeyFixtureSelection,
  freezeJourneyManifest,
  publicJourneyStock,
  publicLoadStock,
  seedEnquiryJourney,
} from './journey-fixtures.mjs';
import {
  validateListingReferenceCatalogue,
  normalizeStaffDraftContentV2,
  validateSyntheticReferenceRevision,
} from '@realtor/domain';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedSyntheticSealedMedia } from '../../../database/test-helpers/synthetic-sealed-media.mjs';
import { seedGuardedListingDraft } from '../../../database/test-helpers/guarded-listing-fixture.mjs';
import { createServer } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { PGlite } from '@electric-sql/pglite';
import { createIdentityVerifier, parseBearerHeader } from '../dist/auth.js';
import { createApiService } from '../dist/service.js';
import { DatabaseSafetyError, PostgresTransactionDatabase } from '../dist/database.js';
import { createDevelopmentServer } from '../dist/http.js';
import { MediaCoordinatorDatabase } from '@realtor/media/coordinator-database';
import {
  createNativeMediaPreview,
  createNativeFloorPlanPreview,
  nativeMediaPreviewConfiguration,
} from './media-preview.mjs';

const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export const REFERENCE_PREVIEW_CATALOGUE = validateListingReferenceCatalogue({
  policy: 'synthetic-reference-catalogue-v1',
  version: '1',
  country: 'KE',
  locations: [
    { id: id(31001), kind: 'county', parentId: null, label: 'Synthetic preview county' },
    { id: id(31002), kind: 'locality', parentId: id(31001), label: 'Synthetic preview town' },
    { id: id(31003), kind: 'neighbourhood', parentId: id(31002), label: 'Synthetic preview block' },
    { id: id(31004), kind: 'county', parentId: null, label: 'Synthetic choice county' },
    { id: id(31005), kind: 'locality', parentId: id(31004), label: 'Synthetic choice town' },
    { id: id(31006), kind: 'neighbourhood', parentId: id(31005), label: 'Synthetic choice block' },
  ],
  amenities: [
    {
      id: id(31010),
      code: 'synthetic-preview-lift',
      label: 'Synthetic preview lift',
      propertyTypes: ['studio', 'apartment'],
    },
  ],
});
export const STAFF_PREVIEW_FIXTURES = Object.freeze({
  realtimeListingId: id(400),
  realtimePeerListingId: id(401),
  realtimePausedReviewListingId: id(402),
  sampleListingId: id(500),
  samplePausedReviewListingId: id(502),
  revision: 1,
  initialVersion: '2',
});
export const ENQUIRY_PREVIEW_FIXTURES = Object.freeze({
  'realtime-estates': Object.freeze({
    general: id(700),
    assigned: id(701),
    contacted: id(702),
    qualified: id(703),
    peer: id(704),
  }),
  'sample-homes': Object.freeze({
    general: id(800),
    assigned: id(801),
    contacted: id(802),
    qualified: id(803),
    peer: id(804),
  }),
});
const COMPANIES = Object.freeze({
  'realtime-estates': Object.freeze({
    id: id(1),
    admin: id(10),
    agent: id(11),
    peer: id(12),
    customer: id(13),
    revoked: id(14),
    listing: id(400),
    name: 'Synthetic Realtime Staff Preview',
  }),
  'sample-homes': Object.freeze({
    id: id(2),
    admin: id(20),
    agent: id(21),
    peer: id(22),
    customer: id(23),
    revoked: id(24),
    listing: id(500),
    name: 'Synthetic Sample Staff Preview',
  }),
});
const LIFETIME_SECONDS = 1800;
const AUDIENCE = 'synthetic-realtor-staff-preview';
class StaffPreviewConfigurationError extends Error {}
function configuration({
  tenantSlug = 'realtime-estates',
  port = 4101,
  actor = 'agent',
  nativeUploads,
  nativeFloorPlan,
  floorPlanReferenceJourney,
  floorPlanPublicationMode,
  floorPlanReplyFault,
  enquiryPreview,
  enquiryCatalogue,
  contactReplyFault,
  viewingReplyFault,
  historicalViewings,
  reminderCaptureMode,
  reminderReplyFault,
  creationReplyFault,
  successorReplyFault,
  controlReplyFault,
  settingsReplyFault,
  reportReplyFault,
  successorTerminalFixture,
  referenceDraftMode,
  referenceReplyFault,
  referenceModerationMode,
  referenceModerationReplyFault,
  referenceCreationMode,
  referenceCreationReplyFault,
  referenceSuccessorMode,
  referenceSuccessorReplyFault,
  referencePublicMode,
  journeyFixture,
  publicReportMode,
  listingVideoMode,
  listingVideoPublicationMode,
  listingVideoReplyFault,
  invitationRedemptionReplyFault,
  staffInvitationRedemptionMode,
  staffInvitationMode,
  invitationReplyFault,
  branchReplyFault,
  staffMembershipMode,
  membershipReplyFault,
  seedAcceptedMedia = nativeUploads === undefined && enquiryPreview === undefined,
  seedPendingReviews = false,
} = {}) {
  if (process.env.NODE_ENV === 'production')
    throw new StaffPreviewConfigurationError('Staff preview refuses NODE_ENV=production.');
  if (settingsReplyFault !== undefined && settingsReplyFault !== 'invalid-first-approved-v1')
    throw new StaffPreviewConfigurationError('Unsupported synthetic settings reply fault.');
  if (
    reportReplyFault !== undefined &&
    (reportReplyFault !== 'invalid-first-report-results-v1' ||
      publicReportMode !== 'synthetic-listing-report-v1')
  )
    throw new StaffPreviewConfigurationError('Unsupported synthetic report reply fault.');
  if (
    staffInvitationRedemptionMode !== undefined &&
    (staffInvitationRedemptionMode !== 'synthetic-single-use-invitations-v1' ||
      staffInvitationMode !== 'synthetic-capture-only-v1' ||
      staffMembershipMode !== 'synthetic-existing-members-v1')
  )
    throw new StaffPreviewConfigurationError(
      'Issuance preview requires explicit capture and membership candidates.',
    );
  if (
    invitationRedemptionReplyFault !== undefined &&
    (invitationRedemptionReplyFault !== 'invalid-first-redemption-result-v1' ||
      staffInvitationRedemptionMode !== 'synthetic-single-use-invitations-v1')
  )
    throw new StaffPreviewConfigurationError(
      'Redemption reply fault requires the explicit invitation candidate.',
    );
  if (staffInvitationMode !== undefined && staffInvitationMode !== 'synthetic-capture-only-v1')
    throw new StaffPreviewConfigurationError('Unsupported synthetic staff invitation mode.');
  if (staffMembershipMode !== undefined && staffMembershipMode !== 'synthetic-existing-members-v1')
    throw new StaffPreviewConfigurationError('Unsupported synthetic staff membership mode.');
  if (
    membershipReplyFault !== undefined &&
    (membershipReplyFault !== 'invalid-first-membership-result-v1' || !staffMembershipMode)
  )
    throw new StaffPreviewConfigurationError('Unsupported synthetic membership reply fault.');
  if (
    invitationReplyFault !== undefined &&
    (invitationReplyFault !== 'invalid-first-invitation-results-v1' ||
      staffInvitationMode !== 'synthetic-capture-only-v1')
  )
    throw new StaffPreviewConfigurationError('Unsupported synthetic invitation reply fault.');
  if (
    branchReplyFault !== undefined &&
    (branchReplyFault !== 'invalid-first-branch-result-v1' ||
      staffInvitationMode !== 'synthetic-capture-only-v1')
  )
    throw new StaffPreviewConfigurationError('Unsupported synthetic branch reply fault.');
  journeyFixtureSelection(journeyFixture);
  if (
    journeyFixture === 'web-admin-pilot-v1' &&
    (!nativeUploads || enquiryPreview !== 'synthetic-v1' || enquiryCatalogue !== 'synthetic-v1')
  )
    throw new StaffPreviewConfigurationError(
      'The web and admin pilot requires native media and explicit synthetic enquiry modes.',
    );
  if (
    listingVideoReplyFault !== undefined &&
    (listingVideoReplyFault !== 'invalid-first-video-v1' ||
      listingVideoMode !== 'synthetic-private-listing-video-v1')
  )
    throw new StaffPreviewConfigurationError('Video fault requires its explicit isolated mode.');
  if (
    listingVideoPublicationMode !== undefined &&
    (listingVideoPublicationMode !== 'synthetic-listing-video-publication-v1' ||
      listingVideoMode !== 'synthetic-private-listing-video-v1')
  )
    throw Error('Invalid video publication mode');
  if (listingVideoMode !== undefined && listingVideoMode !== 'synthetic-private-listing-video-v1')
    throw new StaffPreviewConfigurationError('Unsupported private video candidate.');
  if (publicReportMode !== undefined && publicReportMode !== 'synthetic-listing-report-v1')
    throw new StaffPreviewConfigurationError('Unsupported synthetic listing report mode.');
  if (
    ['public-search-v1', 'public-load-v1'].includes(journeyFixture) &&
    (referenceDraftMode !== 'synthetic-reference-draft-v1' ||
      referenceModerationMode !== 'synthetic-reference-transition-v1' ||
      referencePublicMode !== 'synthetic-reference-public-v1' ||
      !seedAcceptedMedia)
  )
    throw new StaffPreviewConfigurationError(
      'Public journey fixtures require explicit compatible public reference modes and metadata.',
    );
  if (
    journeyFixture === 'enquiry-queue-v1' &&
    (enquiryPreview !== 'synthetic-v1' || enquiryCatalogue !== 'synthetic-v1')
  )
    throw new StaffPreviewConfigurationError(
      'Enquiry journey fixtures require explicit compatible enquiry and catalogue modes.',
    );
  if (
    referenceDraftMode !== undefined &&
    (referenceDraftMode !== 'synthetic-reference-draft-v1' ||
      nativeUploads !== undefined ||
      enquiryPreview !== undefined ||
      seedPendingReviews ||
      successorTerminalFixture !== undefined)
  )
    throw new StaffPreviewConfigurationError(
      'Reference preview requires its explicit isolated synthetic mode.',
    );
  if (
    referenceModerationMode !== undefined &&
    (referenceModerationMode !== 'synthetic-reference-transition-v1' ||
      referenceDraftMode !== 'synthetic-reference-draft-v1' ||
      !seedAcceptedMedia)
  )
    throw new StaffPreviewConfigurationError(
      'Moderation preview requires explicit reference mode and synthetic accepted metadata.',
    );
  if (
    referenceSuccessorMode !== undefined &&
    (referenceSuccessorMode !== 'synthetic-reference-successor-v1' ||
      referenceModerationMode !== 'synthetic-reference-transition-v1' ||
      referenceDraftMode !== 'synthetic-reference-draft-v1' ||
      (referencePublicMode !== undefined && !floorPlanReferenceJourney))
  )
    throw new StaffPreviewConfigurationError(
      'Successor preview requires explicit isolated reference moderation mode.',
    );
  if (
    referenceSuccessorReplyFault !== undefined &&
    (referenceSuccessorReplyFault !== 'invalid-first-successor-v1' ||
      referenceSuccessorMode !== 'synthetic-reference-successor-v1')
  )
    throw new StaffPreviewConfigurationError(
      'Successor reply fault requires explicit reference successor mode.',
    );
  if (
    referenceCreationMode !== undefined &&
    (referenceCreationMode !== 'synthetic-reference-creation-v1' ||
      referenceModerationMode !== 'synthetic-reference-transition-v1' ||
      referencePublicMode !== undefined)
  )
    throw new StaffPreviewConfigurationError(
      'Creation preview requires explicit isolated reference moderation mode.',
    );
  if (
    referenceCreationReplyFault !== undefined &&
    (referenceCreationReplyFault !== 'invalid-first-created-v1' ||
      referenceCreationMode !== 'synthetic-reference-creation-v1')
  )
    throw new StaffPreviewConfigurationError(
      'Creation reply fault requires explicit reference creation mode.',
    );
  if (
    referencePublicMode !== undefined &&
    (referencePublicMode !== 'synthetic-reference-public-v1' ||
      referenceModerationMode !== 'synthetic-reference-transition-v1')
  )
    throw new StaffPreviewConfigurationError(
      'Public reference preview requires its explicit moderation mode.',
    );
  if (
    referenceModerationReplyFault !== undefined &&
    (referenceModerationReplyFault !== 'invalid-first-transition-v1' ||
      referenceModerationMode !== 'synthetic-reference-transition-v1')
  )
    throw new StaffPreviewConfigurationError(
      'Moderation reply fault requires explicit moderation mode.',
    );
  if (
    referenceReplyFault !== undefined &&
    (referenceReplyFault !== 'invalid-first-applied-v1' ||
      referenceDraftMode !== 'synthetic-reference-draft-v1')
  )
    throw new StaffPreviewConfigurationError(
      'Reference reply fault requires explicit reference mode.',
    );
  if (typeof tenantSlug !== 'string' || !Object.hasOwn(COMPANIES, tenantSlug))
    throw new StaffPreviewConfigurationError(
      'Choose the configured realtime-estates or sample-homes synthetic company.',
    );
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535)
    throw new StaffPreviewConfigurationError(
      'Staff preview port must be an integer from 0 through 65535.',
    );
  if (
    ![
      'agent',
      'admin',
      'customer',
      'revoked-agent',
      'other-company-agent',
      'other-company-admin',
    ].includes(actor)
  )
    throw new StaffPreviewConfigurationError('Choose an explicitly defined synthetic actor.');
  if (typeof seedAcceptedMedia !== 'boolean')
    throw new StaffPreviewConfigurationError(
      'Synthetic accepted-metadata fixture flag must be boolean.',
    );
  if (typeof seedPendingReviews !== 'boolean' || (seedPendingReviews && !seedAcceptedMedia))
    throw new StaffPreviewConfigurationError(
      'Pending review fixtures require the explicit accepted-metadata fixture.',
    );
  if (enquiryPreview !== undefined && enquiryPreview !== 'synthetic-v1')
    throw new StaffPreviewConfigurationError(
      'Choose the explicit synthetic-v1 enquiry preview mode or omit it.',
    );
  if (
    enquiryCatalogue !== undefined &&
    (enquiryCatalogue !== 'synthetic-v1' || enquiryPreview !== 'synthetic-v1')
  )
    throw new StaffPreviewConfigurationError(
      'Synthetic enquiry catalogue requires explicit enquiry mode.',
    );
  if (
    reminderCaptureMode !== undefined &&
    (reminderCaptureMode !== 'capture-only-v1' ||
      enquiryPreview !== 'synthetic-v1' ||
      enquiryCatalogue !== 'synthetic-v1')
  )
    throw new StaffPreviewConfigurationError(
      'Synthetic reminder capture requires explicit enquiry and catalogue modes.',
    );
  if (
    reminderReplyFault !== undefined &&
    (reminderReplyFault !== 'invalid-first-captured-v1' ||
      reminderCaptureMode !== 'capture-only-v1')
  )
    throw new StaffPreviewConfigurationError(
      'Reminder reply fault requires explicit synthetic capture mode.',
    );
  if (successorReplyFault !== undefined && successorReplyFault !== 'invalid-first-applied-v1')
    throw new StaffPreviewConfigurationError(
      'Choose the explicit synthetic successor reply fault or omit it.',
    );
  if (controlReplyFault !== undefined && controlReplyFault !== 'invalid-first-applied-v1')
    throw new StaffPreviewConfigurationError(
      'Choose the explicit synthetic listing control reply fault or omit it.',
    );
  if (
    successorTerminalFixture !== undefined &&
    (!['approved', 'rejected'].includes(successorTerminalFixture) ||
      (!seedAcceptedMedia && nativeUploads === undefined) ||
      seedPendingReviews ||
      enquiryPreview !== undefined)
  )
    throw new StaffPreviewConfigurationError(
      'Successor terminal fixture requires explicit old-revision metadata or native mode, without enquiry or pending-review modes.',
    );
  if (creationReplyFault !== undefined && creationReplyFault !== 'invalid-first-created-v1')
    throw new StaffPreviewConfigurationError(
      'Choose the explicit one-shot synthetic creation reply fault or omit it.',
    );
  if (
    historicalViewings !== undefined &&
    (historicalViewings !== 'synthetic-v1' ||
      enquiryPreview !== 'synthetic-v1' ||
      enquiryCatalogue !== 'synthetic-v1')
  )
    throw new StaffPreviewConfigurationError(
      'Historical synthetic viewings require explicit synthetic enquiry and catalogue modes.',
    );
  if (
    contactReplyFault !== undefined &&
    (contactReplyFault !== 'invalid-first-applied-v1' || enquiryPreview !== 'synthetic-v1')
  )
    throw new StaffPreviewConfigurationError(
      'Contact reply fault requires explicit synthetic enquiry mode and the supported one-shot fault.',
    );
  if (
    viewingReplyFault !== undefined &&
    (![
      'invalid-first-applied-v1',
      'invalid-first-confirmation-v1',
      'invalid-first-termination-v1',
      'invalid-first-reschedule-v1',
      'invalid-first-outcome-v1',
    ].includes(viewingReplyFault) ||
      enquiryCatalogue !== 'synthetic-v1' ||
      enquiryPreview !== 'synthetic-v1')
  )
    throw new StaffPreviewConfigurationError(
      'Viewing reply fault requires explicit synthetic enquiry and catalogue modes and the supported one-shot fault.',
    );
  if (
    enquiryPreview !== undefined &&
    ((nativeUploads !== undefined && journeyFixture !== 'web-admin-pilot-v1') ||
      seedAcceptedMedia ||
      seedPendingReviews)
  )
    throw new StaffPreviewConfigurationError(
      'Enquiry preview does not combine with image or pending-review fixtures.',
    );
  if (nativeFloorPlan !== undefined) {
    if (
      nativeUploads !== undefined ||
      enquiryPreview !== undefined ||
      referenceDraftMode !== 'synthetic-reference-draft-v1'
    )
      throw new StaffPreviewConfigurationError(
        'Floor-plan native preview requires isolated reference draft mode.',
      );
    nativeFloorPlan = nativeMediaPreviewConfiguration(nativeFloorPlan);
  }
  if (
    floorPlanReferenceJourney !== undefined &&
    (floorPlanReferenceJourney !== 'synthetic-floor-plan-reference-journey-v1' ||
      floorPlanPublicationMode !== 'synthetic-floor-plan-publication-v1' ||
      referenceModerationMode !== 'synthetic-reference-transition-v1' ||
      journeyFixture !== undefined)
  )
    throw new StaffPreviewConfigurationError(
      'Floor-plan reference journey requires isolated native publication and moderation.',
    );
  if (
    floorPlanPublicationMode !== undefined &&
    (floorPlanPublicationMode !== 'synthetic-floor-plan-publication-v1' || !nativeFloorPlan)
  )
    throw new StaffPreviewConfigurationError(
      'Floor-plan publication requires explicit native floor preview.',
    );
  if (
    floorPlanReplyFault !== undefined &&
    (floorPlanReplyFault !== 'invalid-first-floor-plan-v1' || !nativeFloorPlan)
  )
    throw new StaffPreviewConfigurationError(
      'Floor-plan reply fault requires its explicit native preview.',
    );
  if (nativeUploads !== undefined) {
    nativeUploads = nativeMediaPreviewConfiguration(nativeUploads);
    if (seedAcceptedMedia || seedPendingReviews)
      throw new StaffPreviewConfigurationError(
        'Native media preview starts without fabricated accepted-media or pending-review fixtures.',
      );
  }
  return {
    tenantSlug,
    port,
    actor,
    seedAcceptedMedia,
    seedPendingReviews,
    nativeUploads,
    nativeFloorPlan,
    floorPlanReferenceJourney,
    floorPlanPublicationMode,
    floorPlanReplyFault,
    enquiryPreview,
    enquiryCatalogue,
    contactReplyFault,
    viewingReplyFault,
    historicalViewings,
    reminderCaptureMode,
    reminderReplyFault,
    creationReplyFault,
    successorReplyFault,
    controlReplyFault,
    settingsReplyFault,
    reportReplyFault,
    successorTerminalFixture,
    referenceDraftMode,
    referenceReplyFault,
    referenceModerationMode,
    referenceModerationReplyFault,
    referenceCreationMode,
    referenceCreationReplyFault,
    referenceSuccessorMode,
    referenceSuccessorReplyFault,
    referencePublicMode,
    journeyFixture,
    publicReportMode,
    listingVideoMode,
    listingVideoPublicationMode,
    listingVideoReplyFault,
    invitationRedemptionReplyFault,
    staffInvitationRedemptionMode,
    staffInvitationMode,
    invitationReplyFault,
    branchReplyFault,
    staffMembershipMode,
    membershipReplyFault,
  };
}
function syntheticContent(title = 'Synthetic staff monthly studio') {
  return {
    title,
    description:
      'Synthetic staff editor fixture only. No real property, owner evidence or prospect is represented.',
    purpose: 'rent',
    propertyType: 'studio',
    currency: 'KES',
    amountMinor: 2000000,
    rentPeriod: 'month',
    bedrooms: 0,
    privateBathrooms: 1,
    sharedBathrooms: null,
    country: 'KE',
    locality: 'Synthetic Nairobi area',
    publicPrecision: 'area',
    latitude: null,
    longitude: null,
    privateAddress: 'PRIVATE SYNTHETIC STAFF FIXTURE ADDRESS',
    pricing: {
      declaration: 'complete',
      charges: [
        {
          id: 'service',
          name: 'Monthly service fee',
          amountStatus: 'known',
          amountMinor: 100000,
          timing: 'per_rental_period',
          classification: 'fee',
          mandatory: true,
        },
        {
          id: 'deposit',
          name: 'Refundable security deposit',
          amountStatus: 'known',
          amountMinor: 2000000,
          timing: 'one_off',
          classification: 'refundable_deposit',
          mandatory: true,
        },
        {
          id: 'preparation',
          name: 'One-off preparation fee',
          amountStatus: 'known',
          amountMinor: 50000,
          timing: 'one_off',
          classification: 'fee',
          mandatory: true,
        },
      ],
    },
    location: { county: 'Nairobi', town: 'Synthetic Nairobi town', area: 'Synthetic preview area' },
  };
}
async function bootstrapAs(db, company, actor, operation) {
  await db.exec('BEGIN; SET LOCAL ROLE api_runtime;');
  try {
    await db.query(
      `SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),set_config('realtor.correlation_id','synthetic-staff-preview-seed',true)`,
      [company.id, actor],
    );
    const result = await operation();
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
export async function seedPublicReferenceListing(db, company, fixture) {
  const { listingId, slug, operationBase, referenceLocation, locationDisclosure, ...contentFacts } =
    fixture ?? {};
  const listing = listingId ?? id(Number(company.listing.slice(-3)) + 10);
  const content = normalizeStaffDraftContentV2({
    ...syntheticContent('Synthetic approved historical reference studio'),
    ...contentFacts,
    ...(fixture ? { pricing: { declaration: 'complete', charges: [] } } : {}),
    locality: locationDisclosure?.area ?? 'Synthetic preview block',
    location: {
      county: locationDisclosure?.county ?? 'Synthetic preview county',
      town: locationDisclosure?.town ?? 'Synthetic preview town',
      area: locationDisclosure?.area ?? 'Synthetic preview block',
    },
  });
  await bootstrapAs(db, company, company.agent, () =>
    seedGuardedListingDraft(db, {
      listingId: listing,
      slug: slug ?? `synthetic-reference-public-${listing.slice(-3)}`,
      content,
      actorId: company.agent,
    }),
  );
  for (let position = 0; position < 4; position++)
    await seedSyntheticSealedMedia(db, {
      tenantId: company.id,
      listingId: listing,
      position,
      altText: `Synthetic public photo ${position + 1} — metadata only; no image bytes`,
    });
  await bootstrapAs(db, company, company.agent, async () => {
    await db.query('SELECT app_api.save_synthetic_reference_draft($1,1,2,$2,$3::jsonb,$4::jsonb)', [
      listing,
      id(operationBase ?? 35000 + Number(listing.slice(-3))),
      JSON.stringify(content),
      JSON.stringify({
        catalogueVersion: '1',
        location: referenceLocation ?? {
          countyId: id(31001),
          localityId: id(31002),
          neighbourhoodId: id(31003),
        },
        amenityIds: ['studio', 'apartment'].includes(content.propertyType) ? [id(31010)] : [],
      }),
    ]);
    await db.query("SELECT app_api.confirm_availability($1,1,'available')", [listing]);
    const data = await db.query(
      'SELECT app_api.read_synthetic_reference_revision($1,1,3) AS review',
      [listing],
    );
    const review = validateSyntheticReferenceRevision(
      data.rows[0].review,
      REFERENCE_PREVIEW_CATALOGUE,
      listing,
      1,
      '3',
    );
    await db.query(
      "SELECT app_api.execute_synthetic_reference_transition($1,1,$2,'submit',$3::jsonb,NULL)",
      [
        listing,
        id(operationBase === undefined ? 36000 + Number(listing.slice(-3)) : operationBase + 1),
        JSON.stringify(review),
      ],
    );
  });
  await bootstrapAs(db, company, company.admin, async () => {
    const data = await db.query(
      'SELECT app_api.read_synthetic_reference_review($1,1,4) AS review',
      [listing],
    );
    const review = validateSyntheticReferenceRevision(
      data.rows[0].review,
      REFERENCE_PREVIEW_CATALOGUE,
      listing,
      1,
      '4',
    );
    await db.query(
      "SELECT app_api.execute_synthetic_reference_transition($1,1,$2,'approve',$3::jsonb,NULL)",
      [
        listing,
        id(operationBase === undefined ? 37000 + Number(listing.slice(-3)) : operationBase + 2),
        JSON.stringify(review),
      ],
    );
  });
}
async function seed(db, seedAcceptedMedia, seedPendingReviews) {
  await applyTestMigrations(db);
  for (const [slug, company] of Object.entries(COMPANIES)) {
    await db.query('INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,$2,$3)', [
      company.id,
      slug,
      company.name,
    ]);
    for (const [actor, role, active] of [
      [company.admin, 'admin', true],
      [company.agent, 'agent', true],
      [company.peer, 'agent', true],
      [company.customer, 'customer', true],
      [company.revoked, 'agent', false],
    ])
      await db.query(
        `INSERT INTO app_private.memberships(tenant_id,user_id,role,active,revoked_at) VALUES($1,$2,$3,$4,CASE WHEN $4 THEN NULL ELSE now() END)`,
        [company.id, actor, role, active],
      );
  }
  const fixtures = [
    {
      company: COMPANIES['realtime-estates'],
      listing: STAFF_PREVIEW_FIXTURES.realtimeListingId,
      assigned: COMPANIES['realtime-estates'].agent,
      title: 'Synthetic staff monthly studio',
    },
    {
      company: COMPANIES['realtime-estates'],
      listing: STAFF_PREVIEW_FIXTURES.realtimePeerListingId,
      assigned: COMPANIES['realtime-estates'].peer,
      title: 'Synthetic peer-assigned studio',
    },
    {
      company: COMPANIES['sample-homes'],
      listing: STAFF_PREVIEW_FIXTURES.sampleListingId,
      assigned: COMPANIES['sample-homes'].agent,
      title: 'Synthetic other-company draft',
    },
  ];
  if (seedPendingReviews)
    fixtures.push(
      {
        company: COMPANIES['realtime-estates'],
        listing: STAFF_PREVIEW_FIXTURES.realtimePausedReviewListingId,
        assigned: COMPANIES['realtime-estates'].agent,
        title: 'Synthetic paused review studio',
        paused: true,
      },
      {
        company: COMPANIES['sample-homes'],
        listing: STAFF_PREVIEW_FIXTURES.samplePausedReviewListingId,
        assigned: COMPANIES['sample-homes'].agent,
        title: 'Synthetic other-company paused review',
        paused: true,
      },
    );
  for (const fixture of fixtures) {
    const { company, listing, assigned, title } = fixture;
    await bootstrapAs(db, company, assigned, () =>
      seedGuardedListingDraft(db, {
        listingId: listing,
        slug: `synthetic-staff-${listing.slice(-3)}`,
        content: syntheticContent(title),
        actorId: assigned,
      }),
    );
    if (seedAcceptedMedia)
      for (let position = 0; position < 4; position++)
        await seedSyntheticSealedMedia(db, {
          tenantId: company.id,
          listingId: listing,
          mediaId: id(Number(listing.slice(-3)) * 10 + position),
          position,
          altText: `Synthetic photo ${position + 1} — SQL-only accepted metadata; image bytes unavailable`,
        });
    if (seedPendingReviews && listing !== STAFF_PREVIEW_FIXTURES.realtimePeerListingId) {
      await bootstrapAs(db, company, assigned, () =>
        db.query("SELECT app_api.confirm_availability($1,1,'available')", [listing]),
      );
      await bootstrapAs(db, company, assigned, () =>
        db.query('SELECT app_api.submit_revision($1,1,2)', [listing]),
      );
      if (fixture.paused)
        await bootstrapAs(db, company, company.admin, () =>
          db.query("SELECT app_api.set_publication($1,2,'paused')", [listing]),
        );
    }
  }
}
async function seedEnquiryCatalogue(db) {
  // Synthetic SQL provenance only: these fixtures have no image bytes and prove no upload workflow.
  for (const company of Object.values(COMPANIES)) {
    for (let position = 0; position < 4; position++)
      await seedSyntheticSealedMedia(db, {
        tenantId: company.id,
        listingId: company.listing,
        mediaId: id(Number(company.listing.slice(-3)) * 10 + position),
        position,
      });
    await bootstrapAs(db, company, company.agent, () =>
      db.query("SELECT app_api.confirm_availability($1,1,'available')", [company.listing]),
    );
    const pending = await bootstrapAs(db, company, company.agent, () =>
      db.query('SELECT app_api.submit_revision($1,1,2) AS version', [company.listing]),
    );
    await bootstrapAs(db, company, company.admin, () =>
      db.query('SELECT app_api.decide_revision($1,1,$2,true)', [
        company.listing,
        pending.rows[0].version,
      ]),
    );
  }
}
async function seedEnquiries(db) {
  const now = Date.now(),
    due = new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    next = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  for (const [slug, company] of Object.entries(COMPANIES)) {
    const fixtures = ENQUIRY_PREVIEW_FIXTURES[slug];
    for (const [index, [key, enquiryId]] of Object.entries(fixtures).entries()) {
      const base = Number(enquiryId.slice(-3)),
        operation = (step) => id(10000 + base * 10 + step);
      const labels = {
        general: 'Synthetic prospect — unassigned',
        assigned: 'Synthetic prospect — newly assigned',
        contacted: 'Synthetic prospect — due follow-up',
        qualified: 'Synthetic prospect — qualified',
        peer: 'Synthetic prospect — other agent',
      };
      await bootstrapAs(db, company, company.admin, () =>
        db.query('SELECT app_api.record_enquiry($1,$2,NULL,$3,NULL,$4,$5,$6,$7)', [
          enquiryId,
          id(20000 + base),
          labels[key],
          `synthetic-${slug}-${key}@example.invalid`,
          `Fictional enquiry fixture ${index + 1}. Looking for a rental within a synthetic budget.\nPreserve this original message; no real prospect is represented.`,
          key === 'general' ? 'web' : 'staff',
          'synthetic-staff-notice-v1',
        ]),
      );
      if (key === 'general') continue;
      const assigned = key === 'peer' ? company.peer : company.agent;
      await bootstrapAs(db, company, company.admin, () =>
        db.query(`SELECT app_api.execute_enquiry_operation($1,$2,1,'assign',$3,NULL,NULL,NULL)`, [
          enquiryId,
          operation(1),
          assigned,
        ]),
      );
      if (key === 'assigned') continue;
      await bootstrapAs(db, company, assigned, () =>
        db.query(
          `SELECT app_api.execute_enquiry_operation($1,$2,2,'transition',NULL,'contacted',$3,NULL)`,
          [enquiryId, operation(2), due],
        ),
      );
      if (key === 'qualified')
        await bootstrapAs(db, company, assigned, () =>
          db.query(
            `SELECT app_api.execute_enquiry_operation($1,$2,3,'transition',NULL,'qualified',$3,NULL)`,
            [enquiryId, operation(3), next],
          ),
        );
    }
  }
}
function runtimePools(db, withMedia, inspectViewingAudit) {
  let tail = Promise.resolve();
  let closed = false,
    poisoned = false,
    closing;
  function pool(login) {
    return {
      async connect() {
        if (closed || poisoned) throw new DatabaseSafetyError();
        let unlock;
        const next = new Promise((resolve) => {
          unlock = resolve;
        });
        const previous = tail;
        tail = next;
        await previous;
        if (closed || poisoned) {
          unlock();
          throw new DatabaseSafetyError();
        }
        try {
          // PGlite has one session. A shared queue changes only between fixed,
          // separately granted logins; request SQL never receives bootstrap access.
          await db.exec(`SET SESSION AUTHORIZATION ${login}; RESET ROLE;`);
        } catch (error) {
          poisoned = true;
          unlock();
          throw error;
        }
        let released = false;
        return {
          query: (sql, args) => db.query(sql, args ? [...args] : []),
          release(destroy = false) {
            if (!released) {
              released = true;
              if (destroy) poisoned = true;
              unlock();
            }
          },
        };
      },
    };
  }
  const close = () =>
    (closing ??= (async () => {
      closed = true;
      await tail;
      await db.close();
    })());
  return {
    api: { ...pool('synthetic_staff_login'), end: close },
    auditInspection: inspectViewingAudit ? pool('synthetic_viewing_audit_login') : undefined,
    media: withMedia ? pool('synthetic_staff_media_login') : undefined,
    close,
  };
}
function json(status, payload, extra = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Synthetic-Staff-Preview': 'true',
      ...extra,
    },
  });
}
function failure(status, code, message, extra = {}) {
  const requestId = randomUUID();
  return json(
    status,
    { error: { code, message }, requestId },
    { 'X-Request-Id': requestId, ...extra },
  );
}
async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new StaffPreviewConfigurationError('Expected a loopback TCP listener.');
  return `http://127.0.0.1:${address.port}`;
}
async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections();
  });
}

/** Token is handed only to the calling development launcher, never an HTTP login route. */
export async function startStaffPreview(options = {}) {
  const {
    tenantSlug,
    port,
    actor,
    seedAcceptedMedia,
    seedPendingReviews,
    nativeUploads,
    nativeFloorPlan,
    floorPlanReferenceJourney,
    floorPlanPublicationMode,
    floorPlanReplyFault,
    enquiryPreview,
    enquiryCatalogue,
    contactReplyFault,
    viewingReplyFault,
    historicalViewings,
    reminderCaptureMode,
    reminderReplyFault,
    creationReplyFault,
    successorReplyFault,
    controlReplyFault,
    settingsReplyFault,
    reportReplyFault,
    successorTerminalFixture,
    referenceDraftMode,
    referenceReplyFault,
    referenceModerationMode,
    referenceModerationReplyFault,
    referenceCreationMode,
    referenceCreationReplyFault,
    referenceSuccessorMode,
    referenceSuccessorReplyFault,
    referencePublicMode,
    journeyFixture,
    publicReportMode,
    listingVideoMode,
    listingVideoPublicationMode,
    listingVideoReplyFault,
    invitationRedemptionReplyFault,
    staffInvitationRedemptionMode,
    staffInvitationMode,
    invitationReplyFault,
    branchReplyFault,
    staffMembershipMode,
    membershipReplyFault,
  } = configuration(options);
  let referenceReplyFaultPending = !!referenceReplyFault;
  let referenceModerationReplyFaultPending = !!referenceModerationReplyFault;
  let referenceSuccessorReplyFaultPending = !!referenceSuccessorReplyFault;
  let referenceCreationReplyFaultPending = !!referenceCreationReplyFault;
  let controlReplyFaultPending = !!controlReplyFault;
  let settingsReplyFaultPending = !!settingsReplyFault;
  let branchReplyFaultPending = !!branchReplyFault;
  let membershipReplyFaultPending = !!membershipReplyFault;
  let invitationRedemptionFaultPending = !!invitationRedemptionReplyFault;
  let invitationIssueFaultPending = !!invitationReplyFault;
  let invitationCaptureFaultPending = !!invitationReplyFault,
    invitationRevokeFaultPending = !!invitationReplyFault;
  let reportCaptureFaultPending = !!reportReplyFault,
    reportDecisionFaultPending = !!reportReplyFault;
  let successorReplyFaultPending = !!successorReplyFault;
  let creationReplyFaultPending = !!creationReplyFault;
  let reminderReplyFaultPending = !!reminderReplyFault;
  let contactReplyFaultPending = !!contactReplyFault,
    viewingReplyFaultPending = !!viewingReplyFault;
  const company = COMPANIES[tenantSlug],
    other = COMPANIES[tenantSlug === 'realtime-estates' ? 'sample-homes' : 'realtime-estates'];
  const actorId =
    actor === 'agent'
      ? company.agent
      : actor === 'admin'
        ? company.admin
        : actor === 'customer'
          ? company.customer
          : actor === 'revoked-agent'
            ? company.revoked
            : actor === 'other-company-admin'
              ? other.admin
              : other.agent;
  const db = new PGlite();
  let database, coordinator, nativeMedia, nativeFloor, journeyManifest;
  let apiServer;
  let jwksServer;
  try {
    await seed(db, seedAcceptedMedia, seedPendingReviews);
    if (staffMembershipMode)
      await db.exec(
        await readFile(
          new URL('../../../database/proposals/staff-membership-changes.sql', import.meta.url),
          'utf8',
        ),
      );
    if (staffInvitationMode) {
      // Explicit disposable fixture only; never normal migrations or deployed bootstrap.
      for (const file of [
        'staff-branches.sql',
        'staff-invitation-requests.sql',
        'staff-directory-reads.sql',
      ])
        await db.exec(
          await readFile(new URL('../../../database/proposals/' + file, import.meta.url), 'utf8'),
        );
    }
    if (staffInvitationRedemptionMode)
      await db.exec(
        await readFile(
          new URL('../../../database/proposals/staff-invitation-redemption.sql', import.meta.url),
          'utf8',
        ),
      );
    if (nativeFloorPlan)
      for (const name of ['registration', 'processing', 'output', 'attachment'])
        await db.exec(
          await readFile(
            new URL('../../../database/proposals/floor-plan-' + name + '.sql', import.meta.url),
            'utf8',
          ),
        );
    if (floorPlanPublicationMode)
      for (const name of ['publication', 'publication-output'])
        await db.exec(
          await readFile(
            new URL('../../../database/proposals/floor-plan-' + name + '.sql', import.meta.url),
            'utf8',
          ),
        );
    if (floorPlanReferenceJourney && referenceSuccessorMode)
      for (const name of ['successor', 'successor-delivery'])
        await db.exec(
          await readFile(
            new URL('../../../database/proposals/floor-plan-' + name + '.sql', import.meta.url),
            'utf8',
          ),
        );
    if (listingVideoMode)
      await db.exec(
        await readFile(
          new URL('../../../database/proposals/listing-video.sql', import.meta.url),
          'utf8',
        ),
      );
    if (listingVideoPublicationMode)
      await db.exec(
        await readFile(
          new URL('../../../database/proposals/listing-video-publication.sql', import.meta.url),
          'utf8',
        ),
      );
    if (referenceDraftMode) {
      // Explicit disposable owner fixture only. These are never default migrations.
      for (const file of [
        'listing-reference-draft.sql',
        'listing-reference-catalogue-install.sql',
        'listing-reference-read.sql',
        ...(referenceModerationMode ? ['listing-reference-moderation.sql'] : []),
        ...(referenceCreationMode ? ['listing-reference-creation.sql'] : []),
        ...(referenceSuccessorMode ? ['listing-reference-successor.sql'] : []),
      ])
        await db.exec(
          await readFile(new URL('../../../database/proposals/' + file, import.meta.url), 'utf8'),
        );
      await db.query('SELECT app_private.install_synthetic_reference_catalogue(0,$1::jsonb)', [
        JSON.stringify(REFERENCE_PREVIEW_CATALOGUE),
      ]);
      if (referenceModerationMode && !floorPlanReferenceJourney) {
        for (const fixtureCompany of Object.values(COMPANIES)) {
          const listing = fixtureCompany.listing;
          await bootstrapAs(db, fixtureCompany, fixtureCompany.agent, async () => {
            const content = normalizeStaffDraftContentV2({
              ...syntheticContent('Synthetic reference review studio'),
              locality: 'Synthetic preview block',
              location: {
                county: 'Synthetic preview county',
                town: 'Synthetic preview town',
                area: 'Synthetic preview block',
              },
            });
            await db.query(
              'SELECT app_api.save_synthetic_reference_draft($1,1,2,$2,$3::jsonb,$4::jsonb)',
              [
                listing,
                id(32000 + Number(listing.slice(-3))),
                JSON.stringify(content),
                JSON.stringify({
                  catalogueVersion: '1',
                  location: {
                    countyId: id(31001),
                    localityId: id(31002),
                    neighbourhoodId: id(31003),
                  },
                  amenityIds: [id(31010)],
                }),
              ],
            );
            await db.query("SELECT app_api.confirm_availability($1,1,'available')", [listing]);
            const projection = await db.query(
              'SELECT app_api.read_synthetic_reference_revision($1,1,3) AS review',
              [listing],
            );
            const review = validateSyntheticReferenceRevision(
              projection.rows[0].review,
              REFERENCE_PREVIEW_CATALOGUE,
              listing,
              1,
              '3',
            );
            await db.query(
              "SELECT app_api.execute_synthetic_reference_transition($1,1,$2,'submit',$3::jsonb,NULL)",
              [listing, id(33000 + Number(listing.slice(-3))), JSON.stringify(review)],
            );
          });
        }
        if (referenceSuccessorMode)
          for (const fixtureCompany of Object.values(COMPANIES))
            await bootstrapAs(db, fixtureCompany, fixtureCompany.admin, async () => {
              const listing = fixtureCompany.listing;
              const data = await db.query(
                'SELECT app_api.read_synthetic_reference_review($1,1,4) AS review',
                [listing],
              );
              const review = validateSyntheticReferenceRevision(
                data.rows[0].review,
                REFERENCE_PREVIEW_CATALOGUE,
                listing,
                1,
                '4',
              );
              await db.query(
                "SELECT app_api.execute_synthetic_reference_transition($1,1,$2,'approve',$3::jsonb,NULL)",
                [listing, id(38000 + Number(listing.slice(-3))), JSON.stringify(review)],
              );
            });
        if (referencePublicMode)
          for (const fixtureCompany of Object.values(COMPANIES))
            await seedPublicReferenceListing(db, fixtureCompany);
        if (journeyFixture === 'public-search-v1') {
          const stock = publicJourneyStock(tenantSlug);
          for (const fixture of stock.rows) await seedPublicReferenceListing(db, company, fixture);
          journeyManifest = freezeJourneyManifest({
            policy: 'synthetic-journey-fixtures-v1',
            kind: journeyFixture,
            tenantSlug,
            public: stock.manifest,
          });
        }
        if (journeyFixture === 'public-load-v1') {
          for (const [slug, fixtureCompany] of Object.entries(COMPANIES)) {
            const stock = publicLoadStock(slug);
            for (const fixture of stock.rows)
              await seedPublicReferenceListing(db, fixtureCompany, fixture);
            if (slug === tenantSlug)
              journeyManifest = freezeJourneyManifest({
                policy: 'synthetic-journey-fixtures-v1',
                kind: journeyFixture,
                tenantSlug,
                public: stock.manifest,
                lab: {
                  companies: 2,
                  approvedPerCompany: 500,
                  approvedTotal: 1000,
                  media: 'synthetic-metadata-only',
                  seededThrough: 'guarded-draft-submit-approval',
                },
              });
          }
        }
        if (journeyFixture === 'public-load-v1') {
          const observed = [];
          for (const [slug, fixtureCompany] of Object.entries(COMPANIES)) {
            const result = await bootstrapAs(db, fixtureCompany, fixtureCompany.admin, () =>
              db.query(
                'SELECT count(*)::int AS listings, sum(jsonb_array_length(photo_refs))::int AS "photoRefs" FROM app_api.public_listings_reference_v3',
              ),
            );
            if (result.rows[0]?.listings !== 500 || result.rows[0]?.photoRefs !== 2000)
              throw Error('Representative public inventory does not match the lab manifest.');
            observed.push({ tenantSlug: slug, ...result.rows[0] });
          }
          journeyManifest = freezeJourneyManifest({
            ...journeyManifest,
            lab: { ...journeyManifest.lab, observed },
          });
        }
        await db.query('SELECT app_private.install_synthetic_reference_catalogue(1,$1::jsonb)', [
          JSON.stringify({
            ...REFERENCE_PREVIEW_CATALOGUE,
            version: '2',
            locations: REFERENCE_PREVIEW_CATALOGUE.locations.map((r) => ({
              ...r,
              label: 'Synthetic newer ' + r.kind,
            })),
          }),
        ]);
      }
    }
    if (successorTerminalFixture) {
      for (const fixtureCompany of Object.values(COMPANIES)) {
        // Explicit terminal history only: old revision metadata is synthetic, never native-byte proof.
        // The newly allocated successor remains empty until actual native uploads are attached.
        if (!seedAcceptedMedia)
          for (let position = 0; position < 4; position++)
            await seedSyntheticSealedMedia(db, {
              tenantId: fixtureCompany.id,
              listingId: fixtureCompany.listing,
              mediaId: id(Number(fixtureCompany.listing.slice(-3)) * 10 + position),
              position,
              altText: 'Synthetic historical terminal metadata only; no image bytes',
            });
        await bootstrapAs(db, fixtureCompany, fixtureCompany.agent, () =>
          db.query("SELECT app_api.confirm_availability($1,1,'available')", [
            fixtureCompany.listing,
          ]),
        );
        const pending = await bootstrapAs(db, fixtureCompany, fixtureCompany.agent, () =>
          db.query('SELECT app_api.submit_revision($1,1,2) AS version', [fixtureCompany.listing]),
        );
        await bootstrapAs(db, fixtureCompany, fixtureCompany.admin, () =>
          db.query('SELECT app_api.decide_revision($1,1,$2,$3,$4)', [
            fixtureCompany.listing,
            pending.rows[0].version,
            successorTerminalFixture === 'approved',
            successorTerminalFixture === 'approved'
              ? null
              : 'Synthetic historical rejection; new revision required.',
          ]),
        );
      }
    }
    if (enquiryCatalogue && journeyFixture !== 'web-admin-pilot-v1') await seedEnquiryCatalogue(db);
    if (enquiryPreview) await seedEnquiries(db);
    if (journeyFixture === 'enquiry-queue-v1') {
      const enquiries = await seedEnquiryJourney(
        db,
        company,
        tenantSlug,
        bootstrapAs,
        ENQUIRY_PREVIEW_FIXTURES[tenantSlug].contacted,
      );
      journeyManifest = freezeJourneyManifest({
        policy: 'synthetic-journey-fixtures-v1',
        kind: journeyFixture,
        tenantSlug,
        enquiries,
      });
    }
    if (historicalViewings)
      for (const [index, fixtureCompany] of Object.entries(COMPANIES).entries()) {
        const [slug, c] = fixtureCompany;
        for (const later of [false, true])
          await seedHistoricalConfirmedViewing(db, {
            tenantId: c.id,
            enquiryId: ENQUIRY_PREVIEW_FIXTURES[slug].assigned,
            listingId: c.listing,
            actorId: c.agent,
            viewingId: id(900 + index * 10 + Number(later)),
            later,
            offset: 9000 + index * 100 + Number(later) * 10,
          });
      }
    await db.exec(
      'CREATE ROLE synthetic_staff_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT api_runtime TO synthetic_staff_login;',
    );
    if (nativeUploads || nativeFloorPlan)
      await db.exec(
        'CREATE ROLE synthetic_staff_media_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT media_coordinator TO synthetic_staff_media_login;',
      );
    if (options.inspectViewingAudit === true) {
      await db.exec(
        `CREATE ROLE synthetic_viewing_audit_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA app_private TO synthetic_viewing_audit_login; GRANT SELECT ON app_private.audit_events TO synthetic_viewing_audit_login; CREATE POLICY synthetic_viewing_audit_read ON app_private.audit_events FOR SELECT TO synthetic_viewing_audit_login USING (object_type = 'viewing');`,
      );
    }
    const pools = runtimePools(
      db,
      !!(nativeUploads || nativeFloorPlan),
      options.inspectViewingAudit === true,
    );
    database = new PostgresTransactionDatabase(pools.api);
    await database.checkConnection();
    if (nativeUploads) {
      coordinator = new MediaCoordinatorDatabase(pools.media);
      await coordinator.checkConnection();
    }
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const kid = randomUUID(),
      keys = { keys: [{ ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' }] };
    let issuer;
    jwksServer = createServer({ maxHeaderSize: 8192 }, (incoming, outgoing) => {
      const allowed = issuer && incoming.headers.host === new URL(issuer).host;
      const acceptableOrigin =
        incoming.headers.origin === undefined || incoming.headers.origin === issuer;
      if (
        !allowed ||
        !acceptableOrigin ||
        incoming.method !== 'GET' ||
        incoming.url !== '/.well-known/jwks.json' ||
        (incoming.headers['content-length'] !== undefined &&
          incoming.headers['content-length'] !== '0') ||
        incoming.headers['transfer-encoding']
      ) {
        outgoing.writeHead(404, { 'Cache-Control': 'no-store', Connection: 'close' });
        outgoing.end();
        incoming.resume();
        return;
      }
      outgoing.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      outgoing.end(JSON.stringify(keys));
    });
    jwksServer.requestTimeout = 5000;
    jwksServer.headersTimeout = 5000;
    jwksServer.keepAliveTimeout = 1000;
    jwksServer.maxHeadersCount = 20;
    issuer = await listen(jwksServer, 0);
    const verify = createIdentityVerifier({
      issuer,
      audience: AUDIENCE,
      jwksUrl: issuer + '/.well-known/jwks.json',
      allowLoopbackHttpForTests: true,
    });
    const now = Math.floor(Date.now() / 1000),
      expiresAt = new Date((now + LIFETIME_SECONDS) * 1000).toISOString();
    const issueToken = (subject) =>
      new SignJWT({ synthetic: true })
        .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
        .setIssuer(issuer)
        .setAudience(AUDIENCE)
        .setSubject(subject)
        .setIssuedAt(now)
        .setExpirationTime(now + LIFETIME_SECONDS)
        .sign(privateKey);
    const bearerToken = await issueToken(actorId);
    await verify(bearerToken); // Exercise the real loopback JWKS resolver before handing off.
    let invitationRecipient;
    if (staffInvitationRedemptionMode) {
      const recipientId = id(tenantSlug === 'realtime-estates' ? 50 : 60),
        recipientEmail = 'invitation-recipient@synthetic.example.invalid';
      const token = await new SignJWT({
        synthetic: true,
        email: recipientEmail,
        email_verified: true,
      })
        .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
        .setIssuer(issuer)
        .setAudience(AUDIENCE)
        .setSubject(recipientId)
        .setIssuedAt(now)
        .setExpirationTime(now + LIFETIME_SECONDS)
        .sign(privateKey);
      invitationRecipient = Object.freeze(
        Object.defineProperty({ actorId: recipientId, recipientEmail }, 'bearerToken', {
          value: token,
          enumerable: false,
        }),
      );
    }
    let enquiryStaff;
    if (enquiryPreview) {
      const adminToken = actorId === company.admin ? bearerToken : await issueToken(company.admin);
      const agentToken = actorId === company.agent ? bearerToken : await issueToken(company.agent);
      await verify(adminToken);
      await verify(agentToken);
      enquiryStaff = Object.freeze({
        admin: Object.freeze({ actorId: company.admin, bearerToken: adminToken }),
        agent: Object.freeze({ actorId: company.agent, bearerToken: agentToken }),
      });
    }
    let videoReplyPending = listingVideoReplyFault === 'invalid-first-video-v1';
    let floorUploadFault = !!floorPlanReplyFault,
      floorAttachFault = !!floorPlanReplyFault;
    const service = createApiService({
      ...(enquiryPreview
        ? { staffCaptureOriginalMode: 'synthetic-staff-capture-original-v1' }
        : {}),
      privateOperationResolutionMode: 'synthetic-serialized-original-v1',
      database,
      ...(nativeFloorPlan
        ? {
            floorPlanMode: 'synthetic-private-floor-plan-v1',
            floorPlanPreparation: {
              prepare: (...args) => nativeFloor.prepare(...args),
              recover: (...args) => nativeFloor.recover(...args),
            },
            floorPlanImageRead: (...args) => nativeFloor.readImage(...args),
          }
        : {}),
      ...(floorPlanPublicationMode
        ? {
            floorPlanReferenceJourney,
            floorPlanPublicationMode,
            publishedFloorPlanImageRead: (...args) => nativeFloor.readPublishedImage(...args),
            reviewFloorPlanImageRead: (...args) => nativeFloor.readReviewImage(...args),
          }
        : {}),
      ...(listingVideoMode ? { listingVideoMode } : {}),
      ...(listingVideoPublicationMode ? { listingVideoPublicationMode } : {}),
      verificationMode: 'synthetic-check-record-v1',
      ...(publicReportMode ? { publicReportMode } : {}),
      ...(staffInvitationRedemptionMode
        ? {
            staffInvitationRedemption: {
              mode: staffInvitationRedemptionMode,
              identity: {
                issuer,
                audience: AUDIENCE,
                jwksUrl: issuer + '/.well-known/jwks.json',
                allowLoopbackHttpForTests: true,
              },
            },
          }
        : {}),
      ...(staffInvitationMode ? { staffInvitationMode } : {}),
      ...(staffMembershipMode ? { staffMembershipMode } : {}),
      ...(referenceDraftMode ? { referenceDraftMode } : {}),
      ...(referenceModerationMode ? { referenceModerationMode } : {}),
      ...(referenceCreationMode ? { referenceCreationMode } : {}),
      ...(referenceSuccessorMode ? { referenceSuccessorMode } : {}),
      ...(reminderCaptureMode ? { reminderCaptureMode } : {}),
      tenantId: company.id,
      privacyNoticeVersion: 'synthetic-staff-notice-v1',
      verifyAuthorization: (request) =>
        verify(parseBearerHeader(request.headers.get('authorization') ?? undefined)),
    });
    if (nativeUploads)
      nativeMedia = await createNativeMediaPreview({
        nativeUploads,
        tenant: { tenantId: company.id, slug: tenantSlug, hostnames: ['127.0.0.1', 'localhost'] },
        database,
        coordinator,
        verifyBearer: verify,
      });
    if (nativeFloorPlan)
      nativeFloor = await createNativeFloorPlanPreview({
        nativeFloorPlan,
        publicationMode: floorPlanPublicationMode,
        tenantId: company.id,
        database,
        mediaPool: pools.media,
      });
    let origin;
    let allowedHosts = new Set();
    const guard = (request) => {
      const url = new URL(request.url),
        requestOrigin = request.headers.get('origin');
      if (!allowedHosts.has(url.host) || !allowedHosts.has(request.headers.get('host') ?? ''))
        return failure(404, 'NOT_FOUND', 'Staff preview host is unavailable.');
      if (requestOrigin !== null && requestOrigin !== origin)
        return failure(403, 'FORBIDDEN', 'Staff preview origin is unavailable.');
      if (request.headers.has('cookie'))
        return failure(400, 'INVALID_INPUT', 'Staff preview does not accept cookie credentials.');
      const reviewQueue = url.pathname === '/v2/staff/reviews';
      const nativeCatalogue = !!nativeMedia && url.pathname === '/v2/properties';
      const enquiryQueue =
        enquiryPreview &&
        (/^\/v2\/staff\/enquiries\/[0-9a-f-]{36}\/contacts$/i.test(url.pathname) ||
          /^\/v2\/staff\/enquiries\/[0-9a-f-]{36}\/activity$/i.test(url.pathname) ||
          (enquiryCatalogue &&
            /^\/v2\/staff\/enquiries\/[0-9a-f-]{36}\/viewings(?:\/[0-9a-f-]{36}\/history)?$/i.test(
              url.pathname,
            )) ||
          url.pathname === '/v2/staff/enquiries' ||
          url.pathname === '/v2/staff/enquiry-assignees' ||
          (enquiryCatalogue && url.pathname === '/v2/properties'));
      const catalogueSearch =
        (referencePublicMode && url.pathname === '/v3/properties/search') ||
        (enquiryCatalogue && url.pathname === '/v2/properties/search');
      const enquirySearch = enquiryPreview && url.pathname === '/v3/staff/enquiries';
      const calendarRead = url.pathname === '/v2/staff/viewings/calendar';
      if (calendarRead) {
        try {
          viewingCalendarRequest(request);
        } catch {
          return failure(400, 'INVALID_INPUT', 'Use one supported calendar date window.');
        }
      }
      if (enquirySearch) {
        try {
          staffEnquiryQueueQuery(url.searchParams);
        } catch {
          return failure(400, 'INVALID_INPUT', 'Use supported enquiry queue filters.');
        }
      }
      if (catalogueSearch) {
        try {
          publicSearchQuery(url.searchParams, url.pathname.startsWith('/v3/'));
        } catch {
          return failure(400, 'INVALID_INPUT', 'Use supported public search filters.');
        }
      }
      if (
        url.search &&
        !nativeCatalogue &&
        !catalogueSearch &&
        !enquirySearch &&
        !calendarRead &&
        !(
          /^\/v2\/staff\/listings\/[0-9a-f-]{36}\/verification-history$/.test(url.pathname) &&
          /^\?limit=[1-9]\d?(?:&beforeVersion=[1-9]\d{0,15})?$/.test(url.search)
        ) &&
        !(
          /^\/v2\/staff\/listings\/[0-9a-f-]{36}\/duplicate-candidates$/.test(url.pathname) &&
          /^\?listingVersion=[1-9]\d{0,15}&revision=[1-9]\d{0,9}&revisionVersion=[1-9]\d{0,15}&limit=[1-9]\d?$/.test(
            url.search,
          )
        ) &&
        !(
          staffInvitationMode &&
          ['/v2/staff/branches', '/v2/staff/invitation-requests'].includes(url.pathname)
        ) &&
        !(staffMembershipMode && url.pathname === '/v2/staff/memberships') &&
        !(publicReportMode && url.pathname === '/v2/staff/listing-reports') &&
        (!(
          url.pathname === '/v2/staff/listings' ||
          reviewQueue ||
          enquiryQueue ||
          (referencePublicMode && url.pathname === '/v3/properties')
        ) ||
          [...url.searchParams.keys()].some((key) => key !== 'limit') ||
          url.searchParams.getAll('limit').length > 1)
      )
        return failure(
          400,
          'INVALID_INPUT',
          'Staff preview does not accept query-selected context.',
        );
      return undefined;
    };
    apiServer = createDevelopmentServer(
      async (request) => {
        const denied = guard(request);
        if (denied) return denied;
        if (/^\/v2\/staff\/capture-originals\/[^/]+$/.test(new URL(request.url).pathname))
          return service(request);
        if (
          /^\/v2\/staff\/private-operations\/(settings|report)\/[^/]+\/resolve$/.test(
            new URL(request.url).pathname,
          )
        )
          return service(request);
        if (
          floorPlanPublicationMode &&
          /^(?:\/v3\/properties\/[^/]+\/revisions\/[^/]+|\/v2\/staff\/reviews\/[^/]+\/[^/]+)\/floor-plan/.test(
            new URL(request.url).pathname,
          )
        )
          return service(request);
        if (
          nativeFloor &&
          /^\/v2\/staff\/listings\/[^/]+\/floor-plan-/.test(new URL(request.url).pathname)
        ) {
          const response = await service(request);
          if (floorAttachFault && request.method === 'POST' && response.status === 200) {
            floorAttachFault = false;
            return Response.json(
              { syntheticReplyCorruption: true },
              { headers: { 'Cache-Control': 'no-store' } },
            );
          }
          return response;
        }
        if (
          listingVideoMode &&
          /^\/v2\/staff\/listings\/[^/]+\/video-/.test(new URL(request.url).pathname)
        ) {
          const response = await service(request);
          if (videoReplyPending && request.method === 'POST' && response.status === 200) {
            videoReplyPending = false;
            return Response.json(
              { syntheticReplyCorruption: true },
              { headers: { 'Cache-Control': 'no-store' } },
            );
          }
          return response;
        }
        const videoReadPath = new URL(request.url).pathname;
        if (
          listingVideoPublicationMode &&
          (/^\/v3\/properties\/[^/]+\/revisions\/[^/]+\/video/.test(videoReadPath) ||
            /^\/v2\/staff\/reviews\/[^/]+\/[^/]+\/video/.test(videoReadPath))
        )
          return service(request);
        const url = new URL(request.url),
          reviewQueue = url.pathname === '/v2/staff/reviews';
        if (
          url.pathname === '/v2/public/company-settings' ||
          /^\/v2\/staff\/company-settings(?:\/operations\/[0-9a-f-]{36})?$/.test(url.pathname)
        ) {
          const response = await service(request);
          response.headers.set('X-Synthetic-Staff-Preview', 'true');
          if (settingsReplyFaultPending && request.method === 'POST' && response.status === 200) {
            settingsReplyFaultPending = false;
            return Response.json(
              { syntheticReplyCorruption: true },
              { headers: { 'Cache-Control': 'no-store', 'X-Synthetic-Staff-Preview': 'true' } },
            );
          }
          return response;
        }
        if (nativeMedia && url.pathname === '/v2/properties') {
          if (request.method !== 'GET' || request.headers.has('authorization'))
            return failure(403, 'FORBIDDEN', 'Synthetic public catalogue is guest read-only.');
          const response = await service(request);
          response.headers.set('X-Synthetic-Staff-Preview', 'true');
          return response;
        }
        if (url.pathname === '/health' && request.method === 'GET')
          return json(200, {
            status: 'synthetic-staff-preview',
            synthetic: true,
            persistentStorage: false,
            authentication: 'ephemeral-local-RS256',
            productionReady: false,
            tenantSlug,
            historicalSyntheticViewings: !!historicalViewings,
            syntheticReminderCapture: !!reminderCaptureMode,
            syntheticReferenceDrafts: !!referenceDraftMode,
            syntheticReferenceModeration: !!referenceModerationMode,
            syntheticReferenceCreation: !!referenceCreationMode,
            syntheticReferenceSuccessor: !!referenceSuccessorMode,
            syntheticPublicReferences: !!referencePublicMode,
            acceptedMediaMetadataOnly: seedAcceptedMedia,
            successorHistoricalMetadataOnly: !!successorTerminalFixture,
            nativeUploads: !!nativeMedia,
            privateMediaPreviews: !!nativeMedia,
            retainedSyntheticMedia: !!nativeMedia,
            tokenExpiresAt: expiresAt,
          });
        if (staffMembershipMode && /^\/v2\/staff\/memberships(?:\/|$)/.test(url.pathname)) {
          const response = await service(request);
          if (membershipReplyFaultPending && request.method === 'POST' && response.status === 200) {
            membershipReplyFaultPending = false;
            return Response.json(
              { syntheticMembershipReplyCorruption: true },
              {
                status: 200,
                headers: { 'Cache-Control': 'no-store', 'X-Synthetic-Staff-Preview': 'true' },
              },
            );
          }
          return response;
        }
        if (
          (staffInvitationRedemptionMode &&
            url.pathname.startsWith('/v2/staff/invitation-recipient-session')) ||
          url.pathname.startsWith('/v2/staff/invitation-recipient-lease')
        )
          return service(request);
        if (
          staffInvitationRedemptionMode &&
          url.pathname.startsWith('/v2/staff/invitation-redemptions/')
        ) {
          const response = await service(request);
          if (
            invitationRedemptionFaultPending &&
            request.method === 'POST' &&
            response.status === 200
          ) {
            invitationRedemptionFaultPending = false;
            await response.body?.cancel();
            return Response.json(
              { syntheticRedemptionReplyCorruption: true },
              { status: 200, headers: { 'Cache-Control': 'no-store' } },
            );
          }
          return response;
        }
        if (
          staffInvitationRedemptionMode &&
          url.pathname.startsWith('/v2/staff/invitation-issues/')
        ) {
          const response = await service(request);
          if (invitationIssueFaultPending && request.method === 'POST' && response.status === 200) {
            invitationIssueFaultPending = false;
            await response.body?.cancel();
            return Response.json(
              { syntheticIssueReplyCorruption: true },
              { status: 200, headers: { 'Cache-Control': 'no-store' } },
            );
          }
          return response;
        }
        if (
          staffInvitationMode &&
          (url.pathname === '/v2/staff/branches' ||
            url.pathname.startsWith('/v2/staff/branches/') ||
            /^\/v2\/staff\/invitation-requests(?:\/|$)/.test(url.pathname))
        ) {
          const response = await service(request);
          if (
            branchReplyFaultPending &&
            request.method === 'POST' &&
            url.pathname.startsWith('/v2/staff/branches/operations/') &&
            response.status === 200
          ) {
            branchReplyFaultPending = false;
            return Response.json(
              { syntheticBranchReplyCorruption: true },
              {
                status: 200,
                headers: { 'Cache-Control': 'no-store', 'X-Synthetic-Staff-Preview': 'true' },
              },
            );
          }
          const capture = url.pathname.includes('/operations/');
          if (
            request.method === 'POST' &&
            ((capture && invitationCaptureFaultPending && response.status === 202) ||
              (!capture && invitationRevokeFaultPending && response.status === 200))
          ) {
            if (capture) invitationCaptureFaultPending = false;
            else invitationRevokeFaultPending = false;
            return Response.json(
              { syntheticInvitationReplyCorruption: true },
              {
                status: response.status,
                headers: { 'Cache-Control': 'no-store', 'X-Synthetic-Staff-Preview': 'true' },
              },
            );
          }
          return response;
        }
        if (
          publicReportMode &&
          (/^\/v2\/public\/listings\/[0-9a-f-]+\/reports\/[0-9a-f-]+$/.test(url.pathname) ||
            /^\/v2\/staff\/listing-reports(?:\/[0-9a-f-]+\/operations\/[0-9a-f-]+)?$/.test(
              url.pathname,
            ))
        ) {
          const response = await service(request);
          const capture = url.pathname.startsWith('/v2/public/listings/');
          if (
            request.method === 'POST' &&
            ((capture && reportCaptureFaultPending && response.status === 202) ||
              (!capture && reportDecisionFaultPending && response.status === 200))
          ) {
            if (capture) reportCaptureFaultPending = false;
            else reportDecisionFaultPending = false;
            return Response.json(
              { syntheticReportReplyCorruption: true },
              {
                status: response.status,
                headers: { 'Cache-Control': 'no-store', 'X-Synthetic-Staff-Preview': 'true' },
              },
            );
          }
          return response;
        }
        if (
          referencePublicMode &&
          (url.pathname === '/v3/properties' ||
            url.pathname === '/v3/properties/search' ||
            url.pathname === '/v3/property-reference-options')
        ) {
          const response = await service(request);
          response.headers.set('X-Synthetic-Staff-Preview', 'true');
          return response;
        }
        const referenceSuccessorRoute =
          referenceSuccessorMode &&
          /^\/v3\/staff\/listings\/[0-9a-f-]{36}\/reference-successor-operations\/[0-9a-f-]{36}$/.test(
            url.pathname,
          );
        if (referenceSuccessorRoute && !['GET', 'POST'].includes(request.method))
          return failure(405, 'METHOD_NOT_ALLOWED', 'Successor accepts POST or original GET.', {
            Allow: 'GET, POST',
          });
        const referenceCreationRoute =
          referenceCreationMode &&
          /^\/v3\/staff\/listings\/[0-9a-f-]{36}\/reference-creation-operations\/[0-9a-f-]{36}$/.test(
            url.pathname,
          );
        if (referenceCreationRoute && !['GET', 'POST'].includes(request.method))
          return failure(405, 'METHOD_NOT_ALLOWED', 'Creation accepts POST or original GET.', {
            Allow: 'GET, POST',
          });
        if (
          referenceDraftMode &&
          (url.pathname === '/v3/staff/reference-session' ||
            /^\/v3\/staff\/listings\/[0-9a-f-]{36}\/revision-protocol\/[1-9]\d{0,9}$/.test(
              url.pathname,
            ) ||
            referenceCreationRoute ||
            referenceSuccessorRoute ||
            /^\/v3\/staff\/reference-catalogues\/(current|[1-9]\d{0,15})$/.test(url.pathname) ||
            (referenceModerationMode &&
              /^\/v3\/staff\/(?:listings|reviews)\/[0-9a-f-]{36}\/(?:reference-transition-operations\/[0-9a-f-]{36}|reference-revisions\/[1-9]\d{0,9}\/[1-9]\d{0,15}(?:\/context)?)$/.test(
                url.pathname,
              )) ||
            /^\/v3\/staff\/listings\/[0-9a-f-]{36}\/reference-draft-operations\/[0-9a-f-]{36}$/.test(
              url.pathname,
            ))
        ) {
          const response = await service(request);
          response.headers.set('X-Synthetic-Staff-Preview', 'true');
          const draftFault =
            referenceReplyFaultPending && url.pathname.includes('/reference-draft-operations/');
          const moderationFault =
            referenceModerationReplyFaultPending &&
            url.pathname.includes('/reference-transition-operations/');
          const successorFault = referenceSuccessorReplyFaultPending && referenceSuccessorRoute;
          const creationFault = referenceCreationReplyFaultPending && referenceCreationRoute;
          if (
            (draftFault || moderationFault || creationFault || successorFault) &&
            request.method === 'POST' &&
            response.status === 200
          ) {
            if (draftFault) referenceReplyFaultPending = false;
            if (moderationFault) referenceModerationReplyFaultPending = false;
            if (successorFault) referenceSuccessorReplyFaultPending = false;
            if (creationFault) referenceCreationReplyFaultPending = false;
            return Response.json(
              { syntheticReplyCorruption: true },
              {
                status: 200,
                headers: {
                  'Cache-Control': 'private, no-store',
                  'X-Synthetic-Staff-Preview': 'true',
                },
              },
            );
          }
          return response;
        }
        if (
          url.pathname === '/v2/staff/operations/overview' ||
          url.pathname === '/v2/staff/viewings/calendar' ||
          url.pathname === '/v2/staff/listings' ||
          /^\/v2\/staff\/listings\/[0-9a-f-]{36}$/i.test(url.pathname)
        ) {
          if (request.method !== 'GET')
            return failure(405, 'METHOD_NOT_ALLOWED', 'Listing queue is read-only.', {
              Allow: 'GET',
            });
          const response = await service(request);
          response.headers.set('X-Synthetic-Staff-Preview', 'true');
          return response;
        }
        if (/^\/v2\/staff\/listings\/[0-9a-f-]{36}\/duplicate-candidates$/.test(url.pathname)) {
          const response = await service(request);
          response.headers.set('X-Synthetic-Staff-Preview', 'true');
          return response;
        }
        if (
          /^\/v2\/staff\/listings\/[0-9a-f-]{36}\/verification-(?:operations\/[0-9a-f-]{36}|history)$/.test(
            url.pathname,
          )
        ) {
          const response = await service(request);
          response.headers.set('X-Synthetic-Staff-Preview', 'true');
          return response;
        }
        if (
          url.pathname === '/v2/staff/session' ||
          url.pathname === '/v2/staff/session-lease' ||
          url.pathname === '/v2/staff/listing-import-preview'
        ) {
          const response = await service(request);
          response.headers.set('X-Synthetic-Staff-Preview', 'true');
          return response;
        }
        if (
          /^\/v2\/staff\/listings\/[0-9a-f-]{36}\/creation-operations\/[0-9a-f-]{36}$/i.test(
            url.pathname,
          )
        ) {
          if (!['GET', 'POST'].includes(request.method))
            return failure(
              405,
              'METHOD_NOT_ALLOWED',
              'Creation supports POST and original GET only.',
              { Allow: 'GET, POST' },
            );
          const response = await service(request);
          response.headers.set('X-Synthetic-Staff-Preview', 'true');
          if (
            creationReplyFaultPending &&
            request.method === 'POST' &&
            response.status === 200 &&
            (await response.clone().json()).outcome === 'created'
          ) {
            creationReplyFaultPending = false;
            return Response.json(
              { syntheticReplyCorruption: true },
              {
                status: 200,
                headers: { 'Cache-Control': 'no-store', 'X-Synthetic-Staff-Preview': 'true' },
              },
            );
          }
          return response;
        }
        if (
          /^\/v2\/staff\/listings\/[0-9a-f-]{36}\/revision-operations\/[0-9a-f-]{36}$/i.test(
            url.pathname,
          )
        ) {
          if (!['GET', 'POST'].includes(request.method))
            return failure(
              405,
              'METHOD_NOT_ALLOWED',
              'Successor supports POST and original GET only.',
              { Allow: 'GET, POST' },
            );
          const response = await service(request);
          response.headers.set('X-Synthetic-Staff-Preview', 'true');
          if (
            successorReplyFaultPending &&
            request.method === 'POST' &&
            response.status === 200 &&
            (await response.clone().json()).decision?.outcome === 'applied'
          ) {
            successorReplyFaultPending = false;
            return Response.json(
              { syntheticReplyCorruption: true },
              {
                headers: { 'Cache-Control': 'no-store', 'X-Synthetic-Staff-Preview': 'true' },
              },
            );
          }
          return response;
        }
        if (
          /^\/v2\/staff\/listings\/[0-9a-f-]{36}\/(?:availability|publication)-operations\/[0-9a-f-]{36}$/i.test(
            url.pathname,
          )
        ) {
          if (!['GET', 'POST'].includes(request.method))
            return failure(
              405,
              'METHOD_NOT_ALLOWED',
              'Listing controls support POST and original GET only.',
              { Allow: 'GET, POST' },
            );
          const response = await service(request);
          response.headers.set('X-Synthetic-Staff-Preview', 'true');
          if (
            controlReplyFaultPending &&
            request.method === 'POST' &&
            response.status === 200 &&
            (await response.clone().json()).decision?.outcome === 'applied'
          ) {
            controlReplyFaultPending = false;
            return Response.json(
              { syntheticReplyCorruption: true },
              { headers: { 'Cache-Control': 'no-store', 'X-Synthetic-Staff-Preview': 'true' } },
            );
          }
          return response;
        }
        if (
          enquiryPreview &&
          (journeyFixture !== 'web-admin-pilot-v1' ||
            !/^\/v2\/staff\/(?:listings|reviews)(?:\/|$)/.test(url.pathname))
        ) {
          if (
            enquiryCatalogue &&
            (url.pathname === '/v2/properties' || url.pathname === '/v2/properties/search')
          ) {
            if (request.method !== 'GET' || request.headers.has('authorization'))
              return failure(403, 'FORBIDDEN', 'Synthetic public catalogue is guest read-only.');
            const response = await service(request);
            response.headers.set('X-Synthetic-Staff-Preview', 'true');
            return response;
          }
          if (url.pathname === '/v1/enquiries') {
            if (request.method !== 'POST')
              return failure(405, 'METHOD_NOT_ALLOWED', 'Guest intake accepts POST only.', {
                Allow: 'POST',
              });
            if (request.headers.has('authorization'))
              return failure(403, 'FORBIDDEN', 'Guest intake does not accept staff identity.');
            const response = await service(request);
            response.headers.set('X-Synthetic-Staff-Preview', 'true');
            return response;
          }
          const capture = url.pathname === '/v2/staff/enquiry-captures';
          const contacts =
            /^\/v2\/staff\/enquiries\/[0-9a-f-]{36}\/contacts(?:\/operations\/[0-9a-f-]{36})?$/i.test(
              url.pathname,
            );
          const activity = /^\/v2\/staff\/enquiries\/[0-9a-f-]{36}\/activity$/i.test(url.pathname);
          const viewings =
            enquiryCatalogue &&
            /^\/v2\/staff\/enquiries\/[0-9a-f-]{36}\/(?:viewings(?:\/[0-9a-f-]{36}(?:\/(?:proposals|confirmations|cancellations|declines|reschedules|completions|no-shows|history))?)?|viewing-operations\/[0-9a-f-]{36})$/i.test(
              url.pathname,
            );
          const reminder =
            reminderCaptureMode &&
            /^\/v2\/staff\/enquiries\/[0-9a-f-]{36}\/(?:viewings\/[0-9a-f-]{36}\/reminder-admissions|viewing-reminder-admissions\/[0-9a-f-]{36}(?:\/captures|\/capture-operations\/[0-9a-f-]{36})?)$/i.test(
              url.pathname,
            );
          const queue =
            url.pathname === '/v2/staff/operations/overview' ||
            url.pathname === '/v2/staff/viewings/calendar' ||
            url.pathname === '/v3/staff/enquiries' ||
            url.pathname === '/v2/staff/enquiries' ||
            url.pathname === '/v2/staff/enquiry-assignees';
          const enquiryRoute =
            /^\/v2\/staff\/enquiries\/[0-9a-f-]{36}(?:\/(operations)(?:\/([0-9a-f-]{36}))?)?$/i.exec(
              url.pathname,
            );
          if (
            !reminder &&
            !viewings &&
            !contacts &&
            !activity &&
            !capture &&
            !queue &&
            !enquiryRoute
          )
            return failure(404, 'NOT_FOUND', 'Enquiry preview route is unavailable.');
          const allowedMethod = capture || (enquiryRoute?.[1] && !enquiryRoute[2]) ? 'POST' : 'GET';
          if (reminder) {
            const method = /\/(?:captures|reminder-admissions)$/.test(url.pathname)
              ? 'POST'
              : 'GET';
            if (request.method !== method)
              return failure(
                405,
                'METHOD_NOT_ALLOWED',
                'Method is unavailable for synthetic reminder capture.',
                { Allow: method },
              );
          } else if (contacts) {
            const list = !url.pathname.includes('/operations/');
            if (request.method !== 'GET' && !(list && request.method === 'POST'))
              return failure(
                405,
                'METHOD_NOT_ALLOWED',
                'Method is unavailable for contact logging.',
                { Allow: list ? 'GET, POST' : 'GET' },
              );
          } else if (viewings) {
            const collection = /\/viewings$/.test(url.pathname),
              propose =
                /\/(?:proposals|confirmations|cancellations|declines|reschedules|completions|no-shows)$/.test(
                  url.pathname,
                ),
              methods = collection ? ['GET', 'POST'] : propose ? ['POST'] : ['GET'];
            if (!methods.includes(request.method))
              return failure(
                405,
                'METHOD_NOT_ALLOWED',
                'Method is unavailable for viewing scheduling.',
                { Allow: methods.join(', ') },
              );
          } else if (request.method !== allowedMethod)
            return failure(
              405,
              'METHOD_NOT_ALLOWED',
              'Method is unavailable for the enquiry fixture.',
              { Allow: allowedMethod },
            );
          if (
            request.method === 'POST' &&
            !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
              request.headers.get('content-type') ?? '',
            )
          )
            return failure(415, 'JSON_REQUIRED', 'Use application/json.');
          const response = await service(request);
          response.headers.set('X-Synthetic-Staff-Preview', 'true');
          if (
            reminderReplyFaultPending &&
            reminder &&
            request.method === 'POST' &&
            url.pathname.endsWith('/captures') &&
            response.status === 200 &&
            (await response.clone().json()).outcome === 'captured'
          ) {
            reminderReplyFaultPending = false;
            return Response.json(
              { syntheticReplyCorruption: true },
              {
                status: 200,
                headers: { 'Cache-Control': 'no-store', 'X-Synthetic-Staff-Preview': 'true' },
              },
            );
          }
          // Process-only, disposable fixture: commit normally, then lose valid receipt facts once.
          // Denials/conflicts/reads never consume the fault, and original GET/replay stays intact.
          if (
            contactReplyFaultPending &&
            contacts &&
            request.method === 'POST' &&
            response.status === 200 &&
            (await response.clone().json()).outcome === 'applied'
          ) {
            contactReplyFaultPending = false;
            return Response.json(
              { syntheticReplyCorruption: true },
              {
                status: 200,
                headers: { 'Cache-Control': 'no-store', 'X-Synthetic-Staff-Preview': 'true' },
              },
            );
          }
          if (
            viewingReplyFaultPending &&
            (viewingReplyFault !== 'invalid-first-outcome-v1' ||
              /\/(completions|no-shows)$/.test(url.pathname)) &&
            viewings &&
            request.method === 'POST' &&
            (viewingReplyFault !== 'invalid-first-confirmation-v1' ||
              url.pathname.endsWith('/confirmations')) &&
            (viewingReplyFault !== 'invalid-first-termination-v1' ||
              /\/(cancellations|declines)$/.test(url.pathname)) &&
            (viewingReplyFault !== 'invalid-first-reschedule-v1' ||
              url.pathname.endsWith('/reschedules')) &&
            response.status === 200 &&
            (await response.clone().json()).outcome === 'applied'
          ) {
            viewingReplyFaultPending = false;
            return Response.json(
              { syntheticReplyCorruption: true },
              {
                status: 200,
                headers: { 'Cache-Control': 'no-store', 'X-Synthetic-Staff-Preview': 'true' },
              },
            );
          }
          return response;
        }
        const finalizeRoute =
          nativeMedia &&
          /^\/v2\/staff\/listings\/[0-9a-f-]{36}\/revisions\/[1-9]\d{0,9}\/media-attach-intents\/[0-9a-f-]{36}\/finalize$/i.test(
            url.pathname,
          );
        if (finalizeRoute) {
          const response = await nativeMedia.handleFinalize(request);
          response.headers.set('X-Synthetic-Staff-Preview', 'true');
          return response;
        }
        if (
          /^\/v2\/staff\/reviews\/[0-9a-f-]{36}\/revisions\/[1-9]\d{0,9}\/media-gallery$/i.test(
            url.pathname,
          )
        ) {
          const response = await service(request);
          response.headers.set('X-Synthetic-Staff-Preview', 'true');
          return response;
        }
        const route =
          /^\/v2\/staff\/listings\/[0-9a-f-]{36}\/drafts\/[1-9]\d{0,9}(\/submit)?$/i.exec(
            url.pathname,
          );
        const reviewRoute =
          /^\/v2\/staff\/reviews\/[0-9a-f-]{36}\/revisions\/[1-9]\d{0,9}(\/decision)?$/i.exec(
            url.pathname,
          );
        const mediaRoute =
          /^\/v2\/staff\/listings\/[0-9a-f-]{36}\/revisions\/[1-9]\d{0,9}\/(media-registrations|media-jobs)(?:\/([0-9a-f-]{36}))?$/i.exec(
            url.pathname,
          );
        const galleryRoute =
          /^\/v2\/staff\/listings\/[0-9a-f-]{36}\/revisions\/[1-9]\d{0,9}\/(workspace|media-removals|media-reorders|media-operations)(?:\/([0-9a-f-]{36}))?$/i.exec(
            url.pathname,
          );
        const attachRoute = nativeMedia
          ? /^\/v2\/staff\/listings\/[0-9a-f-]{36}\/revisions\/[1-9]\d{0,9}\/media-attach-intents(?:\/([0-9a-f-]{36}))?$/i.exec(
              url.pathname,
            )
          : null;
        if (!route && !reviewRoute && !reviewQueue && !mediaRoute && !galleryRoute && !attachRoute)
          return failure(404, 'NOT_FOUND', 'Staff preview route is unavailable.');
        if (mediaRoute && mediaRoute[1] === 'media-jobs' && !mediaRoute[2])
          return failure(404, 'NOT_FOUND', 'Staff preview route is unavailable.');
        if (galleryRoute && (galleryRoute[1] === 'media-operations') !== !!galleryRoute[2])
          return failure(404, 'NOT_FOUND', 'Staff preview route is unavailable.');
        const allowedMethods = attachRoute
          ? attachRoute[1]
            ? ['GET']
            : ['POST']
          : galleryRoute
            ? ['workspace', 'media-operations'].includes(galleryRoute[1])
              ? ['GET']
              : ['POST']
            : mediaRoute
              ? mediaRoute[2]
                ? ['GET']
                : ['POST']
              : reviewQueue
                ? ['GET']
                : reviewRoute
                  ? reviewRoute[1]
                    ? ['POST']
                    : ['GET']
                  : route[1]
                    ? ['POST']
                    : ['GET', 'PUT'];
        if (!allowedMethods.includes(request.method))
          return failure(
            405,
            'METHOD_NOT_ALLOWED',
            'Method is unavailable for the staff fixture.',
            { Allow: allowedMethods.join(', ') },
          );
        if (
          request.method !== 'GET' &&
          !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
            request.headers.get('content-type') ?? '',
          )
        )
          return failure(415, 'JSON_REQUIRED', 'Use application/json.');
        const response = await service(request);
        response.headers.set('X-Synthetic-Staff-Preview', 'true');
        return response;
      },
      new WeakMap(),
      nativeMedia
        ? async (request, source) => {
            const denied = guard(request);
            if (denied) return denied;
            const url = new URL(request.url);
            if (
              !/^\/v2\/staff\/listings\/[0-9a-f-]{36}\/revisions\/[1-9]\d{0,9}\/media-jobs\/[0-9a-f-]{36}\/uploads\/[0-9a-f-]{36}$/i.test(
                url.pathname,
              )
            )
              return failure(404, 'NOT_FOUND', 'Staff preview upload route is unavailable.');
            const response = await nativeMedia.handleUpload(request, source);
            response.headers.set('X-Synthetic-Staff-Preview', 'true');
            return response;
          }
        : undefined,
      nativeMedia
        ? async (request) => {
            const denied = guard(request);
            if (denied) return denied;
            const response = await nativeMedia.handlePreview(request);
            response.headers.set('X-Synthetic-Staff-Preview', 'true');
            return response;
          }
        : undefined,
      nativeFloor
        ? async (request, source) => {
            const denied = guard(request);
            if (denied) return denied;
            const response = await service(request, source);
            if (floorUploadFault && request.method === 'PUT' && response.status === 200) {
              floorUploadFault = false;
              return Response.json(
                { syntheticReplyCorruption: true },
                { headers: { 'Cache-Control': 'no-store' } },
              );
            }
            return response;
          }
        : undefined,
    );
    origin = await listen(apiServer, port);
    allowedHosts = new Set([new URL(origin).host, `localhost:${new URL(origin).port}`]);
    let closing;
    const close = () =>
      (closing ??= (async () => {
        try {
          await Promise.all([
            closeServer(apiServer),
            closeServer(jwksServer),
            nativeMedia?.close(),
            nativeFloor?.close(),
          ]);
        } finally {
          try {
            await nativeMedia?.close();
            await nativeFloor?.close();
            await coordinator?.close();
          } finally {
            await database.close();
          }
        }
      })());
    const preview = {
      origin,
      listingId: company.listing,
      revision: 1,
      tenantSlug,
      expiresAt,
      acceptedMediaMetadataOnly: seedAcceptedMedia,
      successorHistoricalMetadataOnly: !!successorTerminalFixture,
      enquiryCatalogueMetadataOnly: !!enquiryCatalogue,
      pendingReviewFixtures: seedPendingReviews,
      syntheticReferenceDrafts: !!referenceDraftMode,
      syntheticReferenceModeration: !!referenceModerationMode,
      syntheticReferenceCreation: !!referenceCreationMode,
      syntheticReferenceSuccessor: !!referenceSuccessorMode,
      syntheticPublicReferences: !!referencePublicMode,
      ...(journeyManifest ? { journeyFixture: journeyManifest } : {}),
      ...(referencePublicMode
        ? { referencePublicListingId: id(Number(company.listing.slice(-3)) + 10) }
        : {}),
      ...(referenceModerationMode && !floorPlanReferenceJourney
        ? { referenceReviewVersion: referenceSuccessorMode ? '5' : '4' }
        : {}),
      nativeUploads: !!nativeMedia,
      nativeFloorPlan: !!nativeFloor,
      syntheticFloorPlanPublication: !!floorPlanPublicationMode,
      syntheticFloorPlanReferenceJourney: !!floorPlanReferenceJourney,
      close,
    };
    if (pools.auditInspection) {
      Object.defineProperty(preview, 'readViewingAudit', {
        value: async (viewingId) => {
          const connection = await pools.auditInspection.connect();
          try {
            return (
              await connection.query(
                "SELECT tenant_id, actor_id, action, object_type, object_id, object_version::text, correlation_id, summary FROM app_private.audit_events WHERE object_type='viewing' AND object_id=$1 ORDER BY id",
                [viewingId],
              )
            ).rows;
          } finally {
            connection.release();
          }
        },
      });
    }
    // Avoid incidental console/JSON dumps of a whole return object exposing its token.
    Object.defineProperty(preview, 'bearerToken', {
      value: bearerToken,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    if (nativeFloorPlan) {
      const entry = (actorId, token) =>
        Object.freeze(
          Object.defineProperty({ actorId }, 'bearerToken', { value: token, enumerable: false }),
        );
      Object.defineProperty(preview, 'floorPlanStaff', {
        value: Object.freeze({
          agent: entry(
            company.agent,
            actorId === company.agent ? bearerToken : await issueToken(company.agent),
          ),
          admin: entry(
            company.admin,
            actorId === company.admin ? bearerToken : await issueToken(company.admin),
          ),
          customer: entry(company.customer, await issueToken(company.customer)),
        }),
        enumerable: false,
      });
    }
    if (invitationRecipient)
      Object.defineProperty(preview, 'invitationRecipient', {
        value: invitationRecipient,
        enumerable: false,
      });
    if (enquiryStaff) {
      Object.defineProperty(preview, 'enquiryStaff', {
        value: enquiryStaff,
        enumerable: false,
        writable: false,
        configurable: false,
      });
      Object.defineProperty(preview, 'enquiryFixtures', {
        value: ENQUIRY_PREVIEW_FIXTURES[tenantSlug],
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(preview);
  } catch (error) {
    try {
      await Promise.all([
        closeServer(apiServer),
        closeServer(jwksServer),
        nativeMedia?.close(),
        nativeFloor?.close(),
      ]);
    } finally {
      try {
        await coordinator?.close();
      } finally {
        if (database) await database.close();
        else await db.close();
      }
    }
    throw error;
  }
}
