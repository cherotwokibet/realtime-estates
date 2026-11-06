import 'server-only';
import { RealtorApiClient, ApiClientError } from '@realtor/api-client';
import {
  validateFloorPlanAttachmentCommand,
  validateFloorPlanPreparationCommand,
  parseFloorPlanJson,
} from '@realtor/domain';
import { readSyntheticUploadBody, SyntheticUploadBodyError } from '@realtor/media/upload-body';
import { previewConfiguration, assertPreviewRequest } from './staff-preview-policy.ts';
import { readRevisionProtocolScreen } from './revision-protocol-screen.ts';
import { readReferenceJson } from './reference-draft-wire.ts';
const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const reply = (status: number, submissionUncertain = false) =>
  Response.json(
    { error: { code: 'PRIVATE_FLOOR_PLAN_UNAVAILABLE' }, submissionUncertain },
    { status, headers },
  );
export function floorPlanEnvironment(env: Readonly<Record<string, string | undefined>>) {
  const result = Object.freeze(
    Object.fromEntries(
      [
        'NODE_ENV',
        'STAFF_PREVIEW_MODE',
        'STAFF_PREVIEW_REFERENCE',
        'STAFF_PREVIEW_FLOOR_PLAN',
        'STAFF_PREVIEW_API_ORIGIN',
        'STAFF_PREVIEW_TOKEN',
        'STAFF_PREVIEW_INSTANCE',
      ].map((k) => [k, env[k]]),
    ),
  );
  if (
    result.STAFF_PREVIEW_FLOOR_PLAN !== 'synthetic-private-floor-plan-v1' ||
    result.STAFF_PREVIEW_REFERENCE !== 'synthetic-reference-draft-v1'
  )
    throw Error('Private floor plans unavailable.');
  previewConfiguration(result);
  return result;
}
async function readFloorPlanScreenForAudience(
  listingId: string,
  revision: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: typeof fetch,
  signal?: AbortSignal,
  reviewer = false,
) {
  const captured = floorPlanEnvironment(env),
    config = previewConfiguration(captured),
    initial = await readRevisionProtocolScreen(listingId, revision, captured, transport, signal);
  if (initial.protocol.protocol !== 'synthetic-reference-v1')
    throw Error('Adopted revision required.');
  const client = new RealtorApiClient({
    baseUrl: config.origin,
    privacyNoticeVersion: 'synthetic-preview-v1',
    allowLoopbackHttp: true,
    ...(transport ? { fetch: transport } : {}),
  });
  const options = { bearerToken: config.bearerToken, timeoutMs: 10000, signal };
  const state = reviewer
    ? await client.getReviewFloorPlan(
        listingId,
        initial.protocol.revision,
        initial.protocol.revisionVersion,
        options,
      )
    : await client.getFloorPlan(listingId, initial.protocol.revision, options);
  const final = await readRevisionProtocolScreen(listingId, revision, captured, transport, signal);
  if (
    JSON.stringify(initial) !== JSON.stringify(final) ||
    state.version !== final.protocol.revisionVersion
  )
    throw Error('Reload changed revision.');
  return Object.freeze({
    scope: Object.freeze({ ...final.scope, listingId, revision: final.protocol.revision }),
    state,
    editable: reviewer ? false : final.protocol.editable,
    audience: reviewer ? ('reviewer' as const) : ('author' as const),
  });
}
export function readFloorPlanScreen(
  listingId: string,
  revision: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: typeof fetch,
  signal?: AbortSignal,
) {
  return readFloorPlanScreenForAudience(listingId, revision, env, transport, signal, false);
}
export function readReviewFloorPlanScreen(
  listingId: string,
  revision: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: typeof fetch,
  signal?: AbortSignal,
) {
  return readFloorPlanScreenForAudience(listingId, revision, env, transport, signal, true);
}
let uploadBusy = false;
/** Synthetic loopback BFF: identities are comparison stamps, never selectors or upstream credentials. */
export async function floorPlanRequest(
  request: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport?: typeof fetch,
): Promise<Response> {
  let captured: ReturnType<typeof floorPlanEnvironment>,
    config: ReturnType<typeof previewConfiguration>;
  try {
    captured = floorPlanEnvironment(env);
    config = previewConfiguration(captured);
    assertPreviewRequest(
      request,
      config.instanceId,
      request.method === 'PUT' ? 'binary' : request.method === 'GET' ? 'empty' : 'json',
    );
  } catch {
    return reply(403);
  }
  const deadline = new AbortController(),
    timer = setTimeout(() => deadline.abort(), request.method === 'PUT' ? 60000 : 15000),
    signal = AbortSignal.any([request.signal, deadline.signal]);
  let writing = false,
    dispatched = false,
    resultReturned = false,
    ownsUpload = false;
  try {
    const url = new URL(request.url),
      uuid = '[0-9a-f-]{36}';
    const input = new RegExp(
        `^/api/staff/listings/(${uuid})/floor-plan-inputs/([1-9][0-9]{0,9})/([1-9][0-9]{0,15})/(${uuid})$`,
      ).exec(url.pathname),
      operation = new RegExp(
        `^/api/staff/listings/(${uuid})/floor-plan-operations/(${uuid})(/recover)?$`,
      ).exec(url.pathname),
      read = new RegExp(
        `^/api/staff/listings/(${uuid})/floor-plan-revisions/([1-9][0-9]{0,9})$`,
      ).exec(url.pathname);
    if (!input && !operation && !read) return reply(404);
    if (
      input
        ? !['PUT', 'GET'].includes(request.method)
        : operation
          ? request.method !== 'POST'
          : request.method !== 'GET'
    )
      return reply(405);
    writing = request.method === 'PUT' || Boolean(operation && !operation[3]);
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
    if (
      request.method === 'GET' &&
      (request.body || request.headers.has('content-type') || request.headers.has('content-length'))
    )
      return reply(400);
    const command = input
      ? validateFloorPlanPreparationCommand({
          policy: 'synthetic-floor-plan-preparation-command-v1',
          listingId: input[1],
          revision: Number(input[2]),
          expectedVersion: input[3],
          requestId: input[4],
        })
      : operation
        ? validateFloorPlanAttachmentCommand(
            await readReferenceJson(request, 2048, signal, parseFloorPlanJson),
          )
        : null;
    if (
      operation &&
      (command?.listingId !== operation[1] ||
        !('operationId' in command!) ||
        command.operationId !== operation[2])
    )
      return reply(400);
    const listingId = command?.listingId ?? read![1]!,
      revision = String(command?.revision ?? read![2]);
    const screen = await readFloorPlanScreen(listingId, revision, captured, transport, signal);
    if (
      request.headers.get('x-reference-actor') !== screen.scope.actorId ||
      request.headers.get('x-reference-tenant') !== screen.scope.tenantId
    )
      return reply(409);
    if (writing && (!screen.editable || screen.state.version !== command!.expectedVersion))
      return reply(409);
    const client = new RealtorApiClient({
        baseUrl: config.origin,
        privacyNoticeVersion: 'synthetic-preview-v1',
        allowLoopbackHttp: true,
        ...(transport ? { fetch: transport } : {}),
      }),
      options = {
        bearerToken: config.bearerToken,
        signal,
        timeoutMs: request.method === 'PUT' ? 60000 : 10000,
      };
    let result;
    if (input) {
      const preparation = validateFloorPlanPreparationCommand(command);
      if (writing) {
        if (uploadBusy) return reply(503);
        uploadBusy = true;
        ownsUpload = true;
        const length = request.headers.get('content-length');
        if (length !== null && (!/^[1-9][0-9]{0,15}$/.test(length) || Number(length) > 10485760))
          return reply(Number(length) > 10485760 ? 413 : 400);
        if (!request.body) return reply(400);
        const source = await readSyntheticUploadBody(
          request.body as unknown as AsyncIterable<Uint8Array>,
          {
            signal,
            timeoutMs: 15000,
            ...(length === null ? {} : { declaredBytes: Number(length) }),
          },
        );
        if (signal.aborted) throw Error('Cancelled.');
        dispatched = true;
        result = await client.prepareFloorPlan(preparation, source, options);
        resultReturned = true;
      } else result = await client.getFloorPlanPreparationOriginal(preparation, options);
    } else if (operation) {
      const attachment = validateFloorPlanAttachmentCommand(command);
      dispatched = writing;
      result = writing
        ? await client.saveFloorPlanAttachment(attachment, options)
        : await client.getFloorPlanAttachmentOriginal(attachment, options);
      resultReturned = writing;
      if (result.actorId !== screen.scope.actorId) throw Error('Changed original actor.');
    } else result = screen.state;
    const current = await client.getCurrentStaffSessionV2(options);
    if (current.actorId !== screen.scope.actorId || current.tenantId !== screen.scope.tenantId)
      return reply(403, writing && dispatched);
    if (signal.aborted) throw Error('Cancelled.');
    return Response.json(result, { headers });
  } catch (error) {
    if (request.signal.aborted || deadline.signal.aborted)
      return reply(deadline.signal.aborted ? 504 : 499, writing && dispatched);
    if (error instanceof SyntheticUploadBodyError)
      return reply(error.code === 'INPUT_TOO_LARGE' ? 413 : error.code === 'TIMED_OUT' ? 408 : 400);
    if (error instanceof ApiClientError)
      return reply(
        error.status && error.status >= 400 && error.status < 600 ? error.status : 502,
        writing &&
          dispatched &&
          (resultReturned || error.kind !== 'HTTP' || error.submissionUncertain),
      );
    return reply(dispatched ? 502 : 400, writing && dispatched);
  } finally {
    clearTimeout(timer);
    if (ownsUpload) uploadBusy = false;
  }
}
