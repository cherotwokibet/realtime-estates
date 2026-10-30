import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import type { ListingReportQueue } from '@realtor/domain';
import { parseListingReportJson, validateListingReportDecisionCommand } from '@realtor/domain';
import { previewConfiguration, assertPreviewRequest } from './staff-preview-policy.ts';
const reply = (status: number, body: unknown) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
export async function listingReportDecisionBoundary(
  request: Request,
  reportId: string,
  operationId: string,
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
  const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (
    !id.test(reportId) ||
    !id.test(operationId) ||
    new URL(request.url).search ||
    request.url.includes('#') ||
    request.headers.has('idempotency-key') ||
    request.headers.has('content-encoding') ||
    !['GET', 'POST'].includes(request.method)
  )
    return reply(400, { error: 'INVALID_REPORT_REVIEW' });
  let command: ReturnType<typeof validateListingReportDecisionCommand> | undefined;
  if (request.method === 'GET') {
    if (
      request.body !== null ||
      request.headers.has('content-type') ||
      request.headers.has('content-length')
    )
      return reply(400, { error: 'INVALID_REPORT_REVIEW' });
  } else {
    const declared = request.headers.get('content-length');
    if (declared !== null && (!/^(0|[1-9]\d*)$/.test(declared) || Number(declared) > 8192))
      return reply(413, { error: 'BODY_TOO_LARGE' });
    if (!request.body) return reply(400, { error: 'INVALID_REPORT_REVIEW' });
    const reader = request.body.getReader();
    let bytes = 0,
      empty = 0,
      text = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error('Body deadline')), 5000);
    });
    try {
      for (;;) {
        const p = await Promise.race([reader.read(), deadline]);
        if (p.done) break;
        if (!p.value.byteLength) {
          if (++empty > 1024) throw Error();
          if (empty % 64 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
          continue;
        }
        empty = 0;
        bytes += p.value.byteLength;
        if (bytes > 8192 || request.signal.aborted) throw Error();
        text += decoder.decode(p.value, { stream: true });
      }
      text += decoder.decode();
      if (declared !== null && Number(declared) !== bytes) throw Error();
      command = validateListingReportDecisionCommand(parseListingReportJson(text));
      if (command.reportId !== reportId || command.operationId !== operationId) throw Error();
    } catch {
      return reply(400, { error: 'INVALID_REPORT_REVIEW' });
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
    const receipt = command
      ? await api.decideListingReport(command, options)
      : await api.getListingReportDecision(reportId, operationId, options);
    return reply(200, { receipt });
  } catch (e) {
    return reply(e instanceof ApiClientError ? (e.status ?? 503) : 503, {
      error: 'REPORT_REVIEW_UNAVAILABLE',
      submissionUncertain: e instanceof ApiClientError ? e.submissionUncertain : !!command,
    });
  }
}
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
