// Fixed local worker entry point. No browser/API body, identity, SQL or provider access.
import { Buffer } from 'node:buffer';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { convertSyntheticImage, SYNTHETIC_CODEC_POLICY } from './index.js';

async function sourceBytes(): Promise<Buffer> {
  const file = await open('source.input', constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(SYNTHETIC_CODEC_POLICY.maxInputBytes)) throw new Error();
    const data = Buffer.alloc(Number(before.size) + 1);
    let bytes = 0;
    while (bytes < data.length) {
      const got = await file.read(data, bytes, data.length - bytes, null);
      if (got.bytesRead === 0) break;
      bytes += got.bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (bytes !== Number(before.size) || after.size !== before.size || after.mtimeNs !== before.mtimeNs ||
        after.ino !== before.ino || after.dev !== before.dev || after.nlink !== 1n) throw new Error();
    return data.subarray(0, bytes);
  } finally { await file.close(); }
}

async function exclusive(name: string, data: Buffer): Promise<void> {
  const file = await open(name, 'wx', 0o600);
  try { await file.writeFile(data); await file.sync(); }
  finally { await file.close(); }
}

try {
  if (process.argv.length !== 2) throw new Error();
  const result = await convertSyntheticImage(await sourceBytes());
  const manifest = Buffer.from(JSON.stringify(result.manifest) + '\n', 'utf8');
  if (manifest.length > 4096) throw new Error();
  await exclusive('converted.webp', result.data);
  await exclusive('manifest.json', manifest);
} catch {
  // Generic exit only; the supervisor owns the bounded terminal protocol. Partial files
  // stay in the attempt until termination is confirmed and trusted cleanup is authorized.
  process.exitCode = 1;
}
