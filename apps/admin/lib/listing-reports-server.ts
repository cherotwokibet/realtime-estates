import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import type { ListingReportQueue } from '@realtor/domain';
import { previewConfiguration, assertPreviewRequest } from './staff-preview-policy.ts';
const reply = (status: number, body: unknown) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
/** Server-only current signed admin identity. No browser-selected company/role/token. */
export async function listingReportsBoundary(
  request: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  let config: ReturnType<typeof previewConfiguration>;
  try {
    config = previewConfiguration(env);
    if (env.STAFF_REPORT_PREVIEW_MODE !== 'synthetic-v1') throw Error();
    assertPreviewRequest(request, config.instanceId);
    if (
      request.headers.has('cookie') ||
      request.headers.has('x-tenant-id') ||
      request.headers.has('x-actor-id')
    )
      throw Error();
  } catch {
    return reply(403, { error: 'REPORTS_UNAVAILABLE' });
  }
  if (request.method !== 'GET') return reply(405, { error: 'READ_ONLY' });
  if (
    request.body !== null ||
    request.headers.has('content-type') ||
    request.headers.has('content-length') ||
    request.headers.has('idempotency-key') ||
    request.url.includes('#')
  )
    return reply(400, { error: 'INVALID_REPORT_QUEUE' });
  const q: Record<string, string> = Object.create(null);
  for (const [k, v] of new URL(request.url).searchParams) {
    if (!['limit', 'status', 'before'].includes(k) || Object.hasOwn(q, k))
      return reply(400, { error: 'INVALID_REPORT_QUEUE' });
    q[k] = v;
  }
  if (q.limit !== undefined && !/^[1-9]\d?$/.test(q.limit))
    return reply(400, { error: 'INVALID_REPORT_QUEUE' });
  const api = new RealtorApiClient({
    baseUrl: config.origin,
    privacyNoticeVersion: 'synthetic-staff-notice-v1',
    allowLoopbackHttp: true,
    fetch: fetcher,
    timeoutMs: 10000,
  });
  try {
    const queue = await api.listListingReports(
      {
        limit: q.limit === undefined ? 50 : Number(q.limit),
        status: (q.status ?? 'new') as ListingReportQueue['status'],
        ...(q.before === undefined ? {} : { before: q.before }),
      },
      { bearerToken: config.bearerToken, signal: request.signal },
    );
    return reply(200, { queue });
  } catch (e) {
    return reply(
      e instanceof ApiClientError ? (e.status ?? (e.kind === 'VALIDATION' ? 400 : 503)) : 503,
      { error: 'REPORTS_UNAVAILABLE' },
    );
  }
}
