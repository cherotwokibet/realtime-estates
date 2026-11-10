import { RealtorApiClient, type PublicPhoto } from '@realtor/api-client';
import type { MobileReferenceConfig } from './reference-catalogue.ts';
import { mobileWebpDataUri } from './image-data-uri.ts';
export type MobilePhotoResult =
  | Readonly<{ status: 'off' | 'empty' | 'unavailable' }>
  | Readonly<{ status: 'ready'; uri: string; alt: string; index: number; count: number }>;
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',
  id = new RegExp('^' + uuid + '$'),
  key = new RegExp('^synthetic/(' + uuid + ')/(' + uuid + ')/(' + uuid + ')[.]webp$');
const max = 10485760;
const own = (v: object, k: string) => {
  const d = Object.getOwnPropertyDescriptor(v, k);
  if (!d || !('value' in d)) throw Error();
  return d.value;
};
/** One bounded anonymous image, no disk cache or retry. The API verifies current
 * publication and retained output provenance around IO; the client validates framing.
 * This is not an independent client hash verification (public photo descriptors omit hashes).
 */
export async function loadMobilePhoto(
  config: MobileReferenceConfig,
  property: { id: string; revision: number; photos: readonly PublicPhoto[] },
  index: number,
  caller: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<MobilePhotoResult> {
  if (config.mode !== 'synthetic-reference-public-v1' || config.photoMode === undefined)
    return Object.freeze({ status: 'off' });
  const controller = new AbortController(),
    signal = AbortSignal.any([caller, controller.signal]);
  let timer: ReturnType<typeof setTimeout> | undefined,
    reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
    abort = () => {},
    finished = false;
  try {
    if (config.photoMode !== 'synthetic-native-v1' || signal.aborted) throw Error();
    const listing = own(property, 'id'),
      revision = own(property, 'revision'),
      photos = own(property, 'photos');
    if (
      typeof listing !== 'string' ||
      !id.test(listing) ||
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      revision > 2147483647 ||
      !Array.isArray(photos) ||
      photos.length > 12 ||
      !Number.isSafeInteger(index) ||
      index < 0
    )
      throw Error();
    if (photos.length === 0) {
      if (index !== 0) throw Error();
      return Object.freeze({ status: 'empty' });
    }
    if (index >= photos.length) throw Error();
    const seen = new Set<string>();
    let selected: RegExpExecArray | null = null,
      alt = '';
    for (let i = 0; i < photos.length; i++) {
      const p = own(photos, String(i));
      if (
        !p ||
        typeof p !== 'object' ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(p)) ||
        Reflect.ownKeys(p).length !== 2
      )
        throw Error();
      const k = own(p, 'key'),
        a = own(p, 'alt');
      const match = typeof k === 'string' ? key.exec(k) : null;
      if (!match || typeof a !== 'string' || a.length > 1000 || seen.has(k)) throw Error();
      seen.add(k);
      if (i === index) {
        selected = match;
        alt = a;
      }
    }
    if (!selected) throw Error();
    // Reuse the shared configured-origin validator; never follow a descriptor URL.
    new RealtorApiClient({
      baseUrl: config.apiOrigin,
      allowLoopbackHttp: config.allowLoopbackHttp,
      privacyNoticeVersion: 'mobile-public-photos',
      fetch: transport,
    });
    const origin = new URL(config.apiOrigin).origin;
    const url = `${origin}/v2/public/listings/${listing}/revisions/${revision}/photos/${selected[2]}/${selected[3]}.webp`;
    timer = setTimeout(() => controller.abort(), 15000);
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(Error('Cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    const pending = transport(url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'image/webp' },
      signal,
    });
    void pending.then(
      (r) => {
        if (signal.aborted) void r.body?.cancel().catch(() => {});
      },
      () => {},
    );
    const response = await Promise.race([pending, cancelled]);
    const length = response.headers.get('content-length');
    if (
      response.status !== 200 ||
      response.redirected ||
      response.headers.get('content-type') !== 'image/webp' ||
      response.headers.has('content-encoding') ||
      !response.headers.get('cache-control')?.split(/[ ,]+/).includes('no-store') ||
      response.headers.get('x-content-type-options') !== 'nosniff' ||
      !length ||
      !/^[1-9][0-9]{0,7}$/.test(length) ||
      Number(length) < 12 ||
      Number(length) > max
    ) {
      void response.body?.cancel().catch(() => {});
      throw Error();
    }
    const expected = Number(length);
    reader = response.body?.getReader();
    if (!reader) throw Error();
    const data = new Uint8Array(expected);
    let size = 0,
      empty = 0;
    for (;;) {
      const part = await Promise.race([reader.read(), cancelled]);
      if (part.done) {
        finished = true;
        break;
      }
      if (!part.value.byteLength) {
        if (++empty > 1024) throw Error();
        if (empty % 64 === 0) await new Promise((r) => setTimeout(r, 0));
        continue;
      }
      size += part.value.byteLength;
      if (size > expected || signal.aborted) throw Error();
      data.set(part.value, size - part.value.byteLength);
    }
    if (
      size !== expected ||
      String.fromCharCode(...data.subarray(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...data.subarray(8, 12)) !== 'WEBP' ||
      new DataView(data.buffer).getUint32(4, true) !== size - 8 ||
      signal.aborted
    )
      throw Error();
    const uri = await mobileWebpDataUri(data, signal);
    if (signal.aborted) throw Error();
    return Object.freeze({
      status: 'ready',
      uri,
      alt: alt || `Property photo ${index + 1}`,
      index,
      count: photos.length,
    });
  } catch {
    return Object.freeze({ status: 'unavailable' });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    if (reader) {
      if (!finished) void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
