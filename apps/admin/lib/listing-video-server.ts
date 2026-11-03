import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import { validateListingVideoCommand, parseListingVideoJson } from '@realtor/domain';
import { previewConfiguration, assertPreviewRequest } from './staff-preview-policy.ts';
import { readReferenceJson } from './reference-draft-wire.ts';
import { readListingVideoScreen, videoEnvironment } from './listing-video-screen.ts';
const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const reply = (status: number, submissionUncertain = false) =>
  Response.json(
    { error: { code: 'PRIVATE_VIDEO_UNAVAILABLE' }, submissionUncertain },
    { status, headers },
  );
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export async function listingVideoRequest(
  request: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: typeof fetch,
): Promise<Response> {
  let captured: ReturnType<typeof videoEnvironment>,
    config: ReturnType<typeof previewConfiguration>;
  try {
    captured = videoEnvironment(env);
    config = previewConfiguration(captured);
    assertPreviewRequest(request, config.instanceId);
  } catch {
    return reply(403);
  }
  const deadline = new AbortController(),
    timer = setTimeout(() => deadline.abort(), 10000),
    signal = AbortSignal.any([request.signal, deadline.signal]);
  let writing = false,
    dispatched = false,
    resultReturned = false;
  try {
    const url = new URL(request.url),
      m = new RegExp(`^/api/staff/listings/(${uuid})/video-operations/(${uuid})(/recover)?$`).exec(
        url.pathname,
      );
    if (!m) return reply(404);
    if (request.method !== 'POST') return reply(405);
    writing = !m[3];
    if (request.url.includes('?') || request.url.includes('#')) return reply(400);
    let forbidden = false;
    request.headers.forEach((_, k) => {
      if (
        [
          'cookie',
          'content-encoding',
          'transfer-encoding',
          'expect',
          'range',
          'idempotency-key',
        ].includes(k) ||
        k.startsWith('if-') ||
        (k.startsWith('x-') &&
          ![
            'x-preview-instance',
            'x-reference-actor',
            'x-reference-tenant',
            'x-forwarded-for',
            'x-forwarded-host',
            'x-forwarded-proto',
            'x-forwarded-port',
          ].includes(k))
      )
        forbidden = true;
    });
    if (forbidden) return reply(400);
    const command = validateListingVideoCommand(
      await readReferenceJson(request, 2048, signal, parseListingVideoJson),
    );
    if (command.listingId !== m[1] || command.operationId !== m[2]) return reply(400);
    const screen = await readListingVideoScreen(
      command.listingId,
      String(command.revision),
      captured,
      transport,
      signal,
    );
    if (
      request.headers.get('x-reference-actor') !== screen.scope.actorId ||
      request.headers.get('x-reference-tenant') !== screen.scope.tenantId
    )
      return reply(409);
    if (writing && (!screen.editable || screen.state.version !== command.expectedVersion))
      return reply(409);
    if (signal.aborted) throw Error('Cancelled.');
    const client = new RealtorApiClient({
        baseUrl: config.origin,
        privacyNoticeVersion: 'synthetic-preview-v1',
        allowLoopbackHttp: true,
        ...(transport ? { fetch: transport } : {}),
      }),
      options = { bearerToken: config.bearerToken, signal, timeoutMs: 10000 };
    dispatched = writing;
    const result = writing
      ? await client.savePrivateListingVideo(command, options)
      : await client.getPrivateListingVideoOriginal(command, options);
    resultReturned = writing;
    const current = await client.getCurrentStaffSessionV2(options);
    if (current.actorId !== screen.scope.actorId || current.tenantId !== screen.scope.tenantId)
      return reply(403, writing);
    if (result.actorId !== current.actorId || signal.aborted) throw Error('Unconfirmed.');
    return Response.json(result, { headers });
  } catch (e) {
    if (request.signal.aborted || deadline.signal.aborted)
      return reply(deadline.signal.aborted ? 504 : 499, writing && dispatched);
    if (e instanceof ApiClientError)
      return reply(
        e.status && e.status >= 400 && e.status < 600 ? e.status : 502,
        writing && dispatched && (resultReturned || e.kind !== 'HTTP' || e.submissionUncertain),
      );
    return reply(dispatched ? 502 : 400, writing && dispatched);
  } finally {
    clearTimeout(timer);
  }
}
