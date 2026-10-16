import { Buffer } from 'node:buffer';
import type { BigIntStats } from 'node:fs';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type {
  MediaCaptureInput,
  MediaProcessingLease,
  MediaSealInput,
  MediaUploadContext,
} from './coordinator-database.js';
import {
  DurableStoreError,
  type DurableSyntheticReference,
  type DurableSyntheticStore,
} from './durable-store.js';
import type { SyntheticImageManifest } from './index.js';

export interface SyntheticProcessingBinding {
  readonly jobId: string;
  readonly claimId: string;
  readonly generationId: string;
}
export interface SyntheticProcessingRequestInput extends SyntheticProcessingBinding {
  readonly workerId: string;
  readonly journalId: string;
  readonly reservationId: string;
  readonly inputStoreId: string;
  readonly context: MediaUploadContext;
  readonly input: MediaCaptureInput;
}
export interface SyntheticProcessingRequest extends SyntheticProcessingRequestInput {
  readonly version: 1;
  readonly requestStoreId: string;
}
export interface SyntheticProcessingOutput {
  readonly objectId: string;
  readonly generationId: string;
  readonly bytes: number;
  readonly sha256: string;
}
export interface SyntheticProcessingSealInput {
  readonly lease: MediaProcessingLease;
  readonly outputStoreId: string;
  readonly output: SyntheticProcessingOutput;
  readonly seal: MediaSealInput;
}
export interface SyntheticProcessingSealRequest
  extends SyntheticProcessingBinding, SyntheticProcessingSealInput {
  readonly version: 1;
  readonly requestStoreId: string;
}
declare const syntheticProcessingTicket: unique symbol;
export interface SyntheticProcessingTicket {
  readonly kind: 'synthetic_processing';
  readonly [syntheticProcessingTicket]: true;
}
export interface SyntheticProcessingReservation {
  readonly ticket: SyntheticProcessingTicket;
  readonly request: SyntheticProcessingRequest;
}
export interface SyntheticProcessingRequests {
  readonly requestStoreId: string;
  readonly rootDirectory: string;
  reserve(input: SyntheticProcessingRequestInput): Promise<SyntheticProcessingReservation>;
  consume(ticket: SyntheticProcessingTicket): SyntheticProcessingRequest;
  read(binding: SyntheticProcessingBinding): Promise<SyntheticProcessingRequest>;
  recordSeal(
    ticket: SyntheticProcessingTicket,
    input: SyntheticProcessingSealInput,
  ): Promise<SyntheticProcessingSealRequest>;
  readSeal(binding: SyntheticProcessingBinding): Promise<SyntheticProcessingSealRequest | null>;
  close(): Promise<void>;
}
export type SyntheticProcessingRequestErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_INPUT'
  | 'INVALID_TICKET'
  | 'BUSY'
  | 'CLOSED'
  | 'BLOCKED'
  | 'INTEGRITY'
  | 'PERSISTENCE_FAILED';
export class SyntheticProcessingRequestError extends Error {
  override readonly name = 'SyntheticProcessingRequestError';
  constructor(readonly code: SyntheticProcessingRequestErrorCode) {
    super(`Synthetic processing request: ${code}.`);
  }
}
export interface SyntheticProcessingRequestsConfiguration {
  readonly store: DurableSyntheticStore;
}

const LIMIT = 4096,
  UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BINDING_KEYS = ['jobId', 'claimId', 'generationId'] as const;
const REQUEST_KEYS = [
  'version',
  'requestStoreId',
  'jobId',
  'claimId',
  'generationId',
  'workerId',
  'journalId',
  'reservationId',
  'inputStoreId',
  'context',
  'input',
] as const;
const SEAL_KEYS = [
  'version',
  'requestStoreId',
  'jobId',
  'claimId',
  'generationId',
  'lease',
  'outputStoreId',
  'output',
  'seal',
] as const;
const OPERATIONS = [
  'auto-orient',
  'resize-inside-1920-without-enlargement',
  'strip-metadata',
  'webp-quality-82-effort-4',
] as const;
type Code = SyntheticProcessingRequestErrorCode;
function fail(code: Code): never {
  throw new SyntheticProcessingRequestError(code);
}
function mapped(error: unknown): SyntheticProcessingRequestError {
  if (error instanceof SyntheticProcessingRequestError) return error;
  if (error instanceof DurableStoreError) {
    if (['INTEGRITY', 'INVALID_PARENT', 'INVALID_REFERENCE'].includes(error.code))
      return new SyntheticProcessingRequestError('INTEGRITY');
    if (error.code === 'CONFLICT' || error.code === 'INCOMPLETE')
      return new SyntheticProcessingRequestError('BLOCKED');
  }
  return new SyntheticProcessingRequestError('PERSISTENCE_FAILED');
}
function nativeCode(error: unknown): unknown {
  return error && typeof error === 'object' && 'code' in error ? error.code : undefined;
}
/** Internal shared fact validators snapshot strict own data properties before I/O. */
export function processingData(
  value: unknown,
  keys: readonly string[],
  code: Code = 'INVALID_INPUT',
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    fail(code);
  const own = Reflect.ownKeys(value),
    result: Record<string, unknown> = {};
  if (own.length !== keys.length) fail(code);
  for (const key of own) {
    if (typeof key !== 'string' || !keys.includes(key)) fail(code);
    const item = Object.getOwnPropertyDescriptor(value, key);
    if (!item?.enumerable || !Object.hasOwn(item, 'value')) fail(code);
    result[key] = item.value;
  }
  return result;
}
export function processingUuid(value: unknown, code: Code = 'INVALID_INPUT'): string {
  if (typeof value !== 'string' || !UUID.test(value)) fail(code);
  return value.toLowerCase();
}
function number(value: unknown, min: number, max: number, code: Code): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    fail(code);
  return value;
}
function hash(value: unknown, code: Code): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(code);
  return value;
}
function timestamp(value: unknown, code: Code): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value.slice(0, 23) + 'Z'
  )
    fail(code);
  return value;
}
export function processingBinding(
  value: unknown,
  code: Code = 'INVALID_INPUT',
): SyntheticProcessingBinding {
  const row = processingData(value, BINDING_KEYS, code);
  return Object.freeze({
    jobId: processingUuid(row.jobId, code),
    claimId: processingUuid(row.claimId, code),
    generationId: processingUuid(row.generationId, code),
  });
}
export function processingContext(
  value: unknown,
  code: Code = 'INVALID_INPUT',
): MediaUploadContext {
  const row = processingData(
      value,
      ['jobId', 'quarantineId', 'outputId', 'expiresAt', 'pipeline'],
      code,
    ),
    jobId = processingUuid(row.jobId, code),
    quarantineId = processingUuid(row.quarantineId, code),
    outputId = processingUuid(row.outputId, code);
  if (
    row.pipeline !== 'synthetic-codec-v1' ||
    quarantineId === outputId ||
    jobId === quarantineId ||
    jobId === outputId
  )
    fail(code);
  return Object.freeze({
    jobId,
    quarantineId,
    outputId,
    expiresAt: timestamp(row.expiresAt, code),
    pipeline: 'synthetic-codec-v1',
  });
}
function capture(value: unknown, code: Code): MediaCaptureInput {
  const row = processingData(value, ['generationId', 'bytes', 'sha256'], code);
  return Object.freeze({
    generationId: processingUuid(row.generationId, code),
    bytes: number(row.bytes, 1, 10485760, code),
    sha256: hash(row.sha256, code),
  });
}
export function processingLease(
  value: unknown,
  code: Code = 'INVALID_INPUT',
): MediaProcessingLease {
  const row = processingData(
    value,
    [
      'jobId',
      'claimId',
      'attempt',
      'leaseNonce',
      'leaseExpiresAt',
      'quarantineId',
      'outputId',
      'input',
      'pipeline',
    ],
    code,
  );
  const jobId = processingUuid(row.jobId, code),
    quarantineId = processingUuid(row.quarantineId, code),
    outputId = processingUuid(row.outputId, code);
  if (
    row.pipeline !== 'synthetic-codec-v1' ||
    quarantineId === outputId ||
    jobId === quarantineId ||
    jobId === outputId
  )
    fail(code);
  return Object.freeze({
    jobId,
    claimId: processingUuid(row.claimId, code),
    attempt: number(row.attempt, 1, 3, code),
    leaseNonce: processingUuid(row.leaseNonce, code),
    leaseExpiresAt: timestamp(row.leaseExpiresAt, code),
    quarantineId,
    outputId,
    input: capture(row.input, code),
    pipeline: 'synthetic-codec-v1',
  });
}
export function processingManifest(
  value: unknown,
  code: Code = 'INVALID_INPUT',
): SyntheticImageManifest {
  const row = processingData(
      value,
      [
        'pipeline',
        'sourceFormat',
        'inputSha256',
        'inputBytes',
        'format',
        'mimeType',
        'sha256',
        'width',
        'height',
        'bytes',
        'encoder',
        'operations',
      ],
      code,
    ),
    encoder = processingData(row.encoder, ['sharp', 'vips'], code),
    operations = row.operations;
  if (
    row.pipeline !== 'synthetic-codec-v1' ||
    !['jpeg', 'png', 'webp'].includes(row.sourceFormat as string) ||
    row.format !== 'webp' ||
    row.mimeType !== 'image/webp' ||
    encoder.sharp !== '0.35.5' ||
    encoder.vips !== '8.18.7' ||
    !Array.isArray(operations) ||
    operations.length !== 4 ||
    Reflect.ownKeys(operations).length !== 5
  )
    fail(code);
  for (let i = 0; i < 4; i++) {
    const item = Object.getOwnPropertyDescriptor(operations, String(i));
    if (!item?.enumerable || !Object.hasOwn(item, 'value') || item.value !== OPERATIONS[i])
      fail(code);
  }
  return Object.freeze({
    pipeline: 'synthetic-codec-v1',
    sourceFormat: row.sourceFormat as SyntheticImageManifest['sourceFormat'],
    inputSha256: hash(row.inputSha256, code),
    inputBytes: number(row.inputBytes, 1, 10485760, code),
    format: 'webp',
    mimeType: 'image/webp',
    sha256: hash(row.sha256, code),
    width: number(row.width, 1, 1920, code),
    height: number(row.height, 1, 1920, code),
    bytes: number(row.bytes, 1, 10485760, code),
    encoder: Object.freeze({ sharp: '0.35.5', vips: '8.18.7' }),
    operations: Object.freeze([...OPERATIONS] as const),
  });
}
function output(value: unknown, code: Code): SyntheticProcessingOutput {
  const row = processingData(value, ['objectId', 'generationId', 'bytes', 'sha256'], code);
  return Object.freeze({
    objectId: processingUuid(row.objectId, code),
    generationId: processingUuid(row.generationId, code),
    bytes: number(row.bytes, 1, 10485760, code),
    sha256: hash(row.sha256, code),
  });
}
export function processingBytes(value: unknown, code: Code = 'INTEGRITY'): Buffer {
  const bytes = Buffer.from(JSON.stringify(value) + '\n', 'utf8');
  if (bytes.length > LIMIT) fail(code);
  return bytes;
}
export function processingEqual(a: unknown, b: unknown): boolean {
  return processingBytes(a).equals(processingBytes(b));
}
function requestInput(
  value: unknown,
  requestStoreId: string,
  code: Code,
): SyntheticProcessingRequest {
  const row = processingData(
      value,
      REQUEST_KEYS.filter((key) => key !== 'version' && key !== 'requestStoreId'),
      code,
    ),
    binding = processingBinding(
      { jobId: row.jobId, claimId: row.claimId, generationId: row.generationId },
      code,
    );
  const context = processingContext(row.context, code),
    input = capture(row.input, code);
  if (context.jobId !== binding.jobId || input.generationId !== binding.generationId) fail(code);
  return Object.freeze({
    version: 1,
    requestStoreId,
    ...binding,
    workerId: processingUuid(row.workerId, code),
    journalId: processingUuid(row.journalId, code),
    reservationId: processingUuid(row.reservationId, code),
    inputStoreId: processingUuid(row.inputStoreId, code),
    context,
    input,
  });
}
function sealInput(
  value: unknown,
  request: SyntheticProcessingRequest,
  code: Code,
): SyntheticProcessingSealRequest {
  const row = processingData(value, ['lease', 'outputStoreId', 'output', 'seal'], code),
    lease = processingLease(row.lease, code),
    stored = output(row.output, code),
    rawSeal = processingData(row.seal, ['attempt', 'leaseNonce', 'manifest'], code);
  const seal = Object.freeze({
      attempt: number(rawSeal.attempt, 1, 3, code),
      leaseNonce: processingUuid(rawSeal.leaseNonce, code),
      manifest: processingManifest(rawSeal.manifest, code),
    }),
    outputStoreId = processingUuid(row.outputStoreId, code);
  if (
    !processingLeaseMatches(request, lease) ||
    outputStoreId !== request.inputStoreId ||
    stored.objectId !== lease.outputId ||
    stored.generationId !== lease.leaseNonce ||
    seal.attempt !== lease.attempt ||
    seal.leaseNonce !== lease.leaseNonce ||
    seal.manifest.inputBytes !== request.input.bytes ||
    seal.manifest.inputSha256 !== request.input.sha256 ||
    stored.bytes !== seal.manifest.bytes ||
    stored.sha256 !== seal.manifest.sha256
  )
    fail(code);
  return Object.freeze({
    version: 1,
    requestStoreId: request.requestStoreId,
    jobId: request.jobId,
    claimId: request.claimId,
    generationId: request.generationId,
    lease,
    outputStoreId,
    output: stored,
    seal,
  });
}
export function processingLeaseMatches(
  request: SyntheticProcessingRequest,
  lease: MediaProcessingLease,
): boolean {
  return (
    lease.jobId === request.jobId &&
    lease.claimId === request.claimId &&
    lease.quarantineId === request.context.quarantineId &&
    lease.outputId === request.context.outputId &&
    lease.pipeline === request.context.pipeline &&
    processingEqual(lease.input, request.input)
  );
}
function parsed(bytes: Buffer): unknown {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > LIMIT) fail('INTEGRITY');
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return fail('INTEGRITY');
  }
}
function parseRequest(
  bytes: Buffer,
  requestStoreId: string,
  binding: SyntheticProcessingBinding,
): SyntheticProcessingRequest {
  const row = processingData(parsed(bytes), REQUEST_KEYS, 'INTEGRITY'),
    { version, requestStoreId: stored, ...input } = row,
    result = requestInput(input, requestStoreId, 'INTEGRITY');
  if (
    version !== 1 ||
    stored !== requestStoreId ||
    !processingEqual(
      processingBinding({
        jobId: result.jobId,
        claimId: result.claimId,
        generationId: result.generationId,
      }),
      binding,
    ) ||
    !bytes.equals(processingBytes(result))
  )
    fail('INTEGRITY');
  return result;
}
function parseSeal(
  bytes: Buffer,
  request: SyntheticProcessingRequest,
): SyntheticProcessingSealRequest {
  const row = processingData(parsed(bytes), SEAL_KEYS, 'INTEGRITY'),
    result = sealInput(
      { lease: row.lease, outputStoreId: row.outputStoreId, output: row.output, seal: row.seal },
      request,
      'INTEGRITY',
    );
  if (
    row.version !== 1 ||
    row.requestStoreId !== request.requestStoreId ||
    row.jobId !== request.jobId ||
    row.claimId !== request.claimId ||
    row.generationId !== request.generationId ||
    !bytes.equals(processingBytes(result))
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
function reference(
  binding: SyntheticProcessingBinding,
  kind: 'quarantine' | 'output',
): DurableSyntheticReference {
  return Object.freeze({
    jobId: binding.jobId,
    objectId: binding.claimId,
    generationId: binding.generationId,
    kind,
  });
}

/** Dedicated permanent request facts; reopened/read records never recreate live command authority. */
export async function createSyntheticProcessingRequests(
  value: SyntheticProcessingRequestsConfiguration,
): Promise<SyntheticProcessingRequests> {
  let store: DurableSyntheticStore,
    requestStoreId: string,
    rootDirectory: string,
    directories: Directory[];
  try {
    const config = processingData(value, ['store'], 'INVALID_CONFIGURATION'),
      row = processingData(
        config.store,
        ['storeId', 'rootDirectory', 'install', 'read', 'close'],
        'INVALID_CONFIGURATION',
      );
    requestStoreId = processingUuid(row.storeId, 'INVALID_CONFIGURATION');
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
    SyntheticProcessingTicket,
    { request: SyntheticProcessingRequest; consumed: boolean }
  >();
  let busy = false,
    closing = false,
    tail: Promise<void> = Promise.resolve(),
    closed: Promise<void> | undefined;
  function admitted<T>(operation: () => Promise<T>): Promise<T> {
    if (closing) return Promise.reject(new SyntheticProcessingRequestError('CLOSED'));
    if (busy) return Promise.reject(new SyntheticProcessingRequestError('BUSY'));
    busy = true;
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
  async function storedRequest(
    value: SyntheticProcessingBinding,
  ): Promise<SyntheticProcessingRequest> {
    const binding = processingBinding({
      jobId: value.jobId,
      claimId: value.claimId,
      generationId: value.generationId,
    });
    return parseRequest(
      (await store.read(reference(binding, 'quarantine'))).data,
      requestStoreId,
      binding,
    );
  }
  function reserve(
    input: SyntheticProcessingRequestInput,
  ): Promise<SyntheticProcessingReservation> {
    let request: SyntheticProcessingRequest, bytes: Buffer;
    try {
      request = requestInput(input, requestStoreId, 'INVALID_INPUT');
      bytes = processingBytes(request, 'INVALID_INPUT');
    } catch (error) {
      return Promise.reject(
        error instanceof SyntheticProcessingRequestError
          ? error
          : new SyntheticProcessingRequestError('INVALID_INPUT'),
      );
    }
    return admitted(async () => {
      try {
        await storedRequest(request);
        fail('BLOCKED');
      } catch (error) {
        if (!(error instanceof DurableStoreError && error.code === 'INCOMPLETE')) throw error;
      }
      const jobPath = path.join(rootDirectory, 'objects', request.jobId);
      try {
        await mkdir(jobPath, { recursive: false, mode: 0o700 });
      } catch (error) {
        if (nativeCode(error) === 'EEXIST') fail('BLOCKED');
        throw error;
      }
      const job = await directory(jobPath);
      await guard([...directories, job]);
      await store.install(reference(request, 'quarantine'), bytes);
      const committed = await storedRequest(request);
      if (!processingEqual(committed, request)) fail('INTEGRITY');
      await guard([...directories, job]);
      const ticket = Object.freeze({ kind: 'synthetic_processing' }) as SyntheticProcessingTicket;
      tickets.set(ticket, { request: committed, consumed: false });
      return Object.freeze({ ticket, request: committed });
    });
  }
  function consume(ticket: SyntheticProcessingTicket): SyntheticProcessingRequest {
    if (closing) fail('CLOSED');
    if (busy) fail('BUSY');
    const live = ticket && typeof ticket === 'object' ? tickets.get(ticket) : undefined;
    if (!live) fail('INVALID_TICKET');
    if (live.consumed) fail('BLOCKED');
    live.consumed = true;
    return live.request;
  }
  function read(value: SyntheticProcessingBinding): Promise<SyntheticProcessingRequest> {
    let binding: SyntheticProcessingBinding;
    try {
      binding = processingBinding(value);
    } catch (error) {
      return Promise.reject(
        error instanceof SyntheticProcessingRequestError
          ? error
          : new SyntheticProcessingRequestError('INVALID_INPUT'),
      );
    }
    return admitted(async () => {
      const result = await storedRequest(binding);
      await guard(directories);
      return result;
    });
  }
  function recordSeal(
    ticket: SyntheticProcessingTicket,
    value: SyntheticProcessingSealInput,
  ): Promise<SyntheticProcessingSealRequest> {
    let request: SyntheticProcessingRequest,
      expected: SyntheticProcessingSealRequest,
      bytes: Buffer;
    try {
      const live = ticket && typeof ticket === 'object' ? tickets.get(ticket) : undefined;
      if (!live || !live.consumed) fail('INVALID_TICKET');
      request = live.request;
      expected = sealInput(value, request, 'INVALID_INPUT');
      bytes = processingBytes(expected, 'INVALID_INPUT');
    } catch (error) {
      return Promise.reject(
        error instanceof SyntheticProcessingRequestError
          ? error
          : new SyntheticProcessingRequestError('INVALID_INPUT'),
      );
    }
    return admitted(async () => {
      const original = await storedRequest(request);
      if (!processingEqual(original, request)) fail('INTEGRITY');
      await store.install(reference(request, 'output'), bytes);
      const read = parseSeal((await store.read(reference(request, 'output'))).data, request);
      if (!processingEqual(read, expected)) fail('INTEGRITY');
      await guard(directories);
      return read;
    });
  }
  function readSeal(
    value: SyntheticProcessingBinding,
  ): Promise<SyntheticProcessingSealRequest | null> {
    let binding: SyntheticProcessingBinding;
    try {
      binding = processingBinding(value);
    } catch (error) {
      return Promise.reject(
        error instanceof SyntheticProcessingRequestError
          ? error
          : new SyntheticProcessingRequestError('INVALID_INPUT'),
      );
    }
    return admitted(async () => {
      const original = await storedRequest(binding);
      try {
        const result = parseSeal((await store.read(reference(binding, 'output'))).data, original);
        await guard(directories);
        return result;
      } catch (error) {
        if (error instanceof DurableStoreError && error.code === 'INCOMPLETE') {
          try {
            await lstat(path.join(rootDirectory, 'objects', binding.jobId, 'output'));
            fail('BLOCKED');
          } catch (missing) {
            if (nativeCode(missing) !== 'ENOENT') throw missing;
          }
          await guard(directories);
          return null;
        }
        throw error;
      }
    });
  }
  function close(): Promise<void> {
    closing = true;
    closed ??= tail;
    return closed;
  }
  return Object.freeze({
    requestStoreId,
    rootDirectory,
    reserve,
    consume,
    read,
    recordSeal,
    readSeal,
    close,
  });
}
