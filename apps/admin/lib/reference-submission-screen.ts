import 'server-only';
import { RealtorApiClient } from '@realtor/api-client';
import { previewConfiguration } from './staff-preview-policy.ts';
import { readRevisionProtocolScreen } from './revision-protocol-screen.ts';
import type { ReferenceModerationScreen } from './reference-moderation-screen.ts';
/** Current assigned-staff scope and persisted exact snapshot; caller supplies no actor, version or catalogue. */
export async function readReferenceSubmissionScreen(
  listingId: string,
  revision: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: typeof fetch,
): Promise<ReferenceModerationScreen> {
  const captured = Object.freeze(
    Object.fromEntries(
      [
        'NODE_ENV',
        'STAFF_PREVIEW_MODE',
        'STAFF_PREVIEW_REFERENCE',
        'STAFF_PREVIEW_REFERENCE_MODERATION',
        'STAFF_PREVIEW_API_ORIGIN',
        'STAFF_PREVIEW_TOKEN',
        'STAFF_PREVIEW_INSTANCE',
      ].map((key) => [key, env[key]]),
    ),
  );
  if (
    captured.STAFF_PREVIEW_REFERENCE !== 'synthetic-reference-draft-v1' ||
    captured.STAFF_PREVIEW_REFERENCE_MODERATION !== 'synthetic-reference-transition-v1'
  )
    throw Error('Reference submission unavailable.');
  const config = previewConfiguration(captured);
  const initial = await readRevisionProtocolScreen(listingId, revision, captured, transport);
  if (initial.protocol.protocol !== 'synthetic-reference-v1')
    throw Error('An adopted reference revision is required.');
  const client = new RealtorApiClient({
    baseUrl: config.origin,
    privacyNoticeVersion: 'synthetic-preview-v1',
    allowLoopbackHttp: true,
    ...(transport ? { fetch: transport } : {}),
  });
  const context = ['draft', 'pending'].includes(initial.protocol.state)
    ? await client.getSyntheticReferenceRevisionContextV3(
        listingId,
        initial.protocol.revision,
        initial.protocol.revisionVersion,
        { bearerToken: config.bearerToken, timeoutMs: 10000 },
      )
    : null;
  const final = await readRevisionProtocolScreen(listingId, revision, captured, transport);
  if (
    JSON.stringify(initial) !== JSON.stringify(final) ||
    (context &&
      (context.review.listingVersion !== final.protocol.listingVersion ||
        context.review.revisionVersion !== final.protocol.revisionVersion ||
        context.review.state !== final.protocol.state))
  )
    throw Error('The saved revision changed; reload before continuing.');
  return Object.freeze({
    scope: Object.freeze({ ...final.scope, listingId, revision: final.protocol.revision }),
    context,
  });
}
