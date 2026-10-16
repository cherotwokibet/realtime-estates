import type { ReviewDetailV2 } from '@realtor/api-client';

export type ReviewIntent = { decision: 'approve' | 'reject'; reason: string | null };
export function reviewRejectionReason(value: string): string {
  const reason = value.trim();
  if (
    !reason ||
    Array.from(reason).length > 1000 ||
    /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(reason)
  )
    throw new Error(
      'Use a nonblank rejection reason of at most 1,000 Unicode characters, without line breaks or control characters.',
    );
  return reason;
}
/** Compare a saved decision without attributing another administrator's action to this tab. */
export function reviewReadback(
  before: ReviewDetailV2,
  intent: ReviewIntent,
  after: ReviewDetailV2,
): 'matching' | 'different' | 'pending' {
  if (after.listingId !== before.listingId || after.revision !== before.revision)
    throw new Error('Unexpected review.');
  if (after.state === 'pending' || after.state === 'draft') return 'pending';
  return after.state === (intent.decision === 'approve' ? 'approved' : 'rejected') &&
    after.decisionReason === intent.reason &&
    BigInt(after.version) > BigInt(before.version)
    ? 'matching'
    : 'different';
}
export function knownPublication(
  review: Pick<
    ReviewDetailV2,
    | 'state'
    | 'revision'
    | 'publishedRevision'
    | 'publicationStatus'
    | 'availability'
    | 'lastAvailabilityConfirmedAt'
  >,
): string {
  if (review.state !== 'approved') return 'This review has not approved the revision.';
  if (review.publishedRevision !== review.revision)
    return 'A different approved revision is selected for publication.';
  if (review.publicationStatus !== 'published')
    return `Approved snapshot retained. Publication is ${review.publicationStatus}.`;
  if (review.availability !== 'available')
    return `Approved snapshot retained. Availability is ${review.availability}.`;
  return 'Approved snapshot selected for publication. Public visibility also requires current availability and the public catalogue rules.';
}
