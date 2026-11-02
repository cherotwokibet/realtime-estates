import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import { validateStaffDirectoryQuery, validateStaffMembershipCommand } from '@realtor/domain';
import {
  readStaffDirectoryCommandBody,
  staffDirectoryPreviewContext,
} from './staff-directory-server.ts';
import { upstreamFailureStatus } from './staff-preview-policy.ts';

const reply = (status: number, body: unknown) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
const uuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

/** Existing staff access changes require a separate explicit server flag. */
export function staffMembershipPreviewContext(
  request: Request,
  env: Readonly<Record<string, string | undefined>>,
) {
  const config = staffDirectoryPreviewContext(request, env);
  if (env.STAFF_MEMBERSHIP_PREVIEW_MODE !== 'synthetic-existing-members-v1') throw Error();
  return config;
}
const apiClient = (
  config: ReturnType<typeof staffMembershipPreviewContext>,
  fetcher: typeof fetch,
) =>
  new RealtorApiClient({
    baseUrl: config.origin,
    privacyNoticeVersion: 'synthetic-staff-notice-v1',
    allowLoopbackHttp: true,
    fetch: fetcher,
    timeoutMs: 10000,
  });
const emptyRead = (request: Request) =>
  request.body === null &&
  !request.headers.has('content-type') &&
  !request.headers.has('content-length');
const failureStatus = (error: unknown) =>
  error instanceof ApiClientError ? upstreamFailureStatus(error.status, error.kind) : 503;

export async function staffMembershipDirectoryBoundary(
  request: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  let config: ReturnType<typeof staffMembershipPreviewContext>;
  try {
    config = staffMembershipPreviewContext(request, env);
  } catch {
    return reply(403, { error: 'STAFF_MEMBERSHIP_UNAVAILABLE' });
  }
  if (request.method !== 'GET') return reply(405, { error: 'METHOD_UNAVAILABLE' });
  const url = new URL(request.url);
  if (
    url.pathname !== '/api/staff-directory/memberships' ||
    request.url.includes('#') ||
    !emptyRead(request)
  )
    return reply(400, { error: 'INVALID_MEMBERSHIP_QUERY' });
  const match = /^\?limit=([1-9]|1[0-9]|20)(?:&after=([0-9a-f-]{36}))?$/.exec(url.search);
  if (!match) return reply(400, { error: 'INVALID_MEMBERSHIP_QUERY' });
  let query: ReturnType<typeof validateStaffDirectoryQuery>;
  try {
    query = validateStaffDirectoryQuery({ limit: Number(match[1]), after: match[2] ?? null });
  } catch {
    return reply(400, { error: 'INVALID_MEMBERSHIP_QUERY' });
  }
  try {
    const page = await apiClient(config, fetcher).listStaffMemberships(query, {
      bearerToken: config.bearerToken,
      signal: request.signal,
    });
    return reply(200, { page });
  } catch (error) {
    return reply(failureStatus(error), { error: 'STAFF_MEMBERSHIP_UNAVAILABLE' });
  }
}

async function membershipBoundary(
  request: Request,
  kind: 'operation' | 'current',
  target: string,
  env: Readonly<Record<string, string | undefined>>,
  fetcher: typeof fetch,
): Promise<Response> {
  let config: ReturnType<typeof staffMembershipPreviewContext>;
  try {
    config = staffMembershipPreviewContext(request, env);
  } catch {
    return reply(403, { error: 'STAFF_MEMBERSHIP_UNAVAILABLE' });
  }
  const path =
    '/api/staff-directory/memberships/' + (kind === 'operation' ? 'operations/' : '') + target;
  if (
    !uuid(target) ||
    new URL(request.url).pathname !== path ||
    request.url.includes('?') ||
    request.url.includes('#')
  )
    return reply(400, { error: 'INVALID_MEMBERSHIP_REQUEST' });
  if (!['GET', 'POST'].includes(request.method) || (kind === 'current' && request.method !== 'GET'))
    return reply(405, { error: 'METHOD_UNAVAILABLE' });
  let command: ReturnType<typeof validateStaffMembershipCommand> | undefined;
  if (request.method === 'GET') {
    if (!emptyRead(request)) return reply(400, { error: 'INVALID_MEMBERSHIP_REQUEST' });
  } else {
    try {
      command = validateStaffMembershipCommand(await readStaffDirectoryCommandBody(request));
      if (command.operationId !== target) throw Error();
    } catch {
      return reply(400, { error: 'INVALID_MEMBERSHIP_REQUEST' });
    }
  }
  try {
    const api = apiClient(config, fetcher),
      options = { bearerToken: config.bearerToken, signal: request.signal };
    if (kind === 'current')
      return reply(200, { member: await api.getStaffMembership(target, options) });
    const receipt = command
      ? await api.saveStaffMembership(command, options)
      : await api.getStaffMembershipOperation(target, options);
    return reply(200, { receipt });
  } catch (error) {
    return reply(failureStatus(error), {
      error: 'STAFF_MEMBERSHIP_UNAVAILABLE',
      submissionUncertain: error instanceof ApiClientError ? error.submissionUncertain : !!command,
    });
  }
}
export function staffMembershipOperationBoundary(
  request: Request,
  operation: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  return membershipBoundary(request, 'operation', operation, env, fetcher);
}
export function staffMembershipCurrentBoundary(
  request: Request,
  member: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  return membershipBoundary(request, 'current', member, env, fetcher);
}
