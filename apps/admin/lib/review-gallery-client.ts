import { validateReviewMediaGallery, type ReviewMediaGallery } from '@realtor/domain';
export class ReviewGalleryAccessDenied extends Error {
  constructor(readonly status: 401 | 403) {
    super('Gallery access unavailable.');
    this.name = 'ReviewGalleryAccessDenied';
  }
}
type Scope = Readonly<{ instanceId: string; listingId: string; revision: number; version: string }>;
export async function readReviewGallery(
  scope: Scope,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<ReviewMediaGallery> {
  if (signal.aborted) throw Error('Gallery read cancelled.');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (
    !uuid.test(scope.instanceId) ||
    !uuid.test(scope.listingId) ||
    !Number.isSafeInteger(scope.revision) ||
    scope.revision < 1 ||
    scope.revision > 2147483647 ||
    !/^[1-9]\d{0,15}$/.test(scope.version) ||
    BigInt(scope.version) > 9007199254740991n
  )
    throw Error('Invalid review scope.');
  const controller = new AbortController(),
    path = `/api/staff/reviews/${scope.listingId}/${scope.revision}/media-gallery`;
  let rejectAbort: (reason: Error) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const cancel = () => {
    controller.abort();
    rejectAbort(Error('Gallery read cancelled.'));
  };
  signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 20000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (signal.aborted) cancel();
    const pending = transport(path, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      headers: { 'X-Preview-Instance': scope.instanceId, 'X-Revision-Version': scope.version },
    }).then((response) => {
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw Error('Gallery read cancelled.');
      }
      return response;
    });
    const response = await Promise.race([pending, interrupted]);
    reader = response.body?.getReader();
    if (response.status === 401 || response.status === 403)
      throw new ReviewGalleryAccessDenied(response.status);
    if (
      response.status !== 200 ||
      response.redirected ||
      response.headers.get('content-type')?.split(';')[0] !== 'application/json' ||
      response.headers.has('content-encoding') ||
      !reader
    )
      throw Error('Gallery unavailable.');
    if (response.url) {
      const actual = new URL(response.url);
      if (
        actual.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost'].includes(actual.hostname) ||
        actual.pathname !== path ||
        actual.search ||
        actual.hash ||
        actual.username ||
        actual.password ||
        (typeof location !== 'undefined' && actual.origin !== location.origin)
      )
        throw Error('Gallery response changed scope.');
    }
    const bytes = new Uint8Array(32768);
    let length = 0;
    for (;;) {
      const item = await Promise.race([reader.read(), interrupted]);
      if (item.done) break;
      if (!(item.value instanceof Uint8Array) || item.value.byteLength > bytes.length - length)
        throw Error('Gallery exceeds limit.');
      bytes.set(item.value, length);
      length += item.value.byteLength;
    }
    if (controller.signal.aborted) throw Error('Gallery read cancelled.');
    return validateReviewMediaGallery(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))),
      scope.listingId,
      scope.revision,
      scope.version,
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    controller.abort();
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
