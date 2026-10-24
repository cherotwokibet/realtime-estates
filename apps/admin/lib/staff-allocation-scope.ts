import 'server-only';
import { RealtorApiClient } from '@realtor/api-client';
import { previewConfiguration } from './staff-preview-policy.ts';
import { captureAllocationIdentity } from './allocation-identity.ts';
/** Trusted server read supplies stale-scope identity, never a browser bearer or posted authority. */
export async function readStaffAllocationScope(
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: typeof fetch,
) {
  const config = previewConfiguration(env);
  const client = new RealtorApiClient({
    baseUrl: config.origin,
    privacyNoticeVersion: 'synthetic-preview-v1',
    allowLoopbackHttp: true,
    ...(transport ? { fetch: transport } : {}),
  });
  const current = await client.getCurrentStaffSessionV2({
    bearerToken: config.bearerToken,
    timeoutMs: 10000,
  });
  return captureAllocationIdentity({
    instanceId: config.instanceId,
    tenantId: current.tenantId,
    actorId: current.actorId,
  });
}
