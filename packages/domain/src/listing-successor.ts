import { DomainError } from './errors.js';
import { normalizeStaffDraftContentV2, type StaffDraftContentV2 } from './staff-draft-content.js';
import { validateStaffListingPage, type StaffListingSummary } from './staff-listings.js';

export interface ListingSuccessorCommand {
  readonly operationId: string;
  readonly listingId: string;
  readonly expectedListingVersion: string;
  readonly predecessor: Readonly<{
    revision: number;
    version: string;
    state: 'approved' | 'rejected';
  }>;
  readonly content: StaffDraftContentV2;
}
export type ListingSuccessorPlan =
  | Readonly<{ outcome: 'conflict'; reason: 'PREDECESSOR_CHANGED'; result: null }>
  | Readonly<{ outcome: 'refused'; reason: 'VERSION_LIMIT' | 'REVISION_LIMIT'; result: null }>
  | Readonly<{
      outcome: 'planned';
      reason: null;
      result: Readonly<{
        listingVersion: string;
        revision: number;
        revisionVersion: '2';
        state: 'draft';
        content: StaffDraftContentV2;
        media: readonly never[];
      }>;
    }>;
export interface ListingSuccessorReceipt {
  readonly operationId: string;
  readonly listingId: string;
  readonly actorId: string;
  readonly kind: 'start_revision';
  readonly request: Readonly<
    Pick<ListingSuccessorCommand, 'expectedListingVersion' | 'predecessor' | 'content'>
  >;
  readonly completedAt: string;
  readonly decision:
    | Exclude<ListingSuccessorPlan, { outcome: 'planned' }>
    | Readonly<{
        outcome: 'applied';
        reason: null;
        result: Readonly<{
          listingVersion: string;
          revision: number;
          revisionVersion: '2';
        }>;
      }>;
}
const invalid = (): never => {
  throw new DomainError('INVALID_LISTING_SUCCESSOR', 'Invalid listing successor facts.');
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
  const output: Record<string, unknown> = {};
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return invalid();
    output[key] = descriptor.value;
  }
  return output;
}
function uuid(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input.length !== 36 ||
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
    BigInt(input) > 9007199254740991n
  )
    return invalid();
  return input;
}
export function validateListingSuccessorCommand(input: unknown): ListingSuccessorCommand {
  const value = record(input, [
    'operationId',
    'listingId',
    'expectedListingVersion',
    'predecessor',
    'content',
  ]);
  const predecessor = record(value.predecessor, ['revision', 'version', 'state']);
  if (
    typeof predecessor.revision !== 'number' ||
    !Number.isSafeInteger(predecessor.revision) ||
    predecessor.revision < 1 ||
    predecessor.revision > 2147483647 ||
    !['approved', 'rejected'].includes(predecessor.state as string)
  )
    return invalid();
  return Object.freeze({
    operationId: uuid(value.operationId),
    listingId: uuid(value.listingId),
    expectedListingVersion: version(value.expectedListingVersion),
    predecessor: Object.freeze({
      revision: predecessor.revision,
      version: version(predecessor.version),
      state: predecessor.state as 'approved' | 'rejected',
    }),
    content: normalizeStaffDraftContentV2(value.content),
  });
}
/** Pure planning only. The caller must independently authorize and lock current SQL state. */
export function planListingSuccessor(
  commandInput: unknown,
  currentInput: StaffListingSummary,
): ListingSuccessorPlan {
  const command = validateListingSuccessorCommand(commandInput);
  const current = validateStaffListingPage({ items: [currentInput], limit: 1, truncated: false }, 1)
    .items[0]!;
  if (current.listingId !== command.listingId) return invalid();
  const latest = current.latest;
  if (
    current.version !== command.expectedListingVersion ||
    !latest ||
    latest.revision !== command.predecessor.revision ||
    latest.version !== command.predecessor.version ||
    latest.state !== command.predecessor.state
  )
    return Object.freeze({ outcome: 'conflict', reason: 'PREDECESSOR_CHANGED', result: null });
  if (BigInt(current.version) === 9007199254740991n)
    return Object.freeze({ outcome: 'refused', reason: 'VERSION_LIMIT', result: null });
  if (latest.revision === 2147483647)
    return Object.freeze({ outcome: 'refused', reason: 'REVISION_LIMIT', result: null });
  return Object.freeze({
    outcome: 'planned',
    reason: null,
    result: Object.freeze({
      listingVersion: String(BigInt(current.version) + 1n),
      revision: latest.revision + 1,
      revisionVersion: '2',
      state: 'draft',
      content: command.content,
      media: Object.freeze([]),
    }),
  });
}

/** Original operation result only; its initial versions never authorize a later edit. */
export function validateListingSuccessorReceipt(
  input: unknown,
  commandInput: unknown,
  expectedActorId?: string,
): ListingSuccessorReceipt {
  const command = validateListingSuccessorCommand(commandInput);
  const value = record(input, [
    'operationId',
    'listingId',
    'actorId',
    'kind',
    'request',
    'completedAt',
    'decision',
  ]);
  const request = record(value.request, ['expectedListingVersion', 'predecessor', 'content']);
  const retained = validateListingSuccessorCommand({
    ...request,
    operationId: value.operationId,
    listingId: value.listingId,
  });
  if (
    JSON.stringify(retained) !== JSON.stringify(command) ||
    value.kind !== 'start_revision' ||
    (expectedActorId !== undefined && uuid(value.actorId) !== uuid(expectedActorId))
  )
    return invalid();
  const completedAt = value.completedAt;
  if (
    typeof completedAt !== 'string' ||
    ![24, 27].includes(completedAt.length) ||
    !/^(?!0000)\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}(?:\d{3})?Z$/.test(completedAt)
  )
    return invalid();
  const milliseconds = completedAt.slice(0, 23) + 'Z';
  if (
    !Number.isFinite(Date.parse(milliseconds)) ||
    new Date(milliseconds).toISOString() !== milliseconds
  )
    return invalid();
  const decision = record(value.decision, ['outcome', 'reason', 'result']);
  let result: ListingSuccessorReceipt['decision'];
  if (decision.outcome === 'applied') {
    const applied = record(decision.result, ['listingVersion', 'revision', 'revisionVersion']);
    if (
      decision.reason !== null ||
      BigInt(command.expectedListingVersion) === 9007199254740991n ||
      command.predecessor.revision === 2147483647 ||
      applied.revisionVersion !== '2' ||
      applied.revision !== command.predecessor.revision + 1 ||
      applied.listingVersion !== String(BigInt(command.expectedListingVersion) + 1n)
    )
      return invalid();
    result = Object.freeze({
      outcome: 'applied',
      reason: null,
      result: Object.freeze({
        listingVersion: applied.listingVersion as string,
        revision: applied.revision as number,
        revisionVersion: '2',
      }),
    });
  } else if (
    decision.outcome === 'conflict' &&
    decision.reason === 'PREDECESSOR_CHANGED' &&
    decision.result === null
  ) {
    result = Object.freeze({ outcome: 'conflict', reason: 'PREDECESSOR_CHANGED', result: null });
  } else if (
    decision.outcome === 'refused' &&
    decision.result === null &&
    (decision.reason === 'VERSION_LIMIT' || decision.reason === 'REVISION_LIMIT')
  ) {
    if (
      (decision.reason === 'VERSION_LIMIT' &&
        command.expectedListingVersion !== '9007199254740991') ||
      (decision.reason === 'REVISION_LIMIT' &&
        (command.predecessor.revision !== 2147483647 ||
          command.expectedListingVersion === '9007199254740991'))
    )
      return invalid();
    result = Object.freeze({ outcome: 'refused', reason: decision.reason, result: null });
  } else return invalid();
  return Object.freeze({
    operationId: command.operationId,
    listingId: command.listingId,
    actorId: uuid(value.actorId),
    kind: 'start_revision',
    completedAt,
    request: Object.freeze({
      expectedListingVersion: command.expectedListingVersion,
      predecessor: command.predecessor,
      content: command.content,
    }),
    decision: result,
  });
}

/** Route-bound stored original. Server callers must additionally supply verified actor identity. */
export function validateListingSuccessorSnapshot(
  input: unknown,
  listingId: string,
  operationId: string,
  expectedActorId?: string,
): ListingSuccessorReceipt {
  const value = record(input, [
    'operationId',
    'listingId',
    'actorId',
    'kind',
    'request',
    'completedAt',
    'decision',
  ]);
  const request = record(value.request, ['expectedListingVersion', 'predecessor', 'content']);
  const command = validateListingSuccessorCommand({ ...request, listingId, operationId });
  return validateListingSuccessorReceipt(input, command, expectedActorId);
}
