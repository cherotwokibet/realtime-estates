import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import { validateStaffInvitationIssueCommand } from '@realtor/domain';
import {
  staffDirectoryPreviewContext,
  readStaffDirectoryCommandBody,
} from './staff-directory-server.ts';
import { upstreamFailureStatus } from './staff-preview-policy.ts';
const reply = (status: number, body: unknown) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
const uuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
/** Explicit synthetic admin boundary. It never selects an actor from browser input. */
export async function staffInvitationIssueBoundary(
  request: Request,
  invitation: string,
  operation: string,
  state = false,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  let config: ReturnType<typeof staffDirectoryPreviewContext>;
  try {
    config = staffDirectoryPreviewContext(request, env);
    if (env.STAFF_INVITATION_ISSUE_PREVIEW_MODE !== 'synthetic-single-use-invitations-v1')
      throw Error();
  } catch {
    return reply(403, { error: 'INVITATION_ISSUE_UNAVAILABLE', submissionUncertain: false });
  }
  const path =
    '/api/staff-directory/invitation-issues/' +
    invitation +
    '/operations/' +
    operation +
    (state ? '/state' : '');
  if (
    !uuid(invitation) ||
    !uuid(operation) ||
    new URL(request.url).pathname !== path ||
    request.url.includes('?') ||
    request.url.includes('#')
  )
    return reply(400, { error: 'INVALID_INVITATION_ISSUE', submissionUncertain: false });
  if (!['GET', ...(state ? [] : ['POST'])].includes(request.method))
    return reply(405, { error: 'METHOD_UNAVAILABLE', submissionUncertain: false });
  let command: ReturnType<typeof validateStaffInvitationIssueCommand> | undefined;
  if (request.method === 'GET') {
    if (
      request.body !== null ||
      request.headers.has('content-type') ||
      request.headers.has('content-length')
    )
      return reply(400, { error: 'INVALID_INVITATION_ISSUE', submissionUncertain: false });
  } else
    try {
      command = validateStaffInvitationIssueCommand(await readStaffDirectoryCommandBody(request));
      if (command.operationId !== operation || command.invitationId !== invitation) throw Error();
    } catch {
      return reply(400, { error: 'INVALID_INVITATION_ISSUE', submissionUncertain: false });
    }
  try {
    const api = new RealtorApiClient({
        baseUrl: config.origin,
        privacyNoticeVersion: 'synthetic-staff-notice-v1',
        allowLoopbackHttp: true,
        fetch: fetcher,
        timeoutMs: 10000,
      }),
      options = { bearerToken: config.bearerToken, signal: request.signal };
    const target = {
      policy: 'staff-invitation-issue-command-v1' as const,
      operationId: operation,
      invitationId: invitation,
    };
    if (state)
      return reply(200, { state: await api.getIssuedStaffInvitationState(target, options) });
    if (command)
      return reply(200, { disclosure: await api.issueStaffInvitation(command, options) });
    return reply(200, { receipt: await api.getStaffInvitationIssue(target, options) });
  } catch (error) {
    return reply(
      error instanceof ApiClientError ? upstreamFailureStatus(error.status, error.kind) : 503,
      {
        error: 'INVITATION_ISSUE_UNAVAILABLE',
        submissionUncertain:
          error instanceof ApiClientError ? error.submissionUncertain : !!command,
      },
    );
  }
}
