import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import { validateReviewMediaGallery } from '@realtor/domain';
import { assertPreviewRequest, previewConfiguration } from './staff-preview-policy.ts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const reply = (status: number, code: string) =>
  Response.json(
    { error: { code, message: 'Reviewer media is unavailable.' }, submissionUncertain: false },
    { status, headers },
  );
type Params = { id: string; revision: string; mediaId?: string };
/** Fixed server-only entry points; no caller can select a draft policy or upstream route. */
export function reviewGalleryRequest(
  request: Request,
  params: { id: string; revision: string },
): Promise<Response> {
  return handle(request, params, 'gallery');
}
export function reviewImageRequest(
  request: Request,
  params: { id: string; revision: string; mediaId: string },
): Promise<Response> {
  return handle(request, params, 'image');
}
async function handle(
  request: Request,
  params: Params,
  kind: 'gallery' | 'image',
): Promise<Response> {
  let config: ReturnType<typeof previewConfiguration>;
  try {
    config = previewConfiguration(process.env);
    if (process.env.STAFF_PREVIEW_MEDIA !== 'synthetic') throw Error();
    assertPreviewRequest(request, config.instanceId);
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== `http://${request.headers.get('host')}`) throw Error();
  } catch {
    return reply(403, 'PREVIEW_UNAVAILABLE');
  }
  if (request.method !== 'GET') return reply(405, 'METHOD_NOT_ALLOWED');
  let version: string, revision: number;
  try {
    const url = new URL(request.url),
      expected = request.headers.get('x-revision-version');
    const suffix = kind === 'gallery' ? 'media-gallery' : `media/${params.mediaId}/preview`;
    if (
      url.search ||
      url.hash ||
      request.url.includes('?') ||
      request.body !== null ||
      !UUID.test(params.id) ||
      !/^[1-9]\d{0,9}$/.test(params.revision) ||
      Number(params.revision) > 2147483647 ||
      (kind === 'image' && (typeof params.mediaId !== 'string' || !UUID.test(params.mediaId))) ||
      url.pathname !== `/api/staff/reviews/${params.id}/${params.revision}/${suffix}` ||
      expected === null ||
      !/^[1-9]\d{0,15}$/.test(expected) ||
      BigInt(expected) > 9007199254740991n
    )
      throw Error();
    let forbidden = false;
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
        ].includes(name) ||
        name.startsWith('if-')
      )
        forbidden = true;
    });
    if (forbidden) throw Error();
    version = expected;
    revision = Number(params.revision);
  } catch {
    return reply(400, 'INVALID_INPUT');
  }
  if (request.signal.aborted) return reply(499, 'CANCELLED');
  try {
    const client = new RealtorApiClient({
      baseUrl: config.origin,
      privacyNoticeVersion: 'synthetic-preview-v1',
      allowLoopbackHttp: true,
    });
    const options = { bearerToken: config.bearerToken, signal: request.signal, timeoutMs: 30000 },
      listing = params.id.toLowerCase();
    if (kind === 'gallery') {
      const data = await client.getReviewMediaGalleryV2(listing, revision, version, options);
      if (request.signal.aborted) return reply(499, 'CANCELLED');
      return Response.json(validateReviewMediaGallery(data, listing, revision, version), {
        headers,
      });
    }
    const media = params.mediaId!.toLowerCase(),
      image = await client.getReviewMediaPreviewV2(listing, revision, media, version, options);
    if (request.signal.aborted) return reply(499, 'CANCELLED');
    if (
      image.listingId !== listing ||
      image.revision !== revision ||
      image.mediaId !== media ||
      image.version !== version ||
      image.mimeType !== 'image/webp' ||
      !(image.data instanceof Uint8Array) ||
      image.data.byteLength < 20 ||
      image.data.byteLength > 10485760
    )
      return reply(502, 'PREVIEW_UNAVAILABLE');
    const bytes = new Uint8Array(image.data);
    return new Response(bytes, {
      headers: {
        ...headers,
        'Content-Type': 'image/webp',
        'Content-Length': String(bytes.byteLength),
        'X-Revision-Version': version,
      },
    });
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.kind === 'CANCELLED') return reply(499, 'CANCELLED');
      if (error.kind === 'TIMEOUT') return reply(504, 'PREVIEW_UNAVAILABLE');
      if (error.kind === 'VALIDATION') return reply(400, 'INVALID_INPUT');
      if (error.kind === 'HTTP') {
        const codes: Record<number, string> = {
          400: 'INVALID_INPUT',
          401: 'UNAUTHENTICATED',
          403: 'FORBIDDEN',
          404: 'NOT_FOUND',
          409: 'VERSION_CONFLICT',
          429: 'RATE_LIMITED',
          503: 'PREVIEW_UNAVAILABLE',
        };
        if (error.status !== undefined && codes[error.status])
          return reply(error.status, codes[error.status]!);
      }
    }
    return reply(502, 'PREVIEW_UNAVAILABLE');
  }
}
