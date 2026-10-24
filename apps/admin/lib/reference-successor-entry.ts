import {
  validateStaffListingSummary,
  type StaffListingSummary,
  type ListingReferenceCatalogue,
  type SyntheticReferenceSuccessorCommand,
} from '@realtor/domain';
import {
  referenceSuccessorSession,
  restoreReferenceSuccessorAttempt,
  prepareReferenceSuccessorAttempt,
  buildReferenceSuccessorCommand,
  type ReferenceSuccessorScope,
  type ReferenceSuccessorClient,
} from './reference-successor-workspace.ts';

/** Restoration precedes eligibility: a lost reply can leave the current latest revision a draft. */
export async function openReferenceSuccessorEntry(
  store: Parameters<typeof referenceSuccessorSession>[0],
  scope: ReferenceSuccessorScope,
  listingInput: StaffListingSummary,
  client: ReferenceSuccessorClient,
  signal?: AbortSignal,
) {
  const session = referenceSuccessorSession(store, scope);
  const listing = validateStaffListingSummary(listingInput, session.scope.listingId);
  const restored = await restoreReferenceSuccessorAttempt(client, session, signal);
  const latest = listing.latest;
  const predecessor =
    latest && (latest.state === 'approved' || latest.state === 'rejected')
      ? Object.freeze({ revision: latest.revision, version: latest.version, state: latest.state })
      : null;
  return Object.freeze({
    scope: session.scope,
    session,
    restored,
    eligible: restored === null && predecessor !== null,
    prepare(
      facts: Pick<SyntheticReferenceSuccessorCommand, 'content' | 'selection'>,
      catalogue: ListingReferenceCatalogue,
      newOperationId: () => string,
    ) {
      if (signal?.aborted || restored || !predecessor || session.load() !== null)
        throw Error('Recover the original or reload current listing authority.');
      const command = buildReferenceSuccessorCommand(
        {
          listingId: session.scope.listingId,
          expectedListingVersion: listing.version,
          predecessor,
          content: facts.content,
          selection: facts.selection,
          operationId: newOperationId(),
        },
        catalogue,
      );
      return prepareReferenceSuccessorAttempt(client, session, command, catalogue);
    },
  });
}
