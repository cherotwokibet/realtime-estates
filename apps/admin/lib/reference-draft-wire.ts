import { parseVerificationJson } from './listing-verification-wire.ts';
/** Strict bounded reader; cancellation never awaits an uncooperative source. */
export async function readReferenceJson(
  source: Request | Response,
  maximum: number,
  signal: AbortSignal,
  parse: (source: string) => unknown = parseVerificationJson,
): Promise<unknown> {
  const declared = source.headers.get('content-length');
  if (
    source.headers.has('content-encoding') ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      source.headers.get('content-type') ?? '',
    ) ||
    (declared !== null && (!/^(0|[1-9]\d*)$/.test(declared) || Number(declared) > maximum))
  )
    throw Error('Invalid framing.');
  const reader = source.body?.getReader();
  if (!reader || signal.aborted) throw Error('Unavailable.');
  let abort = () => {},
    complete = false;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(Error('Cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  const chunks: Uint8Array[] = [];
  let size = 0,
    empty = 0;
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), cancelled]);
      if (part.done) {
        complete = true;
        break;
      }
      if (part.value.byteLength === 0) {
        if (++empty > 1024) throw Error();
        if (empty % 64 === 0) await new Promise((r) => setTimeout(r, 0));
        continue;
      }
      size += part.value.byteLength;
      if (size > maximum || signal.aborted) throw Error();
      chunks.push(part.value.slice());
    }
    if (signal.aborted || (declared !== null && Number(declared) !== size)) throw Error();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
    return parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally {
    signal.removeEventListener('abort', abort);
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
