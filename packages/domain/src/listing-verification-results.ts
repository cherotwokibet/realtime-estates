import { DomainError } from './errors.js';
import {
  validateListingVerificationCommand,
  type ListingVerificationCommand,
  type ListingVerificationRecord,
} from './listing-verification.js';
export interface ListingVerificationReceipt {
  readonly kind: 'listing_verification_receipt';
  readonly operationId: string;
  readonly listingId: string;
  readonly actorId: string;
  readonly request: ListingVerificationCommand;
  readonly completedAt: string;
  readonly decision: Readonly<{
    outcome: 'recorded' | 'conflict' | 'refused';
    reason:
      | null
      | 'LISTING_CHANGED'
      | 'VERIFICATION_CHANGED'
      | 'VERSION_LIMIT'
      | 'OBSERVATION_IN_FUTURE'
      | 'RECORD_CLOCK_INVALID';
    record: ListingVerificationRecord | null;
  }>;
}
export interface ListingVerificationHistory {
  readonly kind: 'listing_verification_history';
  readonly listingId: string;
  readonly verificationVersion: string;
  readonly beforeVersion: string | null;
  readonly records: readonly ListingVerificationRecord[];
  readonly hasMore: boolean;
}
const max = 9007199254740991n;
function invalid(): never {
  throw new DomainError('INVALID_LISTING_VERIFICATION_RESULT', 'Invalid private check result.');
}
function own(input: unknown, fields: readonly string[]): Record<string, unknown> {
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
function version(value: unknown, zero = true): string {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9]\d{0,15})$/.test(value) ||
    BigInt(value) > max ||
    (!zero && value === '0')
  )
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
const recordFields = [
  'kind',
  'operationId',
  'policy',
  'target',
  'subject',
  'outcome',
  'evidenceReference',
  'note',
  'observedAt',
  'actorId',
  'recordedAt',
  'verificationVersion',
] as const;
export function validateListingVerificationRecord(
  input: unknown,
  listingId: string,
): ListingVerificationRecord {
  const row = own(input, recordFields),
    v = version(row.verificationVersion, false),
    actor = uuid(row.actorId),
    recordedAt = instant(row.recordedAt);
  if (row.kind !== 'listing_verification_record') return invalid();
  const command = validateListingVerificationCommand({
    operationId: row.operationId,
    policy: row.policy,
    target: row.target,
    subject: row.subject,
    outcome: row.outcome,
    evidenceReference: row.evidenceReference,
    note: row.note,
    observedAt: row.observedAt,
    expectedVerificationVersion: String(BigInt(v) - 1n),
  });
  if (command.target.listingId !== uuid(listingId) || command.observedAt > recordedAt)
    return invalid();
  const { expectedVerificationVersion, ...original } = command;
  return Object.freeze({
    ...original,
    kind: 'listing_verification_record',
    actorId: actor,
    recordedAt,
    verificationVersion: v,
  });
}
const receiptFields = [
  'kind',
  'operationId',
  'listingId',
  'actorId',
  'request',
  'decision',
  'completedAt',
] as const;
export function validateListingVerificationReceipt(
  input: unknown,
  originalInput: unknown,
  expectedActorId?: string,
): ListingVerificationReceipt {
  const command = validateListingVerificationCommand(originalInput),
    row = own(input, receiptFields),
    actor = uuid(row.actorId),
    completedAt = instant(row.completedAt),
    request = validateListingVerificationCommand(row.request),
    decision = own(row.decision, ['outcome', 'reason', 'record']);
  if (
    row.kind !== 'listing_verification_receipt' ||
    row.operationId !== command.operationId ||
    row.listingId !== command.target.listingId ||
    JSON.stringify(request) !== JSON.stringify(command) ||
    (expectedActorId !== undefined && actor !== uuid(expectedActorId))
  )
    return invalid();
  let result: ListingVerificationRecord | null = null;
  if (decision.outcome === 'recorded') {
    if (decision.reason !== null || BigInt(command.expectedVerificationVersion) === max)
      return invalid();
    result = validateListingVerificationRecord(decision.record, command.target.listingId);
    const { expectedVerificationVersion, ...original } = command;
    const { kind, actorId, recordedAt, verificationVersion, ...saved } = result;
    if (
      JSON.stringify(saved) !== JSON.stringify(original) ||
      actorId !== actor ||
      recordedAt !== completedAt ||
      BigInt(verificationVersion) !== BigInt(command.expectedVerificationVersion) + 1n
    )
      return invalid();
  } else {
    if (decision.record !== null) return invalid();
    if (decision.outcome === 'conflict') {
      if (!['LISTING_CHANGED', 'VERIFICATION_CHANGED'].includes(decision.reason as string))
        return invalid();
    } else if (decision.outcome === 'refused') {
      if (decision.reason === 'VERSION_LIMIT') {
        if (BigInt(command.expectedVerificationVersion) !== max) return invalid();
      } else if (decision.reason === 'OBSERVATION_IN_FUTURE') {
        if (
          BigInt(command.expectedVerificationVersion) === max ||
          command.observedAt <= completedAt
        )
          return invalid();
      } else if (decision.reason === 'RECORD_CLOCK_INVALID') {
        if (
          command.expectedVerificationVersion === '0' ||
          BigInt(command.expectedVerificationVersion) === max ||
          command.observedAt > completedAt
        )
          return invalid();
      } else return invalid();
    } else return invalid();
  }
  return Object.freeze({
    kind: 'listing_verification_receipt',
    operationId: command.operationId,
    listingId: command.target.listingId,
    actorId: actor,
    request,
    completedAt,
    decision: Object.freeze({
      outcome: decision.outcome as ListingVerificationReceipt['decision']['outcome'],
      reason: decision.reason as ListingVerificationReceipt['decision']['reason'],
      record: result,
    }),
  });
}
/** Self-consistency plus trusted route/actor binding; callers still authorize the resource separately. */
export function validateListingVerificationOriginal(
  input: unknown,
  listingId: string,
  operationId: string,
  actorId?: string,
): ListingVerificationReceipt {
  const row = own(input, receiptFields),
    request = validateListingVerificationCommand(row.request);
  if (request.target.listingId !== uuid(listingId) || request.operationId !== uuid(operationId))
    return invalid();
  return validateListingVerificationReceipt(input, request, actorId);
}
export function validateListingVerificationHistory(
  input: unknown,
  listingId: string,
  limit: number,
  beforeVersion: string | null = null,
): ListingVerificationHistory {
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) return invalid();
  const before = beforeVersion === null ? null : version(beforeVersion, false);
  const row = own(input, [
      'kind',
      'listingId',
      'verificationVersion',
      'beforeVersion',
      'records',
      'hasMore',
    ]),
    listing = uuid(listingId),
    v = version(row.verificationVersion),
    items = row.records;
  const ceiling = before === null ? BigInt(v) : BigInt(before) - 1n,
    start = ceiling < BigInt(v) ? ceiling : BigInt(v);
  if (
    row.kind !== 'listing_verification_history' ||
    row.listingId !== listing ||
    row.beforeVersion !== before ||
    typeof row.hasMore !== 'boolean' ||
    row.hasMore !== start > BigInt(limit) ||
    !Array.isArray(items) ||
    Object.getPrototypeOf(items) !== Array.prototype ||
    items.length !== Math.min(Number(start), limit) ||
    Reflect.ownKeys(items).length !== items.length + 1
  )
    return invalid();
  let previous: string | null = null;
  const records = Array.from({ length: items.length }, (_, index) => {
    const d = Object.getOwnPropertyDescriptor(items, String(index));
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
    const result = validateListingVerificationRecord(d.value, listing);
    if (
      BigInt(result.verificationVersion) !== start - BigInt(index) ||
      (previous !== null && result.recordedAt > previous)
    )
      return invalid();
    previous = result.recordedAt;
    return result;
  });
  return Object.freeze({
    kind: 'listing_verification_history',
    listingId: listing,
    verificationVersion: v,
    beforeVersion: before,
    records: Object.freeze(records),
    hasMore: row.hasMore,
  });
}
