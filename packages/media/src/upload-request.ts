import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isSharedArrayBuffer } from 'node:util/types';
import {
  DurableStoreError,
  type DurableSyntheticReference,
  type DurableSyntheticStore,
} from './durable-store.js';

export interface SyntheticUploadRequestInput {
  readonly uploadId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly listingId: string;
  readonly revision: number;
  readonly jobId: string;
  readonly input: Buffer;
}
export interface SyntheticUploadBinding {
  readonly jobId: string;
  readonly uploadId: string;
}
export interface SyntheticUploadRequest extends SyntheticUploadBinding {
  readonly version: 1;
  readonly requestStoreId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly listingId: string;
  readonly revision: number;
  readonly claimId: string;
  readonly generationId: string;
  readonly input: Readonly<{ bytes: number; sha256: string }>;
}
declare const syntheticUploadTicket: unique symbol;
export interface SyntheticUploadTicket {
  readonly kind: 'synthetic_upload';
  readonly [syntheticUploadTicket]: true;
}
export interface SyntheticUploadReservation {
  readonly ticket: SyntheticUploadTicket;
  readonly request: SyntheticUploadRequest;
}
export interface SyntheticUploadRequests {
  readonly requestStoreId: string;
  readonly rootDirectory: string;
  reserve(input: SyntheticUploadRequestInput): Promise<SyntheticUploadReservation>;
  consume(ticket: SyntheticUploadTicket): SyntheticUploadRequest;
  read(binding: SyntheticUploadBinding): Promise<SyntheticUploadRequest>;
  close(): Promise<void>;
}
export interface SyntheticUploadRequestsConfiguration {
  readonly store: DurableSyntheticStore;
}
export type SyntheticUploadRequestErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_INPUT'
  | 'INVALID_TICKET'
  | 'BUSY'
  | 'CLOSED'
  | 'BLOCKED'
  | 'INTEGRITY'
  | 'PERSISTENCE_FAILED';
export class SyntheticUploadRequestError extends Error {
  override readonly name = 'SyntheticUploadRequestError';
  constructor(readonly code: SyntheticUploadRequestErrorCode) {
    super(`Synthetic upload request: ${code}.`);
  }
}

const MAX_BYTES = 10485760,
  MAX_RECORD_BYTES = 4096,
  UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INPUT_KEYS = [
  'uploadId',
  'tenantId',
  'actorId',
  'listingId',
  'revision',
  'jobId',
  'input',
] as const;
const RECORD_KEYS = [
  'version',
  'requestStoreId',
  'uploadId',
  'tenantId',
  'actorId',
  'listingId',
  'revision',
  'jobId',
  'claimId',
  'generationId',
  'input',
] as const;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const nativeBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!;
const nativeOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!;
const nativeLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')!.get!;
type Code = SyntheticUploadRequestErrorCode;
function fail(code: Code): never {
  throw new SyntheticUploadRequestError(code);
}
function mapped(error: unknown): SyntheticUploadRequestError {
  if (error instanceof SyntheticUploadRequestError) return error;
  if (error instanceof DurableStoreError) {
    if (['INTEGRITY', 'INVALID_PARENT', 'INVALID_REFERENCE'].includes(error.code))
      return new SyntheticUploadRequestError('INTEGRITY');
    if (error.code === 'INCOMPLETE' || error.code === 'CONFLICT')
      return new SyntheticUploadRequestError('BLOCKED');
  }
  return new SyntheticUploadRequestError('PERSISTENCE_FAILED');
}
function nativeCode(error: unknown): unknown {
  return error && typeof error === 'object' && 'code' in error ? error.code : undefined;
}
function data(value: unknown, keys: readonly string[], code: Code): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    fail(code);
  const own = Reflect.ownKeys(value),
    snapshot: Record<string, unknown> = {};
  if (own.length !== keys.length) fail(code);
  for (const key of own) {
    if (typeof key !== 'string' || !keys.includes(key)) fail(code);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail(code);
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}
function uuid(value: unknown, code: Code): string {
  if (typeof value !== 'string' || !UUID.test(value)) fail(code);
  return value.toLowerCase();
}
function revision(value: unknown, code: Code): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2147483647)
    fail(code);
  return value;
}
function binding(value: unknown, code: Code): SyntheticUploadBinding {
  const row = data(value, ['jobId', 'uploadId'], code);
  return Object.freeze({ jobId: uuid(row.jobId, code), uploadId: uuid(row.uploadId, code) });
}
interface ByteView {
  readonly backing: ArrayBuffer;
  readonly offset: number;
  readonly length: number;
}
function view(value: unknown): ByteView {
  if (!Buffer.isBuffer(value)) fail('INVALID_INPUT');
  // Intrinsics avoid invoking caller-owned .buffer/.length accessors or iterators.
  const backing = nativeBuffer.call(value) as ArrayBuffer,
    offset = nativeOffset.call(value) as number,
    length = nativeLength.call(value) as number;
  if (isSharedArrayBuffer(backing) || length < 1 || length > MAX_BYTES) fail('INVALID_INPUT');
  return { backing, offset, length };
}
function encoded(value: SyntheticUploadRequest): Buffer {
  const bytes = Buffer.from(JSON.stringify(value) + '\n', 'utf8');
  if (bytes.length > MAX_RECORD_BYTES) fail('INTEGRITY');
  return bytes;
}
function parse(
  bytes: unknown,
  requestStoreId: string,
  expected: SyntheticUploadBinding,
): SyntheticUploadRequest {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_RECORD_BYTES)
    fail('INTEGRITY');
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return fail('INTEGRITY');
  }
  const row = data(parsed, RECORD_KEYS, 'INTEGRITY'),
    input = data(row.input, ['bytes', 'sha256'], 'INTEGRITY');
  if (
    row.version !== 1 ||
    row.requestStoreId !== requestStoreId ||
    typeof input.bytes !== 'number' ||
    !Number.isSafeInteger(input.bytes) ||
    input.bytes < 1 ||
    input.bytes > MAX_BYTES ||
    typeof input.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.sha256)
  )
    fail('INTEGRITY');
  const result: SyntheticUploadRequest = Object.freeze({
    version: 1,
    requestStoreId,
    uploadId: uuid(row.uploadId, 'INTEGRITY'),
    tenantId: uuid(row.tenantId, 'INTEGRITY'),
    actorId: uuid(row.actorId, 'INTEGRITY'),
    listingId: uuid(row.listingId, 'INTEGRITY'),
    revision: revision(row.revision, 'INTEGRITY'),
    jobId: uuid(row.jobId, 'INTEGRITY'),
    claimId: uuid(row.claimId, 'INTEGRITY'),
    generationId: uuid(row.generationId, 'INTEGRITY'),
    input: Object.freeze({ bytes: input.bytes, sha256: input.sha256 }),
  });
  if (
    result.jobId !== expected.jobId ||
    result.uploadId !== expected.uploadId ||
    result.claimId === result.generationId ||
    [result.jobId, result.uploadId].includes(result.claimId) ||
    [result.jobId, result.uploadId].includes(result.generationId) ||
    !bytes.equals(encoded(result))
  )
    fail('INTEGRITY');
  return result;
}
interface Directory {
  readonly location: string;
  readonly dev: bigint;
  readonly ino: bigint;
  readonly birthtimeNs: bigint;
}
async function directory(location: string, expected?: Directory): Promise<Directory> {
  let stat: BigIntStats;
  try {
    stat = await lstat(location, { bigint: true });
  } catch (error) {
    if (nativeCode(error) === 'ENOENT') fail('INTEGRITY');
    throw error;
  }
  const resolved = path.resolve(await realpath(location));
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    (process.platform === 'win32'
      ? resolved.toLowerCase() !== location.toLowerCase()
      : resolved !== location) ||
    (expected &&
      (stat.dev !== expected.dev ||
        stat.ino !== expected.ino ||
        stat.birthtimeNs !== expected.birthtimeNs))
  )
    fail('INTEGRITY');
  return { location, dev: stat.dev, ino: stat.ino, birthtimeNs: stat.birthtimeNs };
}
async function guard(directories: readonly Directory[]): Promise<void> {
  for (const item of directories) await directory(item.location, item);
}
function reference(value: SyntheticUploadBinding): DurableSyntheticReference {
  return Object.freeze({
    jobId: value.jobId,
    objectId: value.uploadId,
    generationId: value.uploadId,
    kind: 'quarantine',
  });
}

/**
 * Dedicated permanent transport admission facts only. This journal authenticates
 * nobody, stores no image bytes and starts no work. The future ingress bridge must
 * compare authenticated tenant/actor/listing/revision/job and exact snapshotted bytes
 * with the returned request before passing a consumed ticket to processing.
 * Read/reopened history never reconstructs a launch capability or clears unknown work.
 */
export async function createSyntheticUploadRequests(
  value: SyntheticUploadRequestsConfiguration,
): Promise<SyntheticUploadRequests> {
  let store: DurableSyntheticStore,
    requestStoreId: string,
    rootDirectory: string,
    directories: Directory[];
  try {
    const config = data(value, ['store'], 'INVALID_CONFIGURATION'),
      row = data(
        config.store,
        ['storeId', 'rootDirectory', 'install', 'read', 'close'],
        'INVALID_CONFIGURATION',
      );
    requestStoreId = uuid(row.storeId, 'INVALID_CONFIGURATION');
    if (
      typeof row.rootDirectory !== 'string' ||
      !path.isAbsolute(row.rootDirectory) ||
      row.rootDirectory.includes('\0') ||
      (process.platform === 'win32' && path.parse(row.rootDirectory).root.startsWith('\\\\'))
    )
      fail('INVALID_CONFIGURATION');
    rootDirectory = path.resolve(row.rootDirectory);
    for (const method of ['install', 'read', 'close'])
      if (typeof row[method] !== 'function') fail('INVALID_CONFIGURATION');
    const source = config.store as DurableSyntheticStore;
    store = Object.freeze({
      storeId: requestStoreId,
      rootDirectory,
      install: (row.install as DurableSyntheticStore['install']).bind(source),
      read: (row.read as DurableSyntheticStore['read']).bind(source),
      close: (row.close as DurableSyntheticStore['close']).bind(source),
    });
    directories = [];
    for (let location = rootDirectory; ;) {
      directories.push(await directory(location));
      const parent = path.dirname(location);
      if (parent === location) break;
      location = parent;
    }
    directories.push(await directory(path.join(rootDirectory, 'objects')));
    await guard(directories);
  } catch {
    return fail('INVALID_CONFIGURATION');
  }
  const tickets = new WeakMap<
    SyntheticUploadTicket,
    { request: SyntheticUploadRequest; consumed: boolean }
  >();
  let busy = false,
    closing = false,
    tail: Promise<void> = Promise.resolve(),
    closed: Promise<void> | undefined;
  function admitted<T>(operation: () => Promise<T>, prepare?: () => void): Promise<T> {
    if (closing) return Promise.reject(new SyntheticUploadRequestError('CLOSED'));
    if (busy) return Promise.reject(new SyntheticUploadRequestError('BUSY'));
    busy = true;
    try {
      prepare?.();
    } catch (error) {
      busy = false;
      return Promise.reject(mapped(error));
    }
    const work = (async () => {
      try {
        await guard(directories);
        return await operation();
      } catch (error) {
        throw mapped(error);
      } finally {
        busy = false;
      }
    })();
    tail = work.then(
      () => undefined,
      () => undefined,
    );
    return work;
  }
  async function stored(value: SyntheticUploadBinding): Promise<SyntheticUploadRequest> {
    return parse((await store.read(reference(value))).data, requestStoreId, value);
  }
  function reserve(value: SyntheticUploadRequestInput): Promise<SyntheticUploadReservation> {
    let fields: Omit<
        SyntheticUploadRequest,
        'version' | 'requestStoreId' | 'claimId' | 'generationId' | 'input'
      >,
      source: ByteView,
      request: SyntheticUploadRequest,
      bytes: Buffer;
    try {
      const row = data(value, INPUT_KEYS, 'INVALID_INPUT');
      fields = {
        uploadId: uuid(row.uploadId, 'INVALID_INPUT'),
        tenantId: uuid(row.tenantId, 'INVALID_INPUT'),
        actorId: uuid(row.actorId, 'INVALID_INPUT'),
        listingId: uuid(row.listingId, 'INVALID_INPUT'),
        revision: revision(row.revision, 'INVALID_INPUT'),
        jobId: uuid(row.jobId, 'INVALID_INPUT'),
      };
      source = view(row.input);
    } catch {
      return Promise.reject(new SyntheticUploadRequestError('INVALID_INPUT'));
    }
    return admitted(
      async () => {
        // Only this exclusive directory creation confers fresh admission. An exact
        // historical generic-store receipt must never be mistaken for a fresh write.
        const jobPath = path.join(rootDirectory, 'objects', request.jobId);
        try {
          await mkdir(jobPath, { recursive: false, mode: 0o700 });
        } catch (error) {
          if (nativeCode(error) === 'EEXIST') fail('BLOCKED');
          throw error;
        }
        const job = await directory(jobPath);
        await guard([...directories, job]);
        await store.install(reference(request), bytes);
        const committed = await stored(request);
        if (!encoded(committed).equals(bytes)) fail('INTEGRITY');
        await guard([...directories, job]);
        const ticket = Object.freeze({ kind: 'synthetic_upload' }) as SyntheticUploadTicket;
        tickets.set(ticket, { request: committed, consumed: false });
        return Object.freeze({ ticket, request: committed });
      },
      () => {
        const snapshot = Buffer.from(new Uint8Array(source.backing, source.offset, source.length));
        if (snapshot.length !== source.length) fail('INVALID_INPUT');
        const claimId = randomUUID();
        let generationId = randomUUID();
        while (generationId === claimId || [fields.jobId, fields.uploadId].includes(generationId))
          generationId = randomUUID();
        if ([fields.jobId, fields.uploadId].includes(claimId)) fail('INVALID_INPUT');
        request = Object.freeze({
          version: 1,
          requestStoreId,
          ...fields,
          claimId,
          generationId,
          input: Object.freeze({
            bytes: snapshot.length,
            sha256: createHash('sha256').update(snapshot).digest('hex'),
          }),
        });
        bytes = encoded(request);
      },
    );
  }
  function consume(ticket: SyntheticUploadTicket): SyntheticUploadRequest {
    if (closing) fail('CLOSED');
    if (busy) fail('BUSY');
    const live = ticket && typeof ticket === 'object' ? tickets.get(ticket) : undefined;
    if (!live) fail('INVALID_TICKET');
    if (live.consumed) fail('BLOCKED');
    live.consumed = true;
    return live.request;
  }
  function read(value: SyntheticUploadBinding): Promise<SyntheticUploadRequest> {
    let expected: SyntheticUploadBinding;
    try {
      expected = binding(value, 'INVALID_INPUT');
    } catch {
      return Promise.reject(new SyntheticUploadRequestError('INVALID_INPUT'));
    }
    return admitted(async () => {
      const result = await stored(expected);
      await guard(directories);
      return result;
    });
  }
  function close(): Promise<void> {
    closing = true;
    closed ??= tail;
    return closed;
  }
  return Object.freeze({ requestStoreId, rootDirectory, reserve, consume, read, close });
}
