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
    headers: { 'cache-control': 'no-store, no-transform', 'x-content-type-options': 'nosniff' },
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
    fetch: async (url, init) => {
      const response = await fetcher(url, init);
      // Preserve raw identity denial even if its error envelope is absent or malformed.
      if (
        /\/v2\/staff\/invitation-recipient-(session|lease)$/.test(String(url)) &&
        response.status >= 400 &&
        response.status <= 599
      ) {
        void response.body?.cancel().catch(() => {});
        throw new ApiClientError('HTTP', 'Recipient identity unavailable.', {
          status: response.status,
          submissionUncertain: false,
        });
      }
      return response;
    },
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
  // One aggregate deadline includes body parsing, identity checks and the outcome read/write.
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
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
  let dispatched = false,
    outcomeRead = false;
  try {
    const client = api(config, fetcher),
      options = { bearerToken: config.bearerToken, signal },
      session = await client.getStaffInvitationRecipientSession(options);
    if (signal.aborted) throw Error('Recipient request closed.');
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
    outcomeRead = true;
    const receipt = validateStaffInvitationRedemptionRecord(
      value,
      target.operationId,
      target.invitationId,
      session.actorId,
    );
    // A verified recipient is identity-only, including before membership exists.
    // Receipt recovery must not infer current staff/admin authority or reactivate a grant.
    const current = await client.getStaffInvitationRecipientSession(options);
    if (
      signal.aborted ||
      current.actorId !== session.actorId ||
      current.tenantId !== session.tenantId ||
      current.recipientEmail !== session.recipientEmail
    )
      return reply(403, {
        error: 'INVITATION_RECIPIENT_UNAVAILABLE',
        submissionUncertain: dispatched,
      });
    return reply(200, { receipt });
  } catch (error) {
    return reply(
      error instanceof ApiClientError ? upstreamFailureStatus(error.status, error.kind) : 503,
      {
        error: 'INVITATION_RECIPIENT_UNAVAILABLE',
        submissionUncertain:
          dispatched &&
          (outcomeRead || !(error instanceof ApiClientError) || error.submissionUncertain),
      },
    );
  }
}

/** Page configuration exposes only the opaque preview instance; identity facts are fetched after hydration. */
export function invitationRecipientPageConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return { instanceId: configuration(env).config.instanceId };
}
export async function invitationRecipientLeaseRequest(
  request: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: typeof fetch = fetch,
) {
  try {
    const selected = configuration(env),
      config = staffDirectoryPreviewContext(request, selected.scoped);
    if (request.method !== 'GET') return reply(405, { error: 'RECIPIENT_LEASE_UNAVAILABLE' });
    if (
      new URL(request.url).pathname !== '/api/invitation-acceptance/lease' ||
      request.url.includes('?') ||
      request.url.includes('#') ||
      request.body !== null ||
      ['content-length', 'content-type', 'transfer-encoding', 'range', 'content-encoding'].some(
        (k) => request.headers.has(k),
      )
    )
      return reply(400, { error: 'INVALID_RECIPIENT_LEASE' });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
    const lease = await api(config, fetcher).getStaffInvitationRecipientLease({
      bearerToken: config.bearerToken,
      signal,
      timeoutMs: 5000,
    });
    if (signal.aborted || Date.now() >= Date.parse(lease.expiresAt)) throw Error();
    return reply(200, lease);
  } catch (error) {
    return reply(
      error instanceof ApiClientError ? upstreamFailureStatus(error.status, error.kind) : 403,
      { error: 'RECIPIENT_LEASE_UNAVAILABLE' },
    );
  }
}
