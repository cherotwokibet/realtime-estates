import 'server-only';
import { ApiClientError, RealtorApiClient } from '@realtor/api-client';
import { validateSyntheticReferenceTransitionCommand } from '@realtor/domain';
import { assertPreviewRequest, previewConfiguration } from './staff-preview-policy.ts';
import { readReferenceModerationJson } from './reference-moderation-wire.ts';
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
        code: status === 409 ? 'CONFLICT' : 'REFERENCE_MODERATION_UNAVAILABLE',
        message: 'Reload the private synthetic moderation workspace.',
      },
      submissionUncertain,
    },
    { status, headers },
  );
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
/** Unmounted default-off loopback candidate. Browser scope/catalogue hints never supply API authority. */
export async function referenceModerationRequest(request: Request): Promise<Response> {
  let config: ReturnType<typeof previewConfiguration>;
  try {
    config = previewConfiguration(process.env);
    if (
      process.env.STAFF_PREVIEW_REFERENCE !== 'synthetic-reference-draft-v1' ||
      process.env.STAFF_PREVIEW_REFERENCE_MODERATION !== 'synthetic-reference-transition-v1'
    )
      throw Error();
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
      operation = new RegExp(
        `^/api/staff/listings/(${uuid})/reference-transition-operations/(${uuid})(/recover)?$`,
      ).exec(url.pathname),
      revision = new RegExp(
        `^/api/staff/(listings|reviews)/(${uuid})/reference-revisions/([1-9]\\d{0,9})/([1-9]\\d{0,15})/([1-9]\\d{0,15})$`,
      ).exec(url.pathname);
    if (!operation && !revision) return reply(404);
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
    if (
      revision &&
      (Number(revision[3]) > 2147483647 ||
        BigInt(revision[4]!) > 9007199254740991n ||
        BigInt(revision[5]!) > 9007199254740991n)
    )
      throw Error();
    const input = operation ? await readReferenceModerationJson(request, signal) : undefined;
    const client = new RealtorApiClient({
        baseUrl: config.origin,
        privacyNoticeVersion: 'synthetic-preview-v1',
        allowLoopbackHttp: true,
      }),
      options = { bearerToken: config.bearerToken, signal, timeoutMs: 10000 };
    const current = await client.getSyntheticReferenceSessionV3(options);
    if (signal.aborted) throw Error();
    if (
      request.headers.get('x-reference-actor') !== current.actorId ||
      request.headers.get('x-reference-tenant') !== current.tenantId
    )
      return reply(409);
    let result;
    if (revision) {
      // This hint must match the actual stored snapshot under SDK/API validation; it cannot rename or adopt anything.
      const catalogue = await client.getSyntheticReferenceCatalogueV3(revision[5]!, options);
      result =
        revision[1] === 'reviews'
          ? await client.getSyntheticReferenceReviewV3(
              revision[2]!,
              Number(revision[3]),
              revision[4]!,
              catalogue,
              options,
            )
          : await client.getSyntheticReferenceRevisionV3(
              revision[2]!,
              Number(revision[3]),
              revision[4]!,
              catalogue,
              options,
            );
    } else if (operation) {
      const version = (input as { review?: { attributes?: { catalogueVersion?: unknown } } })
        ?.review?.attributes?.catalogueVersion;
      if (
        typeof version !== 'string' ||
        !/^[1-9]\d{0,15}$/.test(version) ||
        BigInt(version) > 9007199254740991n
      )
        throw Error();
      const original = await client.getSyntheticReferenceCatalogueV3(version, options),
        command = validateSyntheticReferenceTransitionCommand(input, original);
      if (command.listingId !== operation[1] || command.operationId !== operation[2]) throw Error();
      if (signal.aborted) throw Error();
      dispatched = writing;
      result = writing
        ? await client.transitionSyntheticReferenceRevisionV3(
            command,
            original,
            current.actorId,
            options,
          )
        : await client.getSyntheticReferenceTransitionReceiptV3(
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
              : error.kind === 'VALIDATION'
                ? 400
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
