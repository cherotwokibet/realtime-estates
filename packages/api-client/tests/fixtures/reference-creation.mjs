import {
  normalizeStaffDraftContentV2,
  syntheticReferenceCreationDraftCommand,
  snapshotListingReferenceAttributes,
} from '@realtor/domain';
export const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const catalogue = (version = '1', large = false) => ({
  policy: 'synthetic-reference-catalogue-v1',
  version,
  country: 'KE',
  locations: [{ id: id(200), kind: 'county', parentId: null, label: 'Synthetic original county' }],
  amenities: Array.from({ length: large ? 50 : 1 }, (_, i) => ({
    id: id(210 + i),
    code: 'synthetic-feature-' + i,
    label: large ? '界'.repeat(160) : 'Synthetic original lift',
    propertyTypes: ['apartment'],
  })),
});
export const command = (listing = 100, operation = 1000, cat = catalogue(), large = false) => ({
  policy: 'synthetic-reference-creation-v1',
  operationId: id(operation),
  listingId: id(listing),
  slug: 'synthetic-reference-' + listing,
  content: normalizeStaffDraftContentV2({
    title: large ? '界'.repeat(160) : 'Synthetic created apartment',
    description: large ? '界'.repeat(10000) : 'Independent synthetic creation.',
    propertyType: 'apartment',
    purpose: 'rent',
    currency: 'KES',
    amountMinor: 2000001,
    rentPeriod: 'month',
    bedrooms: 2,
    privateBathrooms: 1,
    sharedBathrooms: null,
    country: 'KE',
    locality: 'Synthetic original county',
    location: { county: 'Synthetic original county', town: null, area: null },
    publicPrecision: 'area',
    latitude: null,
    longitude: null,
    privateAddress: large ? '界'.repeat(1000) : 'PRIVATE-SYNTHETIC-CREATION',
    pricing: {
      declaration: 'complete',
      charges: large
        ? Array.from({ length: 32 }, (_, i) => ({
            id: 'fee-' + i,
            name: '界'.repeat(160),
            amountStatus: 'known',
            amountMinor: 1,
            timing: 'one_off',
            classification: 'fee',
            mandatory: true,
          }))
        : [],
    },
  }),
  selection: {
    catalogueVersion: cat.version,
    location: { countyId: id(200), localityId: null, neighbourhoodId: null },
    amenityIds: cat.amenities.map((a) => a.id),
  },
});
export const receipt = (c = command(), cat = catalogue(), actor = id(10)) => ({
  policy: c.policy,
  creation: {
    operationId: c.operationId,
    listingId: c.listingId,
    actorId: actor,
    kind: 'create_listing',
    request: { slug: c.slug, content: c.content },
    outcome: 'created',
    reason: null,
    result: { listingVersion: '1', revision: 1, revisionVersion: '2' },
    completedAt: '2026-10-24T01:00:00.000000Z',
  },
  referenceDraft: {
    ...syntheticReferenceCreationDraftCommand(c),
    actorId: actor,
    revisionVersion: '3',
    attributes: snapshotListingReferenceAttributes(c.selection, cat, c.content.propertyType),
  },
});
