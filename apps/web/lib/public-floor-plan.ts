import { RealtorApiClient } from '@realtor/api-client';
import type { PublishedFloorPlan } from '@realtor/domain';
import { resolveCatalogueConfig, type CatalogueEnvironment } from './catalogue-config.ts';
export type PublicFloorPlanEnvironment = CatalogueEnvironment & {
  readonly WEB_CATALOGUE_FLOOR_PLAN?: string;
};
export type PublicFloorPlanResult =
  | Readonly<{ status: 'off' | 'unavailable' }>
  | Readonly<{ status: 'ready'; saved: PublishedFloorPlan }>;
function config(env: PublicFloorPlanEnvironment) {
  const resolved = resolveCatalogueConfig(env);
  if (
    env.WEB_CATALOGUE_FLOOR_PLAN !== 'synthetic-floor-plan-publication-v1' ||
    !['development', 'test'].includes(env.NODE_ENV ?? '') ||
    resolved.status !== 'ready' ||
    resolved.config.mode !== 'connected' ||
    resolved.config.dataKind !== 'synthetic' ||
    !resolved.config.allowLoopbackHttp
  )
    throw Error('Floor plans unavailable.');
  const url = new URL(resolved.config.apiOrigin);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw Error('Local synthetic mode required.');
  return resolved.config;
}
function client(env: PublicFloorPlanEnvironment, transport?: typeof fetch) {
  const c = config(env);
  return new RealtorApiClient({
    baseUrl: c.apiOrigin,
    allowLoopbackHttp: true,
    privacyNoticeVersion: 'public-floor-plan-read-only',
    ...(transport ? { fetch: transport } : {}),
  });
}
export async function readPublicFloorPlan(
  property: { id: string; revision: number | null; reference?: { revisionVersion: string | null } },
  env: PublicFloorPlanEnvironment,
  transport?: typeof fetch,
  signal?: AbortSignal,
): Promise<PublicFloorPlanResult> {
  if (env.WEB_CATALOGUE_FLOOR_PLAN === undefined) return Object.freeze({ status: 'off' });
  try {
    if (property.revision === null) throw Error();
    const saved = await client(env, transport).getPublishedFloorPlan(
      property.id,
      property.revision,
      { signal },
    );
    if (
      property.reference?.revisionVersion &&
      saved.approvedVersion !== property.reference.revisionVersion
    )
      throw Error();
    return Object.freeze({ status: 'ready', saved });
  } catch {
    return Object.freeze({ status: 'unavailable' });
  }
}
const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
};
const unavailable = (status = 404) =>
  Response.json({ error: 'Floor plan unavailable.' }, { status, headers });
/** Trusted company/origin only; no caller credentials or context is forwarded. */
export async function handlePublicFloorPlan(
  request: Request,
  env: PublicFloorPlanEnvironment,
  transport?: typeof fetch,
) {
  try {
    config(env);
    if (request.method !== 'GET') return unavailable(405);
    if (request.url.includes('?') || request.url.includes('#') || request.body !== null)
      return unavailable(400);
    let forbidden = false;
    request.headers.forEach((_, k) => {
      if (
        [
          'authorization',
          'cookie',
          'range',
          'content-type',
          'content-length',
          'content-encoding',
          'transfer-encoding',
          'expect',
          'idempotency-key',
        ].includes(k) ||
        k.startsWith('if-') ||
        /^x-(?:actor|tenant|company|role)(?:-|$)/.test(k)
      )
        forbidden = true;
    });
    if (forbidden) return unavailable(400);
    const m =
      /^\/api\/public-floor-plans\/([0-9a-f-]{36})\/([1-9][0-9]{0,9})\/([1-9][0-9]{0,15})$/.exec(
        new URL(request.url).pathname,
      );
    if (!m) return unavailable();
    const result = await client(env, transport).getPublishedFloorPlanImage(
      m[1]!,
      Number(m[2]),
      m[3]!,
      { signal: request.signal, timeoutMs: 15000 },
    );
    return new Response(result.data, {
      headers: {
        ...headers,
        'Content-Type': 'image/webp',
        'Content-Length': String(result.data.length),
        'Content-Disposition': 'inline; filename="floor-plan.webp"',
      },
    });
  } catch {
    return unavailable();
  }
}
