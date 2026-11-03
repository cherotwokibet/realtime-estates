import { randomUUID } from 'node:crypto';
import { RealtorApiClient } from '@realtor/api-client';
/** Explicit signed setup for an owned disposable fixture. Never logs credentials. */
export async function prepareVideoReview(preview) {
  const api = new RealtorApiClient({
    baseUrl: preview.origin,
    allowLoopbackHttp: true,
    privacyNoticeVersion: 'synthetic-video-fixture',
  });
  const auth = { bearerToken: preview.bearerToken };
  const session = await api.getSyntheticReferenceSessionV3(auth);
  const context = await api.getSyntheticReferenceRevisionContextV3(
    preview.listingId,
    1,
    preview.referenceReviewVersion,
    auth,
  );
  const cat = context.catalogue;
  const read = async (version) =>
    (await api.getSyntheticReferenceRevisionContextV3(preview.listingId, 1, version, auth)).review;
  const transition = async (action, review) =>
    api.transitionSyntheticReferenceRevisionV3(
      {
        policy: 'synthetic-reference-transition-v1',
        operationId: randomUUID(),
        listingId: preview.listingId,
        revision: 1,
        action,
        review,
        reason: null,
      },
      cat,
      session.actorId,
      auth,
    );
  const withdrawn = await transition('withdraw', await read(preview.referenceReviewVersion));
  const saved = await api.savePrivateListingVideo(
    {
      policy: 'synthetic-listing-video-command-v1',
      operationId: randomUUID(),
      listingId: preview.listingId,
      revision: 1,
      expectedVersion: withdrawn.revisionVersion,
      video: {
        provider: 'youtube',
        videoId: 'abcdefghijk',
        title: 'Synthetic approved apartment tour',
      },
    },
    auth,
  );
  const submitted = await transition('submit', await read(saved.resultVersion));
  return {
    api,
    auth,
    cat,
    actorId: session.actorId,
    version: submitted.revisionVersion,
    transition,
    read,
  };
}
