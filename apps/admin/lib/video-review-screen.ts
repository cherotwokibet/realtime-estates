import 'server-only';
import { RealtorApiClient } from '@realtor/api-client';
import { readReferenceModerationScreen } from './reference-moderation-screen.ts';
import { previewConfiguration } from './staff-preview-policy.ts';

/** Fixed server opt-in. Failed video reads cannot leave a fresh decision enabled. */
export async function readVideoReviewScreen(
  listingId: string,
  revision: string,
  version: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: typeof fetch,
) {
  const captured = Object.freeze({ ...env });
  const before = await readReferenceModerationScreen(
    listingId,
    revision,
    version,
    captured,
    transport,
  );
  if (captured.STAFF_PREVIEW_VIDEO_PUBLICATION === undefined) return before;
  if (captured.STAFF_PREVIEW_VIDEO_PUBLICATION !== 'synthetic-listing-video-publication-v1')
    throw Error('Video review unavailable.');
  // A decided revision has no pending video read. Keep the existing recovery-only shell.
  if (!before.context) return before;
  const config = previewConfiguration(captured);
  const client = new RealtorApiClient({
    baseUrl: config.origin,
    allowLoopbackHttp: true,
    privacyNoticeVersion: 'synthetic-preview-v1',
    ...(transport ? { fetch: transport } : {}),
  });
  const video = await client.getReviewListingVideo(listingId, Number(revision), version, {
    bearerToken: config.bearerToken,
    timeoutMs: 10000,
  });
  const after = await readReferenceModerationScreen(
    listingId,
    revision,
    version,
    captured,
    transport,
  );
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw Error('Saved review changed; reload.');
  return Object.freeze({ ...after, video });
}
