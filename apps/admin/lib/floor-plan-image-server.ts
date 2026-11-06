import 'server-only';
import { createHash } from 'node:crypto';
import { ApiClientError } from '@realtor/api-client';
import { listingVideoTarget } from '@realtor/domain';
import { readSyntheticUploadBody } from '@realtor/media/upload-body';
import {
  floorPlanEnvironment,
  readFloorPlanScreen,
  readReviewFloorPlanScreen,
} from './floor-plan-server.ts';
import { assertPreviewRequest, previewConfiguration } from './staff-preview-policy.ts';
const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const reply = (status: number) =>
  Response.json(
    { error: { code: 'PRIVATE_FLOOR_PLAN_IMAGE_UNAVAILABLE' }, submissionUncertain: false },
    { status, headers },
  );
async function imageRequest(
  request: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport: typeof fetch = (...args) => globalThis.fetch(...args),
  reviewer = false,
) {
  let captured: ReturnType<typeof floorPlanEnvironment>,
    config: ReturnType<typeof previewConfiguration>;
  try {
    captured = floorPlanEnvironment(env);
    config = previewConfiguration(captured);
    assertPreviewRequest(request, config.instanceId);
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== `http://${request.headers.get('host')}`) throw Error();
  } catch {
    return reply(403);
  }
  const deadline = new AbortController(),
    timer = setTimeout(() => deadline.abort(), 15000),
    signal = AbortSignal.any([request.signal, deadline.signal]);
  let abort = () => {};
  try {
    const readScreen = reviewer ? readReviewFloorPlanScreen : readFloorPlanScreen;
    const url = new URL(request.url),
      m = new RegExp(
        `^/api/staff/${reviewer ? 'reviews' : 'listings'}/([0-9a-f-]{36})/floor-plan-images/([1-9][0-9]{0,9})/([1-9][0-9]{0,15})/([0-9a-f-]{36})$`,
      ).exec(url.pathname);
    if (!m) return reply(404);
    if (request.method !== 'GET') return reply(405);
    if (request.url.includes('?') || request.url.includes('#') || request.body) return reply(400);
    let forbidden = false;
    request.headers.forEach((_, k) => {
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
    try {
      listingVideoTarget(m[1], Number(m[2]));
      listingVideoTarget(m[4], 1);
      if (BigInt(m[3]!) > 9007199254740991n) return reply(400);
    } catch {
      return reply(400);
    }
    const before = await readScreen(m[1]!, m[2]!, captured, transport, signal),
      meta = before.state.floorPlan;
    if (
      request.headers.get('x-reference-actor') !== before.scope.actorId ||
      request.headers.get('x-reference-tenant') !== before.scope.tenantId
    )
      return reply(409);
    if (!meta || before.state.version !== m[3] || meta.operationId !== m[4]) return reply(409);
    if (signal.aborted) throw Error('Cancelled.');
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(Error('Cancelled.'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    const pending = transport(
      reviewer
        ? `${config.origin}/v2/staff/reviews/${m[1]}/${m[2]}/floor-plan-image/${m[3]}`
        : `${config.origin}/v2/staff/listings/${m[1]}/floor-plan-images/${m[2]}/${m[4]}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.bearerToken}` },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal,
      },
    );
    void pending.then(
      (r) => {
        if (signal.aborted) void r.body?.cancel().catch(() => {});
      },
      () => {},
    );
    const response = await Promise.race([pending, cancelled]);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return reply(
        [401, 403, 404, 409, 429, 503].includes(response.status) ? response.status : 502,
      );
    }
    if (
      response.redirected ||
      response.headers.get('content-type') !== 'image/webp' ||
      response.headers.get('cache-control') !== 'private, no-store' ||
      response.headers.get('x-content-type-options') !== 'nosniff' ||
      response.headers.has('content-encoding') ||
      response.headers.get('content-length') !== String(meta.bytes)
    ) {
      void response.body?.cancel().catch(() => {});
      return reply(502);
    }
    const bytes = await readSyntheticUploadBody(
      response.body as unknown as AsyncIterable<Uint8Array>,
      { signal, timeoutMs: 15000, declaredBytes: meta.bytes },
    );
    if (
      bytes.length < 12 ||
      bytes.toString('latin1', 0, 4) !== 'RIFF' ||
      bytes.toString('latin1', 8, 12) !== 'WEBP' ||
      createHash('sha256').update(bytes).digest('hex') !== meta.sha256
    )
      return reply(502);
    const after = await readScreen(m[1]!, m[2]!, captured, transport, signal);
    if (JSON.stringify(after) !== JSON.stringify(before)) return reply(409);
    if (signal.aborted) throw Error('Cancelled.');
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...headers,
        'Content-Type': 'image/webp',
        'Content-Length': String(bytes.length),
        'Content-Disposition': 'inline; filename="floor-plan.webp"',
      },
    });
  } catch (error) {
    if (signal.aborted) return reply(deadline.signal.aborted ? 504 : 499);
    if (error instanceof ApiClientError && error.kind === 'HTTP' && error.status)
      return reply([401, 403, 404, 409, 429, 503].includes(error.status) ? error.status : 502);
    return reply(502);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

export function floorPlanImageRequest(
  request: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport: typeof fetch = (...args) => globalThis.fetch(...args),
) {
  return imageRequest(request, env, transport, false);
}
export function reviewFloorPlanImageRequest(
  request: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport: typeof fetch = (...args) => globalThis.fetch(...args),
) {
  return imageRequest(request, env, transport, true);
}
