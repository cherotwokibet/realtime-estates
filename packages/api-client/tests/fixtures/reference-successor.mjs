import {
  syntheticReferenceSuccessorDraftCommand,
  snapshotListingReferenceAttributes,
} from '@realtor/domain';
import { command as creation, catalogue, id } from './reference-creation.mjs';
export { catalogue, id };
export const command = (listing = 100, operation = 1000, cat = catalogue(), large = false) => {
  const { slug: _slug, ...base } = creation(listing, operation, cat, large);
  return {
    ...base,
    policy: 'synthetic-reference-successor-v1',
    expectedListingVersion: '1',
    predecessor: { revision: 1, version: '4', state: 'rejected' },
  };
};
export const receipt = (c = command(), cat = catalogue(), actor = id(10)) => ({
  policy: c.policy,
  successor: {
    operationId: c.operationId,
    listingId: c.listingId,
    actorId: actor,
    kind: 'start_revision',
    request: {
      expectedListingVersion: c.expectedListingVersion,
      predecessor: c.predecessor,
      content: c.content,
    },
    decision: {
      outcome: 'applied',
      reason: null,
      result: {
        listingVersion: String(BigInt(c.expectedListingVersion) + 1n),
        revision: c.predecessor.revision + 1,
        revisionVersion: '2',
      },
    },
    completedAt: '2026-10-24T08:00:00.000000Z',
  },
  referenceDraft: {
    ...syntheticReferenceSuccessorDraftCommand(c),
    actorId: actor,
    revisionVersion: '3',
    attributes: snapshotListingReferenceAttributes(c.selection, cat, c.content.propertyType),
  },
});
