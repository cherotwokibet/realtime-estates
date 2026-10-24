import 'server-only';
import { RealtorApiClient } from '@realtor/api-client';
import { previewConfiguration } from './staff-preview-policy.ts';
/** Return current public catalogue and stale-session scope; keep all bearer data server-only. */
export async function readReferenceCreationScreen(
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: typeof fetch,
) {
  const config = previewConfiguration(env);
  if (
    env.STAFF_PREVIEW_REFERENCE !== 'synthetic-reference-draft-v1' ||
    env.STAFF_PREVIEW_REFERENCE_CREATION !== 'synthetic-reference-creation-v1'
  )
    throw Error('Creation unavailable.');
  const client = new RealtorApiClient({
    baseUrl: config.origin,
    privacyNoticeVersion: 'synthetic-preview-v1',
    allowLoopbackHttp: true,
    ...(transport ? { fetch: transport } : {}),
  });
  const options = { bearerToken: config.bearerToken, timeoutMs: 10000 };
  const current = await client.getSyntheticReferenceSessionV3(options);
  const catalogue = await client.getSyntheticReferenceCatalogueV3('current', options);
  return Object.freeze({
    identity: Object.freeze({
      instanceId: config.instanceId,
      tenantId: current.tenantId,
      actorId: current.actorId,
    }),
    catalogue,
  });
}
