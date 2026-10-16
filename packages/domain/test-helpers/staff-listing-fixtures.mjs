export const staffListingId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export function staffListingFixture(n = 10) {
  return {
    listingId: staffListingId(n),
    slug: `synthetic-listing-${n}`,
    assignedAgentId: staffListingId(2),
    version: '3',
    availability: 'available',
    publicationStatus: 'published',
    publishedRevision: 1,
    changedAt: '2026-01-01T09:00:00.123456Z',
    latest: {
      revision: 2,
      state: 'draft',
      version: '2',
      title: 'Synthetic changed draft',
      updatedAt: '2026-01-01T09:00:00.123456Z',
    },
  };
}
