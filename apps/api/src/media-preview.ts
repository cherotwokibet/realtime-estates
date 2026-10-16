import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { isProxy } from 'node:util/types';
import {
  processingContext,
  processingLease,
  processingManifest,
  processingEqual,
  type SyntheticProcessingBinding,
  type SyntheticProcessingRequests,
} from '@realtor/media/processing-request';
import type { DurableSyntheticStore } from '@realtor/media/durable-store';
import type {
  MediaCaptureReceipt,
  MediaProcessingLease,
  MediaUploadContext,
  MediaVerifiedReceipt,
} from '@realtor/media/coordinator-database';
import {
  createTenantResolver,
  parseBearerHeader,
  type TenantConfiguration,
  type VerifiedIdentity,
} from './auth.js';
import type { TransactionDatabase } from './database.js';

const UUID =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const ID = new RegExp(`^${UUID}$`),
  ROUTE = new RegExp(
    `^/v2/staff/listings/(${UUID})/revisions/([1-9]\\d*)/media/(${UUID})/preview$`,
  );
const MAX_BYTES = 10485760,
  MAX_VERSION = 9007199254740991n;
const CONTEXT = ['jobId', 'quarantineId', 'outputId', 'expiresAt', 'pipeline'] as const;
const CAPTURE = ['jobId', 'generationId', 'inputBytes', 'inputSha256', 'capturedAt'] as const;
const LEASE = [
  'jobId',
  'claimId',
  'attempt',
  'leaseNonce',
  'leaseExpiresAt',
  'quarantineId',
  'outputId',
  'input',
  'pipeline',
] as const;
const MANIFEST = [
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
] as const;
const nativeTypedArray = Object.getPrototypeOf(Uint8Array.prototype) as object;
const nativeBuffer = Object.getOwnPropertyDescriptor(nativeTypedArray, 'buffer')!.get!;
const nativeOffset = Object.getOwnPropertyDescriptor(nativeTypedArray, 'byteOffset')!.get!;
const nativeLength = Object.getOwnPropertyDescriptor(nativeTypedArray, 'byteLength')!.get!;
const nativeArrayBufferLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
)!.get!;

interface Resource {
  readonly tenantId: string;
  readonly listingId: string;
  readonly revision: number;
  readonly mediaId: string;
  readonly version: string;
}
interface AuthorizedPreview extends Resource {
  readonly kind: 'private_media_preview';
  readonly state: 'draft';
  readonly operationId: string;
  readonly assignedAgentId: string | null;
  readonly actorRole: 'admin' | 'agent';
  readonly context: MediaUploadContext;
  readonly capture: MediaCaptureReceipt;
  readonly lease: MediaProcessingLease;
  readonly verified: MediaVerifiedReceipt;
}
export interface DevelopmentMediaPreviewOptions {
  readonly tenant: TenantConfiguration;
  readonly database: TransactionDatabase;
  readonly verifyBearer: (bearer: string) => Promise<VerifiedIdentity>;
  /** Fixed server-owned read facets only. Browser input never selects a store or its roots. */
  readonly processingRequests: Pick<
    SyntheticProcessingRequests,
    'requestStoreId' | 'read' | 'readSeal'
  >;
  readonly outputStore: Pick<DurableSyntheticStore, 'storeId' | 'read'>;
}
export interface DevelopmentMediaPreviewApi {
  handle(request: Request): Promise<Response>;
  /** Drain admitted reads; caller-owned stores/database remain open and unchanged. */
  close(): Promise<void>;
}
class PreviewError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
function invalid(): never {
  throw new PreviewError(503, 'SERVICE_UNAVAILABLE');
}
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    isProxy(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length) invalid();
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !fields.includes(key)) invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    result[key] = descriptor.value;
  }
  return result;
}
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || isProxy(value)) invalid();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
  return descriptor.value;
}
function method<T extends (...args: never[]) => unknown>(
  value: unknown,
  key: string,
  inherited = false,
): T {
  if (!value || typeof value !== 'object' || isProxy(value)) invalid();
  let target: object | null = value,
    descriptor: PropertyDescriptor | undefined;
  for (let depth = 0; target && depth < 8; depth++) {
    if (isProxy(target)) invalid();
    descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor || !inherited) break;
    target = Object.getPrototypeOf(target) as object | null;
  }
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function')
    invalid();
  return descriptor.value.bind(value) as T;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value) || value !== value.toLowerCase()) invalid();
  return value;
}
function positive(value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum)
    invalid();
  return value;
}
function version(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,15}$/.test(value) || BigInt(value) > MAX_VERSION)
    invalid();
  return value;
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid();
  return value;
}
function time(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value.slice(0, 23) + 'Z'
  )
    invalid();
  return value;
}
function input(value: unknown): Readonly<{ generationId: string; bytes: number; sha256: string }> {
  const row = record(value, ['generationId', 'bytes', 'sha256']);
  return Object.freeze({
    generationId: uuid(row.generationId),
    bytes: positive(row.bytes, MAX_BYTES),
    sha256: hash(row.sha256),
  });
}
function context(value: unknown): MediaUploadContext {
  return processingContext(record(value, CONTEXT), 'INTEGRITY');
}
function lease(value: unknown): MediaProcessingLease {
  const row = record(value, LEASE);
  return processingLease({ ...row, input: input(row.input) }, 'INTEGRITY');
}
function manifest(value: unknown): MediaVerifiedReceipt['manifest'] {
  const row = record(value, MANIFEST),
    encoder = record(row.encoder, ['sharp', 'vips']),
    operations = row.operations;
  if (
    !Array.isArray(operations) ||
    isProxy(operations) ||
    Object.getPrototypeOf(operations) !== Array.prototype
  )
    invalid();
  return processingManifest({ ...row, encoder, operations }, 'INTEGRITY');
}
function authorized(value: unknown, resource: Resource, actorId: string): AuthorizedPreview {
  const row = record(value, [
    'kind',
    'tenantId',
    'listingId',
    'revision',
    'version',
    'state',
    'mediaId',
    'operationId',
    'assignedAgentId',
    'actorRole',
    'context',
    'capture',
    'lease',
    'verified',
  ]);
  if (
    row.kind !== 'private_media_preview' ||
    row.state !== 'draft' ||
    uuid(row.tenantId) !== resource.tenantId ||
    uuid(row.listingId) !== resource.listingId ||
    positive(row.revision, 2147483647) !== resource.revision ||
    version(row.version) !== resource.version ||
    uuid(row.mediaId) !== resource.mediaId ||
    !['admin', 'agent'].includes(row.actorRole as string)
  )
    invalid();
  const operationId = uuid(row.operationId),
    assignedAgentId = row.assignedAgentId === null ? null : uuid(row.assignedAgentId),
    scope = context(row.context),
    rawCapture = record(row.capture, CAPTURE),
    processing = lease(row.lease);
  if (row.actorRole === 'agent' && assignedAgentId !== actorId) invalid();
  const capture = Object.freeze({
    jobId: uuid(rawCapture.jobId),
    generationId: uuid(rawCapture.generationId),
    inputBytes: positive(rawCapture.inputBytes, MAX_BYTES),
    inputSha256: hash(rawCapture.inputSha256),
    capturedAt: time(rawCapture.capturedAt),
  });
  const raw = record(row.verified, [
    'jobId',
    'attempt',
    'leaseNonce',
    'outputId',
    'manifestSha256',
    'manifest',
    'verifiedAt',
    'outcome',
  ]);
  if (raw.outcome !== 'verified') invalid();
  // This digest belongs to PostgreSQL's manifest serialization. Preserve it as
  // a SQL fact; hashing JSON.stringify(manifest) would produce another identity.
  const verified = Object.freeze({
    jobId: uuid(raw.jobId),
    attempt: positive(raw.attempt, 3),
    leaseNonce: uuid(raw.leaseNonce),
    outputId: uuid(raw.outputId),
    manifestSha256: hash(raw.manifestSha256),
    manifest: manifest(raw.manifest),
    verifiedAt: time(raw.verifiedAt),
    outcome: 'verified' as const,
  });
  if (
    scope.jobId !== capture.jobId ||
    scope.jobId !== processing.jobId ||
    scope.jobId !== verified.jobId ||
    scope.quarantineId !== processing.quarantineId ||
    scope.outputId !== processing.outputId ||
    scope.outputId !== verified.outputId ||
    capture.generationId !== processing.input.generationId ||
    capture.inputBytes !== processing.input.bytes ||
    capture.inputSha256 !== processing.input.sha256 ||
    verified.attempt !== processing.attempt ||
    verified.leaseNonce !== processing.leaseNonce ||
    verified.manifest.inputBytes !== capture.inputBytes ||
    verified.manifest.inputSha256 !== capture.inputSha256 ||
    operationId === scope.jobId ||
    resource.mediaId === operationId ||
    resource.mediaId === scope.jobId
  )
    invalid();
  return Object.freeze({
    ...resource,
    kind: 'private_media_preview',
    state: 'draft',
    operationId,
    assignedAgentId,
    actorRole: row.actorRole as 'admin' | 'agent',
    context: scope,
    capture,
    lease: processing,
    verified,
  });
}
function snapshotBytes(value: unknown): Buffer {
  if (!Buffer.isBuffer(value) || isProxy(value) || !ArrayBuffer.isView(value)) invalid();
  const backing = Reflect.apply(nativeBuffer, value, []) as ArrayBuffer,
    offset = Reflect.apply(nativeOffset, value, []) as number,
    length = Reflect.apply(nativeLength, value, []) as number;
  Reflect.apply(nativeArrayBufferLength, backing, []);
  positive(length, MAX_BYTES);
  return Buffer.from(new Uint8Array(backing, offset, length));
}
function commonHeaders(requestId: string): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store, no-cache, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Content-Type-Options': 'nosniff',
    'X-Request-Id': requestId,
  };
}
function errorResponse(status: number, code: string, requestId: string): Response {
  return Response.json(
    { error: { code, message: 'Private image preview is unavailable.' }, requestId },
    { status, headers: commonHeaders(requestId) },
  );
}
function cancelled(request: Request): void {
  if (request.signal.aborted) throw new PreviewError(400, 'REQUEST_ABORTED');
}

/** Local synthetic read boundary only. It never processes, attaches, publishes or changes a draft. */
export function createDevelopmentMediaPreviewApi(
  options: DevelopmentMediaPreviewOptions,
): DevelopmentMediaPreviewApi {
  if (process.env.NODE_ENV === 'production')
    throw new Error('The synthetic image preview is development-only.');
  let tenantId: string,
    resolveTenant: ReturnType<typeof createTenantResolver>,
    database: TransactionDatabase,
    verify: DevelopmentMediaPreviewOptions['verifyBearer'],
    requestStoreId: string,
    storeId: string,
    readRequest: SyntheticProcessingRequests['read'],
    readSeal: SyntheticProcessingRequests['readSeal'],
    readOutput: DurableSyntheticStore['read'];
  try {
    const row = record(options, [
      'tenant',
      'database',
      'verifyBearer',
      'processingRequests',
      'outputStore',
    ]);
    tenantId = uuid(own(row.tenant, 'tenantId'));
    resolveTenant = createTenantResolver([row.tenant as TenantConfiguration]);
    database = Object.freeze({
      transaction: method<TransactionDatabase['transaction']>(row.database, 'transaction', true),
    });
    if (typeof row.verifyBearer !== 'function') invalid();
    verify = row.verifyBearer as DevelopmentMediaPreviewOptions['verifyBearer'];
    requestStoreId = uuid(own(row.processingRequests, 'requestStoreId'));
    storeId = uuid(own(row.outputStore, 'storeId'));
    if (requestStoreId === storeId) invalid();
    readRequest = method<SyntheticProcessingRequests['read']>(row.processingRequests, 'read');
    readSeal = method<SyntheticProcessingRequests['readSeal']>(row.processingRequests, 'readSeal');
    readOutput = method<DurableSyntheticStore['read']>(row.outputStore, 'read');
  } catch {
    throw new Error('Invalid trusted private image preview configuration.');
  }
  let closing = false,
    closed: Promise<void> | undefined;
  const active = new Set<Promise<Response>>();
  async function read(
    resource: Resource,
    actorId: string,
    requestId: string,
  ): Promise<AuthorizedPreview> {
    let value: unknown;
    try {
      value = await database.transaction(
        { tenantId, actorId, correlationId: requestId },
        async (query) => {
          const result = await query.query(
            'SELECT app_api.read_private_media_preview($1::uuid,$2::integer,$3::uuid,$4::bigint) AS receipt',
            [resource.listingId, resource.revision, resource.mediaId, resource.version],
          );
          if (result.rows.length !== 1) invalid();
          return result.rows[0]?.receipt;
        },
      );
    } catch (error) {
      if (error instanceof PreviewError) throw error;
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (['42501', 'P0002'].includes(code)) throw new PreviewError(404, 'NOT_FOUND');
      if (code === '40001') throw new PreviewError(409, 'VERSION_CONFLICT');
      invalid();
    }
    return authorized(value, resource, actorId);
  }
  async function output(facts: AuthorizedPreview, request: Request): Promise<Buffer> {
    const binding: SyntheticProcessingBinding = Object.freeze({
      jobId: facts.context.jobId,
      claimId: facts.lease.claimId,
      generationId: facts.capture.generationId,
    });
    const original = record(await readRequest(binding), [
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
    ]);
    cancelled(request);
    if (
      original.version !== 1 ||
      original.requestStoreId !== requestStoreId ||
      original.inputStoreId !== storeId ||
      original.jobId !== binding.jobId ||
      original.claimId !== binding.claimId ||
      original.generationId !== binding.generationId ||
      !processingEqual(context(original.context), facts.context) ||
      !processingEqual(input(original.input), facts.lease.input)
    )
      invalid();
    uuid(original.workerId);
    uuid(original.journalId);
    uuid(original.reservationId);
    const sealed = record(await readSeal(binding), [
      'version',
      'requestStoreId',
      'jobId',
      'claimId',
      'generationId',
      'lease',
      'outputStoreId',
      'output',
      'seal',
    ]);
    cancelled(request);
    const stored = record(sealed.output, ['objectId', 'generationId', 'bytes', 'sha256']),
      seal = record(sealed.seal, ['attempt', 'leaseNonce', 'manifest']);
    if (
      sealed.version !== 1 ||
      sealed.requestStoreId !== requestStoreId ||
      sealed.jobId !== binding.jobId ||
      sealed.claimId !== binding.claimId ||
      sealed.generationId !== binding.generationId ||
      sealed.outputStoreId !== storeId ||
      !processingEqual(lease(sealed.lease), facts.lease) ||
      seal.attempt !== facts.verified.attempt ||
      seal.leaseNonce !== facts.verified.leaseNonce ||
      !processingEqual(manifest(seal.manifest), facts.verified.manifest) ||
      stored.objectId !== facts.context.outputId ||
      stored.generationId !== facts.lease.leaseNonce ||
      stored.bytes !== facts.verified.manifest.bytes ||
      stored.sha256 !== facts.verified.manifest.sha256
    )
      invalid();
    const reference = Object.freeze({
        jobId: binding.jobId,
        objectId: facts.context.outputId,
        generationId: facts.lease.leaseNonce,
        kind: 'output' as const,
      }),
      result = record(await readOutput(reference), ['receipt', 'data']);
    cancelled(request);
    const receipt = record(result.receipt, [
      'version',
      'storeId',
      'jobId',
      'objectId',
      'generationId',
      'kind',
      'bytes',
      'sha256',
    ]);
    if (
      receipt.version !== 1 ||
      receipt.storeId !== storeId ||
      receipt.jobId !== reference.jobId ||
      receipt.objectId !== reference.objectId ||
      receipt.generationId !== reference.generationId ||
      receipt.kind !== 'output' ||
      receipt.bytes !== stored.bytes ||
      receipt.sha256 !== stored.sha256
    )
      invalid();
    const bytes = snapshotBytes(result.data);
    if (
      bytes.length !== receipt.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== receipt.sha256 ||
      bytes.length < 20 ||
      bytes.toString('latin1', 0, 4) !== 'RIFF' ||
      bytes.toString('latin1', 8, 12) !== 'WEBP' ||
      bytes.readUInt32LE(4) !== bytes.length - 8
    )
      invalid();
    return bytes;
  }
  async function dispatch(request: Request): Promise<Response> {
    const requestId = randomUUID();
    try {
      const url = new URL(request.url),
        match = ROUTE.exec(url.pathname);
      if (!match || url.search || url.hash) throw new PreviewError(404, 'NOT_FOUND');
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
        throw new PreviewError(404, 'NOT_FOUND');
      try {
        if (resolveTenant(url.host).tenantId.toLowerCase() !== tenantId) throw new Error();
      } catch {
        throw new PreviewError(404, 'NOT_FOUND');
      }
      const host = request.headers.get('host');
      if (host !== null && host !== url.host) throw new PreviewError(404, 'NOT_FOUND');
      if (request.method !== 'GET') throw new PreviewError(405, 'METHOD_NOT_ALLOWED');
      const revision = Number(match[2]);
      if (!Number.isSafeInteger(revision) || revision > 2147483647)
        throw new PreviewError(400, 'INVALID_INPUT');
      const expected = request.headers.get('x-revision-version');
      if (expected === null || !/^[1-9]\d{0,15}$/.test(expected) || BigInt(expected) > MAX_VERSION)
        throw new PreviewError(400, 'INVALID_INPUT');
      let unsupported = false;
      request.headers.forEach((_, key) => {
        if (
          [
            'cookie',
            'expect',
            'content-length',
            'transfer-encoding',
            'content-type',
            'content-encoding',
            'range',
          ].includes(key) ||
          key.startsWith('if-')
        )
          unsupported = true;
      });
      if (request.body !== null || unsupported) throw new PreviewError(400, 'INVALID_INPUT');
      if (request.headers.has('origin') && request.headers.get('origin') !== url.origin)
        throw new PreviewError(403, 'FORBIDDEN');
      cancelled(request);
      let actorId: string;
      try {
        const identity = record(
          await verify(parseBearerHeader(request.headers.get('authorization') ?? undefined)),
          ['actorId'],
        );
        actorId = uuid(
          typeof identity.actorId === 'string' ? identity.actorId.toLowerCase() : identity.actorId,
        );
      } catch {
        throw new PreviewError(401, 'UNAUTHENTICATED');
      }
      cancelled(request);
      const resource = Object.freeze({
        tenantId,
        listingId: match[1]!.toLowerCase(),
        revision,
        mediaId: match[3]!.toLowerCase(),
        version: expected,
      });
      const before = await read(resource, actorId, requestId);
      cancelled(request);
      const bytes = await output(before, request),
        after = await read(resource, actorId, requestId);
      cancelled(request);
      if (!processingEqual(before, after)) invalid();
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          ...commonHeaders(requestId),
          'Content-Type': 'image/webp',
          'Content-Length': String(bytes.length),
        },
      });
    } catch (error) {
      const known =
        error instanceof PreviewError ? error : new PreviewError(503, 'SERVICE_UNAVAILABLE');
      return errorResponse(known.status, known.code, requestId);
    }
  }
  function handle(request: Request): Promise<Response> {
    if (closing) return Promise.resolve(errorResponse(503, 'SERVICE_UNAVAILABLE', randomUUID()));
    const work = dispatch(request);
    active.add(work);
    void work.finally(() => active.delete(work)).catch(() => undefined);
    return work;
  }
  function close(): Promise<void> {
    closing = true;
    closed ??= Promise.allSettled([...active]).then(() => undefined);
    return closed;
  }
  return Object.freeze({ handle, close });
}
