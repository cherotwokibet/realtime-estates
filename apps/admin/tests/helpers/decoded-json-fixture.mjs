import { gzipSync, brotliCompressSync, deflateSync } from 'node:zlib';
export function decodedJsonResponse(value, encoding) {
  const text = JSON.stringify(value),
    bytes = Buffer.from(text),
    encoded = { gzip: gzipSync, br: brotliCompressSync, deflate: deflateSync, identity: (b) => b }[
      encoding
    ](bytes);
  return new Response(text, {
    headers: {
      'content-type': 'application/json',
      'content-encoding': encoding,
      'content-length': String(encoded.length),
      'cache-control': 'no-store',
    },
  });
}
