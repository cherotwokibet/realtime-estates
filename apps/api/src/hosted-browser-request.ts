import { parseCustomerFavouriteJson } from '@realtor/domain';
export class BrowserRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
export async function readHostedBrowserJson(r: Request, maxBytes = 2048) {
  if (
    r.headers.get('content-type') !== 'application/json' ||
    r.headers.has('content-encoding') ||
    r.headers.has('transfer-encoding')
  )
    throw new BrowserRequestError(400, 'INVALID_REQUEST');
  const length = r.headers.get('content-length');
  if (length !== null && (!/^(0|[1-9][0-9]{0,3})$/.test(length) || Number(length) > maxBytes))
    throw new BrowserRequestError(400, 'INVALID_REQUEST');
  const reader = r.body?.getReader();
  if (!reader) throw new BrowserRequestError(400, 'INVALID_REQUEST');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BrowserRequestError(408, 'INVALID_REQUEST')), 5000);
  });
  try {
    const chunks: Uint8Array[] = [];
    let n = 0;
    while (true) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next.done) break;
      n += next.value.length;
      if (n > maxBytes) throw new BrowserRequestError(400, 'INVALID_REQUEST');
      chunks.push(next.value);
    }
    if (length !== null && Number(length) !== n)
      throw new BrowserRequestError(400, 'INVALID_REQUEST');
    const bytes = new Uint8Array(n);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    return parseCustomerFavouriteJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
