import { browserDecodedJsonLength } from './browser-decoded-json.ts';
import {
  previewListingImport,
  validateListingImportPreview,
  type ListingImportPreview,
} from '@realtor/domain';
import { parseCreationJson } from './listing-creation-wire.ts';
export async function readListingImportPreview(
  instanceId: string,
  csv: string,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<ListingImportPreview> {
  if (signal.aborted) throw Error('Preview cancelled.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(instanceId))
    throw Error('Reload the preview.');
  previewListingImport(csv);
  const controller = new AbortController(),
    path = '/api/staff/listing-import-preview';
  let rejectAbort: (error: Error) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const cancel = () => {
    controller.abort();
    rejectAbort(Error('Preview cancelled or timed out.'));
  };
  signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 30000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (signal.aborted) throw Error('Preview cancelled.');
    const pending = transport(path, {
      method: 'POST',
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Preview-Instance': instanceId },
      body: JSON.stringify({ csv }),
    }).then((response) => {
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw Error('Preview cancelled.');
      }
      return response;
    });
    const response = await Promise.race([pending, interrupted]);
    reader = response.body?.getReader();
    if (
      response.status !== 200 ||
      response.redirected ||
      response.headers.get('content-type')?.split(';')[0] !== 'application/json' ||
      !reader
    )
      throw Error('Preview unavailable for current access. Try a fresh preview.');
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
        throw Error('Preview response changed scope.');
    }
    const maximum = 1048576,
      declared = browserDecodedJsonLength(response, maximum);
    const bytes = new Uint8Array(maximum);
    let length = 0;
    for (;;) {
      const item = await Promise.race([reader.read(), interrupted]);
      if (item.done) break;
      if (!(item.value instanceof Uint8Array) || item.value.byteLength > maximum - length)
        throw Error('Preview exceeds limit.');
      bytes.set(item.value, length);
      length += item.value.byteLength;
    }
    if (controller.signal.aborted) throw Error('Preview cancelled.');
    if (declared !== null && Number(declared) !== length)
      throw Error('Preview response length changed.');
    return validateListingImportPreview(
      parseCreationJson(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)),
      ),
      csv,
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
