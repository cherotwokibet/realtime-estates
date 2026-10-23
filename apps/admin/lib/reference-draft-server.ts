import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import { validateSyntheticReferenceDraftCommand } from '@realtor/domain';
import { assertPreviewRequest, previewConfiguration } from './staff-preview-policy.ts';
import { readReferenceJson } from './reference-draft-wire.ts';
const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const reply = (status: number, submissionUncertain = false) =>
  Response.json(
    {
      error: {
        code: status === 409 ? 'CONFLICT' : 'REFERENCE_UNAVAILABLE',
        message: 'Reload the private synthetic reference workspace.',
      },
      submissionUncertain,
    },
    { status, headers },
  );
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
/** Browser scope is a stale-session guard, never upstream authority. API checks verified identity/current membership on every call. */
export async function referenceDraftRequest(request: Request): Promise<Response> {
  let config: ReturnType<typeof previewConfiguration>;
  try {
    config = previewConfiguration(process.env);
    if (process.env.STAFF_PREVIEW_REFERENCE !== 'synthetic-reference-draft-v1') throw Error();
    assertPreviewRequest(request, config.instanceId);
  } catch {
    return reply(403);
  }
  const deadline = new AbortController(),
    timer = setTimeout(() => deadline.abort(), 10000),
    signal = AbortSignal.any([request.signal, deadline.signal]);
  let writing = false,
    dispatched = false;
  try {
    const url = new URL(request.url),
      catalogue = /^\/api\/staff\/reference-catalogues\/(current|[1-9]\d{0,15})$/.exec(
        url.pathname,
      ),
      session = url.pathname === '/api/staff/reference-session',
      operation = new RegExp(
        `^/api/staff/listings/(${uuid})/reference-draft-operations/(${uuid})(/recover)?$`,
      ).exec(url.pathname);
    if (!catalogue && !session && !operation) return reply(404);
    if (request.method !== (operation ? 'POST' : 'GET')) return reply(405);
    writing = !!operation && !operation[3];
    if (url.search || request.url.includes('?') || request.url.includes('#')) throw Error();
    let forbidden =
      request.headers.has('origin') &&
      request.headers.get('origin') !== `http://${request.headers.get('host')}`;
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
    if (
      forbidden ||
      (!operation &&
        (request.body !== null ||
          request.headers.has('content-type') ||
          request.headers.has('content-length')))
    )
      throw Error();
    if (catalogue && catalogue[1] !== 'current' && BigInt(catalogue[1]!) > 9007199254740991n)
      throw Error();
    const client = new RealtorApiClient({
        baseUrl: config.origin,
        privacyNoticeVersion: 'synthetic-preview-v1',
        allowLoopbackHttp: true,
      }),
      options = { bearerToken: config.bearerToken, signal, timeoutMs: 10000 };
    let input: unknown;
    if (operation) input = await readReferenceJson(request, 131072, signal);
    const current = await client.getSyntheticReferenceSessionV3(options);
    if (signal.aborted) throw Error();
    if (session) return Response.json({ ...current, instanceId: config.instanceId }, { headers });
    if (
      request.headers.get('x-reference-actor') !== current.actorId ||
      request.headers.get('x-reference-tenant') !== current.tenantId
    )
      return reply(409);
    let result: unknown;
    if (catalogue) result = await client.getSyntheticReferenceCatalogueV3(catalogue[1]!, options);
    else if (operation) {
      const version = (input as { selection?: { catalogueVersion?: unknown } })?.selection
        ?.catalogueVersion;
      if (
        typeof version !== 'string' ||
        !/^[1-9]\d{0,15}$/.test(version) ||
        BigInt(version) > 9007199254740991n
      )
        throw Error();
      const original = await client.getSyntheticReferenceCatalogueV3(version, options),
        command = validateSyntheticReferenceDraftCommand(input, original);
      if (command.listingId !== operation[1] || command.operationId !== operation[2]) throw Error();
      dispatched = writing;
      result = writing
        ? await client.saveSyntheticReferenceDraftV3(command, original, current.actorId, options)
        : await client.getSyntheticReferenceDraftReceiptV3(
            command,
            original,
            current.actorId,
            options,
          );
    }
    if (signal.aborted) throw Error();
    return Response.json(result, { headers });
  } catch (error) {
    const uncertain = writing && dispatched;
    if (request.signal.aborted) return reply(499, uncertain);
    if (deadline.signal.aborted) return reply(504, uncertain);
    if (error instanceof ApiClientError) {
      const status =
        error.kind === 'HTTP' && error.status && error.status >= 400 && error.status <= 599
          ? error.status
          : error.kind === 'CANCELLED'
            ? 499
            : error.kind === 'TIMEOUT'
              ? 504
              : 502;
      return reply(
        status,
        uncertain && (error.kind !== 'HTTP' || error.submissionUncertain === true),
      );
    }
    return reply(400, uncertain);
  } finally {
    clearTimeout(timer);
  }
}
