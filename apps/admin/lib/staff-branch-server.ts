import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import { validateStaffBranchCommand } from '@realtor/domain';
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
export async function staffBranchBoundary(
  request: Request,
  kind: 'operation' | 'current',
  target: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  let config: ReturnType<typeof staffDirectoryPreviewContext>;
  try {
    config = staffDirectoryPreviewContext(request, env);
  } catch {
    return reply(403, { error: 'STAFF_BRANCH_UNAVAILABLE' });
  }
  const path =
    '/api/staff-directory/branches/' + (kind === 'operation' ? 'operations/' : '') + target;
  if (
    !['operation', 'current'].includes(kind) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(target) ||
    new URL(request.url).pathname !== path ||
    request.url.includes('?') ||
    request.url.includes('#')
  )
    return reply(400, { error: 'INVALID_BRANCH_REQUEST' });
  if (!['GET', 'POST'].includes(request.method) || (kind === 'current' && request.method !== 'GET'))
    return reply(405, { error: 'METHOD_UNAVAILABLE' });
  let command: ReturnType<typeof validateStaffBranchCommand> | undefined;
  if (request.method === 'GET') {
    if (
      request.body !== null ||
      request.headers.has('content-type') ||
      request.headers.has('content-length')
    )
      return reply(400, { error: 'INVALID_BRANCH_REQUEST' });
  } else {
    try {
      command = validateStaffBranchCommand(await readStaffDirectoryCommandBody(request));
      if (command.operationId !== target) throw Error();
    } catch {
      return reply(400, { error: 'INVALID_BRANCH_REQUEST' });
    }
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
    if (kind === 'current')
      return reply(200, { branch: await api.getStaffBranch(target, options) });
    return reply(200, {
      receipt: command
        ? await api.saveStaffBranch(command, options)
        : await api.getStaffBranchOperation(target, options),
    });
  } catch (error) {
    return reply(
      error instanceof ApiClientError ? upstreamFailureStatus(error.status, error.kind) : 503,
      {
        error: 'STAFF_BRANCH_UNAVAILABLE',
        submissionUncertain:
          error instanceof ApiClientError ? error.submissionUncertain : !!command,
      },
    );
  }
}
