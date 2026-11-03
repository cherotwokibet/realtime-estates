import { listingVideoExternalLink } from '@realtor/domain';
import type { PublicVideoResult } from '../lib/public-video.ts';
export default function PublicListingVideo({ result }: { result: PublicVideoResult }) {
  if (result.status === 'off') return null;
  return (
    <section aria-label="Property video">
      <h2>Property video</h2>
      {result.status === 'unavailable' ? (
        <p>Video details are unavailable. Please try again later.</p>
      ) : result.video ? (
        <>
          <p>{result.video.title}</p>
          <a
            href={listingVideoExternalLink(result.video)}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
          >
            Open on {result.video.provider === 'youtube' ? 'YouTube' : 'Vimeo'} (new tab)
          </a>
          <p>Opening this link visits an external video provider.</p>
        </>
      ) : (
        <p>No video supplied for this approved revision.</p>
      )}
    </section>
  );
}
