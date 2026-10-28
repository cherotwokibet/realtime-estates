import { resolveCatalogueConfig, type CatalogueEnvironment } from './catalogue-config.ts';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ID = new RegExp(`^${UUID}$`),
  KEY = new RegExp(`^synthetic/(${UUID})/(${UUID})/(${UUID})\\.webp$`);
const MAX = 10485760;
export type PublicPhotoEnvironment = CatalogueEnvironment & {
  readonly WEB_PUBLIC_MEDIA_MODE?: string;
};
export interface PublicPhotoTarget {
  readonly listing: string;
  readonly revision: string;
  readonly job: string;
  readonly output: string;
}
export function publicPhotosEnabled(env: PublicPhotoEnvironment): boolean {
  const resolved = resolveCatalogueConfig(env);
  return (
    ['development', 'test'].includes(env.NODE_ENV ?? '') &&
    env.WEB_PUBLIC_MEDIA_MODE === 'synthetic-native-v1' &&
    resolved.status === 'ready' &&
    resolved.config.mode === 'connected' &&
    resolved.config.dataKind === 'synthetic' &&
    resolved.config.allowLoopbackHttp &&
    new URL(resolved.config.apiOrigin).protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(resolved.config.apiOrigin).hostname)
  );
}
export function publicPhotoPath(
  listing: string,
  revision: number | null,
  key: string,
): string | null {
  if (
    !ID.test(listing) ||
    revision === null ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    revision > 2147483647 ||
    typeof key !== 'string'
  )
    return null;
  const match = KEY.exec(key);
  return match ? `/api/public-photos/${listing}/${revision}/${match[2]}/${match[3]}` : null;
}
const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const failure = (status = 404) =>
  Response.json({ error: 'Property image unavailable.' }, { status, headers });
/** Fixed anonymous server proxy. No browser cookies, identity, host or posted company is forwarded. */
export async function handlePublicPhoto(
  request: Request,
  target: PublicPhotoTarget,
  env: PublicPhotoEnvironment,
  fetchImage: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = () => controller.abort();
  try {
    if (!publicPhotosEnabled(env)) return failure();
    const url = new URL(request.url);
    if (request.method !== 'GET') return failure(405);
    if (
      url.search ||
      url.hash ||
      request.headers.has('authorization') ||
      request.headers.has('range') ||
      request.body !== null
    )
      return failure(400);
    if (
      !ID.test(target.listing) ||
      !ID.test(target.job) ||
      !ID.test(target.output) ||
      !/^[1-9]\d{0,9}$/.test(target.revision) ||
      Number(target.revision) > 2147483647
    )
      return failure();
    const resolved = resolveCatalogueConfig(env);
    if (resolved.status !== 'ready' || resolved.config.mode !== 'connected') return failure();
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    if (controller.signal.aborted) return failure(503);
    timer = setTimeout(abort, 15000);
    const response = await fetchImage(
      `${resolved.config.apiOrigin}/v2/public/listings/${target.listing}/revisions/${target.revision}/photos/${target.job}/${target.output}.webp`,
      {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        headers: { Accept: 'image/webp' },
        signal: controller.signal,
      },
    );
    if (
      controller.signal.aborted ||
      response.status !== 200 ||
      response.redirected ||
      response.headers.get('content-type') !== 'image/webp' ||
      response.headers.has('content-encoding') ||
      !response.body
    ) {
      await response.body?.cancel().catch(() => {});
      return failure(response.status === 404 ? 404 : 503);
    }
    const length = response.headers.get('content-length');
    if (!length || !/^[1-9]\d{0,7}$/.test(length) || Number(length) > MAX) {
      await response.body.cancel();
      return failure(503);
    }
    const expected = Number(length),
      reader = response.body.getReader(),
      parts: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (controller.signal.aborted) throw Error('aborted');
        if (next.done) break;
        total += next.value.byteLength;
        if (total > expected || total > MAX) throw Error('size');
        parts.push(new Uint8Array(next.value));
      }
    } catch {
      await reader.cancel().catch(() => {});
      return failure(503);
    } finally {
      reader.releaseLock();
    }
    if (controller.signal.aborted || total !== expected || total < 20) return failure(503);
    const data = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      data.set(part, offset);
      offset += part.byteLength;
    }
    if (
      String.fromCharCode(...data.slice(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...data.slice(8, 12)) !== 'WEBP' ||
      new DataView(data.buffer).getUint32(4, true) !== total - 8
    )
      return failure(503);
    return new Response(data, {
      headers: { ...headers, 'Content-Type': 'image/webp', 'Content-Length': String(total) },
    });
  } catch {
    return failure(503);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
  }
}
