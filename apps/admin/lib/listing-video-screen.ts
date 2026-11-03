import 'server-only';
import { RealtorApiClient } from '@realtor/api-client';
import { previewConfiguration } from './staff-preview-policy.ts';
import { readRevisionProtocolScreen } from './revision-protocol-screen.ts';
import { captureVideoScope } from './listing-video-session.ts';
export function videoEnvironment(env: Readonly<Record<string, string | undefined>>) {
  const captured = Object.freeze(
    Object.fromEntries(
      [
        'NODE_ENV',
        'STAFF_PREVIEW_MODE',
        'STAFF_PREVIEW_REFERENCE',
        'STAFF_PREVIEW_VIDEO',
        'STAFF_PREVIEW_API_ORIGIN',
        'STAFF_PREVIEW_TOKEN',
        'STAFF_PREVIEW_INSTANCE',
      ].map((k) => [k, env[k]]),
    ),
  );
  if (
    captured.STAFF_PREVIEW_VIDEO !== 'synthetic-private-listing-video-v1' ||
    captured.STAFF_PREVIEW_REFERENCE !== 'synthetic-reference-draft-v1'
  )
    throw Error('Private video preview unavailable.');
  return captured;
}
export async function readListingVideoScreen(
  listingId: string,
  revision: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: typeof fetch,
  signal?: AbortSignal,
) {
  const captured = videoEnvironment(env),
    config = previewConfiguration(captured),
    initial = await readRevisionProtocolScreen(listingId, revision, captured, transport, signal);
  if (initial.protocol.protocol !== 'synthetic-reference-v1')
    throw Error('Adopted reference revision required.');
  const client = new RealtorApiClient({
    baseUrl: config.origin,
    privacyNoticeVersion: 'synthetic-preview-v1',
    allowLoopbackHttp: true,
    ...(transport ? { fetch: transport } : {}),
  });
  const state = await client.getPrivateListingVideo(listingId, initial.protocol.revision, {
    bearerToken: config.bearerToken,
    timeoutMs: 10000,
    signal,
  });
  const final = await readRevisionProtocolScreen(listingId, revision, captured, transport, signal);
  if (
    JSON.stringify(initial) !== JSON.stringify(final) ||
    state.version !== final.protocol.revisionVersion
  )
    throw Error('Saved revision changed; reload.');
  return Object.freeze({
    scope: captureVideoScope({ ...final.scope, listingId, revision: final.protocol.revision }),
    state,
    editable: final.protocol.editable,
  });
}
export type ListingVideoScreen = Awaited<ReturnType<typeof readListingVideoScreen>>;
