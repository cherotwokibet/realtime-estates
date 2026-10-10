import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rmdir, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { isSharedArrayBuffer, isUint8Array } from 'node:util/types';
import { SYNTHETIC_CODEC_POLICY } from './containers.js';

/** In-memory capability only; never a client filename, storage key or serializable ID. */
declare const localSyntheticHandle: unique symbol;
export interface LocalSyntheticHandle { readonly [localSyntheticHandle]: true }
export interface LocalSyntheticObject {
  readonly handle: LocalSyntheticHandle;
  readonly kind: 'quarantine' | 'output';
  readonly bytes: number;
  readonly sha256: string;
}
export interface LocalSyntheticStore {
  ingest(source: AsyncIterable<Uint8Array>, options?: { readonly signal?: AbortSignal }): Promise<LocalSyntheticObject>;
  read(handle: LocalSyntheticHandle): Promise<Buffer>;
  /** Snapshots bytes immediately; this storage operation does not certify codec origin. */
  publish(output: Buffer): Promise<LocalSyntheticObject>;
  /** Cancels active work and removes only known owned files/directories, never recursively. */
  dispose(): Promise<void>;
}
export type LocalStoreErrorCode = 'INVALID_PARENT' | 'INVALID_HANDLE' | 'INVALID_CHUNK' | 'EMPTY_INPUT' |
  'INPUT_TOO_LARGE' | 'OUTPUT_TOO_LARGE' | 'ABORTED' | 'DISPOSED' | 'BUSY' | 'INTEGRITY' | 'IO_FAILURE';
export class LocalStoreError extends Error {
  override readonly name = 'LocalStoreError';
  constructor(readonly code: LocalStoreErrorCode, message: string) { super(message); }
}

interface Identity { readonly dev: bigint; readonly ino: bigint; readonly birthtimeNs: bigint }
interface Directory { readonly path: string; readonly identity: Identity }
interface ObjectRecord {
  readonly path: string;
  readonly identity: Identity;
  readonly kind: 'quarantine' | 'output';
  readonly bytes: number;
  readonly sha256: string;
}
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const READ_SLICE = 64 * 1024;
const MAX_ADMITTED_OPERATIONS = 2; // One active + one queued; checked before publication copies.
const WRITE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW;
const READ_FLAGS = constants.O_RDONLY | NOFOLLOW;

function fail(code: LocalStoreErrorCode, message: string): never { throw new LocalStoreError(code, message); }
function identity(stat: BigIntStats): Identity { return { dev: stat.dev, ino: stat.ino, birthtimeNs: stat.birthtimeNs }; }
function sameIdentity(a: Identity, b: Identity): boolean { return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs; }
function equalPath(a: string, b: string): boolean { return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; }
function abortIfNeeded(signal: AbortSignal): void { if (signal.aborted) fail('ABORTED', 'Local synthetic storage operation was cancelled.'); }
function normalizeError(error: unknown): LocalStoreError {
  return error instanceof LocalStoreError ? error : new LocalStoreError('IO_FAILURE', 'Local synthetic storage I/O failed.');
}

async function checkedDirectory(location: string, expected?: Identity): Promise<Directory> {
  const stat = await lstat(location, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory() || (expected && !sameIdentity(identity(stat), expected)) ||
      !equalPath(path.resolve(await realpath(location)), location)) {
    fail('INTEGRITY', 'A local synthetic storage directory changed or is indirect.');
  }
  return { path: location, identity: identity(stat) };
}

async function writeAll(file: FileHandle, bytes: Buffer, signal: AbortSignal): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    abortIfNeeded(signal);
    const written = await file.write(bytes, offset, bytes.length - offset, null);
    if (written.bytesWritten < 1) fail('IO_FAILURE', 'Local synthetic storage write made no progress.');
    offset += written.bytesWritten;
  }
}

async function nextOrAbort<T>(iterator: AsyncIterator<T>, signal: AbortSignal): Promise<IteratorResult<T>> {
  abortIfNeeded(signal);
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new LocalStoreError('ABORTED', 'Local synthetic storage operation was cancelled.'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    // Both race inputs have rejection handlers, including a producer that rejects late.
    return await Promise.race([Promise.resolve().then(() => { abortIfNeeded(signal); return iterator.next(); }), cancelled]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Local synthetic, disposable storage only. The parent must be trusted and not mutated
 * by other actors. lstat/realpath/identity checks and no-follow where available reduce
 * accidental traversal; Node has no portable directory-relative/openat API here.
 * They do NOT defeat hostile same-user symlink/reparse races or prove Windows ACLs.
 * No API/SQL/provider, referenced-object deletion or production acceptance is supplied.
 */
export async function createLocalSyntheticStore(trustedParentDirectory: string): Promise<LocalSyntheticStore> {
  if (typeof trustedParentDirectory !== 'string' || !path.isAbsolute(trustedParentDirectory) ||
      (process.platform === 'win32' && path.parse(trustedParentDirectory).root.startsWith('\\\\'))) {
    fail('INVALID_PARENT', 'An existing trusted absolute local parent directory is required.');
  }
  const parent = path.resolve(trustedParentDirectory);
  const ancestors: Directory[] = [];
  let location = parent;
  try {
    for (;;) {
      ancestors.push(await checkedDirectory(location));
      const previous = path.dirname(location);
      if (previous === location) break;
      location = previous;
    }
  } catch {
    fail('INVALID_PARENT', 'The trusted parent must have stable direct directory ancestors.');
  }
  let rootPath: string;
  try { rootPath = await mkdtemp(path.join(parent, 'realtor-synthetic-')); }
  catch { fail('IO_FAILURE', 'Could not create a local synthetic storage root.'); }
  const quarantinePath = path.join(rootPath, 'quarantine');
  const outputPath = path.join(rootPath, 'output');
  let directories: Directory[];
  try {
    await mkdir(quarantinePath, { mode: 0o700 });
    await mkdir(outputPath, { mode: 0o700 });
    directories = [await checkedDirectory(rootPath), await checkedDirectory(quarantinePath), await checkedDirectory(outputPath)];
    for (const ancestor of ancestors) await checkedDirectory(ancestor.path, ancestor.identity);
  } catch (error) {
    // No recursive fallback. Unexpected entries or a substituted directory remain for
    // trusted inspection; failure must never delete the supplied parent/unknown tree.
    for (const created of [outputPath, quarantinePath, rootPath]) await rmdir(created).catch(() => undefined);
    throw normalizeError(error);
  }

  const records = new WeakMap<LocalSyntheticHandle, ObjectRecord>();
  const ownedFiles = new Map<string, Identity>();
  let tail: Promise<void> = Promise.resolve();
  let closing = false;
  let admitted = 0;
  let active: AbortController | undefined;
  let disposal: Promise<void> | undefined;

  async function guardDirectories(): Promise<void> {
    for (const directory of [...ancestors, ...directories]) await checkedDirectory(directory.path, directory.identity);
  }

  function enqueue<T>(operation: (signal: AbortSignal) => Promise<T>, prepare?: () => void): Promise<T> {
    if (closing) return Promise.reject(new LocalStoreError('DISPOSED', 'Local synthetic store is disposing or disposed.'));
    if (admitted >= MAX_ADMITTED_OPERATIONS) return Promise.reject(new LocalStoreError('BUSY', 'Local synthetic store permits one active and one queued operation.'));
    admitted++;
    try { prepare?.(); }
    catch (error) { admitted--; return Promise.reject(normalizeError(error)); }
    const task = tail.then(async () => {
      const controller = new AbortController();
      active = controller;
      try {
        if (closing) fail('DISPOSED', 'Local synthetic store is disposing or disposed.');
        await guardDirectories();
        abortIfNeeded(controller.signal);
        return await operation(controller.signal);
      } catch (error) {
        throw normalizeError(error);
      } finally {
        active = undefined;
        admitted--;
      }
    });
    tail = task.then(() => undefined, () => undefined);
    return task;
  }

  async function checkedFile(record: Pick<ObjectRecord, 'path' | 'identity'>): Promise<void> {
    const stat = await lstat(record.path, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || !sameIdentity(identity(stat), record.identity)) {
      fail('INTEGRITY', 'A local synthetic storage file changed identity or is indirect.');
    }
  }

  async function scan(record: ObjectRecord, signal: AbortSignal, collect: boolean): Promise<Buffer> {
    await checkedFile(record);
    const file = await open(record.path, READ_FLAGS);
    try {
      const before = await file.stat({ bigint: true });
      if (!before.isFile() || before.nlink !== 1n || !sameIdentity(identity(before), record.identity) || before.size !== BigInt(record.bytes)) {
        fail('INTEGRITY', 'Stored synthetic bytes changed size or identity.');
      }
      const hash = createHash('sha256');
      const slices: Buffer[] = [];
      let bytes = 0;
      for (;;) {
        abortIfNeeded(signal);
        const slice = Buffer.alloc(Math.min(READ_SLICE, record.bytes - bytes + 1));
        const read = await file.read(slice, 0, slice.length, null);
        if (read.bytesRead === 0) break;
        bytes += read.bytesRead;
        if (bytes > record.bytes) fail('INTEGRITY', 'Stored synthetic bytes exceed their captured length.');
        const chunk = slice.subarray(0, read.bytesRead);
        hash.update(chunk);
        if (collect) slices.push(chunk);
      }
      const after = await file.stat({ bigint: true });
      await checkedFile(record);
      if (!sameIdentity(identity(after), record.identity) || after.size !== before.size || after.mtimeNs !== before.mtimeNs ||
          bytes !== record.bytes || hash.digest('hex') !== record.sha256) {
        fail('INTEGRITY', 'Stored synthetic bytes failed actual length or SHA-256 revalidation.');
      }
      abortIfNeeded(signal);
      return collect ? Buffer.concat(slices, bytes) : Buffer.alloc(0);
    } finally {
      await file.close();
    }
  }

  async function removePartial(filePath: string): Promise<void> {
    const known = ownedFiles.get(filePath);
    if (!known) return;
    await guardDirectories();
    await checkedFile({ path: filePath, identity: known });
    await unlink(filePath);
    ownedFiles.delete(filePath);
  }

  async function createFile(kind: ObjectRecord['kind']): Promise<{ file: FileHandle; filePath: string; fileIdentity: Identity }> {
    const filePath = path.join(kind === 'quarantine' ? quarantinePath : outputPath, `${randomUUID()}.${kind === 'quarantine' ? 'input' : 'output'}`);
    const file = await open(filePath, WRITE_FLAGS, 0o600);
    try {
      const stat = await file.stat({ bigint: true });
      if (!stat.isFile() || stat.nlink !== 1n) fail('INTEGRITY', 'Created local synthetic file is not a direct regular file.');
      const fileIdentity = identity(stat);
      ownedFiles.set(filePath, fileIdentity);
      return { file, filePath, fileIdentity };
    } catch (error) {
      await file.close();
      throw error;
    }
  }

  async function issue(record: ObjectRecord, signal: AbortSignal): Promise<LocalSyntheticObject> {
    await scan(record, signal, false);
    const handle = Object.freeze({}) as LocalSyntheticHandle;
    records.set(handle, record);
    return Object.freeze({ handle, kind: record.kind, bytes: record.bytes, sha256: record.sha256 });
  }

  function ingest(source: AsyncIterable<Uint8Array>, options: { readonly signal?: AbortSignal } = {}): Promise<LocalSyntheticObject> {
    return enqueue(async storeSignal => {
      const signal = options.signal ? AbortSignal.any([storeSignal, options.signal]) : storeSignal;
      abortIfNeeded(signal);
      if (!source || typeof source[Symbol.asyncIterator] !== 'function') fail('INVALID_CHUNK', 'An asynchronous byte source is required.');
      const iterator = source[Symbol.asyncIterator]();
      let file: FileHandle | undefined;
      let filePath: string | undefined;
      let complete = false;
      let closed = false;
      try {
        const created = await createFile('quarantine');
        file = created.file;
        filePath = created.filePath;
        const hash = createHash('sha256');
        let bytes = 0;
        for (;;) {
          const next = await nextOrAbort(iterator, signal);
          abortIfNeeded(signal);
          if (next.done) { complete = true; break; }
          const view = next.value;
          if (!isUint8Array(view) || view.byteLength === 0 || isSharedArrayBuffer(view.buffer)) {
            fail('INVALID_CHUNK', 'Each input chunk must be a non-empty, ordinary Uint8Array.');
          }
          if (view.byteLength > SYNTHETIC_CODEC_POLICY.maxInputBytes - bytes) fail('INPUT_TOO_LARGE', 'Streamed input exceeds 10 MiB.');
          const chunk = Buffer.from(view); // Snapshot the exact view before any disk await.
          await writeAll(file, chunk, signal);
          hash.update(chunk);
          bytes += chunk.length;
        }
        if (bytes === 0) fail('EMPTY_INPUT', 'An empty synthetic input is not stored.');
        abortIfNeeded(signal);
        await file.sync();
        await file.close();
        closed = true;
        return await issue({ path: filePath, identity: created.fileIdentity, kind: 'quarantine', bytes, sha256: hash.digest('hex') }, signal);
      } catch (error) {
        if (file && !closed) { await file.close(); closed = true; }
        if (filePath) await removePartial(filePath);
        throw error;
      } finally {
        if (!complete && typeof iterator.return === 'function') {
          // A suspended or hostile producer may never finish return(). Ask once, consume
          // late failure, and never await it or permit its late result to write bytes.
          try { void Promise.resolve(iterator.return()).catch(() => undefined); } catch { /* best effort */ }
        }
      }
    });
  }

  function publish(output: Buffer): Promise<LocalSyntheticObject> {
    // Snapshot BEFORE enqueue/await; caller mutation while another operation runs cannot
    // change the bytes that this publication and receipt describe.
    if (!Buffer.isBuffer(output) || output.length === 0 || isSharedArrayBuffer(output.buffer)) {
      return Promise.reject(new LocalStoreError('INVALID_CHUNK', 'A non-empty ordinary output Buffer is required.'));
    }
    if (output.length > SYNTHETIC_CODEC_POLICY.maxOutputBytes) return Promise.reject(new LocalStoreError('OUTPUT_TOO_LARGE', 'Synthetic output exceeds 10 MiB.'));
    let snapshot = Buffer.alloc(0);
    return enqueue(async signal => {
      const { file, filePath, fileIdentity } = await createFile('output');
      let closed = false;
      try {
        await writeAll(file, snapshot, signal);
        await file.sync();
        await file.close();
        closed = true;
        return await issue({ path: filePath, identity: fileIdentity, kind: 'output', bytes: snapshot.length, sha256: createHash('sha256').update(snapshot).digest('hex') }, signal);
      } catch (error) {
        if (!closed) { await file.close(); closed = true; }
        await removePartial(filePath);
        throw error;
      }
    }, () => { snapshot = Buffer.from(output); });
  }

  function read(handle: LocalSyntheticHandle): Promise<Buffer> {
    return enqueue(async signal => {
      const record = (typeof handle === 'object' && handle !== null) ? records.get(handle) : undefined;
      if (!record) fail('INVALID_HANDLE', 'Object handle does not belong to this local synthetic store.');
      return scan(record, signal, true);
    });
  }

  function dispose(): Promise<void> {
    if (disposal) return disposal;
    closing = true;
    active?.abort();
    disposal = tail.then(async () => {
      try {
        await guardDirectories();
        const rootEntries = await readdir(rootPath);
        if (rootEntries.length !== 2 || !rootEntries.includes('quarantine') || !rootEntries.includes('output')) {
          fail('INTEGRITY', 'Unexpected entries prevent local synthetic cleanup.');
        }
        for (const directoryPath of [quarantinePath, outputPath]) {
          for (const name of await readdir(directoryPath)) {
            if (!ownedFiles.has(path.join(directoryPath, name))) fail('INTEGRITY', 'Unknown files prevent local synthetic cleanup.');
          }
        }
        for (const [filePath, fileIdentity] of ownedFiles) await checkedFile({ path: filePath, identity: fileIdentity });
        for (const [filePath, fileIdentity] of ownedFiles) {
          await guardDirectories();
          await checkedFile({ path: filePath, identity: fileIdentity });
          await unlink(filePath);
          ownedFiles.delete(filePath);
        }
        // rmdir is deliberately nonrecursive: a new unknown file fails closed.
        await guardDirectories();
        await rmdir(quarantinePath);
        await checkedDirectory(outputPath, directories[2]!.identity);
        await rmdir(outputPath);
        await checkedDirectory(rootPath, directories[0]!.identity);
        await rmdir(rootPath);
      } catch (error) {
        throw normalizeError(error);
      }
    });
    return disposal;
  }

  return Object.freeze({ ingest, read, publish, dispose });
}
