import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isSharedArrayBuffer } from 'node:util/types';
import {
  DurableStoreError,
  type DurableSyntheticStore,
  type DurableSyntheticReference,
} from './durable-store.js';
import {
  snapshotFloorPlanWorkerTarget,
  validateFloorPlanWorkerLease,
  type FloorPlanWorkerTarget,
  type FloorPlanWorkerLease,
} from './floor-plan-admission.js';
import type { createFloorPlanProcessor } from './floor-plan-processing.js';
import type { FloorPlanRequests, FloorPlanRequestBinding } from './floor-plan-request.js';
import type { SyntheticFloorPlanManifest } from './index.js';
import { verifySyntheticFloorPlanReadback } from './process-readback.js';
export interface FloorPlanGalleryTarget {
  readonly companyId: string;
  readonly actorId: string;
  readonly listingId: string;
  readonly revision: number;
}
export interface PublishedFloorPlanTarget {
  readonly companyId: string;
  readonly listingId: string;
  readonly revision: number;
  readonly approvedVersion: string;
}
export class FloorPlanOutputError extends Error {
  override readonly name = 'FloorPlanOutputError';
  constructor(
    readonly code: 'INVALID_CONFIGURATION' | 'INTEGRITY' | 'BUSY' | 'CLOSED' | 'BLOCKED',
  ) {
    super(`Floor-plan output: ${code}.`);
  }
}
/** Only the trusted SQL transport may classify an acknowledgement as uncertain. */
export class FloorPlanSealUncertainError extends Error {
  override readonly name = 'FloorPlanSealUncertainError';
  constructor() {
    super('Floor-plan seal acknowledgement is uncertain.');
  }
}
function fail(code: FloorPlanOutputError['code']): never {
  throw new FloorPlanOutputError(code);
}
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function object(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v)) ||
    Reflect.ownKeys(v).length !== keys.length
  )
    fail('INTEGRITY');
  const r: Record<string, unknown> = {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) fail('INTEGRITY');
    r[k] = d.value;
  }
  return r;
}
function snapshot(v: unknown, depth = 0): unknown {
  if (depth > 8) fail('INTEGRITY');
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) fail('INTEGRITY');
    return v;
  }
  if (Array.isArray(v)) {
    if (v.length > 32) fail('INTEGRITY');
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (Reflect.ownKeys(v).length !== v.length + 1) fail('INTEGRITY');
    return Object.freeze(
      Array.from({ length: v.length }, (_, i) => {
        const d = descriptors[String(i)];
        if (!d?.enumerable || !Object.hasOwn(d, 'value')) fail('INTEGRITY');
        return snapshot(d.value, depth + 1);
      }),
    );
  }
  if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
    fail('INTEGRITY');
  const keys = Reflect.ownKeys(v);
  if (keys.length > 32 || keys.some((k) => typeof k !== 'string')) fail('INTEGRITY');
  const r: Record<string, unknown> = {};
  for (const k of (keys as string[]).sort()) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) fail('INTEGRITY');
    Object.defineProperty(r, k, { value: snapshot(d.value, depth + 1), enumerable: true });
  }
  return Object.freeze(r);
}
const json = (v: unknown) => Buffer.from(JSON.stringify(snapshot(v)) + '\n');
const equal = (a: unknown, b: unknown) => json(a).equals(json(b));
function store(value: DurableSyntheticStore): DurableSyntheticStore {
  const r = object(value, ['storeId', 'rootDirectory', 'install', 'read', 'close']);
  if (
    typeof r.storeId !== 'string' ||
    !id.test(r.storeId) ||
    typeof r.rootDirectory !== 'string' ||
    !path.isAbsolute(r.rootDirectory) ||
    r.rootDirectory.includes('\0') ||
    ['install', 'read', 'close'].some((k) => typeof r[k] !== 'function')
  )
    fail('INVALID_CONFIGURATION');
  return Object.freeze({
    storeId: r.storeId,
    rootDirectory: path.resolve(r.rootDirectory),
    install: value.install.bind(value),
    read: value.read.bind(value),
    close: value.close.bind(value),
  });
}
function checkedRead(
  v: unknown,
  s: DurableSyntheticStore,
  ref: DurableSyntheticReference,
  max: number,
): Buffer {
  const r = object(v, ['data', 'receipt']);
  if (
    !Buffer.isBuffer(r.data) ||
    isSharedArrayBuffer(r.data.buffer) ||
    r.data.length < 1 ||
    r.data.length > max
  )
    fail('INTEGRITY');
  const bytes = Buffer.from(r.data);
  const receipt = object(r.receipt, [
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
    receipt.storeId !== s.storeId ||
    receipt.bytes !== bytes.length ||
    receipt.sha256 !== hash(bytes) ||
    Object.entries(ref).some(([k, v]) => receipt[k] !== v)
  )
    fail('INTEGRITY');
  return bytes;
}
function parsed(bytes: Buffer): unknown {
  let v: unknown;
  try {
    v = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail('INTEGRITY');
  }
  if (!json(v).equals(bytes)) fail('INTEGRITY');
  return snapshot(v);
}
const bindingKeys = [
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
const binding = (t: FloorPlanWorkerTarget) =>
  Object.fromEntries(bindingKeys.map((k) => [k, t[k]])) as unknown as FloorPlanRequestBinding;
const metadataRef = (t: FloorPlanWorkerTarget, receipt = false): DurableSyntheticReference =>
  Object.freeze({
    jobId: t.jobId,
    objectId: t.requestId,
    generationId: t.leaseNonce,
    kind: receipt ? 'output' : 'quarantine',
  });
const outputRef = (lease: FloorPlanWorkerLease): DurableSyntheticReference =>
  Object.freeze({
    jobId: lease.target.jobId,
    objectId: lease.outputObjectId,
    generationId: lease.target.leaseNonce,
    kind: 'output',
  });
interface Intent {
  readonly version: 1;
  readonly role: 'floor_plan';
  readonly pipeline: 'synthetic-floor-plan-codec-v1';
  readonly metadataStoreId: string;
  readonly outputStoreId: string;
  readonly target: FloorPlanWorkerTarget;
  readonly lease: FloorPlanWorkerLease;
  readonly manifest: SyntheticFloorPlanManifest;
}
/** Trusted server composition. Supplied processor/stores remain caller-owned. Reconciliation is read-only. */
export function createFloorPlanOutputDelivery(config: {
  readonly processor: Pick<Awaited<ReturnType<typeof createFloorPlanProcessor>>, 'run'>;
  readonly requests: FloorPlanRequests;
  readonly outputStore: DurableSyntheticStore;
  readonly metadataStore: DurableSyntheticStore;
  readonly preflight: (target: FloorPlanWorkerTarget) => Promise<unknown>;
  readonly seal: (
    target: FloorPlanWorkerTarget,
    outputObjectId: string,
    manifest: SyntheticFloorPlanManifest,
  ) => Promise<unknown>;
  readonly readSeal: (target: FloorPlanWorkerTarget) => Promise<unknown>;
  readonly readGallery?: (target: FloorPlanGalleryTarget) => Promise<unknown>;
  readonly readPublishedGallery?: (target: PublishedFloorPlanTarget) => Promise<unknown>;
}) {
  const output = store(config.outputStore),
    metadata = store(config.metadataStore),
    run = config.processor.run.bind(config.processor),
    readSource = config.requests.read.bind(config.requests),
    preflight = config.preflight,
    seal = config.seal,
    readSeal = config.readSeal;
  const relative = path.relative(output.rootDirectory, metadata.rootDirectory);
  if (
    output.storeId === metadata.storeId ||
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) ||
    metadata.rootDirectory.startsWith(output.rootDirectory + path.sep) ||
    output.rootDirectory.startsWith(metadata.rootDirectory + path.sep)
  )
    fail('INVALID_CONFIGURATION');
  const readGallery = config.readGallery;
  const readPublishedGallery = config.readPublishedGallery;
  let busy = false,
    closed = false,
    tail: Promise<unknown> = Promise.resolve();
  function admit<T>(work: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new FloorPlanOutputError('CLOSED'));
    if (busy) return Promise.reject(new FloorPlanOutputError('BUSY'));
    busy = true;
    const p = work().finally(() => {
      busy = false;
    });
    tail = p.catch(() => {});
    return p;
  }
  async function source(target: FloorPlanWorkerTarget) {
    const saved = await readSource(binding(target));
    if (
      [output.storeId, metadata.storeId].includes(saved.request.inputStoreId) ||
      [output.storeId, metadata.storeId].includes(saved.request.requestStoreId)
    )
      fail('INVALID_CONFIGURATION');
    return saved.source;
  }
  function intent(value: unknown, target: FloorPlanWorkerTarget): Intent {
    const r = object(value, [
      'version',
      'role',
      'pipeline',
      'metadataStoreId',
      'outputStoreId',
      'target',
      'lease',
      'manifest',
    ]);
    if (
      r.version !== 1 ||
      r.role !== 'floor_plan' ||
      r.pipeline !== 'synthetic-floor-plan-codec-v1' ||
      r.metadataStoreId !== metadata.storeId ||
      r.outputStoreId !== output.storeId ||
      !equal(snapshotFloorPlanWorkerTarget(r.target as FloorPlanWorkerTarget), target)
    )
      fail('INTEGRITY');
    const l = object(r.lease, ['target', 'outputObjectId', 'claimedAt', 'expiresAt']);
    if (
      !equal(l.target, target) ||
      typeof l.outputObjectId !== 'string' ||
      !id.test(l.outputObjectId)
    )
      fail('INTEGRITY');
    return snapshot(r) as Intent;
  }
  function receipt(value: unknown, saved: Intent, bytes: Buffer) {
    const r = object(value, ['policy', 'lease', 'manifest', 'manifestSha256', 'verifiedAt']);
    if (
      r.policy !== 'synthetic-floor-plan-output-v1' ||
      !equal(r.manifest, saved.manifest) ||
      typeof r.manifestSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(r.manifestSha256) ||
      typeof r.verifiedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(r.verifiedAt) ||
      !Number.isFinite(Date.parse(r.verifiedAt))
    )
      fail('INTEGRITY');
    const lease = validateFloorPlanWorkerLease(r.lease, saved.target, bytes, false);
    if (
      !equal(lease, saved.lease) ||
      Date.parse(r.verifiedAt) < Date.parse(lease.claimedAt) ||
      Date.parse(r.verifiedAt) >= Date.parse(lease.expiresAt)
    )
      fail('INTEGRITY');
    return snapshot(r) as Readonly<Record<string, unknown>>;
  }
  async function retained(target: FloorPlanWorkerTarget) {
    const saved = intent(
        parsed(
          checkedRead(
            await metadata.read(metadataRef(target)),
            metadata,
            metadataRef(target),
            8192,
          ),
        ),
        target,
      ),
      bytes = await source(target),
      ref = outputRef(saved.lease),
      data = checkedRead(await output.read(ref), output, ref, 10485760);
    const verified = verifySyntheticFloorPlanReadback(
      bytes,
      data,
      Buffer.from(JSON.stringify(saved.manifest) + '\n'),
    );
    return { saved, bytes, ref, data: verified.data };
  }
  // One retained-output verifier for both audiences; each caller supplies its own authority reader.
  function readAttachmentBytes(
    value: Omit<FloorPlanGalleryTarget, 'actorId'> & { readonly actorId: string | null },
    reader: (() => Promise<unknown>) | undefined,
    expectedVersion?: string,
  ) {
    const t = object(value, ['companyId', 'actorId', 'listingId', 'revision']);
    for (const key of ['companyId', 'listingId'])
      if (typeof t[key] !== 'string' || !id.test(t[key] as string)) fail('INTEGRITY');
    if (
      typeof t.revision !== 'number' ||
      !Number.isSafeInteger(t.revision) ||
      t.revision < 1 ||
      t.revision > 2147483647
    )
      fail('INTEGRITY');
    if (
      expectedVersion === undefined
        ? typeof t.actorId !== 'string' || !id.test(t.actorId)
        : t.actorId !== null
    )
      fail('INTEGRITY');
    const target = Object.freeze(t) as unknown as Omit<FloorPlanGalleryTarget, 'actorId'> & {
      readonly actorId: string | null;
    };
    return admit(async () => {
      if (typeof reader !== 'function') fail('INVALID_CONFIGURATION');
      function gallery(value: unknown) {
        const row = object(value, [
          'policy',
          'companyId',
          'actorId',
          'listingId',
          'revision',
          'version',
          'state',
          'floorPlan',
        ]);
        if (
          row.policy !== 'synthetic-floor-plan-gallery-v1' ||
          Object.entries(target).some(([k, v]) => row[k] !== v) ||
          typeof row.version !== 'string' ||
          !/^[1-9][0-9]{0,15}$/.test(row.version) ||
          BigInt(row.version) > 9007199254740991n ||
          !['draft', 'pending', 'approved', 'rejected'].includes(row.state as string) ||
          (expectedVersion !== undefined &&
            (row.version !== expectedVersion || row.state !== 'approved'))
        )
          fail('INTEGRITY');
        return snapshot(row) as Readonly<Record<string, unknown>>;
      }
      const original = gallery(await reader());
      if (original.floorPlan === null) return Object.freeze({ state: 'missing' as const });
      const attached = object(original.floorPlan, [
        'policy',
        'command',
        'actorId',
        'resultVersion',
        'output',
      ]);
      const command = object(attached.command, [
        'policy',
        'operationId',
        'listingId',
        'revision',
        'expectedVersion',
        'requestId',
      ]);
      if (
        attached.policy !== 'synthetic-floor-plan-attachment-record-v1' ||
        typeof attached.actorId !== 'string' ||
        !id.test(attached.actorId) ||
        typeof attached.resultVersion !== 'string' ||
        !/^[1-9][0-9]{0,15}$/.test(attached.resultVersion) ||
        BigInt(attached.resultVersion) > BigInt(original.version as string) ||
        command.policy !== 'synthetic-floor-plan-attachment-command-v1' ||
        command.listingId !== target.listingId ||
        command.revision !== target.revision ||
        typeof command.operationId !== 'string' ||
        !id.test(command.operationId) ||
        typeof command.expectedVersion !== 'string' ||
        !/^[1-9][0-9]{0,15}$/.test(command.expectedVersion) ||
        BigInt(command.expectedVersion) + 1n !== BigInt(attached.resultVersion)
      )
        fail('INTEGRITY');
      const sealed = object(attached.output, [
        'policy',
        'lease',
        'manifest',
        'manifestSha256',
        'verifiedAt',
      ]);
      const lease = object(sealed.lease, [
        'policy',
        'registration',
        'claimId',
        'leaseNonce',
        'outputObjectId',
        'claimedAt',
        'expiresAt',
      ]);
      const registration = object(lease.registration, [
        'policy',
        'role',
        'pipeline',
        'countsAsPhoto',
        'binding',
        'source',
        'registeredAt',
        'expiresAt',
      ]);
      const source = object(registration.binding, bindingKeys);
      const selected = snapshotFloorPlanWorkerTarget({
        ...source,
        claimId: lease.claimId,
        leaseNonce: lease.leaseNonce,
      } as unknown as FloorPlanWorkerTarget);
      if (
        selected.companyId !== target.companyId ||
        selected.listingId !== target.listingId ||
        selected.revision !== target.revision ||
        selected.requestId !== command.requestId ||
        BigInt(selected.expectedVersion) > BigInt(command.expectedVersion)
      )
        fail('INTEGRITY');
      const actual = await retained(selected);
      receipt(sealed, actual.saved, actual.bytes);
      if (!equal(gallery(await reader()), original)) fail('BLOCKED');
      return Object.freeze({
        state: 'ready' as const,
        target,
        version: original.version as string,
        operationId: command.operationId,
        manifest: actual.saved.manifest,
        data: Buffer.from(actual.data),
      });
    });
  }
  return Object.freeze({
    run(value: FloorPlanWorkerTarget) {
      const target = snapshotFloorPlanWorkerTarget(value);
      return admit(async () => {
        const native = await run(target);
        if (native.state !== 'readback_verified') return native;
        const bytes = await source(target),
          lease = validateFloorPlanWorkerLease(await preflight(target), target, bytes);
        if (!equal(lease, native.lease)) fail('INTEGRITY');
        const result = verifySyntheticFloorPlanReadback(
          bytes,
          native.result.data,
          Buffer.from(JSON.stringify(native.result.manifest) + '\n'),
        );
        const saved = intent(
          {
            version: 1,
            role: 'floor_plan',
            pipeline: 'synthetic-floor-plan-codec-v1',
            metadataStoreId: metadata.storeId,
            outputStoreId: output.storeId,
            target,
            lease,
            manifest: result.manifest,
          },
          target,
        );
        await metadata.install(metadataRef(target), json(saved));
        await output.install(outputRef(lease), result.data);
        const actual = await retained(target);
        if (!equal(actual.saved, saved)) fail('INTEGRITY');
        let response: unknown;
        try {
          response = await seal(target, lease.outputObjectId, result.manifest);
        } catch (error) {
          if (!(error instanceof FloorPlanSealUncertainError)) throw error;
          response = await readSeal(target);
        }
        const accepted = receipt(response, saved, bytes);
        await metadata.install(metadataRef(target, true), json(accepted));
        const persisted = parsed(
          checkedRead(
            await metadata.read(metadataRef(target, true)),
            metadata,
            metadataRef(target, true),
            8192,
          ),
        );
        if (!equal(persisted, accepted)) fail('INTEGRITY');
        return Object.freeze({
          state: 'sealed' as const,
          target,
          outputRef: actual.ref,
          manifest: result.manifest,
          receipt: accepted,
          receiptPersisted: true,
        });
      });
    },
    reconcile(value: FloorPlanWorkerTarget) {
      const target = snapshotFloorPlanWorkerTarget(value);
      return admit(async () => {
        let response: unknown;
        try {
          response = await readSeal(target);
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'P0002')
            return Object.freeze({ state: 'blocked' as const, reason: 'UNCONFIRMED' as const });
          throw error;
        }
        let actual: Awaited<ReturnType<typeof retained>>;
        try {
          actual = await retained(target);
        } catch (error) {
          if (error instanceof DurableStoreError && error.code === 'INCOMPLETE')
            return Object.freeze({ state: 'blocked' as const, reason: 'UNCONFIRMED' as const });
          throw error;
        }
        const accepted = receipt(response, actual.saved, actual.bytes);
        let receiptPersisted = false;
        try {
          const local = parsed(
            checkedRead(
              await metadata.read(metadataRef(target, true)),
              metadata,
              metadataRef(target, true),
              8192,
            ),
          );
          if (!equal(local, accepted)) fail('INTEGRITY');
          receiptPersisted = true;
        } catch (error) {
          if (!(error instanceof DurableStoreError && error.code === 'INCOMPLETE')) throw error;
        }
        const current = receipt(await readSeal(target), actual.saved, actual.bytes);
        if (!equal(current, accepted)) fail('INTEGRITY');
        return Object.freeze({
          state: 'sealed' as const,
          target,
          outputRef: actual.ref,
          manifest: actual.saved.manifest,
          receipt: accepted,
          receiptPersisted,
        });
      });
    },
    /** Private current-attachment bytes. No URL, decoder, write or seal is created. */
    readAttached(value: FloorPlanGalleryTarget) {
      const captured = Object.freeze(
        object(value, ['companyId', 'actorId', 'listingId', 'revision']),
      ) as unknown as FloorPlanGalleryTarget;
      return readAttachmentBytes(
        captured,
        typeof readGallery === 'function' ? () => readGallery(captured) : undefined,
      );
    },
    /** Anonymous approved delivery is a separate, exact-version capability. */
    readPublished(value: PublishedFloorPlanTarget) {
      const t = object(value, ['companyId', 'listingId', 'revision', 'approvedVersion']);
      for (const key of ['companyId', 'listingId'])
        if (typeof t[key] !== 'string' || !id.test(t[key] as string)) fail('INTEGRITY');
      if (
        typeof t.approvedVersion !== 'string' ||
        !/^[1-9][0-9]{0,15}$/.test(t.approvedVersion) ||
        BigInt(t.approvedVersion) > 9007199254740991n
      )
        fail('INTEGRITY');
      const target = Object.freeze(t) as unknown as PublishedFloorPlanTarget;
      const reader =
        typeof readPublishedGallery !== 'function'
          ? undefined
          : async () => {
              const raw = object(await readPublishedGallery(target), [
                'policy',
                'companyId',
                'listingId',
                'revision',
                'approvedVersion',
                'floorPlan',
              ]);
              if (
                raw.policy !== 'synthetic-published-floor-plan-output-v1' ||
                Object.entries(target).some(([k, v]) => raw[k] !== v)
              )
                fail('INTEGRITY');
              return {
                policy: 'synthetic-floor-plan-gallery-v1',
                companyId: target.companyId,
                actorId: null,
                listingId: target.listingId,
                revision: target.revision,
                version: target.approvedVersion,
                state: 'approved',
                floorPlan: raw.floorPlan,
              };
            };
      return readAttachmentBytes(
        {
          companyId: target.companyId,
          actorId: null,
          listingId: target.listingId,
          revision: target.revision,
        },
        reader,
        target.approvedVersion,
      );
    },
    close() {
      closed = true;
      return tail;
    },
  });
}
