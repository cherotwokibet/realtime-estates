import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, opendir, realpath, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { isSharedArrayBuffer } from 'node:util/types';

export interface DurableSyntheticReference {
  readonly jobId: string;
  readonly objectId: string;
  readonly generationId: string;
  readonly kind: 'quarantine' | 'output';
}
export interface DurableSyntheticReceipt extends DurableSyntheticReference {
  readonly version: 1;
  readonly storeId: string;
  readonly bytes: number;
  readonly sha256: string;
}
export interface DurableSyntheticRead {
  readonly receipt: DurableSyntheticReceipt;
  readonly data: Buffer;
}
export interface DurableSyntheticStore {
  readonly storeId: string;
  readonly rootDirectory: string;
  install(reference: DurableSyntheticReference, bytes: Buffer): Promise<DurableSyntheticReceipt>;
  read(reference: DurableSyntheticReference): Promise<DurableSyntheticRead>;
  /** Stops new admission and drains every admitted operation; retained files are never deleted. */
  close(): Promise<void>;
}
export type DurableStoreErrorCode =
  | 'INVALID_PARENT'
  | 'INVALID_REFERENCE'
  | 'INVALID_BYTES'
  | 'TOO_LARGE'
  | 'EMPTY_INPUT'
  | 'BUSY'
  | 'CLOSED'
  | 'INCOMPLETE'
  | 'CONFLICT'
  | 'INTEGRITY'
  | 'IO_FAILURE';
export class DurableStoreError extends Error {
  override readonly name = 'DurableStoreError';
  constructor(readonly code: DurableStoreErrorCode) {
    super(`Durable synthetic store: ${code}.`);
  }
}
interface Identity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly birthtimeNs: bigint;
}
interface Directory {
  readonly location: string;
  readonly identity: Identity;
}
interface FileSnapshot {
  readonly identity: Identity;
  readonly size: bigint;
  readonly mtimeNs: bigint;
}
interface ScannedFile {
  readonly snapshot: FileSnapshot;
  readonly data: Buffer;
  readonly sha256: string;
}
const MAX_BYTES = 10485760,
  MAX_RECEIPT_BYTES = 1024,
  MAX_MARKER_BYTES = 256,
  READ_SLICE = 65536;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
const WRITE_FLAGS =
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);
function fail(code: DurableStoreErrorCode): never {
  throw new DurableStoreError(code);
}
function normalized(error: unknown): DurableStoreError {
  return error instanceof DurableStoreError ? error : new DurableStoreError('IO_FAILURE');
}
function errorCode(error: unknown): unknown {
  return error && typeof error === 'object' && 'code' in error ? error.code : undefined;
}
function identity(stat: BigIntStats): Identity {
  return { dev: stat.dev, ino: stat.ino, birthtimeNs: stat.birthtimeNs };
}
function sameIdentity(a: Identity, b: Identity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}
function equalPath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function canonical(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value) + '\n', 'utf8');
}
function plain(
  value: unknown,
  keys: readonly string[],
  code: DurableStoreErrorCode,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    return fail(code);
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length ||
    own.some((key) => {
      if (typeof key !== 'string' || !keys.includes(key)) return true;
      const item = Object.getOwnPropertyDescriptor(value, key);
      return !item?.enumerable || !Object.hasOwn(item, 'value');
    })
  )
    return fail(code);
  return value as Record<string, unknown>;
}
function uuid(value: unknown, code: DurableStoreErrorCode): string {
  if (typeof value !== 'string' || !UUID.test(value)) return fail(code);
  return value.toLowerCase();
}
function reference(
  value: unknown,
  code: DurableStoreErrorCode = 'INVALID_REFERENCE',
): DurableSyntheticReference {
  const row = plain(value, ['jobId', 'objectId', 'generationId', 'kind'], code);
  if (row.kind !== 'quarantine' && row.kind !== 'output') return fail(code);
  return Object.freeze({
    jobId: uuid(row.jobId, code),
    objectId: uuid(row.objectId, code),
    generationId: uuid(row.generationId, code),
    kind: row.kind,
  });
}
function absolute(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    !path.isAbsolute(value) ||
    (process.platform === 'win32' && path.parse(value).root.startsWith('\\\\'))
  )
    return fail('INVALID_PARENT');
  return path.resolve(value);
}
async function directory(
  location: string,
  expected?: Identity,
  missing: DurableStoreErrorCode = 'INTEGRITY',
): Promise<Directory> {
  let stat: BigIntStats;
  try {
    stat = await lstat(location, { bigint: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return fail(missing);
    throw error;
  }
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    (expected && !sameIdentity(identity(stat), expected)) ||
    !equalPath(path.resolve(await realpath(location)), location)
  )
    return fail('INTEGRITY');
  return { location, identity: identity(stat) };
}
async function ancestors(location: string): Promise<Directory[]> {
  const result: Directory[] = [];
  for (;;) {
    result.push(await directory(location));
    const previous = path.dirname(location);
    if (previous === location) return result;
    location = previous;
  }
}
async function guardDirectories(directories: readonly Directory[]): Promise<void> {
  for (const item of directories) await directory(item.location, item.identity);
}
async function entries(
  location: string,
  allowed: readonly string[],
  required: readonly string[] = [],
  directories: readonly string[] = [],
): Promise<readonly string[]> {
  const names: string[] = [];
  const handle = await opendir(location);
  try {
    for (;;) {
      const item = await handle.read();
      if (!item) break;
      if (
        names.length >= allowed.length ||
        !allowed.includes(item.name) ||
        names.includes(item.name) ||
        item.isSymbolicLink() ||
        (directories.includes(item.name) ? !item.isDirectory() : !item.isFile())
      )
        fail('INTEGRITY');
      names.push(item.name);
    }
  } finally {
    await handle.close();
  }
  if (required.some((name) => !names.includes(name))) fail('INTEGRITY');
  return names;
}
function regular(stat: BigIntStats, expected?: Identity): void {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1n ||
    (expected && !sameIdentity(identity(stat), expected))
  )
    fail('INTEGRITY');
}
async function guardFile(location: string, expected: FileSnapshot): Promise<void> {
  let stat: BigIntStats;
  try {
    stat = await lstat(location, { bigint: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return fail('INTEGRITY');
    throw error;
  }
  regular(stat, expected.identity);
  if (stat.size !== expected.size || stat.mtimeNs !== expected.mtimeNs) fail('INTEGRITY');
}
async function scan(
  location: string,
  max: number,
  {
    bytes,
    sha256,
    expected,
    collect = true,
  }: { bytes?: number; sha256?: string; expected?: Identity; collect?: boolean } = {},
): Promise<ScannedFile> {
  let initial: BigIntStats;
  try {
    initial = await lstat(location, { bigint: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return fail('INTEGRITY');
    throw error;
  }
  regular(initial, expected);
  if (
    initial.size < 1n ||
    initial.size > BigInt(max) ||
    (bytes !== undefined && initial.size !== BigInt(bytes))
  )
    fail('INTEGRITY');
  const file = await open(location, READ_FLAGS);
  let result: ScannedFile;
  try {
    const before = await file.stat({ bigint: true });
    regular(before, identity(initial));
    if (before.size !== initial.size || before.mtimeNs !== initial.mtimeNs) fail('INTEGRITY');
    const size = Number(before.size),
      hash = createHash('sha256'),
      chunks: Buffer[] = [];
    let count = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(READ_SLICE, size - count + 1));
      const read = await file.read(chunk, 0, chunk.length, null);
      if (read.bytesRead === 0) break;
      count += read.bytesRead;
      if (count > size || count > max) fail('INTEGRITY');
      const actual = chunk.subarray(0, read.bytesRead);
      hash.update(actual);
      if (collect) chunks.push(actual);
    }
    const after = await file.stat({ bigint: true });
    regular(after, identity(before));
    const actualHash = hash.digest('hex');
    if (
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      count !== size ||
      (sha256 !== undefined && actualHash !== sha256)
    )
      fail('INTEGRITY');
    result = {
      snapshot: { identity: identity(before), size: before.size, mtimeNs: before.mtimeNs },
      data: collect ? Buffer.concat(chunks, count) : Buffer.alloc(0),
      sha256: actualHash,
    };
  } finally {
    await file.close();
  }
  await guardFile(location, result.snapshot);
  return result;
}
async function writeExclusive(location: string, bytes: Buffer): Promise<Identity> {
  const file: FileHandle = await open(location, WRITE_FLAGS, 0o600);
  try {
    const initial = await file.stat({ bigint: true });
    regular(initial);
    let offset = 0;
    while (offset < bytes.length) {
      const written = await file.write(bytes, offset, bytes.length - offset, null);
      if (written.bytesWritten < 1 || written.bytesWritten > bytes.length - offset)
        fail('IO_FAILURE');
      offset += written.bytesWritten;
    }
    await file.sync();
    const after = await file.stat({ bigint: true });
    regular(after, identity(initial));
    if (after.size !== BigInt(bytes.length)) fail('INTEGRITY');
    return identity(initial);
  } finally {
    await file.close();
  }
}
function parseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return fail('INTEGRITY');
  }
}
async function marker(root: string, storeId: string, expected?: Identity): Promise<FileSnapshot> {
  const read = await scan(path.join(root, 'store.json'), MAX_MARKER_BYTES, { expected });
  const row = plain(parseJson(read.data), ['version', 'storeId'], 'INTEGRITY');
  if (
    row.version !== 1 ||
    row.storeId !== storeId ||
    !read.data.equals(canonical({ version: 1, storeId }))
  )
    fail('INTEGRITY');
  return read.snapshot;
}
function receipt(
  bytes: Buffer,
  storeId: string,
  ref: DurableSyntheticReference,
): DurableSyntheticReceipt {
  const row = plain(
    parseJson(bytes),
    ['version', 'storeId', 'jobId', 'objectId', 'generationId', 'kind', 'bytes', 'sha256'],
    'INTEGRITY',
  );
  const binding = reference(
    { jobId: row.jobId, objectId: row.objectId, generationId: row.generationId, kind: row.kind },
    'INTEGRITY',
  );
  if (
    row.version !== 1 ||
    row.storeId !== storeId ||
    typeof row.bytes !== 'number' ||
    !Number.isSafeInteger(row.bytes) ||
    row.bytes < 1 ||
    row.bytes > MAX_BYTES ||
    typeof row.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.sha256)
  )
    fail('INTEGRITY');
  const result = Object.freeze({
    version: 1 as const,
    storeId,
    jobId: binding.jobId,
    objectId: binding.objectId,
    generationId: binding.generationId,
    kind: binding.kind,
    bytes: row.bytes,
    sha256: row.sha256,
  });
  if (!bytes.equals(canonical(result)) || binding.jobId !== ref.jobId || binding.kind !== ref.kind)
    fail('INTEGRITY');
  if (binding.objectId !== ref.objectId || binding.generationId !== ref.generationId)
    fail('CONFLICT');
  return result;
}

/**
 * Trusted stable local filesystem only. Sync and a receipt written last establish
 * restart-readable committed pairs, not directory/power-loss durability or hostile
 * same-user race resistance. No deletion, repair, worker recovery or accepted media.
 */
function store(
  root: string,
  storeId: string,
  directories: readonly Directory[],
  objects: Directory,
  markerSnapshot: FileSnapshot,
): DurableSyntheticStore {
  let closing = false,
    admitted = 0,
    tail: Promise<void> = Promise.resolve(),
    closed: Promise<void> | undefined;
  async function guard(): Promise<void> {
    await guardDirectories([...directories, objects]);
    await entries(root, ['store.json', 'objects'], ['store.json', 'objects'], ['objects']);
    await marker(root, storeId, markerSnapshot.identity);
    await guardFile(path.join(root, 'store.json'), markerSnapshot);
  }
  function enqueue<T>(operation: () => Promise<T>, prepare?: () => void): Promise<T> {
    if (closing) return Promise.reject(new DurableStoreError('CLOSED'));
    if (admitted >= 2) return Promise.reject(new DurableStoreError('BUSY'));
    admitted++;
    try {
      prepare?.();
    } catch (error) {
      admitted--;
      return Promise.reject(normalized(error));
    }
    const work = tail.then(async () => {
      try {
        await guard();
        return await operation();
      } catch (error) {
        throw normalized(error);
      } finally {
        admitted--;
      }
    });
    tail = work.then(
      () => undefined,
      () => undefined,
    );
    return work;
  }
  async function target(
    ref: DurableSyntheticReference,
    create: boolean,
  ): Promise<{ job: Directory; object: Directory; created: boolean }> {
    const jobPath = path.join(objects.location, ref.jobId),
      objectPath = path.join(jobPath, ref.kind);
    if (create) {
      try {
        await mkdir(jobPath, { mode: 0o700 });
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
      }
    }
    const job = await directory(jobPath, undefined, 'INCOMPLETE');
    await entries(jobPath, ['quarantine', 'output'], [], ['quarantine', 'output']);
    let created = false;
    if (create) {
      try {
        await mkdir(objectPath, { mode: 0o700 });
        created = true;
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
      }
    }
    const object = await directory(objectPath, undefined, 'INCOMPLETE');
    await guardDirectories([job, object]);
    return { job, object, created };
  }
  async function pair(
    ref: DurableSyntheticReference,
    location: { job: Directory; object: Directory },
    collect: boolean,
    expectedData?: Identity,
    expectedReceipt?: Identity,
  ): Promise<DurableSyntheticRead> {
    await guardDirectories([location.job, location.object]);
    const names = await entries(location.object.location, ['data.bin', 'receipt.json']);
    if (!names.includes('receipt.json')) fail('INCOMPLETE');
    if (!names.includes('data.bin')) fail('INTEGRITY');
    const receiptPath = path.join(location.object.location, 'receipt.json'),
      storedReceipt = await scan(receiptPath, MAX_RECEIPT_BYTES, { expected: expectedReceipt });
    const facts = receipt(storedReceipt.data, storeId, ref),
      stored = await scan(path.join(location.object.location, 'data.bin'), MAX_BYTES, {
        bytes: facts.bytes,
        sha256: facts.sha256,
        expected: expectedData,
        collect,
      });
    await guardFile(receiptPath, storedReceipt.snapshot);
    await guardDirectories([location.job, location.object]);
    await entries(
      location.object.location,
      ['data.bin', 'receipt.json'],
      ['data.bin', 'receipt.json'],
    );
    await entries(location.job.location, ['quarantine', 'output'], [], ['quarantine', 'output']);
    await guard();
    return Object.freeze({ receipt: facts, data: stored.data });
  }
  function install(
    value: DurableSyntheticReference,
    bytes: Buffer,
  ): Promise<DurableSyntheticReceipt> {
    let ref: DurableSyntheticReference;
    try {
      ref = reference(value);
      if (!Buffer.isBuffer(bytes) || isSharedArrayBuffer(bytes.buffer)) fail('INVALID_BYTES');
      if (bytes.length === 0) fail('EMPTY_INPUT');
      if (bytes.length > MAX_BYTES) fail('TOO_LARGE');
    } catch (error) {
      return Promise.reject(normalized(error));
    }
    let snapshot: Buffer, sha256: string;
    return enqueue(
      async () => {
        const location = await target(ref, true);
        if (!location.created) {
          const existing = await pair(ref, location, false);
          if (existing.receipt.bytes !== snapshot.length || existing.receipt.sha256 !== sha256)
            fail('CONFLICT');
          return existing.receipt;
        }
        const dataPath = path.join(location.object.location, 'data.bin'),
          dataIdentity = await writeExclusive(dataPath, snapshot);
        await scan(dataPath, MAX_BYTES, {
          bytes: snapshot.length,
          sha256,
          expected: dataIdentity,
          collect: false,
        });
        await guardDirectories([location.job, location.object]);
        await entries(location.object.location, ['data.bin'], ['data.bin']);
        await guard();
        const result = Object.freeze({
          version: 1 as const,
          storeId,
          jobId: ref.jobId,
          objectId: ref.objectId,
          generationId: ref.generationId,
          kind: ref.kind,
          bytes: snapshot.length,
          sha256,
        });
        const receiptIdentity = await writeExclusive(
          path.join(location.object.location, 'receipt.json'),
          canonical(result),
        );
        return (await pair(ref, location, false, dataIdentity, receiptIdentity)).receipt;
      },
      () => {
        snapshot = Buffer.from(bytes);
        sha256 = digest(snapshot);
      },
    );
  }
  function read(value: DurableSyntheticReference): Promise<DurableSyntheticRead> {
    let ref: DurableSyntheticReference;
    try {
      ref = reference(value);
    } catch (error) {
      return Promise.reject(normalized(error));
    }
    return enqueue(async () => pair(ref, await target(ref, false), true));
  }
  function close(): Promise<void> {
    closing = true;
    closed ??= tail;
    return closed;
  }
  return Object.freeze({ storeId, rootDirectory: root, install, read, close });
}

export async function createDurableSyntheticStore(
  trustedAbsoluteParent: string,
): Promise<DurableSyntheticStore> {
  const parent = absolute(trustedAbsoluteParent);
  let parents: Directory[];
  try {
    parents = await ancestors(parent);
  } catch {
    return fail('INVALID_PARENT');
  }
  try {
    const root = await mkdtemp(path.join(parent, 'realtor-durable-synthetic-')),
      storeId = randomUUID(),
      objectsPath = path.join(root, 'objects');
    await mkdir(objectsPath, { mode: 0o700 });
    const rootDirectory = await directory(root),
      objects = await directory(objectsPath);
    await guardDirectories(parents);
    const markerIdentity = await writeExclusive(
      path.join(root, 'store.json'),
      canonical({ version: 1, storeId }),
    );
    const snapshot = await marker(root, storeId, markerIdentity);
    await entries(root, ['store.json', 'objects'], ['store.json', 'objects'], ['objects']);
    await guardDirectories([...parents, rootDirectory, objects]);
    return store(root, storeId, [rootDirectory, ...parents], objects, snapshot);
  } catch (error) {
    throw normalized(error);
  }
}
export async function reopenDurableSyntheticStore(
  trustedAbsoluteRoot: string,
  expectedStoreId: string,
): Promise<DurableSyntheticStore> {
  const root = absolute(trustedAbsoluteRoot),
    storeId = uuid(expectedStoreId, 'INVALID_PARENT');
  let parents: Directory[];
  try {
    parents = await ancestors(root);
  } catch {
    return fail('INVALID_PARENT');
  }
  try {
    const objects = await directory(path.join(root, 'objects'));
    await entries(root, ['store.json', 'objects'], ['store.json', 'objects'], ['objects']);
    const snapshot = await marker(root, storeId);
    await guardDirectories([...parents, objects]);
    return store(root, storeId, parents, objects, snapshot);
  } catch (error) {
    throw normalized(error);
  }
}
