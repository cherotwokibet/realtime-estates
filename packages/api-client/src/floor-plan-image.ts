import { validatePublishedFloorPlan, type PublishedFloorPlan } from '@realtor/domain';
export type FloorPlanImageDigest = (data: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>;
/** Anonymous exact-target WebP read. No caller headers, credentials, redirects or retry. */
export async function readPublishedFloorPlanImageBytes(
  url: string,
  value: PublishedFloorPlan,
  caller: AbortSignal,
  transport: typeof fetch = fetch,
  digest: FloorPlanImageDigest = (data) => crypto.subtle.digest('SHA-256', data),
): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof url !== 'string' || url.length > 2048) throw Error('Invalid image target.');
  const state = validatePublishedFloorPlan(
      value,
      Object.getOwnPropertyDescriptor(value, 'listingId')?.value as string,
      Object.getOwnPropertyDescriptor(value, 'revision')?.value as number,
    ),
    meta = state.floorPlan;
  if (!meta) throw Error('Published floor plan unavailable.');
  const parsed = new URL(url, 'https://same-origin.invalid');
  const paths = [
    `/v3/properties/${state.listingId}/revisions/${state.revision}/floor-plan-image/${state.approvedVersion}`,
    `/api/public-floor-plans/${state.listingId}/${state.revision}/${state.approvedVersion}`,
  ];
  if (
    !paths.includes(parsed.pathname) ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password ||
    !(
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))
    ) ||
    url.includes('?') ||
    url.includes('#') ||
    url.startsWith('//')
  )
    throw Error('Invalid floor-plan image target.');
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 15000),
    signal = AbortSignal.any([caller, controller.signal]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
    complete = false,
    abort = () => {};
  try {
    if (signal.aborted) throw Error('Cancelled.');
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(Error('Cancelled.'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    const pending = transport(url, {
      method: 'GET',
      headers: { Accept: 'image/webp' },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal,
    });
    void pending.then(
      (r) => {
        if (signal.aborted) void r.body?.cancel().catch(() => {});
      },
      () => {},
    );
    const response = await Promise.race([pending, cancelled]);
    if (
      response.status !== 200 ||
      response.redirected ||
      response.headers.get('content-type') !== 'image/webp' ||
      !response.headers.get('cache-control')?.split(/[ ,]+/).includes('no-store') ||
      response.headers.get('x-content-type-options') !== 'nosniff' ||
      response.headers.get('content-length') !== String(meta.bytes) ||
      response.headers.has('content-encoding')
    ) {
      void response.body?.cancel().catch(() => {});
      throw Error('Published image unavailable.');
    }
    reader = response.body?.getReader();
    if (!reader) throw Error('Image unavailable.');
    const data = new Uint8Array(meta.bytes);
    let size = 0,
      empty = 0;
    for (;;) {
      const part = await Promise.race([reader.read(), cancelled]);
      if (part.done) {
        complete = true;
        break;
      }
      if (part.value.byteLength === 0) {
        if (++empty > 1024) throw Error('Invalid stream.');
        if (empty % 64 === 0) await new Promise((r) => setTimeout(r, 0));
        continue;
      }
      size += part.value.byteLength;
      if (size > meta.bytes || signal.aborted) throw Error('Invalid image length.');
      data.set(part.value, size - part.value.byteLength);
    }
    if (
      size !== meta.bytes ||
      size < 12 ||
      String.fromCharCode(...data.subarray(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...data.subarray(8, 12)) !== 'WEBP' ||
      new DataView(data.buffer).getUint32(4, true) !== size - 8 ||
      signal.aborted
    )
      throw Error('Invalid image bytes.');
    const hash = Array.from(new Uint8Array(await Promise.race([digest(data), cancelled])))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    if (hash !== meta.sha256 || signal.aborted) throw Error('Image differs.');
    return data;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    if (reader) {
      if (!complete) void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
