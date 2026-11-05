import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { isSharedArrayBuffer } from 'node:util/types';
import { inspectContainer } from './containers.js';
import {
  createFloorPlanSourceAdmission,
  validateFloorPlanSourceRegistration,
  type FloorPlanRequests,
  type FloorPlanRequestBinding,
  type FloorPlanSourceTarget,
} from './floor-plan-request.js';
import {
  validateFloorPlanWorkerLease,
  snapshotFloorPlanWorkerTarget,
  type FloorPlanWorkerTarget,
} from './floor-plan-admission.js';
import type { createFloorPlanOutputDelivery } from './floor-plan-output.js';
export interface FloorPlanPreparationTarget extends FloorPlanSourceTarget {
  readonly expectedVersion: number;
}
export class FloorPlanPreparationUncertainError extends Error {
  override readonly name = 'FloorPlanPreparationUncertainError';
  constructor() {
    super('Floor-plan command acknowledgement is uncertain.');
  }
}
export class FloorPlanPreparationError extends Error {
  override readonly name = 'FloorPlanPreparationError';
  constructor(readonly code: 'INVALID_INPUT' | 'INTEGRITY' | 'BUSY' | 'CLOSED') {
    super(`Floor-plan preparation: ${code}.`);
  }
}
function fail(code: FloorPlanPreparationError['code']): never {
  throw new FloorPlanPreparationError(code);
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length
  )
    fail('INTEGRITY');
  const r: Record<string, unknown> = {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(value, k);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) fail('INTEGRITY');
    r[k] = d.value;
  }
  return r;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function target(value: FloorPlanPreparationTarget): FloorPlanPreparationTarget {
  const r = object(value, [
    'companyId',
    'actorId',
    'listingId',
    'revision',
    'requestId',
    'expectedVersion',
  ]);
  for (const k of ['companyId', 'actorId', 'listingId', 'requestId'])
    if (typeof r[k] !== 'string' || !uuid.test(r[k] as string)) fail('INVALID_INPUT');
  for (const k of ['revision', 'expectedVersion'])
    if (
      typeof r[k] !== 'number' ||
      !Number.isSafeInteger(r[k]) ||
      (r[k] as number) < 1 ||
      (k === 'revision' && (r[k] as number) > 2147483647)
    )
      fail('INVALID_INPUT');
  return Object.freeze(r) as unknown as FloorPlanPreparationTarget;
}
const sourceTarget = (t: FloorPlanPreparationTarget): FloorPlanSourceTarget =>
  Object.freeze({
    companyId: t.companyId,
    actorId: t.actorId,
    listingId: t.listingId,
    revision: t.revision,
    requestId: t.requestId,
  });
function registeredBinding(raw: unknown, t: FloorPlanPreparationTarget): FloorPlanRequestBinding {
  const r = object(raw, [
    'policy',
    'role',
    'pipeline',
    'countsAsPhoto',
    'binding',
    'source',
    'registeredAt',
    'expiresAt',
  ]);
  if (
    r.policy !== 'synthetic-floor-plan-registration-v1' ||
    r.role !== 'floor_plan' ||
    r.pipeline !== 'synthetic-floor-plan-codec-v1' ||
    r.countsAsPhoto !== false
  )
    fail('INTEGRITY');
  const b = object(r.binding, [
    'companyId',
    'actorId',
    'listingId',
    'revision',
    'expectedVersion',
    'requestId',
    'jobId',
    'generationId',
    'inputObjectId',
  ]);
  if (Object.entries(t).some(([k, v]) => b[k] !== v)) fail('INTEGRITY');
  for (const k of ['jobId', 'generationId', 'inputObjectId'])
    if (typeof b[k] !== 'string' || !uuid.test(b[k] as string)) fail('INTEGRITY');
  return Object.freeze(b) as unknown as FloorPlanRequestBinding;
}
function claimed(
  raw: unknown,
  b: FloorPlanRequestBinding,
  source: Buffer,
  fresh: boolean,
): FloorPlanWorkerTarget {
  const l = object(raw, [
    'policy',
    'registration',
    'claimId',
    'leaseNonce',
    'outputObjectId',
    'claimedAt',
    'expiresAt',
  ]);
  // The preparation operation is also its deterministic server claim identity. Nonce/output identities remain SQL-owned.
  const t = snapshotFloorPlanWorkerTarget({
    ...b,
    claimId: b.requestId,
    leaseNonce: l.leaseNonce,
  } as FloorPlanWorkerTarget);
  validateFloorPlanWorkerLease(raw, t, source, fresh);
  return t;
}
function prepared(
  target: FloorPlanPreparationTarget,
  result: Awaited<ReturnType<ReturnType<typeof createFloorPlanOutputDelivery>['reconcile']>>,
) {
  if (result.state !== 'sealed')
    return Object.freeze({ state: 'blocked' as const, reason: 'UNCONFIRMED' as const });
  const m = result.manifest;
  return Object.freeze({
    state: 'prepared' as const,
    prepared: Object.freeze({
      policy: 'synthetic-floor-plan-prepared-v1' as const,
      listingId: target.listingId,
      revision: target.revision,
      requestId: target.requestId,
      expectedVersion: String(target.expectedVersion),
      width: m.width,
      height: m.height,
      bytes: m.bytes,
      sha256: m.sha256,
    }),
  });
}
/** Server-only composition. This does not read HTTP bodies or accept caller-selected claims/paths. */
export function createFloorPlanPreparation(config: {
  readonly requests: FloorPlanRequests;
  readonly sourceAdmission: ReturnType<typeof createFloorPlanSourceAdmission>;
  readonly delivery: Pick<ReturnType<typeof createFloorPlanOutputDelivery>, 'run' | 'reconcile'>;
  readonly register: (
    target: FloorPlanPreparationTarget,
    source: Readonly<{ sha256: string; bytes: number; format: 'jpeg' | 'png' | 'webp' }>,
  ) => Promise<unknown>;
  readonly readRegistration: (target: FloorPlanPreparationTarget) => Promise<unknown>;
  readonly claim: (target: FloorPlanPreparationTarget, claimId: string) => Promise<unknown>;
  readonly readLease: (target: FloorPlanPreparationTarget) => Promise<unknown>;
}) {
  const register = config.register,
    readRegistration = config.readRegistration,
    claim = config.claim,
    readLease = config.readLease,
    record = config.sourceAdmission.record.bind(config.sourceAdmission),
    read = config.requests.read.bind(config.requests),
    run = config.delivery.run.bind(config.delivery),
    reconcile = config.delivery.reconcile.bind(config.delivery);
  let closed = false,
    busy = false,
    tail: Promise<unknown> = Promise.resolve();
  function admit<T>(work: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new FloorPlanPreparationError('CLOSED'));
    if (busy) return Promise.reject(new FloorPlanPreparationError('BUSY'));
    busy = true;
    const r = work().finally(() => {
      busy = false;
    });
    tail = r.catch(() => {});
    return r;
  }
  async function command(action: () => Promise<unknown>, original: () => Promise<unknown>) {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof FloorPlanPreparationUncertainError)) throw error;
      return original();
    }
  }
  return Object.freeze({
    prepare(value: FloorPlanPreparationTarget, input: Buffer) {
      if (closed || busy)
        return Promise.reject(new FloorPlanPreparationError(closed ? 'CLOSED' : 'BUSY'));
      const t = target(value);
      if (
        !Buffer.isBuffer(input) ||
        isSharedArrayBuffer(input.buffer) ||
        input.length < 1 ||
        input.length > 10485760
      )
        fail('INVALID_INPUT');
      const bytes = Buffer.from(input),
        facts = Object.freeze({
          sha256: createHash('sha256').update(bytes).digest('hex'),
          bytes: bytes.length,
          format: inspectContainer(bytes),
        });
      return admit(async () => {
        const raw = await command(
            () => register(t, facts),
            () => readRegistration(t),
          ),
          b = registeredBinding(raw, t);
        validateFloorPlanSourceRegistration(raw, sourceTarget(t), bytes);
        const saved = await record(sourceTarget(t), bytes);
        for (const [k, v] of Object.entries(b))
          if (saved.binding[k as keyof FloorPlanRequestBinding] !== v) fail('INTEGRITY');
        const lease = await command(
            () => claim(t, t.requestId),
            () => readLease(t),
          ),
          selected = claimed(lease, b, bytes, true);
        const result = await run(selected);
        if (result.state !== 'sealed')
          return Object.freeze({ state: 'blocked' as const, reason: 'NATIVE_FAILED' as const });
        return prepared(t, result);
      });
    },
    recover(value: FloorPlanPreparationTarget) {
      const t = target(value);
      return admit(async () => {
        try {
          const raw = await readRegistration(t),
            b = registeredBinding(raw, t),
            lease = await readLease(t),
            saved = await read(b);
          validateFloorPlanSourceRegistration(raw, sourceTarget(t), saved.source);
          const selected = claimed(lease, b, saved.source, false);
          return prepared(t, await reconcile(selected));
        } catch (error) {
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            (error.code === 'P0002' || error.code === 'INCOMPLETE')
          )
            return Object.freeze({ state: 'blocked' as const, reason: 'UNCONFIRMED' as const });
          throw error;
        }
      });
    },
    close() {
      closed = true;
      return tail;
    },
  });
}
