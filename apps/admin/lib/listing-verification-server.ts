import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import {
  validateListingVerificationCommand,
  validateListingVerificationReceipt,
  validateListingVerificationOriginal,
  validateListingVerificationHistory,
} from '@realtor/domain';
import { assertPreviewRequest, previewConfiguration } from './staff-preview-policy.ts';
import { parseVerificationJson } from './listing-verification-wire.ts';

const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const reply = (status: number, code: string, submissionUncertain = false) =>
  Response.json(
    { error: { code, message: 'Private check records are unavailable.' }, submissionUncertain },
    { status, headers },
  );
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Fixed loopback development adapter; credentials never come from browser input. */
export async function listingVerificationRequest(request: Request): Promise<Response> {
  let config: ReturnType<typeof previewConfiguration>;
  try {
    config = previewConfiguration(process.env);
    assertPreviewRequest(request, config.instanceId);
  } catch {
    return reply(403, 'PREVIEW_UNAVAILABLE');
  }
  if (!['GET', 'POST'].includes(request.method)) return reply(405, 'METHOD_NOT_ALLOWED');
  if (request.signal.aborted) return reply(499, 'CANCELLED');
  const deadline = new AbortController(),
    timer = setTimeout(() => deadline.abort(), 30000);
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  let dispatched = false;
  const writing = request.method === 'POST';
  try {
    const url = new URL(request.url),
      operation = new RegExp(
        `^/api/staff/listings/(${uuid})/verification-operations/(${uuid})$`,
      ).exec(url.pathname),
      history = new RegExp(`^/api/staff/listings/(${uuid})/verification-history$`).exec(
        url.pathname,
      );
    let forbidden =
      request.url.includes('#') ||
      (request.headers.has('origin') &&
        request.headers.get('origin') !== `http://${request.headers.get('host')}`);
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
          'x-revision-version',
        ].includes(name) ||
        name.startsWith('if-')
      )
        forbidden = true;
    });
    if (forbidden || (!operation && !history)) throw Error();
    let limit = 20,
      before: string | null = null;
    if (history) {
      const query = /^\?limit=([1-9]\d?)(?:&beforeVersion=([1-9]\d{0,15}))?$/.exec(url.search);
      if (writing || !query || Number(query[1]) > 25) throw Error();
      limit = Number(query[1]);
      before = query[2] ?? null;
      if (before !== null && BigInt(before) > 9007199254740991n) throw Error();
    } else if (url.search || request.url.includes('?')) throw Error();
    if (
      !writing &&
      (request.body !== null ||
        request.headers.has('content-type') ||
        request.headers.has('content-length'))
    )
      throw Error();
    const client = new RealtorApiClient({
      baseUrl: config.origin,
      privacyNoticeVersion: 'synthetic-preview-v1',
      allowLoopbackHttp: true,
    });
    const options = { bearerToken: config.bearerToken, signal, timeoutMs: 30000 };
    let result: unknown;
    if (writing) {
      if (
        !operation ||
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
          request.headers.get('content-type') ?? '',
        )
      )
        throw Error();
      const declared = request.headers.get('content-length');
      if (declared !== null && (!/^(0|[1-9]\d*)$/.test(declared) || Number(declared) > 16384))
        throw Error();
      const reader = request.body?.getReader();
      if (!reader) throw Error();
      let abort = () => {};
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(Error('Cancelled.'));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
      const chunks: Uint8Array[] = [];
      let size = 0,
        emptyReads = 0,
        complete = false;
      try {
        for (;;) {
          const part = await Promise.race([reader.read(), cancelled]);
          if (part.done) {
            complete = true;
            break;
          }
          if (part.value.byteLength === 0) {
            // Empty chunks must not consume memory or starve the abort/deadline timers.
            if (++emptyReads % 64 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
            if (signal.aborted) throw Error();
            continue;
          }
          size += part.value.byteLength;
          if (size > 16384 || signal.aborted) throw Error();
          chunks.push(part.value);
        }
      } finally {
        signal.removeEventListener('abort', abort);
        if (!complete) void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (signal.aborted || (declared !== null && Number(declared) !== size)) throw Error();
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const command = validateListingVerificationCommand(
        parseVerificationJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      );
      if (command.target.listingId !== operation[1] || command.operationId !== operation[2])
        throw Error();
      dispatched = true;
      result = validateListingVerificationReceipt(
        await client.recordSyntheticListingVerificationV2(command, options),
        command,
      );
    } else if (operation) {
      dispatched = true;
      result = validateListingVerificationOriginal(
        await client.getListingVerificationOriginalV2(operation[1]!, operation[2]!, options),
        operation[1]!,
        operation[2]!,
      );
    } else if (history) {
      dispatched = true;
      result = validateListingVerificationHistory(
        await client.getListingVerificationHistoryV2(history[1]!, limit, options, before),
        history[1]!,
        limit,
        before,
      );
    }
    if (signal.aborted) throw Error();
    return Response.json(result, { headers });
  } catch (error) {
    const uncertain = writing && dispatched;
    if (request.signal.aborted) return reply(499, 'CANCELLED', uncertain);
    if (deadline.signal.aborted) return reply(504, 'PREVIEW_UNAVAILABLE', uncertain);
    if (error instanceof ApiClientError) {
      if (error.kind === 'CANCELLED') return reply(499, 'CANCELLED', uncertain);
      if (error.kind === 'TIMEOUT') return reply(504, 'PREVIEW_UNAVAILABLE', uncertain);
      const codes: Record<number, string> = {
        400: 'INVALID_INPUT',
        401: 'UNAUTHENTICATED',
        403: 'FORBIDDEN',
        404: 'NOT_FOUND',
        409: 'CONFLICT',
        422: 'INVALID_INPUT',
        429: 'RATE_LIMITED',
        503: 'PREVIEW_UNAVAILABLE',
      };
      if (error.kind === 'HTTP' && error.status !== undefined && codes[error.status])
        return reply(error.status, codes[error.status]!, uncertain);
    }
    return reply(
      dispatched ? 502 : 400,
      dispatched ? 'PREVIEW_UNAVAILABLE' : 'INVALID_INPUT',
      uncertain,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** A successful history read establishes current-admin access for the initial private screen. */
export async function readInitialListingVerificationHistory(listingId: string) {
  const config = previewConfiguration(process.env),
    client = new RealtorApiClient({
      baseUrl: config.origin,
      privacyNoticeVersion: 'synthetic-preview-v1',
      allowLoopbackHttp: true,
    });
  return client.getListingVerificationHistoryV2(listingId, 20, {
    bearerToken: config.bearerToken,
    timeoutMs: 10000,
  });
}
