import { Buffer } from 'node:buffer';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
export interface SyntheticAttemptFileIdentity {
  readonly location: string;
  readonly dev: bigint;
  readonly ino: bigint;
  readonly birthtimeNs: bigint;
  readonly directory: boolean;
  readonly size: bigint;
  readonly mtimeNs: bigint;
}

type Identity = SyntheticAttemptFileIdentity;
export function createSyntheticAttemptFiles(
  fail: (code: 'INVALID_CONFIGURATION' | 'INTEGRITY' | 'PERSISTENCE_FAILED') => never,
) {
  const MAX_BYTES = 10485760;
  const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    WRITE_FLAGS =
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);
  function absolute(value: unknown): string {
    if (
      typeof value !== 'string' ||
      !path.isAbsolute(value) ||
      value.includes('\0') ||
      (process.platform === 'win32' && path.parse(value).root.startsWith('\\\\'))
    )
      fail('INVALID_CONFIGURATION');
    return path.resolve(value);
  }
  function overlap(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return (
      relative === '' ||
      (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
    );
  }
  function same(a: BigIntStats, b: Identity): boolean {
    return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
  }
  async function checked(
    location: string,
    directory: boolean,
    expected?: Identity,
  ): Promise<Identity> {
    const stat = await lstat(location, { bigint: true }),
      resolved = path.resolve(await realpath(location));
    if (
      stat.isSymbolicLink() ||
      (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n) ||
      (expected &&
        (!same(stat, expected) ||
          (!directory && (stat.size !== expected.size || stat.mtimeNs !== expected.mtimeNs)))) ||
      (process.platform === 'win32'
        ? resolved.toLowerCase() !== location.toLowerCase()
        : resolved !== location)
    )
      fail('INTEGRITY');
    return {
      location,
      dev: stat.dev,
      ino: stat.ino,
      birthtimeNs: stat.birthtimeNs,
      directory,
      size: stat.size,
      mtimeNs: stat.mtimeNs,
    };
  }
  async function ancestry(location: string): Promise<Identity[]> {
    const result: Identity[] = [];
    for (;;) {
      result.push(await checked(location, true));
      const parent = path.dirname(location);
      if (parent === location) return result;
      location = parent;
    }
  }
  async function guards(values: readonly Identity[]): Promise<void> {
    for (const item of values) await checked(item.location, item.directory, item);
  }
  async function boundedFile(directory: Identity, name: string, maximum: number): Promise<Buffer> {
    await checked(directory.location, true, directory);
    const location = path.join(directory.location, name),
      initial = await checked(location, false);
    if (initial.size < 1n || initial.size > BigInt(maximum)) fail('INTEGRITY');
    const file = await open(location, READ_FLAGS);
    let result: Buffer;
    try {
      const before = await file.stat({ bigint: true });
      if (
        !same(before, initial) ||
        !before.isFile() ||
        before.nlink !== 1n ||
        before.size !== initial.size ||
        before.mtimeNs !== initial.mtimeNs
      )
        fail('INTEGRITY');
      const bytes = Buffer.alloc(Number(before.size) + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const read = await file.read(bytes, offset, bytes.length - offset, null);
        if (!read.bytesRead) break;
        offset += read.bytesRead;
      }
      const after = await file.stat({ bigint: true });
      if (
        !same(after, initial) ||
        !after.isFile() ||
        after.nlink !== 1n ||
        after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs ||
        offset !== Number(before.size)
      )
        fail('INTEGRITY');
      result = Buffer.from(bytes.subarray(0, offset));
    } finally {
      await file.close();
    }
    await checked(location, false, initial);
    await checked(directory.location, true, directory);
    return result;
  }
  async function writeSource(directory: Identity, bytes: Buffer): Promise<void> {
    await checked(directory.location, true, directory);
    const location = path.join(directory.location, 'source.input'),
      file = await open(location, WRITE_FLAGS, 0o600);
    try {
      const before = await file.stat({ bigint: true });
      if (!before.isFile() || before.nlink !== 1n) fail('INTEGRITY');
      let offset = 0;
      while (offset < bytes.length) {
        const write = await file.write(bytes, offset, bytes.length - offset, null);
        if (write.bytesWritten < 1) fail('PERSISTENCE_FAILED');
        offset += write.bytesWritten;
      }
      await file.sync();
      const after = await file.stat({ bigint: true });
      if (
        !after.isFile() ||
        after.nlink !== 1n ||
        after.dev !== before.dev ||
        after.ino !== before.ino ||
        after.size !== BigInt(bytes.length)
      )
        fail('INTEGRITY');
    } finally {
      await file.close();
    }
    if (!(await boundedFile(directory, 'source.input', MAX_BYTES)).equals(bytes)) fail('INTEGRITY');
  }
  async function expectedFiles(directory: Identity): Promise<void> {
    await checked(directory.location, true, directory);
    const handle = await opendir(directory.location),
      seen: string[] = [];
    try {
      for (;;) {
        const item = await handle.read();
        if (!item) break;
        if (
          seen.length >= 3 ||
          !['source.input', 'converted.webp', 'manifest.json'].includes(item.name) ||
          seen.includes(item.name) ||
          item.isSymbolicLink() ||
          !item.isFile()
        )
          fail('INTEGRITY');
        seen.push(item.name);
      }
    } finally {
      await handle.close();
    }
    if (seen.length !== 3) fail('INTEGRITY');
    await checked(directory.location, true, directory);
  }

  return Object.freeze({
    absolute,
    overlap,
    checked,
    ancestry,
    guards,
    boundedFile,
    writeSource,
    expectedFiles,
  });
}
