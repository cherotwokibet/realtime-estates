import { validateListingVideoState, type ListingVideoState } from '@realtor/domain';
/** Metadata only: reviewing never navigates to or fetches a provider. */
export default function ReviewListingVideo({ state }: { state: ListingVideoState }) {
  const value = validateListingVideoState(state, state.listingId, state.revision);
  return (
    <section aria-label="Saved video selection">
      <h2>Video selection</h2>
      {value.video ? (
        <>
          <p>{value.video.title}</p>
          <dl>
            <dt>Provider</dt>
            <dd>{value.video.provider === 'youtube' ? 'YouTube' : 'Vimeo'}</dd>
            <dt>Video identifier</dt>
            <dd>{value.video.videoId}</dd>
          </dl>
          <p>
            Approval publishes this provider identifier and title. No player or provider request is
            loaded here.
          </p>
        </>
      ) : (
        <p>No video selected in this saved revision.</p>
      )}
      <p>Videos do not satisfy the listing photo minimum.</p>
    </section>
  );
}
