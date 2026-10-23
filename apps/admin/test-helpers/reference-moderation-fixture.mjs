import { normalizeStaffDraftContentV2, snapshotListingReferenceAttributes } from '@realtor/domain';
export const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const scope = () => ({
  instanceId: id(9),
  tenantId: id(1),
  actorId: id(10),
  listingId: id(100),
  revision: 1,
});
export const catalogue = () => ({
  policy: 'synthetic-reference-catalogue-v1',
  version: '1',
  country: 'KE',
  locations: [{ id: id(200), kind: 'county', parentId: null, label: 'Synthetic original county' }],
  amenities: [],
});
export const review = () => ({
  policy: 'synthetic-reference-revision-v1',
  listingId: id(100),
  revision: 1,
  listingVersion: '2',
  revisionVersion: '3',
  state: 'pending',
  availability: 'available',
  availabilityConfirmedAt: '2026-10-23T12:00:00.000Z',
  publicationStatus: 'paused',
  publishedRevision: 1,
  content: normalizeStaffDraftContentV2({
    bedrooms: 1,
    locality: 'Synthetic original county',
    location: { county: 'Synthetic original county', town: null, area: null },
    pricing: { declaration: 'not_declared', charges: [] },
    privateAddress: 'PRIVATE BFF REVIEW',
  }),
  attributes: snapshotListingReferenceAttributes(
    {
      catalogueVersion: '1',
      location: { countyId: id(200), localityId: null, neighbourhoodId: null },
      amenityIds: [],
    },
    catalogue(),
    null,
  ),
  photos: [
    {
      id: id(300),
      position: 0,
      altText: 'Synthetic image',
      sha256: 'a'.repeat(64),
      accepted: true,
      sealed: true,
    },
  ],
});
export const command = () => ({
  policy: 'synthetic-reference-transition-v1',
  operationId: id(400),
  listingId: id(100),
  revision: 1,
  action: 'approve',
  review: review(),
  reason: null,
});
export const receipt = () => ({
  ...command(),
  actorId: id(10),
  revisionVersion: '4',
  state: 'approved',
});
export const path = `/api/staff/listings/${id(100)}/reference-transition-operations/${id(400)}`;
export const readPath = `/api/staff/reviews/${id(100)}/reference-revisions/1/3/1`;
export const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_PREVIEW_REFERENCE: 'synthetic-reference-draft-v1',
  STAFF_PREVIEW_REFERENCE_MODERATION: 'synthetic-reference-transition-v1',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
  STAFF_PREVIEW_TOKEN: 'a.b.c',
  STAFF_PREVIEW_INSTANCE: id(9),
};
export function request(
  route = path,
  {
    method = route.includes('operations') ? 'POST' : 'GET',
    body = JSON.stringify(command()),
    headers = {},
    signal,
  } = {},
) {
  return new Request('http://127.0.0.1:3001' + route, {
    method,
    signal,
    headers: {
      host: '127.0.0.1:3001',
      'x-preview-instance': id(9),
      'x-reference-actor': id(10),
      'x-reference-tenant': id(1),
      ...(method === 'POST'
        ? { origin: 'http://127.0.0.1:3001', 'content-type': 'application/json' }
        : {}),
      ...headers,
    },
    ...(method === 'POST'
      ? { body, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) }
      : {}),
  });
}
