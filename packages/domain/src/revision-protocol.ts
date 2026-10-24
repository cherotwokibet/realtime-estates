import { DomainError } from './errors.js';

export interface RevisionProtocolTarget {
  readonly listingId: string;
  readonly revision: number;
}
export interface RevisionProtocol extends RevisionProtocolTarget {
  readonly listingVersion: string;
  readonly revisionVersion: string;
  readonly state: 'draft' | 'pending' | 'approved' | 'rejected';
  readonly editable: boolean;
  readonly protocol: 'ordinary-v2' | 'synthetic-reference-v1';
}
function invalid(): never {
  throw new DomainError('INVALID_REVISION_PROTOCOL', 'Revision protocol is unavailable.');
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
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const d = Object.getOwnPropertyDescriptor(input, field);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
    values[field] = d.value;
  }
  return values;
}
function target(row: Record<string, unknown>): RevisionProtocolTarget {
  if (
    typeof row.listingId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      row.listingId,
    ) ||
    typeof row.revision !== 'number' ||
    !Number.isInteger(row.revision) ||
    row.revision < 1 ||
    row.revision > 2147483647
  )
    return invalid();
  return Object.freeze({ listingId: row.listingId, revision: row.revision });
}
function version(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d{0,15}$/.test(value) ||
    BigInt(value) > 9007199254740991n
  )
    return invalid();
  return value;
}
export function validateRevisionProtocolTarget(input: unknown): RevisionProtocolTarget {
  return target(own(input, ['listingId', 'revision']));
}
/** A failed/unknown projection must never imply the ordinary protocol. */
export function validateRevisionProtocol(
  input: unknown,
  expected: RevisionProtocolTarget,
): RevisionProtocol {
  const requested = validateRevisionProtocolTarget(expected);
  const row = own(input, [
    'listingId',
    'revision',
    'listingVersion',
    'revisionVersion',
    'state',
    'editable',
    'protocol',
  ]);
  const current = target(row);
  if (
    current.listingId !== requested.listingId ||
    current.revision !== requested.revision ||
    typeof row.state !== 'string' ||
    !['draft', 'pending', 'approved', 'rejected'].includes(row.state) ||
    typeof row.editable !== 'boolean' ||
    row.editable !== (row.state === 'draft') ||
    (row.protocol !== 'ordinary-v2' && row.protocol !== 'synthetic-reference-v1')
  )
    return invalid();
  return Object.freeze({
    ...current,
    listingVersion: version(row.listingVersion),
    revisionVersion: version(row.revisionVersion),
    state: row.state as RevisionProtocol['state'],
    editable: row.editable,
    protocol: row.protocol,
  });
}
