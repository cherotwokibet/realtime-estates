import {
  validateListingDuplicateRequest,
  validateListingDuplicateCandidates,
  type ListingDuplicateRequest,
  type ListingDuplicateCandidates,
} from '@realtor/domain';
import { parseCreationJson } from './listing-creation-wire.ts';
/** Bounded read only. A failed fresh lookup never establishes uniqueness or mutation success. */
export async function readListingDuplicateCandidates(
  instanceId: string,
  input: ListingDuplicateRequest,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<ListingDuplicateCandidates> {
  if (signal.aborted) throw Error('Lookup cancelled.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(instanceId))
    throw Error('Reload this listing.');
  const lookup = validateListingDuplicateRequest(input);
  const path = `/api/staff/listings/${lookup.listingId}/duplicate-candidates`,
    search = `?listingVersion=${lookup.listingVersion}&revision=${lookup.revision}&revisionVersion=${lookup.revisionVersion}&limit=${lookup.limit}`;
  const controller = new AbortController();
  let rejectAbort: (error: Error) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const cancel = () => {
    controller.abort();
    rejectAbort(Error('Lookup cancelled or timed out.'));
  };
  signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 30000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (signal.aborted) throw Error('Lookup cancelled.');
    const pending = transport(path + search, {
      method: 'GET',
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'X-Preview-Instance': instanceId },
    }).then((response) => {
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw Error('Lookup cancelled.');
      }
      return response;
    });
    const response = await Promise.race([pending, interrupted]);
    reader = response.body?.getReader();
    if (
      response.status !== 200 ||
      response.redirected ||
      response.headers.get('content-type')?.split(';')[0] !== 'application/json' ||
      response.headers.has('content-encoding') ||
      !reader
    )
      throw Error('Lookup unavailable. Reload the listing before checking again.');
    if (response.url) {
      const actual = new URL(response.url);
      if (
        actual.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost'].includes(actual.hostname) ||
        actual.pathname !== path ||
        actual.search !== search ||
        actual.hash ||
        actual.username ||
        actual.password ||
        (typeof location !== 'undefined' && actual.origin !== location.origin)
      )
        throw Error('Lookup response changed scope.');
    }
    const maximum = 1048576,
      declared = response.headers.get('content-length');
    if (declared !== null && (!/^(0|[1-9]\d*)$/.test(declared) || Number(declared) > maximum))
      throw Error('Lookup exceeds limit.');
    const bytes = new Uint8Array(maximum);
    let length = 0;
    for (;;) {
      const item = await Promise.race([reader.read(), interrupted]);
      if (item.done) break;
      if (!(item.value instanceof Uint8Array) || item.value.byteLength > maximum - length)
        throw Error('Lookup exceeds limit.');
      bytes.set(item.value, length);
      length += item.value.byteLength;
    }
    if (controller.signal.aborted) throw Error('Lookup cancelled.');
    if (declared !== null && Number(declared) !== length) throw Error('Lookup length changed.');
    return validateListingDuplicateCandidates(
      parseCreationJson(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)),
      ),
      lookup,
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
