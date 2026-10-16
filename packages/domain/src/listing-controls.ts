import { DomainError } from './errors.js';

export type ListingAvailability = 'available' | 'reserved' | 'rented' | 'sold' | 'withdrawn';
export type ListingPublication = 'unpublished' | 'published' | 'paused' | 'archived';
export type ListingControlCommand = Readonly<{
  operationId: string;
  listingId: string;
  expectedListingVersion: string;
}> &
  (
    | Readonly<{ kind: 'confirm_availability'; availability: ListingAvailability }>
    | Readonly<{
        kind: 'set_publication';
        publicationStatus: Exclude<ListingPublication, 'unpublished'>;
      }>
  );
export interface ListingControlFacts {
  readonly listingId: string;
  readonly version: string;
  readonly availability: ListingAvailability;
  readonly publicationStatus: ListingPublication;
  readonly publishedRevision: number | null;
  readonly approvedSnapshotRevision: number | null;
  readonly lastAvailabilityConfirmedAt: string | null;
  readonly archivedAt: string | null;
}
export type ListingControlDecision =
  | Readonly<{ outcome: 'applied'; reason: null; result: Readonly<{ listingVersion: string }> }>
  | Readonly<{ outcome: 'conflict'; reason: 'LISTING_CHANGED'; result: null }>
  | Readonly<{
      outcome: 'refused';
      reason: 'VERSION_LIMIT' | 'APPROVED_PUBLICATION_REQUIRED' | 'CONFIRMATION_CLOCK_INVALID';
      result: null;
    }>;
export interface ListingControlReceiptBase {
  readonly operationId: string;
  readonly listingId: string;
  readonly actorId: string;
  readonly completedAt: string;
  readonly decision: ListingControlDecision;
}
export type ListingControlReceipt = ListingControlReceiptBase &
  (
    | Readonly<{
        kind: 'confirm_availability';
        request: Readonly<{ expectedListingVersion: string; availability: ListingAvailability }>;
      }>
    | Readonly<{
        kind: 'set_publication';
        request: Readonly<{
          expectedListingVersion: string;
          publicationStatus: Exclude<ListingPublication, 'unpublished'>;
        }>;
      }>
  );
const maxVersion = 9007199254740991n;
const freshnessMicros = 2592000000000n;
const invalid = (): never => {
  throw new DomainError('INVALID_LISTING_CONTROL', 'Invalid listing control facts.');
};
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
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return invalid();
    out[key] = descriptor.value;
  }
  return out;
}
function ownKind(input: unknown): unknown {
  if (!input || typeof input !== 'object') return invalid();
  const d = Object.getOwnPropertyDescriptor(input, 'kind');
  if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
  return d.value;
}
function uuid(input: unknown): string {
  if (
    typeof input !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input)
  )
    return invalid();
  return input.toLowerCase();
}
function version(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input.length > 16 ||
    !/^[1-9]\d*$/.test(input) ||
    BigInt(input) > maxVersion
  )
    return invalid();
  return input;
}
function availability(input: unknown): ListingAvailability {
  if (!['available', 'reserved', 'rented', 'sold', 'withdrawn'].includes(input as string))
    return invalid();
  return input as ListingAvailability;
}
function publication(input: unknown): ListingPublication {
  if (!['unpublished', 'published', 'paused', 'archived'].includes(input as string))
    return invalid();
  return input as ListingPublication;
}
function revision(input: unknown): number | null {
  if (input === null) return null;
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 1 || input > 2147483647)
    return invalid();
  return input;
}
function instant(input: unknown): string {
  if (
    typeof input !== 'string' ||
    !/^(?!0000)\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}(?:\d{3})?Z$/.test(input)
  )
    return invalid();
  const milliseconds = input.slice(0, 23) + 'Z';
  if (
    !Number.isFinite(Date.parse(milliseconds)) ||
    new Date(milliseconds).toISOString() !== milliseconds
  )
    return invalid();
  return input;
}
function micros(value: string): bigint {
  return (
    BigInt(Date.parse(value.slice(0, 23) + 'Z')) * 1000n +
    BigInt(value.length === 27 ? value.slice(23, 26) : '0')
  );
}
export function validateListingControlCommand(input: unknown): ListingControlCommand {
  const kind = ownKind(input);
  if (kind !== 'confirm_availability' && kind !== 'set_publication') return invalid();
  const target = kind === 'confirm_availability' ? 'availability' : 'publicationStatus';
  const v = record(input, ['operationId', 'listingId', 'expectedListingVersion', 'kind', target]);
  const base = {
    operationId: uuid(v.operationId),
    listingId: uuid(v.listingId),
    expectedListingVersion: version(v.expectedListingVersion),
  };
  if (kind === 'confirm_availability')
    return Object.freeze({ ...base, kind, availability: availability(v.availability) });
  const status = publication(v.publicationStatus);
  if (status === 'unpublished') return invalid();
  return Object.freeze({ ...base, kind, publicationStatus: status });
}
export function validateListingControlFacts(
  input: unknown,
  expectedListingId: string,
): ListingControlFacts {
  const v = record(input, [
    'listingId',
    'version',
    'availability',
    'publicationStatus',
    'publishedRevision',
    'approvedSnapshotRevision',
    'lastAvailabilityConfirmedAt',
    'archivedAt',
  ]);
  const status = publication(v.publicationStatus),
    publishedRevision = revision(v.publishedRevision);
  const archivedAt = v.archivedAt === null ? null : instant(v.archivedAt);
  if (
    v.listingId !== uuid(expectedListingId) ||
    (status === 'published' && publishedRevision === null) ||
    (status === 'archived') !== (archivedAt !== null)
  )
    return invalid();
  return Object.freeze({
    listingId: uuid(v.listingId),
    version: version(v.version),
    availability: availability(v.availability),
    publicationStatus: status,
    publishedRevision,
    approvedSnapshotRevision: revision(v.approvedSnapshotRevision),
    lastAvailabilityConfirmedAt:
      v.lastAvailabilityConfirmedAt === null ? null : instant(v.lastAvailabilityConfirmedAt),
    archivedAt,
  });
}
/** Pure policy over independently authorized current facts; this function grants no access. */
export function planListingControl(
  input: unknown,
  currentInput: unknown,
  role: 'agent' | 'admin',
  nowInput: string,
):
  | Exclude<ListingControlDecision, { outcome: 'applied' }>
  | Readonly<{ outcome: 'planned'; reason: null; result: ListingControlFacts }> {
  const command = validateListingControlCommand(input),
    current = validateListingControlFacts(currentInput, command.listingId),
    now = instant(nowInput);
  if (
    !['agent', 'admin'].includes(role) ||
    (role === 'agent' &&
      command.kind === 'set_publication' &&
      (command.publicationStatus !== 'paused' || current.publicationStatus === 'archived'))
  )
    throw new DomainError(
      'LISTING_CONTROL_FORBIDDEN',
      'Listing control requires current staff authority.',
    );
  if (current.version !== command.expectedListingVersion)
    return Object.freeze({ outcome: 'conflict', reason: 'LISTING_CHANGED', result: null });
  if (BigInt(current.version) === maxVersion)
    return Object.freeze({ outcome: 'refused', reason: 'VERSION_LIMIT', result: null });
  const confirmed = current.lastAvailabilityConfirmedAt;
  if (
    (command.kind === 'confirm_availability' || command.publicationStatus === 'published') &&
    confirmed !== null &&
    micros(confirmed) > micros(now)
  )
    return Object.freeze({
      outcome: 'refused',
      reason: 'CONFIRMATION_CLOCK_INVALID',
      result: null,
    });
  if (
    command.kind === 'set_publication' &&
    command.publicationStatus === 'published' &&
    (current.publishedRevision === null ||
      current.approvedSnapshotRevision !== current.publishedRevision ||
      current.availability !== 'available' ||
      confirmed === null ||
      micros(confirmed) <= micros(now) - freshnessMicros)
  )
    return Object.freeze({
      outcome: 'refused',
      reason: 'APPROVED_PUBLICATION_REQUIRED',
      result: null,
    });
  const status =
    command.kind === 'set_publication'
      ? command.publicationStatus
      : command.availability !== 'available' && current.publicationStatus === 'published'
        ? 'paused'
        : current.publicationStatus;
  return Object.freeze({
    outcome: 'planned',
    reason: null,
    result: Object.freeze({
      ...current,
      version: String(BigInt(current.version) + 1n),
      availability:
        command.kind === 'confirm_availability' ? command.availability : current.availability,
      publicationStatus: status,
      lastAvailabilityConfirmedAt: command.kind === 'confirm_availability' ? now : confirmed,
      archivedAt:
        status === 'archived'
          ? command.kind === 'set_publication'
            ? now
            : current.archivedAt
          : null,
    }),
  });
}
/** Immutable original result. A receipt is never a current listing projection. */
export function validateListingControlReceipt(
  input: unknown,
  commandInput: unknown,
  expectedActorId?: string,
): ListingControlReceipt {
  const command = validateListingControlCommand(commandInput),
    v = record(input, [
      'operationId',
      'listingId',
      'actorId',
      'kind',
      'request',
      'completedAt',
      'decision',
    ]);
  const field = command.kind === 'confirm_availability' ? 'availability' : 'publicationStatus';
  const request = record(v.request, ['expectedListingVersion', field]);
  const retained = validateListingControlCommand({
    ...request,
    operationId: v.operationId,
    listingId: v.listingId,
    kind: v.kind,
  });
  const actorId = uuid(v.actorId);
  if (
    JSON.stringify(retained) !== JSON.stringify(command) ||
    v.operationId !== command.operationId ||
    v.listingId !== command.listingId ||
    v.kind !== command.kind ||
    v.actorId !== actorId ||
    (expectedActorId !== undefined && actorId !== uuid(expectedActorId))
  )
    return invalid();
  const d = record(v.decision, ['outcome', 'reason', 'result']);
  let decision: ListingControlDecision;
  if (d.outcome === 'applied') {
    const result = record(d.result, ['listingVersion']);
    if (
      d.reason !== null ||
      BigInt(command.expectedListingVersion) === maxVersion ||
      result.listingVersion !== String(BigInt(command.expectedListingVersion) + 1n)
    )
      return invalid();
    decision = Object.freeze({
      outcome: 'applied',
      reason: null,
      result: Object.freeze({ listingVersion: result.listingVersion as string }),
    });
  } else if (d.outcome === 'conflict' && d.reason === 'LISTING_CHANGED' && d.result === null)
    decision = Object.freeze({ outcome: 'conflict', reason: 'LISTING_CHANGED', result: null });
  else if (
    d.outcome === 'refused' &&
    d.result === null &&
    ['VERSION_LIMIT', 'APPROVED_PUBLICATION_REQUIRED', 'CONFIRMATION_CLOCK_INVALID'].includes(
      d.reason as string,
    )
  ) {
    if (
      (BigInt(command.expectedListingVersion) === maxVersion && d.reason !== 'VERSION_LIMIT') ||
      (d.reason === 'VERSION_LIMIT' && BigInt(command.expectedListingVersion) !== maxVersion) ||
      (d.reason === 'APPROVED_PUBLICATION_REQUIRED' &&
        (command.kind !== 'set_publication' || command.publicationStatus !== 'published')) ||
      (d.reason === 'CONFIRMATION_CLOCK_INVALID' &&
        command.kind === 'set_publication' &&
        command.publicationStatus !== 'published')
    )
      return invalid();
    decision = Object.freeze({
      outcome: 'refused',
      reason: d.reason as
        'VERSION_LIMIT' | 'APPROVED_PUBLICATION_REQUIRED' | 'CONFIRMATION_CLOCK_INVALID',
      result: null,
    });
  } else return invalid();
  const base = {
    operationId: command.operationId,
    listingId: command.listingId,
    actorId,
    completedAt: instant(v.completedAt),
    decision,
  };
  return command.kind === 'confirm_availability'
    ? Object.freeze({
        ...base,
        kind: command.kind,
        request: Object.freeze({
          expectedListingVersion: command.expectedListingVersion,
          availability: command.availability,
        }),
      })
    : Object.freeze({
        ...base,
        kind: command.kind,
        request: Object.freeze({
          expectedListingVersion: command.expectedListingVersion,
          publicationStatus: command.publicationStatus,
        }),
      });
}
/** Route-bound recovery. Servers additionally bind the independently verified actor. */
export function validateListingControlSnapshot(
  input: unknown,
  listingId: string,
  operationId: string,
  kind: ListingControlCommand['kind'],
  expectedActorId?: string,
): ListingControlReceipt {
  const v = record(input, [
    'operationId',
    'listingId',
    'actorId',
    'kind',
    'request',
    'completedAt',
    'decision',
  ]);
  const field =
    kind === 'confirm_availability'
      ? 'availability'
      : kind === 'set_publication'
        ? 'publicationStatus'
        : invalid();
  const request = record(v.request, ['expectedListingVersion', field]);
  return validateListingControlReceipt(
    input,
    { ...request, operationId, listingId, kind },
    expectedActorId,
  );
}
