import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import { parseStaffInvitationJson, validateStaffBranchCommand } from '@realtor/domain';
import { staffDirectoryPreviewContext } from './staff-directory-server.ts';
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
    const declared = request.headers.get('content-length');
    if (
      (declared !== null && (!/^(0|[1-9]\d*)$/.test(declared) || Number(declared) > 8192)) ||
      !request.body
    )
      return reply(400, { error: 'INVALID_BRANCH_REQUEST' });
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
      if (declared !== null && Number(declared) !== bytes) throw Error();
      command = validateStaffBranchCommand(parseStaffInvitationJson(text));
      if (command.operationId !== target) throw Error();
    } catch {
      return reply(400, { error: 'INVALID_BRANCH_REQUEST' });
    } finally {
      if (timer) clearTimeout(timer);
      void reader.cancel().catch(() => {});
      reader.releaseLock();
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
