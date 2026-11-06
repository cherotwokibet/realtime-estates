import { validateFloorPlanState, type FloorPlanState } from '@realtor/domain';
import { captureVideoScope, type VideoScope } from './listing-video-session.ts';
/** One saved attachment only. Bytes become a local Blob; no token, provider URL or automatic retry. */
async function loadImage(
  input: VideoScope,
  value: FloorPlanState,
  caller: AbortSignal,
  transport: typeof fetch = (...args) => globalThis.fetch(...args),
  reviewer = false,
) {
  const scope = captureVideoScope(input),
    state = validateFloorPlanState(value, scope.listingId, scope.revision),
    meta = state.floorPlan;
  if (!meta) throw Error('No saved floor plan.');
  if (reviewer && !['pending', 'approved'].includes(state.state))
    throw Error('Review image unavailable.');
  const deadline = new AbortController(),
    timer = setTimeout(() => deadline.abort(), 15000),
    signal = AbortSignal.any([caller, deadline.signal]);
  let abort = () => {},
    reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
    complete = false;
  try {
    if (signal.aborted) throw Error('Cancelled.');
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(Error('Cancelled.'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    const pending = transport(
      `/api/staff/${reviewer ? 'reviews' : 'listings'}/${scope.listingId}/floor-plan-images/${scope.revision}/${state.version}/${meta.operationId}`,
      {
        method: 'GET',
        headers: {
          'X-Preview-Instance': scope.instanceId,
          'X-Reference-Actor': scope.actorId,
          'X-Reference-Tenant': scope.tenantId,
        },
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
    if (
      !response.ok ||
      response.redirected ||
      response.headers.get('content-type') !== 'image/webp' ||
      !response.headers.get('cache-control')?.split(/[ ,]+/).includes('no-store') ||
      response.headers.get('x-content-type-options') !== 'nosniff' ||
      response.headers.get('content-length') !== String(meta.bytes) ||
      response.headers.has('content-encoding')
    ) {
      void response.body?.cancel().catch(() => {});
      throw Error('Private image unavailable.');
    }
    reader = response.body?.getReader();
    if (!reader) throw Error('No bytes.');
    const bytes = new Uint8Array(meta.bytes);
    let size = 0,
      empty = 0;
    for (;;) {
      const part = await Promise.race([reader.read(), cancelled]);
      if (part.done) {
        complete = true;
        break;
      }
      if (part.value.byteLength === 0) {
        if (++empty > 1024) throw Error('Empty stream.');
        if (empty % 64 === 0) await new Promise((r) => setTimeout(r, 0));
        continue;
      }
      size += part.value.byteLength;
      if (size > meta.bytes || signal.aborted) throw Error('Image length differs.');
      bytes.set(part.value, size - part.value.byteLength);
    }
    if (
      size !== meta.bytes ||
      size < 12 ||
      String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP' ||
      signal.aborted
    )
      throw Error('Image differs.');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    if (hash !== meta.sha256 || signal.aborted) throw Error('Image hash differs.');
    return new Blob([bytes], { type: 'image/webp' });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    if (reader) {
      if (!complete) void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

export function loadFloorPlanImage(
  input: VideoScope,
  value: FloorPlanState,
  caller: AbortSignal,
  transport: typeof fetch = (...args) => globalThis.fetch(...args),
) {
  return loadImage(input, value, caller, transport, false);
}
export function loadReviewFloorPlanImage(
  input: VideoScope,
  value: FloorPlanState,
  caller: AbortSignal,
  transport: typeof fetch = (...args) => globalThis.fetch(...args),
) {
  return loadImage(input, value, caller, transport, true);
}
