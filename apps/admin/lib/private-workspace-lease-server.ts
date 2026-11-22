import 'server-only';
import {
  deletionTriageConfiguration,
  deletionPrivacyConfiguration,
} from './deletion-triage-server.ts';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import { assertPreviewRequest, previewConfiguration } from './staff-preview-policy.ts';
import { enquiryAccessLeaseConfiguration } from './enquiry-preview-server.ts';
const reply = (status: number, body: unknown) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });

/** Fixed developer credentials stay server-side; a profile names no production principal. */
export async function privateWorkspaceLeaseRequest(
  request: Request,
  profile: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: typeof fetch,
) {
  if (!['staff', 'admin', 'agent', 'deletion-triage', 'deletion-privacy'].includes(profile))
    return reply(404, { error: 'PRIVATE_ACCESS_UNAVAILABLE' });
  if (request.method !== 'GET')
    return new Response(null, {
      status: 405,
      headers: { Allow: 'GET', 'Cache-Control': 'no-store' },
    });
  let config:
    | ReturnType<typeof previewConfiguration>
    | ReturnType<typeof enquiryAccessLeaseConfiguration>
    | ReturnType<typeof deletionTriageConfiguration>
    | ReturnType<typeof deletionPrivacyConfiguration>;
  let reviewerScope: { tenantId: string; reviewerId: string } | undefined;
  try {
    const reviewer =
      profile === 'deletion-privacy'
        ? deletionPrivacyConfiguration(env)
        : profile === 'deletion-triage'
          ? deletionTriageConfiguration(env)
          : undefined;
    reviewerScope = reviewer?.scope;
    config =
      reviewer ??
      (profile === 'staff'
        ? previewConfiguration(env)
        : enquiryAccessLeaseConfiguration(profile as 'admin' | 'agent', env));
  } catch {
    return reply(503, { error: 'PRIVATE_ACCESS_UNAVAILABLE' });
  }
  try {
    assertPreviewRequest(request, config.instanceId);
  } catch {
    return reply(403, { error: 'PRIVATE_ACCESS_UNAVAILABLE' });
  }
  const url = new URL(request.url);
  if (
    url.search ||
    url.hash ||
    request.body !== null ||
    [
      'cookie',
      'content-type',
      'content-length',
      'x-actor-id',
      'x-tenant-id',
      'x-role',
      'x-company-id',
    ].some((k) => request.headers.has(k))
  )
    return reply(400, { error: 'INVALID_PRIVATE_ACCESS_REQUEST' });
  try {
    const client = new RealtorApiClient({
      baseUrl: config.origin,
      privacyNoticeVersion: 'synthetic-private-lease-v1',
      allowLoopbackHttp: true,
      ...(transport ? { fetch: transport } : {}),
    });
    const lease = await client.getCurrentStaffAccessLeaseV2({
      bearerToken: config.bearerToken,
      signal: request.signal,
      timeoutMs: 5000,
    });
    if ('actorId' in config && (lease.actorId !== config.actorId || lease.role !== config.role))
      return reply(403, { error: 'PRIVATE_ACCESS_UNAVAILABLE' });
    if (
      reviewerScope &&
      (lease.actorId !== reviewerScope.reviewerId ||
        lease.tenantId !== reviewerScope.tenantId ||
        lease.role !== 'admin')
    )
      return reply(403, { error: 'PRIVATE_ACCESS_UNAVAILABLE' });
    if (profile === 'deletion-privacy' && reviewerScope)
      await client.listDeletionPrivacyQueue({ limit: 1 }, reviewerScope, {
        bearerToken: config.bearerToken,
        signal: request.signal,
        timeoutMs: 5000,
      });
    if (Date.now() >= Date.parse(lease.expiresAt))
      return reply(403, { error: 'PRIVATE_ACCESS_UNAVAILABLE' });
    return reply(200, lease);
  } catch (error) {
    return reply(
      error instanceof ApiClientError && [401, 403].includes(error.status ?? 0)
        ? error.status!
        : 503,
      { error: 'PRIVATE_ACCESS_UNAVAILABLE' },
    );
  }
}
