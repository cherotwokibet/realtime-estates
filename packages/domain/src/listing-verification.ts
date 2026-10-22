import { DomainError } from './errors.js';
import {
  validateListingDuplicateRequest,
  type ListingDuplicateRequest,
} from './listing-duplicates.js';
export type VerificationTarget = Readonly<Omit<ListingDuplicateRequest, 'limit'>>;
export interface ListingVerificationCommand {
  readonly operationId: string;
  readonly policy: 'synthetic-check-record-v1';
  readonly target: VerificationTarget;
  readonly expectedVerificationVersion: string;
  readonly subject: 'identity' | 'advertising_authority' | 'availability';
  readonly outcome: 'supported' | 'not_supported' | 'inconclusive';
  readonly evidenceReference: string | null;
  readonly note: string;
  readonly observedAt: string;
}
export interface ListingVerificationRecord extends Omit<
  ListingVerificationCommand,
  'expectedVerificationVersion'
> {
  readonly kind: 'listing_verification_record';
  readonly actorId: string;
  readonly recordedAt: string;
  readonly verificationVersion: string;
}
export interface ListingVerificationFacts {
  readonly target: VerificationTarget;
  readonly verificationVersion: string;
  readonly lastRecordedAt: string | null;
}
const maximum = 9007199254740991n;
function invalid(): never {
  throw new DomainError('INVALID_LISTING_VERIFICATION', 'Invalid private check record.');
}
function record(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return invalid();
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== fields.length ||
    keys.some((k) => typeof k !== 'string' || !fields.includes(k))
  )
    return invalid();
  const out: Record<string, unknown> = {};
  for (const key of fields) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
    out[key] = d.value;
  }
  return out;
}
function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  )
    return invalid();
  return value;
}
function version(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,15})$/.test(value) || BigInt(value) > maximum)
    return invalid();
  return value;
}
function instant(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.startsWith('0000') ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    return invalid();
  return value;
}
const targetKeys = ['listingId', 'listingVersion', 'revision', 'revisionVersion'] as const;
function target(input: unknown): VerificationTarget {
  const row = record(input, targetKeys);
  try {
    const { limit, ...value } = validateListingDuplicateRequest({ ...row, limit: 1 });
    return Object.freeze(value);
  } catch {
    return invalid();
  }
}
const fields = [
  'operationId',
  'policy',
  'target',
  'expectedVerificationVersion',
  'subject',
  'outcome',
  'evidenceReference',
  'note',
  'observedAt',
] as const;
export function validateListingVerificationCommand(input: unknown): ListingVerificationCommand {
  const row = record(input, fields);
  if (
    row.policy !== 'synthetic-check-record-v1' ||
    !['identity', 'advertising_authority', 'availability'].includes(row.subject as string) ||
    !['supported', 'not_supported', 'inconclusive'].includes(row.outcome as string)
  )
    return invalid();
  if (
    row.evidenceReference !== null &&
    (typeof row.evidenceReference !== 'string' ||
      !/^synthetic:[a-z0-9][a-z0-9-]{0,79}$/.test(row.evidenceReference))
  )
    return invalid();
  if (row.outcome !== 'inconclusive' && row.evidenceReference === null) return invalid();
  if (
    typeof row.note !== 'string' ||
    row.note !== row.note.trim() ||
    row.note.length > 1200 ||
    Array.from(row.note).length > 600 ||
    row.note.length === 0 ||
    /[\uD800-\uDFFF]/u.test(row.note) ||
    /[\u0000-\u001f\u007f-\u009f]/.test(row.note)
  )
    return invalid();
  return Object.freeze({
    operationId: uuid(row.operationId),
    policy: 'synthetic-check-record-v1',
    target: target(row.target),
    expectedVerificationVersion: version(row.expectedVerificationVersion),
    subject: row.subject as ListingVerificationCommand['subject'],
    outcome: row.outcome as ListingVerificationCommand['outcome'],
    evidenceReference: row.evidenceReference as string | null,
    note: row.note,
    observedAt: instant(row.observedAt),
  });
}
export type ListingVerificationPlan =
  | Readonly<{ outcome: 'planned'; record: ListingVerificationRecord }>
  | Readonly<{
      outcome: 'conflict';
      reason: 'LISTING_CHANGED' | 'VERIFICATION_CHANGED';
      record: null;
    }>
  | Readonly<{
      outcome: 'refused';
      reason: 'VERSION_LIMIT' | 'OBSERVATION_IN_FUTURE' | 'RECORD_CLOCK_INVALID';
      record: null;
    }>;
/** Pure provisional synthetic policy. Caller must independently authorize current tenant/admin first. */
export function planListingVerification(
  input: unknown,
  currentInput: unknown,
  role: 'admin' | 'agent',
  actorId: string,
  nowInput: string,
): ListingVerificationPlan {
  if (role !== 'admin')
    throw new DomainError('LISTING_VERIFICATION_FORBIDDEN', 'A current admin is required.');
  const command = validateListingVerificationCommand(input),
    row = record(currentInput, ['target', 'verificationVersion', 'lastRecordedAt']),
    current = target(row.target),
    v = version(row.verificationVersion),
    last = row.lastRecordedAt === null ? null : instant(row.lastRecordedAt),
    now = instant(nowInput),
    actor = uuid(actorId);
  if ((v === '0') !== (last === null)) return invalid();
  if (targetKeys.some((key) => command.target[key] !== current[key]))
    return Object.freeze({ outcome: 'conflict', reason: 'LISTING_CHANGED', record: null });
  if (command.expectedVerificationVersion !== v)
    return Object.freeze({ outcome: 'conflict', reason: 'VERIFICATION_CHANGED', record: null });
  if (BigInt(v) === maximum)
    return Object.freeze({ outcome: 'refused', reason: 'VERSION_LIMIT', record: null });
  if (command.observedAt > now)
    return Object.freeze({ outcome: 'refused', reason: 'OBSERVATION_IN_FUTURE', record: null });
  if (last !== null && last > now)
    return Object.freeze({ outcome: 'refused', reason: 'RECORD_CLOCK_INVALID', record: null });
  const { expectedVerificationVersion, ...original } = command;
  return Object.freeze({
    outcome: 'planned',
    record: Object.freeze({
      ...original,
      kind: 'listing_verification_record',
      actorId: actor,
      recordedAt: now,
      verificationVersion: String(BigInt(v) + 1n),
    }),
  });
}
