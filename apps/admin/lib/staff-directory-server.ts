import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import { validateStaffDirectoryQuery } from '@realtor/domain';
import {
  previewConfiguration,
  assertPreviewRequest,
  upstreamFailureStatus,
} from './staff-preview-policy.ts';
const reply = (status: number, body: unknown) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
/** Explicit loopback-only developer adapter. Browser never selects company, actor or bearer. */
export async function staffDirectoryBoundary(
  request: Request,
  kind: 'branches' | 'invitations',
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  let config: ReturnType<typeof previewConfiguration>;
  try {
    config = previewConfiguration(env);
    if (
      env.STAFF_DIRECTORY_PREVIEW_MODE !== 'synthetic-v1' ||
      !['branches', 'invitations'].includes(kind)
    )
      throw Error();
    assertPreviewRequest(request, config.instanceId);
    const headerNames: string[] = [];
    request.headers.forEach((_, key) => headerNames.push(key));
    for (const key of headerNames)
      if (
        ['cookie', 'idempotency-key', 'range', 'content-encoding'].includes(key) ||
        key.startsWith('if-') ||
        (key.startsWith('x-') && key !== 'x-preview-instance')
      )
        throw Error();
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== 'http://' + request.headers.get('host')) throw Error();
  } catch {
    return reply(403, { error: 'STAFF_DIRECTORY_UNAVAILABLE' });
  }
  if (request.method !== 'GET') return reply(405, { error: 'READ_ONLY' });
  const url = new URL(request.url);
  if (
    url.pathname !== '/api/staff-directory/' + kind ||
    request.url.includes('#') ||
    request.body !== null ||
    request.headers.has('content-type') ||
    request.headers.has('content-length')
  )
    return reply(400, { error: 'INVALID_DIRECTORY_QUERY' });
  const match = /^\?limit=([1-9]|1[0-9]|20)(?:&after=([0-9a-f-]{36}))?$/.exec(url.search);
  if (!match) return reply(400, { error: 'INVALID_DIRECTORY_QUERY' });
  let query: ReturnType<typeof validateStaffDirectoryQuery>;
  try {
    query = validateStaffDirectoryQuery({ limit: Number(match[1]), after: match[2] ?? null });
  } catch {
    return reply(400, { error: 'INVALID_DIRECTORY_QUERY' });
  }
  const api = new RealtorApiClient({
    baseUrl: config.origin,
    privacyNoticeVersion: 'synthetic-staff-notice-v1',
    allowLoopbackHttp: true,
    fetch: fetcher,
    timeoutMs: 10000,
  });
  try {
    const options = { bearerToken: config.bearerToken, signal: request.signal };
    const page =
      kind === 'branches'
        ? await api.listStaffBranches(query, options)
        : await api.listStaffInvitationRequests(query, options);
    return reply(200, { page });
  } catch (error) {
    return reply(
      error instanceof ApiClientError ? upstreamFailureStatus(error.status, error.kind) : 503,
      { error: 'STAFF_DIRECTORY_UNAVAILABLE' },
    );
  }
}
