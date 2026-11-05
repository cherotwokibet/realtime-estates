import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { isSharedArrayBuffer } from 'node:util/types';
import type { FloorPlanRequests, FloorPlanRequestBinding } from './floor-plan-request.js';
import type { SyntheticAttemptJournal, SyntheticAttemptReservation } from './attempt-journal.js';
import type { SyntheticWorkerAdmission, SyntheticWorkerPermit } from './worker-admission.js';
import { inspectContainer } from './containers.js';

export interface FloorPlanWorkerTarget extends FloorPlanRequestBinding {
  readonly claimId: string;
  readonly leaseNonce: string;
}
export interface FloorPlanWorkerLease {
  readonly target: FloorPlanWorkerTarget;
  readonly outputObjectId: string;
  readonly claimedAt: string;
  readonly expiresAt: string;
}
declare const prepared: unique symbol;
export interface PreparedFloorPlanWorker {
  readonly [prepared]: true;
  readonly source: Buffer;
  readonly lease: FloorPlanWorkerLease;
  readonly attempt: SyntheticAttemptReservation;
  readonly permit: SyntheticWorkerPermit;
}
export class FloorPlanWorkerAdmissionError extends Error {
  override readonly name = 'FloorPlanWorkerAdmissionError';
  constructor(readonly code: 'INTEGRITY' | 'INVALID_INPUT' | 'BUSY' | 'CLOSED' | 'BLOCKED') {
    super(`Floor-plan worker admission: ${code}.`);
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const stamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
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
];
function fail(code: ConstructorParameters<typeof FloorPlanWorkerAdmissionError>[0]): never {
  throw new FloorPlanWorkerAdmissionError(code);
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length
  )
    fail('INTEGRITY');
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) fail('INTEGRITY');
    out[key] = d.value;
  }
  return out;
}
export function snapshotFloorPlanWorkerTarget(value: FloorPlanWorkerTarget): FloorPlanWorkerTarget {
  const row = object(value, [...bindingKeys, 'claimId', 'leaseNonce']);
  for (const [key, value] of Object.entries(row)) {
    if (key === 'revision' || key === 'expectedVersion') {
      if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < 1 ||
        (key === 'revision' && value > 2147483647)
      )
        fail('INVALID_INPUT');
    } else if (typeof value !== 'string' || !uuid.test(value)) fail('INVALID_INPUT');
  }
  return Object.freeze(row) as unknown as FloorPlanWorkerTarget;
}
export function validateFloorPlanWorkerLease(
  value: unknown,
  selected: FloorPlanWorkerTarget,
  source: Buffer,
): FloorPlanWorkerLease {
  const row = object(value, [
    'policy',
    'registration',
    'claimId',
    'leaseNonce',
    'outputObjectId',
    'claimedAt',
    'expiresAt',
  ]);
  const reg = object(row.registration, [
    'policy',
    'role',
    'pipeline',
    'countsAsPhoto',
    'binding',
    'source',
    'registeredAt',
    'expiresAt',
  ]);
  const b = object(reg.binding, bindingKeys),
    facts = object(reg.source, ['sha256', 'bytes', 'format']);
  if (
    row.policy !== 'synthetic-floor-plan-lease-v1' ||
    reg.policy !== 'synthetic-floor-plan-registration-v1' ||
    reg.role !== 'floor_plan' ||
    reg.pipeline !== 'synthetic-floor-plan-codec-v1' ||
    reg.countsAsPhoto !== false ||
    bindingKeys.some((k) => b[k] !== selected[k as keyof FloorPlanWorkerTarget]) ||
    row.claimId !== selected.claimId ||
    row.leaseNonce !== selected.leaseNonce ||
    typeof row.outputObjectId !== 'string' ||
    !uuid.test(row.outputObjectId) ||
    facts.sha256 !== createHash('sha256').update(source).digest('hex') ||
    facts.bytes !== source.length ||
    facts.format !== inspectContainer(source)
  )
    fail('INTEGRITY');
  for (const time of [row.claimedAt, row.expiresAt, reg.registeredAt, reg.expiresAt])
    if (typeof time !== 'string' || !stamp.test(time) || !Number.isFinite(Date.parse(time)))
      fail('INTEGRITY');
  const claimed = Date.parse(row.claimedAt as string),
    expires = Date.parse(row.expiresAt as string),
    registered = Date.parse(reg.registeredAt as string),
    registrationExpires = Date.parse(reg.expiresAt as string);
  if (
    registrationExpires - registered !== 86400000 ||
    claimed < registered ||
    expires <= claimed ||
    expires > claimed + 300000 ||
    expires > registrationExpires ||
    claimed > Date.now() ||
    expires <= Date.now()
  )
    fail('BLOCKED');
  return Object.freeze({
    target: selected,
    outputObjectId: row.outputObjectId as string,
    claimedAt: row.claimedAt as string,
    expiresAt: row.expiresAt as string,
  });
}
/** Trusted server-only composition. No SQL claims, source writes, process launch or output promotion. */
export function createFloorPlanWorkerAdmission(config: {
  readonly requests: FloorPlanRequests;
  readonly journal: SyntheticAttemptJournal;
  readonly worker: SyntheticWorkerAdmission;
  readonly preflight: (target: FloorPlanWorkerTarget) => Promise<unknown>;
}) {
  const { requests, journal, worker, preflight } = config;
  if (typeof preflight !== 'function' || worker.journalId !== journal.journalId)
    fail('INVALID_INPUT');
  const live = new WeakMap<
    PreparedFloorPlanWorker,
    {
      lease: FloorPlanWorkerLease;
      attempt: SyntheticAttemptReservation;
      permit: SyntheticWorkerPermit;
    }
  >();
  let closed = false,
    busy = false;
  async function exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (closed) fail('CLOSED');
    if (busy) fail('BUSY');
    busy = true;
    try {
      return await work();
    } finally {
      busy = false;
    }
  }
  return Object.freeze({
    prepare(input: FloorPlanWorkerTarget): Promise<PreparedFloorPlanWorker> {
      const selected = snapshotFloorPlanWorkerTarget(input);
      return exclusive(async () => {
        // Check current access before private source reads. Validate the receipt after readback.
        const first = await preflight(selected);
        const binding = Object.fromEntries(
          bindingKeys.map((k) => [k, selected[k as keyof FloorPlanWorkerTarget]]),
        ) as unknown as FloorPlanRequestBinding;
        const read = await requests.read(binding);
        if (!Buffer.isBuffer(read.source) || isSharedArrayBuffer(read.source.buffer))
          fail('INTEGRITY');
        const source = Buffer.from(read.source),
          original = validateFloorPlanWorkerLease(first, selected, source);
        const fresh = validateFloorPlanWorkerLease(await preflight(selected), selected, source);
        if (JSON.stringify(fresh) !== JSON.stringify(original)) fail('INTEGRITY');
        const slot = await worker.reserve({ jobId: selected.jobId, claimId: selected.claimId });
        try {
          const attempt = await journal.reserve({
            jobId: selected.jobId,
            claimId: selected.claimId,
            attempt: 1,
            leaseNonce: selected.leaseNonce,
          });
          const result = Object.freeze({
            source,
            lease: original,
            attempt,
            permit: slot.permit,
          }) as PreparedFloorPlanWorker;
          live.set(result, { lease: original, attempt, permit: slot.permit });
          return result;
        } catch (error) {
          await worker.releaseBeforeLaunch(slot.permit);
          throw error;
        }
      });
    },
    /** Called after secure source staging. Consumes this live admission even on uncertain failure. */
    arm(value: PreparedFloorPlanWorker): Promise<void> {
      return exclusive(async () => {
        const entry = live.get(value);
        if (!entry) fail('BLOCKED');
        live.delete(value);
        try {
          const checked = validateFloorPlanWorkerLease(
            await preflight(entry.lease.target),
            entry.lease.target,
            value.source,
          );
          if (JSON.stringify(checked) !== JSON.stringify(entry.lease)) fail('INTEGRITY');
        } catch (error) {
          await worker.releaseBeforeLaunch(entry.permit);
          throw error;
        }
        await worker.arm(entry.permit, entry.attempt);
      });
    },
    /** Abandon an unarmed preparation without erasing its historical attempt. */
    cancel(value: PreparedFloorPlanWorker): Promise<void> {
      return exclusive(async () => {
        const entry = live.get(value);
        if (!entry) fail('BLOCKED');
        live.delete(value);
        await worker.releaseBeforeLaunch(entry.permit);
      });
    },
    close() {
      closed = true;
    },
  });
}
