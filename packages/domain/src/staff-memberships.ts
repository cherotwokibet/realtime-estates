/** Existing staff administration only. A validated command never creates membership or authority. */
export interface StaffMembershipCommand {
  readonly policy: 'staff-membership-command-v1';
  readonly operationId: string;
  readonly memberId: string;
  readonly expectedVersion: string;
  readonly requestedRole: 'agent' | 'admin';
  readonly active: boolean;
  readonly reason: string;
}
export interface StaffMembershipRecord extends Omit<StaffMembershipCommand, 'policy'> {
  readonly policy: 'staff-membership-record-v1';
  readonly actorId: string;
  readonly version: string;
  readonly outcome: 'applied' | 'unchanged' | 'conflict';
  readonly recordedAt: string;
}
export interface StaffMembershipCurrent {
  readonly policy: 'staff-membership-current-v1';
  readonly memberId: string;
  readonly role: 'agent' | 'admin';
  readonly active: boolean;
  readonly version: string;
  readonly revokedAt: string | null;
}
const invalid = (): never => {
  throw Error('Invalid staff membership data.');
};
function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return invalid();
  const own = Reflect.ownKeys(input);
  if (
    own.length !== keys.length ||
    own.some((key) => typeof key !== 'string' || !keys.includes(key))
  )
    return invalid();
  const values: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return invalid();
    values[key] = descriptor.value;
  }
  return values;
}
const uuid = (value: unknown): string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    ? value
    : invalid();
const version = (value: unknown, maximum = 9007199254740991n): string =>
  typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value) && BigInt(value) <= maximum
    ? value
    : invalid();
const role = (value: unknown): 'agent' | 'admin' =>
  value === 'agent' || value === 'admin' ? value : invalid();
const active = (value: unknown): boolean => (typeof value === 'boolean' ? value : invalid());
const reason = (value: unknown): string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value === value.trim() &&
  value === value.normalize('NFC') &&
  [...value].length <= 500 &&
  !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>\ud800-\udfff]/u.test(value)
    ? value
    : invalid();
const instant = (value: unknown): string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value
    ? value
    : invalid();
const commandKeys = [
  'operationId',
  'memberId',
  'expectedVersion',
  'requestedRole',
  'active',
  'reason',
] as const;
export function validateStaffMembershipCommand(input: unknown): StaffMembershipCommand {
  const values = record(input, ['policy', ...commandKeys]);
  if (values.policy !== 'staff-membership-command-v1') return invalid();
  return Object.freeze({
    policy: 'staff-membership-command-v1',
    operationId: uuid(values.operationId),
    memberId: uuid(values.memberId),
    expectedVersion: version(values.expectedVersion, 9007199254740990n),
    requestedRole: role(values.requestedRole),
    active: active(values.active),
    reason: reason(values.reason),
  });
}
/** A private original receipt binds the exact submitted facts, current actor and outcome arithmetic. */
export function validateStaffMembershipRecord(
  input: unknown,
  command?: StaffMembershipCommand,
  actorId?: string,
): StaffMembershipRecord {
  const values = record(input, [
    'policy',
    ...commandKeys,
    'actorId',
    'version',
    'outcome',
    'recordedAt',
  ]);
  if (
    values.policy !== 'staff-membership-record-v1' ||
    !['applied', 'unchanged', 'conflict'].includes(values.outcome as string)
  )
    return invalid();
  const facts = validateStaffMembershipCommand({
    policy: 'staff-membership-command-v1',
    operationId: values.operationId,
    memberId: values.memberId,
    expectedVersion: values.expectedVersion,
    requestedRole: values.requestedRole,
    active: values.active,
    reason: values.reason,
  });
  const observed = version(values.version),
    expected = BigInt(facts.expectedVersion),
    actual = BigInt(observed),
    actor = uuid(values.actorId);
  if (
    actor === facts.memberId ||
    (values.outcome === 'applied' && actual !== expected + 1n) ||
    (values.outcome === 'unchanged' && actual !== expected) ||
    (values.outcome === 'conflict' && actual === expected)
  )
    return invalid();
  if (command !== undefined) {
    const wanted = validateStaffMembershipCommand(command);
    for (const key of commandKeys) if (facts[key] !== wanted[key]) return invalid();
  }
  if (actorId !== undefined && actor !== uuid(actorId)) return invalid();
  return Object.freeze({
    ...facts,
    policy: 'staff-membership-record-v1',
    actorId: actor,
    version: observed,
    outcome: values.outcome as StaffMembershipRecord['outcome'],
    recordedAt: instant(values.recordedAt),
  });
}
/** Current projection deliberately omits private operation, actor and reason fields. */
export function validateStaffMembershipCurrent(
  input: unknown,
  memberId?: string,
): StaffMembershipCurrent {
  const values = record(input, ['policy', 'memberId', 'role', 'active', 'version', 'revokedAt']);
  if (values.policy !== 'staff-membership-current-v1') return invalid();
  const member = uuid(values.memberId);
  if (memberId !== undefined && member !== uuid(memberId)) return invalid();
  const isActive = active(values.active);
  if (isActive && values.revokedAt !== null) return invalid();
  const revokedAt = isActive ? null : instant(values.revokedAt);
  return Object.freeze({
    policy: 'staff-membership-current-v1',
    memberId: member,
    role: role(values.role),
    active: isActive,
    version: version(values.version),
    revokedAt,
  });
}
