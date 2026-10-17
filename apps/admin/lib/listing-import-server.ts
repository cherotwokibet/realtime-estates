import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import { previewListingImport, validateListingImportPreview } from '@realtor/domain';
import { assertPreviewRequest, previewConfiguration } from './staff-preview-policy.ts';
import { parseCreationJson } from './listing-creation-wire.ts';
const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const reply = (status: number, code: string) =>
  Response.json(
    { error: { code, message: 'Import preview is unavailable.' }, submissionUncertain: false },
    { status, headers },
  );
/** Local synthetic adapter only; no browser bearer or caller-selected upstream. */
export async function listingImportPreviewRequest(request: Request): Promise<Response> {
  let config: ReturnType<typeof previewConfiguration>;
  try {
    config = previewConfiguration(process.env);
    assertPreviewRequest(request, config.instanceId);
  } catch {
    return reply(403, 'PREVIEW_UNAVAILABLE');
  }
  if (request.method !== 'POST') return reply(405, 'METHOD_NOT_ALLOWED');
  if (request.signal.aborted) return reply(499, 'CANCELLED');
  const deadline = new AbortController(),
    timer = setTimeout(() => deadline.abort(), 30000);
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  let dispatched = false;
  try {
    const url = new URL(request.url);
    if (
      url.pathname !== '/api/staff/listing-import-preview' ||
      url.search ||
      url.hash ||
      request.url.includes('?')
    )
      throw Error();
    let forbidden = false;
    request.headers.forEach((_, name) => {
      if (
        [
          'cookie',
          'content-encoding',
          'transfer-encoding',
          'expect',
          'range',
          'idempotency-key',
          'x-actor-id',
          'x-tenant-id',
          'x-role',
          'x-actor',
          'x-tenant',
          'x-company-id',
          'x-assigned-agent-id',
        ].includes(name) ||
        name.startsWith('if-')
      )
        forbidden = true;
    });
    if (
      forbidden ||
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        request.headers.get('content-type') ?? '',
      )
    )
      throw Error();
    const declared = request.headers.get('content-length'),
      maximum = 256 * 1024;
    if (declared !== null && (!/^(0|[1-9]\d*)$/.test(declared) || Number(declared) > maximum))
      throw Error();
    const reader = request.body?.getReader();
    if (!reader) throw Error();
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (signal.aborted) throw Error();
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maximum) {
          await reader.cancel();
          throw Error();
        }
        chunks.push(part.value);
      }
    } finally {
      signal.removeEventListener('abort', cancel);
      reader.releaseLock();
    }
    if (signal.aborted) throw Error();
    if (declared !== null && Number(declared) !== size) throw Error();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const input = parseCreationJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Reflect.ownKeys(input).length !== 1 ||
      !Object.hasOwn(input, 'csv')
    )
      throw Error();
    const csv = (input as { csv: unknown }).csv;
    if (typeof csv !== 'string') throw Error();
    previewListingImport(csv);
    dispatched = true;
    const client = new RealtorApiClient({
      baseUrl: config.origin,
      privacyNoticeVersion: 'synthetic-preview-v1',
      allowLoopbackHttp: true,
    });
    const data = await client.previewListingImportV2(csv, {
      bearerToken: config.bearerToken,
      signal,
      timeoutMs: 30000,
    });
    if (signal.aborted) throw Error();
    return Response.json(validateListingImportPreview(data, csv), { headers });
  } catch (error) {
    if (request.signal.aborted) return reply(499, 'CANCELLED');
    if (deadline.signal.aborted) return reply(504, 'PREVIEW_UNAVAILABLE');
    if (error instanceof ApiClientError) {
      if (error.kind === 'CANCELLED') return reply(499, 'CANCELLED');
      if (error.kind === 'TIMEOUT') return reply(504, 'PREVIEW_UNAVAILABLE');
      if (error.kind === 'VALIDATION') return reply(400, 'INVALID_INPUT');
      const codes: Record<number, string> = {
        400: 'INVALID_INPUT',
        401: 'UNAUTHENTICATED',
        403: 'FORBIDDEN',
        404: 'NOT_FOUND',
        413: 'INVALID_INPUT',
        415: 'INVALID_INPUT',
        422: 'INVALID_INPUT',
        429: 'RATE_LIMITED',
        503: 'PREVIEW_UNAVAILABLE',
      };
      if (error.kind === 'HTTP' && error.status !== undefined && codes[error.status])
        return reply(error.status, codes[error.status]!);
    }
    return reply(dispatched ? 502 : 400, dispatched ? 'PREVIEW_UNAVAILABLE' : 'INVALID_INPUT');
  } finally {
    clearTimeout(timer);
  }
}
