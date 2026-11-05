import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { isSharedArrayBuffer } from 'node:util/types';
import path from 'node:path';
import { inspectContainer, SYNTHETIC_CODEC_POLICY, type SourceFormat } from './containers.js';
import type {
  DurableSyntheticStore,
  DurableSyntheticReference,
  DurableSyntheticRead,
} from './durable-store.js';

/** Local immutable metadata only. It grants no SQL, upload, worker or attachment authority. */
export interface FloorPlanRequestBinding {
  readonly jobId: string;
  readonly requestId: string;
  readonly generationId: string;
  readonly inputObjectId: string;
  readonly companyId: string;
  readonly actorId: string;
  readonly listingId: string;
  readonly revision: number;
  readonly expectedVersion: number;
}
export interface FloorPlanRequest {
  readonly version: 1;
  readonly role: 'floor_plan';
  readonly pipeline: 'synthetic-floor-plan-codec-v1';
  readonly requestStoreId: string;
  readonly inputStoreId: string;
  readonly binding: FloorPlanRequestBinding;
  readonly source: Readonly<{ bytes: number; sha256: string; format: SourceFormat }>;
}
export interface FloorPlanRequests {
  record(input: {
    readonly binding: FloorPlanRequestBinding;
    readonly source: Buffer;
  }): Promise<FloorPlanRequest>;
  read(
    binding: FloorPlanRequestBinding,
  ): Promise<Readonly<{ request: FloorPlanRequest; source: Buffer }>>;
  /** Fence new operations and drain this facade; supplied stores remain caller-owned. */
  close(): Promise<void>;
}
export interface FloorPlanSourceTarget {
  readonly companyId: string;
  readonly actorId: string;
  readonly listingId: string;
  readonly revision: number;
  readonly requestId: string;
}

/** The trusted caller supplies a fresh, authenticated SQL preflight for every record attempt. */
export function createFloorPlanSourceAdmission(configuration: {
  readonly requests: FloorPlanRequests;
  readonly preflight: (target: FloorPlanSourceTarget) => Promise<unknown>;
}): {
  record(target: FloorPlanSourceTarget, source: Buffer): Promise<FloorPlanRequest>;
} {
  const { requests, preflight } = configuration;
  if (typeof preflight !== 'function' || typeof requests?.record !== 'function')
    fail('INVALID_CONFIGURATION');
  return Object.freeze({
    async record(target: FloorPlanSourceTarget, input: Buffer): Promise<FloorPlanRequest> {
      const facts = data(
        target,
        ['companyId', 'actorId', 'listingId', 'revision', 'requestId'],
        'INVALID_INPUT',
      );
      const selected = Object.freeze({
        companyId: uuid(facts.companyId, 'INVALID_INPUT'),
        actorId: uuid(facts.actorId, 'INVALID_INPUT'),
        listingId: uuid(facts.listingId, 'INVALID_INPUT'),
        revision: positive(facts.revision, 'INVALID_INPUT'),
        requestId: uuid(facts.requestId, 'INVALID_INPUT'),
      });
      if (
        selected.revision > 2147483647 ||
        !Buffer.isBuffer(input) ||
        isSharedArrayBuffer(input.buffer) ||
        input.length < 1 ||
        input.length > SYNTHETIC_CODEC_POLICY.maxInputBytes
      )
        fail('INVALID_INPUT');
      const source = Buffer.from(input);
      const bound = validateFloorPlanSourceRegistration(
        await preflight(selected),
        selected,
        source,
      );
      return requests.record({ binding: bound, source });
    },
  });
}

export function validateFloorPlanSourceRegistration(
  value: unknown,
  selected: FloorPlanSourceTarget,
  source: Buffer,
): FloorPlanRequestBinding {
  const registered = data(
    value,
    [
      'policy',
      'role',
      'pipeline',
      'countsAsPhoto',
      'binding',
      'source',
      'registeredAt',
      'expiresAt',
    ],
    'INTEGRITY',
  );
  if (
    registered.policy !== 'synthetic-floor-plan-registration-v1' ||
    registered.role !== 'floor_plan' ||
    registered.pipeline !== 'synthetic-floor-plan-codec-v1' ||
    registered.countsAsPhoto !== false
  )
    fail('INTEGRITY');
  const bound = binding(registered.binding, 'INTEGRITY');
  if (
    Object.entries(selected).some(
      ([key, value]) => bound[key as keyof FloorPlanRequestBinding] !== value,
    )
  )
    fail('INTEGRITY');
  const declared = data(registered.source, ['sha256', 'bytes', 'format'], 'INTEGRITY');
  if (
    declared.sha256 !== hash(source) ||
    declared.bytes !== source.length ||
    declared.format !== inspectContainer(source)
  )
    fail('INTEGRITY');
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
  if (
    typeof registered.registeredAt !== 'string' ||
    !timestamp.test(registered.registeredAt) ||
    typeof registered.expiresAt !== 'string' ||
    !timestamp.test(registered.expiresAt) ||
    Date.parse(registered.expiresAt) - Date.parse(registered.registeredAt) !== 86400000
  )
    fail('INTEGRITY');

  return bound;
}

type Code =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_INPUT'
  | 'INTEGRITY'
  | 'PERSISTENCE_FAILED'
  | 'BUSY'
  | 'CLOSED';
export class FloorPlanRequestError extends Error {
  override readonly name = 'FloorPlanRequestError';
  constructor(readonly code: Code) {
    super(`Local floor-plan request: ${code}.`);
  }
}
const BINDING = [
  'jobId',
  'requestId',
  'generationId',
  'inputObjectId',
  'companyId',
  'actorId',
  'listingId',
  'revision',
  'expectedVersion',
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
function fail(code: Code): never {
  throw new FloorPlanRequestError(code);
}
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const json = (v: unknown) => Buffer.from(JSON.stringify(v) + '\n', 'utf8');
function data(v: unknown, keys: readonly string[], code: Code): Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v))
  )
    fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(v);
  if (Reflect.ownKeys(v).length !== keys.length || keys.some((k) => !Object.hasOwn(descriptors, k)))
    fail(code);
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const d = descriptors[k]!;
    if (!d.enumerable || !Object.hasOwn(d, 'value')) fail(code);
    out[k] = d.value;
  }
  return out;
}
function uuid(v: unknown, code: Code): string {
  return typeof v === 'string' && UUID.test(v) ? v : fail(code);
}
function positive(v: unknown, code: Code): number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : fail(code);
}
function binding(v: unknown, code: Code): FloorPlanRequestBinding {
  const r = data(v, BINDING, code);
  return Object.freeze({
    jobId: uuid(r.jobId, code),
    requestId: uuid(r.requestId, code),
    generationId: uuid(r.generationId, code),
    inputObjectId: uuid(r.inputObjectId, code),
    companyId: uuid(r.companyId, code),
    actorId: uuid(r.actorId, code),
    listingId: uuid(r.listingId, code),
    revision: positive(r.revision, code),
    expectedVersion: positive(r.expectedVersion, code),
  });
}
function store(v: unknown): DurableSyntheticStore {
  const r = data(
    v,
    ['storeId', 'rootDirectory', 'install', 'read', 'close'],
    'INVALID_CONFIGURATION',
  );
  const storeId = uuid(r.storeId, 'INVALID_CONFIGURATION');
  if (
    typeof r.rootDirectory !== 'string' ||
    !path.isAbsolute(r.rootDirectory) ||
    r.rootDirectory.includes('\0') ||
    ['install', 'read', 'close'].some((k) => typeof r[k] !== 'function')
  )
    fail('INVALID_CONFIGURATION');
  return Object.freeze({
    storeId,
    rootDirectory: path.resolve(r.rootDirectory),
    install: (r.install as DurableSyntheticStore['install']).bind(v),
    read: (r.read as DurableSyntheticStore['read']).bind(v),
    close: (r.close as DurableSyntheticStore['close']).bind(v),
  }) as DurableSyntheticStore;
}
function reference(b: FloorPlanRequestBinding, request: boolean): DurableSyntheticReference {
  return Object.freeze({
    jobId: b.jobId,
    objectId: request ? b.requestId : b.inputObjectId,
    generationId: b.generationId,
    kind: 'quarantine',
  });
}
function checkedRead(
  r: DurableSyntheticRead,
  s: DurableSyntheticStore,
  ref: DurableSyntheticReference,
  limit: number,
): Buffer {
  const row = data(r, ['data', 'receipt'], 'INTEGRITY');
  if (
    !Buffer.isBuffer(row.data) ||
    isSharedArrayBuffer(row.data.buffer) ||
    row.data.length < 1 ||
    row.data.length > limit
  )
    fail('INTEGRITY');
  const bytes = Buffer.from(row.data);
  const receipt = data(
    row.receipt,
    ['version', 'storeId', 'jobId', 'objectId', 'generationId', 'kind', 'bytes', 'sha256'],
    'INTEGRITY',
  );
  if (
    receipt.version !== 1 ||
    receipt.storeId !== s.storeId ||
    receipt.bytes !== bytes.length ||
    receipt.sha256 !== hash(bytes) ||
    Object.entries(ref).some(([k, v]) => receipt[k] !== v)
  )
    fail('INTEGRITY');
  return bytes;
}

/** Uses independently supplied local stores; must never be treated as current authorization. */
export function createFloorPlanRequests(configuration: {
  readonly requestStore: DurableSyntheticStore;
  readonly inputStore: DurableSyntheticStore;
}): FloorPlanRequests {
  const config = data(configuration, ['requestStore', 'inputStore'], 'INVALID_CONFIGURATION');
  const requests = store(config.requestStore),
    inputs = store(config.inputStore);
  const canonicalRoot = (s: DurableSyntheticStore) =>
    process.platform === 'win32' ? s.rootDirectory.toLowerCase() : s.rootDirectory;
  if (requests.storeId === inputs.storeId || canonicalRoot(requests) === canonicalRoot(inputs))
    fail('INVALID_CONFIGURATION');
  let closed = false,
    busy = false,
    tail: Promise<unknown> = Promise.resolve();
  function admit<T>(work: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new FloorPlanRequestError('CLOSED'));
    if (busy) return Promise.reject(new FloorPlanRequestError('BUSY'));
    busy = true;
    const result = (async () => {
      try {
        return await work();
      } catch (e) {
        throw e instanceof FloorPlanRequestError
          ? e
          : new FloorPlanRequestError('PERSISTENCE_FAILED');
      } finally {
        busy = false;
      }
    })();
    tail = result.catch(() => {});
    return result;
  }
  async function saved(b: FloorPlanRequestBinding): Promise<FloorPlanRequest> {
    const bytes = checkedRead(
      await requests.read(reference(b, true)),
      requests,
      reference(b, true),
      4096,
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      fail('INTEGRITY');
    }
    const r = data(
      parsed,
      ['version', 'role', 'pipeline', 'requestStoreId', 'inputStoreId', 'binding', 'source'],
      'INTEGRITY',
    );
    const source = data(r.source, ['bytes', 'sha256', 'format'], 'INTEGRITY');
    if (
      r.version !== 1 ||
      r.role !== 'floor_plan' ||
      r.pipeline !== 'synthetic-floor-plan-codec-v1' ||
      r.requestStoreId !== requests.storeId ||
      r.inputStoreId !== inputs.storeId ||
      positive(source.bytes, 'INTEGRITY') > SYNTHETIC_CODEC_POLICY.maxInputBytes ||
      typeof source.sha256 !== 'string' ||
      !HASH.test(source.sha256) ||
      !['jpeg', 'png', 'webp'].includes(source.format as string)
    )
      fail('INTEGRITY');
    const captured = binding(r.binding, 'INTEGRITY');
    if (!json(captured).equals(json(b))) fail('INTEGRITY');
    const result: FloorPlanRequest = Object.freeze({
      version: 1,
      role: 'floor_plan',
      pipeline: 'synthetic-floor-plan-codec-v1',
      requestStoreId: requests.storeId,
      inputStoreId: inputs.storeId,
      binding: captured,
      source: Object.freeze({
        bytes: source.bytes as number,
        sha256: source.sha256,
        format: source.format as SourceFormat,
      }),
    });
    if (!bytes.equals(json(result))) fail('INTEGRITY');
    return result;
  }
  return Object.freeze({
    record(value: { readonly binding: FloorPlanRequestBinding; readonly source: Buffer }) {
      let b: FloorPlanRequestBinding, source: Buffer, request: FloorPlanRequest;
      try {
        const r = data(value, ['binding', 'source'], 'INVALID_INPUT');
        b = binding(r.binding, 'INVALID_INPUT');
        if (
          !Buffer.isBuffer(r.source) ||
          isSharedArrayBuffer(r.source.buffer) ||
          r.source.length < 1 ||
          r.source.length > SYNTHETIC_CODEC_POLICY.maxInputBytes
        )
          fail('INVALID_INPUT');
        source = Buffer.from(r.source);
        request = Object.freeze({
          version: 1,
          role: 'floor_plan',
          pipeline: 'synthetic-floor-plan-codec-v1',
          requestStoreId: requests.storeId,
          inputStoreId: inputs.storeId,
          binding: b,
          source: Object.freeze({
            bytes: source.length,
            sha256: hash(source),
            format: inspectContainer(source),
          }),
        });
      } catch (e) {
        return Promise.reject(
          e instanceof FloorPlanRequestError ? e : new FloorPlanRequestError('INVALID_INPUT'),
        );
      }
      return admit(async () => {
        // Intent is immutable before source installation. Lost acknowledgements never trigger a retry.
        await requests.install(reference(b, true), json(request));
        const original = await saved(b);
        if (!json(original).equals(json(request))) fail('INTEGRITY');
        await inputs.install(reference(b, false), source);
        const actual = checkedRead(
          await inputs.read(reference(b, false)),
          inputs,
          reference(b, false),
          SYNTHETIC_CODEC_POLICY.maxInputBytes,
        );
        if (!actual.equals(source)) fail('INTEGRITY');
        return original;
      });
    },
    read(value: FloorPlanRequestBinding) {
      let b: FloorPlanRequestBinding;
      try {
        b = binding(value, 'INVALID_INPUT');
      } catch (e) {
        return Promise.reject(e);
      }
      return admit(async () => {
        const request = await saved(b);
        const source = checkedRead(
          await inputs.read(reference(b, false)),
          inputs,
          reference(b, false),
          SYNTHETIC_CODEC_POLICY.maxInputBytes,
        );
        if (
          source.length !== request.source.bytes ||
          hash(source) !== request.source.sha256 ||
          inspectContainer(source) !== request.source.format
        )
          fail('INTEGRITY');
        return Object.freeze({ request, source });
      });
    },
    close() {
      closed = true;
      return tail.then(() => {});
    },
  });
}
