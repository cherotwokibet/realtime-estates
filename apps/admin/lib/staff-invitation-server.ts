import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import {
  validateStaffInvitationIntent,
  validateStaffInvitationRevocationCommand,
} from '@realtor/domain';
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
const uuid = (value: unknown) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export async function staffInvitationBoundary(
  request: Request,
  kind: 'capture' | 'current' | 'revocation',
  target: string,
  operation: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  let config: ReturnType<typeof staffDirectoryPreviewContext>;
  try {
    config = staffDirectoryPreviewContext(request, env);
  } catch {
    return reply(403, { error: 'STAFF_INVITATION_UNAVAILABLE' });
  }
  const path =
    '/api/staff-directory/invitations/' +
    (kind === 'capture'
      ? 'operations/' + target
      : kind === 'revocation'
        ? target + '/revocations/' + operation
        : target);
  if (
    !['capture', 'current', 'revocation'].includes(kind) ||
    !uuid(target) ||
    (kind === 'revocation' ? !uuid(operation) : operation !== undefined) ||
    new URL(request.url).pathname !== path ||
    request.url.includes('?') ||
    request.url.includes('#')
  )
    return reply(400, { error: 'INVALID_INVITATION_REQUEST' });
  if (!['GET', 'POST'].includes(request.method) || (kind === 'current' && request.method !== 'GET'))
    return reply(405, { error: 'METHOD_UNAVAILABLE' });
  let intent: ReturnType<typeof validateStaffInvitationIntent> | undefined,
    revocation: ReturnType<typeof validateStaffInvitationRevocationCommand> | undefined;
  if (request.method === 'GET') {
    if (
      request.body !== null ||
      request.headers.has('content-type') ||
      request.headers.has('content-length')
    )
      return reply(400, { error: 'INVALID_INVITATION_REQUEST' });
  } else {
    try {
      const body = await readStaffDirectoryCommandBody(request);
      if (kind === 'capture') {
        intent = validateStaffInvitationIntent(body);
        if (intent.operationId !== target) throw Error();
      } else {
        revocation = validateStaffInvitationRevocationCommand(body);
        if (revocation.operationId !== operation || revocation.invitationId !== target)
          throw Error();
      }
    } catch {
      return reply(400, { error: 'INVALID_INVITATION_REQUEST' });
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
      return reply(200, { state: await api.getStaffInvitationState(target, options) });
    const receipt = intent
      ? await api.recordStaffInvitationRequest(intent, options)
      : revocation
        ? await api.revokeStaffInvitationRequest(revocation, options)
        : kind === 'capture'
          ? await api.getStaffInvitationRequest(target, options)
          : await api.getStaffInvitationRevocation(target, operation!, options);
    return reply(intent ? 202 : 200, { receipt });
  } catch (error) {
    return reply(
      error instanceof ApiClientError ? upstreamFailureStatus(error.status, error.kind) : 503,
      {
        error: 'STAFF_INVITATION_UNAVAILABLE',
        submissionUncertain:
          error instanceof ApiClientError ? error.submissionUncertain : !!(intent || revocation),
      },
    );
  }
}
