import { readReferenceJson } from './reference-draft-wire.ts';
import { parseVerificationJson } from './listing-verification-wire.ts';
/** Fetch exposes decoded response bytes. Wire lengths are not decoded lengths for compressed replies.
 * Request readers remain strict; this adapter is only for browser Fetch responses.
 */
export async function readBrowserDecodedJson(
  response: Response,
  maximum: number,
  signal: AbortSignal,
  parse: (source: string) => unknown = parseVerificationJson,
): Promise<unknown> {
  const expected = browserDecodedJsonLength(response, maximum);
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  if (expected === null) headers.delete('content-length');
  return readReferenceJson(new Response(response.body, { headers }), maximum, signal, parse);
}

/** Returns an identity-body length only; compressed Fetch lengths count encoded wire bytes. */
export function browserDecodedJsonLength(response: Response, maximum: number): number | null {
  const encoding = response.headers.get('content-encoding')?.toLowerCase() ?? null,
    declared = response.headers.get('content-length');
  if (
    !Number.isSafeInteger(maximum) ||
    maximum <= 0 ||
    (encoding !== null && !['identity', 'gzip', 'br', 'deflate'].includes(encoding)) ||
    (declared !== null && (!/^(0|[1-9]\d*)$/.test(declared) || Number(declared) > maximum))
  ) {
    void response.body?.cancel().catch(() => {});
    throw Error('Invalid response framing.');
  }
  return declared !== null && (encoding === null || encoding === 'identity')
    ? Number(declared)
    : null;
}
