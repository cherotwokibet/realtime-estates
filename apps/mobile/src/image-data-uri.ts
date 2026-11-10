/** In-memory encoding after bounded image transport checks. No provider URL, disk or offline cache. */
export async function mobileWebpDataUri(data: Uint8Array, signal: AbortSignal) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const chunks: string[] = [];
  for (let offset = 0; offset < data.length; offset += 12288) {
    if (signal.aborted) throw Error('Cancelled.');
    let chunk = '';
    const end = Math.min(offset + 12288, data.length);
    for (let i = offset; i < end; i += 3) {
      const a = data[i]!,
        b = data[i + 1],
        c = data[i + 2];
      chunk +=
        alphabet[a >>> 2]! +
        alphabet[((a & 3) << 4) | ((b ?? 0) >>> 4)]! +
        (b === undefined ? '=' : alphabet[((b & 15) << 2) | ((c ?? 0) >>> 6)]!) +
        (c === undefined ? '=' : alphabet[c & 63]!);
    }
    chunks.push(chunk);
    if (offset % (12288 * 16) === 0) await new Promise((r) => setTimeout(r, 0));
  }
  if (signal.aborted) throw Error('Cancelled.');
  return 'data:image/webp;base64,' + chunks.join('');
}
