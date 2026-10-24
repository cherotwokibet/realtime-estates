import 'server-only';
import { RealtorApiClient } from '@realtor/api-client';
import { previewConfiguration } from './staff-preview-policy.ts';

/** Current identity/context only; terminal eligibility must not prevent local original recovery. */
export async function readReferenceSuccessorScreen(
  listingId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: typeof fetch,
) {
  const config = previewConfiguration(env);
  if (
    env.STAFF_PREVIEW_REFERENCE !== 'synthetic-reference-draft-v1' ||
    env.STAFF_PREVIEW_REFERENCE_MODERATION !== 'synthetic-reference-transition-v1' ||
    env.STAFF_PREVIEW_REFERENCE_SUCCESSOR !== 'synthetic-reference-successor-v1'
  )
    throw Error('Successor unavailable.');
  const client = new RealtorApiClient({
    baseUrl: config.origin,
    privacyNoticeVersion: 'synthetic-preview-v1',
    allowLoopbackHttp: true,
    ...(transport ? { fetch: transport } : {}),
  });
  const options = { bearerToken: config.bearerToken, timeoutMs: 10000 };
  const current = await client.getSyntheticReferenceSessionV3(options);
  const listing = await client.getStaffListingV2(listingId, options);
  const catalogue = await client.getSyntheticReferenceCatalogueV3('current', options);
  return Object.freeze({
    scope: Object.freeze({
      instanceId: config.instanceId,
      tenantId: current.tenantId,
      actorId: current.actorId,
      listingId,
    }),
    listing,
    catalogue,
  });
}
