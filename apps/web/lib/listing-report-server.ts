import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import { parseListingReportJson, validateListingReportCommand } from '@realtor/domain';
import { authorizeListingReport, listingReportConfig } from './listing-report-config.ts';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const reply = (status: number, body: unknown) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
/** Public BFF: fixed server origin; no browser identity, arbitrary URL or hidden retry. */
export async function handleListingReport(
  request: Request,
  listingId: string,
  operationId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  let scope: ReturnType<typeof listingReportConfig>;
  try {
    scope = listingReportConfig(env);
    authorizeListingReport(request, scope.instanceId);
  } catch {
    return reply(403, { error: 'REPORT_UNAVAILABLE' });
  }
  if (
    !uuid.test(listingId) ||
    !uuid.test(operationId) ||
    new URL(request.url).search ||
    !['GET', 'POST'].includes(request.method)
  )
    return reply(400, { error: 'INVALID_REPORT_REQUEST' });
  let command: ReturnType<typeof validateListingReportCommand> | undefined;
  if (request.method === 'GET') {
    if (
      request.body !== null ||
      request.headers.has('content-type') ||
      request.headers.has('content-length')
    )
      return reply(400, { error: 'INVALID_REPORT_REQUEST' });
  } else {
    if (
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        request.headers.get('content-type') ?? '',
      ) ||
      request.headers.has('transfer-encoding')
    )
      return reply(415, { error: 'JSON_REQUIRED' });
    const length = request.headers.get('content-length');
    if (length !== null && (!/^(0|[1-9]\d*)$/.test(length) || Number(length) > 8192))
      return reply(413, { error: 'BODY_TOO_LARGE' });
    if (!request.body) return reply(400, { error: 'INVALID_REPORT_REQUEST' });
    const reader = request.body.getReader();
    let emptyFrames = 0;
    let bytes = 0,
      text = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error('Body deadline')), 5000);
    });
    try {
      for (;;) {
        const part = await Promise.race([reader.read(), deadline]);
        if (part.done) break;
        if (!part.value.byteLength) {
          if (++emptyFrames > 1024) throw Error('Too many empty frames');
          if (emptyFrames % 64 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
          continue;
        }
        emptyFrames = 0;
        bytes += part.value.byteLength;
        if (bytes > 8192) throw Error('Body too large');
        if (request.signal.aborted) throw Error('Cancelled');
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
      if (length !== null && Number(length) !== bytes) throw Error('Length mismatch');
      command = validateListingReportCommand(parseListingReportJson(text));
      if (command.listingId !== listingId || command.operationId !== operationId)
        throw Error('Route mismatch');
    } catch {
      return reply(400, { error: 'INVALID_REPORT_REQUEST' });
    } finally {
      if (timer) clearTimeout(timer);
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  const api = new RealtorApiClient({
    baseUrl: scope.apiOrigin,
    privacyNoticeVersion: scope.noticeVersion,
    allowLoopbackHttp: true,
    fetch: fetcher,
    timeoutMs: 10000,
  });
  try {
    const receipt = command
      ? await api.captureListingReport(command, { signal: request.signal })
      : await api.getListingReportReceipt(listingId, operationId, { signal: request.signal });
    return reply(command ? 202 : 200, { receipt });
  } catch (e) {
    if (e instanceof ApiClientError)
      return reply(e.status ?? 503, {
        error: e.kind,
        submissionUncertain: e.submissionUncertain,
        retryAfterSeconds: e.retryAfterSeconds ?? null,
      });
    return reply(503, { error: 'REPORT_UNAVAILABLE', submissionUncertain: !!command });
  }
}
