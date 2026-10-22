import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import {
  validateListingDuplicateRequest,
  validateListingDuplicateCandidates,
  type ListingDuplicateRequest,
} from '@realtor/domain';
import { assertPreviewRequest, previewConfiguration } from './staff-preview-policy.ts';

const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const reply = (status: number, code: string) =>
  Response.json(
    { error: { code, message: 'Possible matches are unavailable.' }, submissionUncertain: false },
    { status, headers },
  );
/** Fixed local synthetic adapter. Production identity composition is a separate gate. */
export async function listingDuplicateCandidatesRequest(request: Request): Promise<Response> {
  let config: ReturnType<typeof previewConfiguration>;
  try {
    config = previewConfiguration(process.env);
    assertPreviewRequest(request, config.instanceId, 'empty');
  } catch {
    return reply(403, 'PREVIEW_UNAVAILABLE');
  }
  if (request.method !== 'GET') return reply(405, 'METHOD_NOT_ALLOWED');
  if (request.signal.aborted) return reply(499, 'CANCELLED');
  let lookup: ListingDuplicateRequest;
  try {
    const url = new URL(request.url);
    const path = /^\/api\/staff\/listings\/([0-9a-f-]{36})\/duplicate-candidates$/.exec(
      url.pathname,
    );
    const query =
      /^\?listingVersion=([1-9]\d{0,15})&revision=([1-9]\d{0,9})&revisionVersion=([1-9]\d{0,15})&limit=([1-9]\d?)$/.exec(
        url.search,
      );
    let forbidden =
      request.body !== null ||
      request.url.includes('#') ||
      !path ||
      !query ||
      (request.headers.has('origin') &&
        request.headers.get('origin') !== `http://${request.headers.get('host')}`);
    request.headers.forEach((_, name) => {
      if (
        [
          'cookie',
          'content-type',
          'content-length',
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
    if (forbidden || !path || !query) throw Error();
    lookup = validateListingDuplicateRequest({
      listingId: path[1],
      listingVersion: query[1],
      revision: Number(query[2]),
      revisionVersion: query[3],
      limit: Number(query[4]),
    });
  } catch {
    return reply(400, 'INVALID_INPUT');
  }
  try {
    const client = new RealtorApiClient({
      baseUrl: config.origin,
      privacyNoticeVersion: 'synthetic-preview-v1',
      allowLoopbackHttp: true,
    });
    const result = await client.getListingDuplicateCandidatesV2(lookup, {
      bearerToken: config.bearerToken,
      signal: request.signal,
      timeoutMs: 30000,
    });
    if (request.signal.aborted) return reply(499, 'CANCELLED');
    return Response.json(validateListingDuplicateCandidates(result, lookup), { headers });
  } catch (error) {
    if (request.signal.aborted) return reply(499, 'CANCELLED');
    if (error instanceof ApiClientError) {
      if (error.kind === 'CANCELLED') return reply(499, 'CANCELLED');
      if (error.kind === 'TIMEOUT') return reply(504, 'PREVIEW_UNAVAILABLE');
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
        return reply(error.status, codes[error.status]!);
    }
    return reply(502, 'PREVIEW_UNAVAILABLE');
  }
}
