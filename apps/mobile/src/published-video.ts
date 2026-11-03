import { RealtorApiClient } from '@realtor/api-client';
import { listingVideoExternalLink, type ListingVideo } from '@realtor/domain';
import type { MobileReferenceConfig } from './reference-catalogue.ts';
export type MobileVideoResult =
  | Readonly<{ status: 'off' }>
  | Readonly<{ status: 'unavailable' }>
  | Readonly<{ status: 'ready'; video: ListingVideo | null }>;
export async function loadMobilePublishedVideo(
  config: MobileReferenceConfig,
  property: { id: string; revision: number; reference: { revisionVersion: string | null } },
  signal: AbortSignal,
  transport?: typeof fetch,
): Promise<MobileVideoResult> {
  if (config.mode !== 'synthetic-reference-public-v1' || config.videoMode === undefined)
    return Object.freeze({ status: 'off' });
  try {
    if (config.videoMode !== 'synthetic-listing-video-publication-v1' || signal.aborted)
      throw Error();
    const client = new RealtorApiClient({
      baseUrl: config.apiOrigin,
      allowLoopbackHttp: config.allowLoopbackHttp,
      privacyNoticeVersion: 'mobile-public-video',
      ...(transport ? { fetch: transport } : {}),
    });
    const saved = await client.getPublishedListingVideo(property.id, property.revision, { signal });
    if (
      signal.aborted ||
      (property.reference.revisionVersion !== null &&
        saved.approvedVersion !== property.reference.revisionVersion)
    )
      throw Error();
    return Object.freeze({ status: 'ready', video: saved.video });
  } catch {
    return Object.freeze({ status: 'unavailable' });
  }
}
/** Only call from an explicit user action; loading metadata never calls the opener. */
export async function openMobilePublishedVideo(
  result: MobileVideoResult,
  open: (url: string) => Promise<unknown>,
) {
  if (result.status !== 'ready' || !result.video) return false;
  await open(listingVideoExternalLink(result.video));
  return true;
}
