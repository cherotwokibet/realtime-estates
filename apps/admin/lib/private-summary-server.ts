import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import { adminAuditQuery } from '@realtor/domain';
import { adminAuditHostAllowed } from './admin-audit-server.ts';
import { pushQueueConfiguration } from './push-queue-preview-server.ts';
import { assertPreviewRequest, previewConfiguration } from './staff-preview-policy.ts';
import { captureRecoveryScope, sameRecoveryScope } from './private-recovery-contract.ts';

const reply = (status: number, data: unknown) =>
  Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
/** Expected identity is a stale-view fence, never authority. Current SQL checks authorize each read. */
export async function privateSummaryRequest(
  request: Request,
  kind: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport: typeof fetch = fetch,
) {
  if (kind !== 'audit' && kind !== 'push')
    return reply(404, { error: 'PRIVATE_SUMMARY_UNAVAILABLE' });
  if (request.method !== 'GET') return reply(405, { error: 'METHOD_UNAVAILABLE' });
  let config;
  try {
    config = kind === 'push' ? pushQueueConfiguration(env) : previewConfiguration(env);
    if (kind === 'audit' && !adminAuditHostAllowed(request.headers.get('host'), env)) throw Error();
    assertPreviewRequest(request, config.instanceId);
  } catch {
    return reply(403, { error: 'PRIVATE_SUMMARY_UNAVAILABLE' });
  }
  let expected, query;
  try {
    if (
      request.body !== null ||
      request.url.includes('#') ||
      [
        'cookie',
        'content-type',
        'content-length',
        'content-encoding',
        'transfer-encoding',
        'range',
        'x-actor-id',
        'x-tenant-id',
        'x-role',
        'x-company-id',
      ].some((k) => request.headers.has(k))
    )
      throw Error();
    expected = captureRecoveryScope({
      instanceId: config.instanceId,
      tenantId: request.headers.get('x-preview-tenant'),
      actorId: request.headers.get('x-preview-actor'),
    });
    const url = new URL(request.url);
    if (url.pathname !== '/api/private-summary/' + kind) throw Error();
    if (kind === 'push' && request.url.includes('?')) throw Error();
    query = adminAuditQuery(url.searchParams);
  } catch {
    return reply(400, { error: 'INVALID_PRIVATE_SUMMARY_REQUEST' });
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
  let denied: number | undefined;
  const api = new RealtorApiClient({
    baseUrl: config.origin,
    allowLoopbackHttp: true,
    privacyNoticeVersion: 'synthetic-private-summary-v1',
    fetch: async (...args) => {
      const response = await transport(...args);
      if (response.status === 401 || response.status === 403) {
        denied = response.status;
        void response.body?.cancel().catch(() => {});
        throw new ApiClientError('HTTP', 'Private read denied.', { status: response.status });
      }
      return response;
    },
  });
  const options = { bearerToken: config.bearerToken, signal, timeoutMs: 10000 };
  try {
    const current = async () => {
      const lease = await api.getCurrentStaffAccessLeaseV2(options);
      const scope = {
        instanceId: config.instanceId,
        tenantId: lease.tenantId,
        actorId: lease.actorId,
      };
      if (
        lease.role !== 'admin' ||
        !sameRecoveryScope(expected, scope) ||
        Date.now() >= Date.parse(lease.expiresAt) ||
        (kind === 'push' && pushQueueConfiguration(env).tenantId !== lease.tenantId)
      )
        throw new ApiClientError('HTTP', 'Private read scope changed.', { status: 403 });
      return { scope, lease };
    };
    const first = await current();
    const data =
      kind === 'audit'
        ? await api.listAdminAuditEvents(first.scope.tenantId, query, options)
        : await api.getSyntheticPushQueueSummary(first.scope.tenantId, options);
    const last = await current();
    if (
      signal.aborted ||
      Date.now() >= Date.parse(first.lease.expiresAt) ||
      Date.now() >= Date.parse(last.lease.expiresAt)
    )
      return reply(403, { error: 'PRIVATE_SUMMARY_UNAVAILABLE' });
    return reply(200, { policy: 'private-summary-v1', kind, scope: last.scope, data });
  } catch (error) {
    return reply(
      denied ??
        (error instanceof ApiClientError && [401, 403].includes(error.status ?? 0)
          ? error.status!
          : signal.aborted
            ? 408
            : 503),
      { error: 'PRIVATE_SUMMARY_UNAVAILABLE' },
    );
  }
}
