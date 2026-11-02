import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import {
  validateStaffInvitationRedemptionCommand,
  validateStaffInvitationRedemptionRecord,
  validateStaffInvitationRawSecret,
} from '@realtor/domain';
import { previewConfiguration, upstreamFailureStatus } from './staff-preview-policy.ts';
import {
  staffDirectoryPreviewContext,
  readStaffDirectoryCommandBody,
} from './staff-directory-server.ts';
const reply = (status: number, payload: unknown) =>
  Response.json(payload, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
const uuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
/** A separate trusted recipient bearer is mandatory. There is no admin-token fallback. */
function configuration(env: Readonly<Record<string, string | undefined>>) {
  const token = env.STAFF_INVITATION_RECIPIENT_TOKEN;
  if (
    env.STAFF_INVITATION_RECIPIENT_PREVIEW_MODE !== 'synthetic-verified-recipient-v1' ||
    !token ||
    token === env.STAFF_PREVIEW_TOKEN
  )
    throw Error('Recipient context unavailable.');
  const scoped = { ...env, STAFF_PREVIEW_TOKEN: token };
  return { scoped, config: previewConfiguration(scoped) };
}
const api = (config: ReturnType<typeof previewConfiguration>, fetcher: typeof fetch) =>
  new RealtorApiClient({
    baseUrl: config.origin,
    privacyNoticeVersion: 'synthetic-staff-notice-v1',
    allowLoopbackHttp: true,
    fetch: fetcher,
    timeoutMs: 10000,
  });
/** Serialized page data contains verified identity facts only, never either bearer or a membership assertion. */
export async function loadInvitationRecipientContext(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: typeof fetch = fetch,
) {
  const { config } = configuration(env),
    session = await api(config, fetcher).getStaffInvitationRecipientSession({
      bearerToken: config.bearerToken,
    });
  return Object.freeze({ instanceId: config.instanceId, session });
}
export async function invitationRecipientBoundary(
  request: Request,
  target: Readonly<{ invitationId: string; operationId: string }> | null,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  let config: ReturnType<typeof previewConfiguration>;
  try {
    const selected = configuration(env);
    config = staffDirectoryPreviewContext(request, selected.scoped);
  } catch {
    return reply(403, { error: 'INVITATION_RECIPIENT_UNAVAILABLE', submissionUncertain: false });
  }
  const path = target
    ? '/api/invitation-acceptance/' + target.invitationId + '/operations/' + target.operationId
    : '/api/invitation-acceptance/session';
  if (
    (target && (!uuid(target.invitationId) || !uuid(target.operationId))) ||
    new URL(request.url).pathname !== path ||
    request.url.includes('?') ||
    request.url.includes('#')
  )
    return reply(400, { error: 'INVALID_INVITATION_ACCEPTANCE', submissionUncertain: false });
  if (!['GET', ...(target ? ['POST'] : [])].includes(request.method))
    return reply(405, { error: 'METHOD_UNAVAILABLE', submissionUncertain: false });
  let command: ReturnType<typeof validateStaffInvitationRedemptionCommand> | undefined,
    secret: string | undefined;
  if (request.method === 'GET') {
    if (
      request.body ||
      request.headers.has('content-length') ||
      request.headers.has('content-type')
    )
      return reply(400, { error: 'INVALID_INVITATION_ACCEPTANCE', submissionUncertain: false });
  } else
    try {
      const body = await readStaffDirectoryCommandBody(request);
      if (
        !body ||
        typeof body !== 'object' ||
        Reflect.ownKeys(body).length !== 2 ||
        !Object.hasOwn(body, 'command') ||
        !Object.hasOwn(body, 'secret')
      )
        throw Error();
      const row = body as Record<string, unknown>;
      command = validateStaffInvitationRedemptionCommand(row.command);
      secret = validateStaffInvitationRawSecret(row.secret);
      if (
        command.operationId !== target!.operationId ||
        command.invitationId !== target!.invitationId
      )
        throw Error();
    } catch {
      return reply(400, { error: 'INVALID_INVITATION_ACCEPTANCE', submissionUncertain: false });
    }
  let dispatched = false;
  try {
    const client = api(config, fetcher),
      options = { bearerToken: config.bearerToken, signal: request.signal },
      session = await client.getStaffInvitationRecipientSession(options);
    if (!target) return reply(200, { session });
    const input = {
      policy: 'staff-invitation-redemption-command-v1' as const,
      operationId: target.operationId,
      invitationId: target.invitationId,
    };
    dispatched = !!command;
    const value = command
      ? await client.redeemStaffInvitation(command, secret!, options)
      : await client.getStaffInvitationRedemption(input, options);
    const receipt = validateStaffInvitationRedemptionRecord(
      value,
      target.operationId,
      target.invitationId,
      session.actorId,
    );
    return reply(200, { receipt });
  } catch (error) {
    return reply(
      error instanceof ApiClientError ? upstreamFailureStatus(error.status, error.kind) : 503,
      {
        error: 'INVITATION_RECIPIENT_UNAVAILABLE',
        submissionUncertain:
          dispatched && (error instanceof ApiClientError ? error.submissionUncertain : true),
      },
    );
  }
}
