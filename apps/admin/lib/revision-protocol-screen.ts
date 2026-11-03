import 'server-only';
import { RealtorApiClient } from '@realtor/api-client';
import { validateRevisionProtocolTarget } from '@realtor/domain';
import { previewConfiguration } from './staff-preview-policy.ts';
import { captureAllocationIdentity } from './allocation-identity.ts';

/** Server-only pre-routing context. No caller-selected company, actor, bearer or protocol. */
export async function readRevisionProtocolScreen(
  listingId: string,
  revision: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: typeof fetch,
  signal?: AbortSignal,
) {
  const config = previewConfiguration(env);
  if (
    env.STAFF_PREVIEW_REFERENCE !== 'synthetic-reference-draft-v1' ||
    !/^[1-9]\d{0,9}$/.test(revision)
  )
    throw Error('Revision protocol is unavailable.');
  const target = validateRevisionProtocolTarget({ listingId, revision: Number(revision) });
  const client = new RealtorApiClient({
    baseUrl: config.origin,
    privacyNoticeVersion: 'synthetic-preview-v1',
    allowLoopbackHttp: true,
    ...(transport ? { fetch: transport } : {}),
  });
  const options = { bearerToken: config.bearerToken, timeoutMs: 10000, signal };
  const current = await client.getSyntheticReferenceSessionV3(options);
  const protocol = await client.getRevisionProtocolV3(target.listingId, target.revision, options);
  return Object.freeze({
    scope: captureAllocationIdentity({
      instanceId: config.instanceId,
      tenantId: current.tenantId,
      actorId: current.actorId,
    }),
    protocol,
  });
}
