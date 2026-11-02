import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import {
  parseStaffInvitationJson,
  validateStaffDirectoryQuery,
  type StaffMembershipPage,
} from '@realtor/domain';
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
    if (!['branches', 'invitations'].includes(kind)) throw Error();
    config = staffDirectoryPreviewContext(request, env);
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

export function staffDirectoryPreviewContext(
  request: Request,
  env: Readonly<Record<string, string | undefined>>,
) {
  const config = previewConfiguration(env);
  if (env.STAFF_DIRECTORY_PREVIEW_MODE !== 'synthetic-v1') throw Error();
  assertPreviewRequest(request, config.instanceId);
  // Next's Node adapter adds these transport facts. They never select identity or
  // authority; accept only its complete, exact loopback shape after Host validation.
  const forwarded = [
    'x-forwarded-host',
    'x-forwarded-port',
    'x-forwarded-proto',
    'x-forwarded-for',
  ];
  if (forwarded.some((key) => request.headers.has(key))) {
    const url = new URL(request.url);
    if (
      request.headers.get('x-forwarded-host') !== request.headers.get('host') ||
      request.headers.get('x-forwarded-port') !== (url.port || '80') ||
      request.headers.get('x-forwarded-proto') !== 'http' ||
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
        request.headers.get('x-forwarded-for') ?? '',
      )
    )
      throw Error();
  }
  const headerNames: string[] = [];
  request.headers.forEach((_, key) => headerNames.push(key));
  for (const key of headerNames)
    if (
      ['cookie', 'idempotency-key', 'range', 'content-encoding'].includes(key) ||
      key.startsWith('if-') ||
      (key.startsWith('x-') && key !== 'x-preview-instance' && !forwarded.includes(key))
    )
      throw Error();
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== 'http://' + request.headers.get('host')) throw Error();

  return config;
}

/** Bounded exact JSON for private synthetic staff commands; no unbounded request.json(). */
export async function readStaffDirectoryCommandBody(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (
    (declared !== null && (!/^(0|[1-9]\d*)$/.test(declared) || Number(declared) > 8192)) ||
    !request.body
  )
    throw Error('Invalid body framing.');
  const reader = request.body.getReader(),
    decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0,
    empty = 0,
    text = '',
    timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Error('Body deadline')), 5000);
  });
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) break;
      if (!chunk.value.byteLength) {
        if (++empty > 1024) throw Error();
        if (empty % 64 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
        continue;
      }
      empty = 0;
      bytes += chunk.value.byteLength;
      if (bytes > 8192 || request.signal.aborted) throw Error();
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    if (request.signal.aborted || (declared !== null && Number(declared) !== bytes)) throw Error();
    return parseStaffInvitationJson(text);
  } finally {
    if (timer) clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function loadStaffDirectoryWorkspace(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: typeof fetch = fetch,
) {
  const config = previewConfiguration(env);
  if (env.STAFF_DIRECTORY_PREVIEW_MODE !== 'synthetic-v1')
    throw Error('Staff workspace unavailable.');
  const api = new RealtorApiClient({
      baseUrl: config.origin,
      privacyNoticeVersion: 'synthetic-staff-notice-v1',
      allowLoopbackHttp: true,
      fetch: fetcher,
      timeoutMs: 10000,
    }),
    options = { bearerToken: config.bearerToken };
  const session = await api.getCurrentStaffSessionV2(options);
  const [branches, invitations] = await Promise.all([
    api.listStaffBranches({ limit: 10, after: null }, options),
    api.listStaffInvitationRequests({ limit: 10, after: null }, options),
  ]);
  let memberships: StaffMembershipPage | null = null;
  if (env.STAFF_MEMBERSHIP_PREVIEW_MODE !== undefined) {
    if (env.STAFF_MEMBERSHIP_PREVIEW_MODE !== 'synthetic-existing-members-v1')
      throw Error('Staff membership workspace unavailable.');
    memberships = await api.listStaffMemberships({ limit: 10, after: null }, options);
  }
  if (
    env.STAFF_INVITATION_ISSUE_PREVIEW_MODE !== undefined &&
    env.STAFF_INVITATION_ISSUE_PREVIEW_MODE !== 'synthetic-single-use-invitations-v1'
  )
    throw Error('Invitation issuance workspace unavailable.');
  return {
    issuanceEnabled:
      env.STAFF_INVITATION_ISSUE_PREVIEW_MODE === 'synthetic-single-use-invitations-v1',
    scope: { instanceId: config.instanceId, tenantId: session.tenantId, actorId: session.actorId },
    branches,
    invitations,
    memberships,
  };
}
