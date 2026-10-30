import {
  validateStaffInvitationIntent,
  validateStaffInvitationEmail,
  type StaffInvitationIntent,
} from './staff-invitations.js';
export interface StaffInvitationRequestRecord {
  readonly policy: 'staff-invitation-request-record-v1';
  readonly operationId: string;
  readonly actorId: string;
  readonly recipientEmail: string;
  readonly requestedRole: 'agent' | 'admin';
  readonly expiresAfterHours: 24 | 72 | 168;
  readonly branch: Readonly<{ branchId: string; version: string; name: string }> | null;
  readonly recordedAt: string;
  readonly expiresAt: string;
  readonly status: 'recorded';
  readonly delivery: 'not_attempted';
  readonly membershipGranted: false;
}
export type StaffInvitationState = Omit<StaffInvitationRequestRecord, 'policy' | 'actorId'> &
  Readonly<{
    policy: 'staff-invitation-state-v1';
    version: '1' | '2';
    state: 'pending' | 'revoked' | 'expired';
  }>;
export interface StaffInvitationRevocationCommand {
  readonly policy: 'staff-invitation-revocation-command-v1';
  readonly operationId: string;
  readonly invitationId: string;
  readonly expectedVersion: string;
  readonly reason: string;
}
export interface StaffInvitationRevocationRecord {
  readonly policy: 'staff-invitation-revocation-record-v1';
  readonly operationId: string;
  readonly invitationId: string;
  readonly actorId: string;
  readonly expectedVersion: string;
  readonly version: '1' | '2';
  readonly reason: string;
  readonly outcome: 'revoked' | 'already_revoked' | 'expired' | 'conflict';
  readonly recordedAt: string;
}
const invalid = (): never => {
  throw Error('Invalid staff invitation response.');
};
function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return invalid();
  const own = Reflect.ownKeys(input);
  if (own.length !== keys.length || own.some((k) => typeof k !== 'string' || !keys.includes(k)))
    return invalid();
  const out: Record<string, unknown> = Object.create(null);
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(input, k);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
    out[k] = d.value;
  }
  return out;
}
const uuid = (v: unknown): string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)
    ? v
    : invalid();
const version = (v: unknown, max = 9007199254740991n): string =>
  typeof v === 'string' && /^[1-9]\d{0,15}$/.test(v) && BigInt(v) <= max ? v : invalid();
const plain = (v: unknown, max: number): string =>
  typeof v === 'string' &&
  v.length > 0 &&
  v === v.trim() &&
  v === v.normalize('NFC') &&
  [...v].length <= max &&
  !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>\ud800-\udfff]/u.test(v)
    ? v
    : invalid();
const instant = (v: unknown): string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v
    ? v
    : invalid();
const requestKeys = [
  'operationId',
  'recipientEmail',
  'requestedRole',
  'expiresAfterHours',
  'branch',
  'recordedAt',
  'expiresAt',
  'status',
  'delivery',
  'membershipGranted',
];
function requestFacts(
  r: Record<string, unknown>,
): Omit<StaffInvitationRequestRecord, 'policy' | 'actorId'> {
  if (
    !['agent', 'admin'].includes(r.requestedRole as string) ||
    ![24, 72, 168].includes(r.expiresAfterHours as number) ||
    r.status !== 'recorded' ||
    r.delivery !== 'not_attempted' ||
    r.membershipGranted !== false
  )
    return invalid();
  let branch: StaffInvitationRequestRecord['branch'] = null;
  if (r.branch !== null) {
    const b = record(r.branch, ['branchId', 'version', 'name']);
    branch = Object.freeze({
      branchId: uuid(b.branchId),
      version: version(b.version),
      name: plain(b.name, 160),
    });
  }
  if (r.requestedRole === 'admin' && branch !== null) return invalid();
  const recordedAt = instant(r.recordedAt),
    expiresAt = instant(r.expiresAt);
  if (Date.parse(expiresAt) - Date.parse(recordedAt) !== (r.expiresAfterHours as number) * 3600000)
    return invalid();
  return {
    operationId: uuid(r.operationId),
    recipientEmail: validateStaffInvitationEmail(r.recipientEmail),
    requestedRole: r.requestedRole as 'agent' | 'admin',
    expiresAfterHours: r.expiresAfterHours as 24 | 72 | 168,
    branch,
    recordedAt,
    expiresAt,
    status: 'recorded',
    delivery: 'not_attempted',
    membershipGranted: false,
  };
}
/** Historical capture receipt only: no sent message, redeemable secret or role grant can be asserted. */
export function validateStaffInvitationRequestRecord(
  input: unknown,
  intent?: StaffInvitationIntent,
  actorId?: string,
): StaffInvitationRequestRecord {
  const r = record(input, ['policy', 'actorId', ...requestKeys]);
  if (r.policy !== 'staff-invitation-request-record-v1') return invalid();
  const v = Object.freeze({
    policy: 'staff-invitation-request-record-v1' as const,
    actorId: uuid(r.actorId),
    ...requestFacts(r),
  });
  if (actorId !== undefined && v.actorId !== uuid(actorId)) return invalid();
  if (intent !== undefined) {
    const c = validateStaffInvitationIntent(intent);
    if (
      c.operationId !== v.operationId ||
      c.recipientEmail !== v.recipientEmail ||
      c.requestedRole !== v.requestedRole ||
      c.branchId !== (v.branch?.branchId ?? null) ||
      c.expiresAfterHours !== v.expiresAfterHours
    )
      return invalid();
  }
  return v;
}
/** State is descriptive server data; it neither authenticates a recipient nor uses the client clock. */
export function validateStaffInvitationState(
  input: unknown,
  invitationId?: string,
): StaffInvitationState {
  const r = record(input, ['policy', 'version', 'state', ...requestKeys]);
  if (
    r.policy !== 'staff-invitation-state-v1' ||
    !['pending', 'revoked', 'expired'].includes(r.state as string) ||
    r.version !== (r.state === 'revoked' ? '2' : '1')
  )
    return invalid();
  const v = Object.freeze({
    policy: 'staff-invitation-state-v1' as const,
    version: r.version as '1' | '2',
    state: r.state as 'pending' | 'revoked' | 'expired',
    ...requestFacts(r),
  });
  if (invitationId !== undefined && v.operationId !== uuid(invitationId)) return invalid();
  return v;
}
export function validateStaffInvitationRevocationCommand(
  input: unknown,
): StaffInvitationRevocationCommand {
  const r = record(input, ['policy', 'operationId', 'invitationId', 'expectedVersion', 'reason']);
  if (r.policy !== 'staff-invitation-revocation-command-v1') return invalid();
  return Object.freeze({
    policy: 'staff-invitation-revocation-command-v1',
    operationId: uuid(r.operationId),
    invitationId: uuid(r.invitationId),
    expectedVersion: version(r.expectedVersion, 9007199254740990n),
    reason: plain(r.reason, 500),
  });
}
export function validateStaffInvitationRevocationRecord(
  input: unknown,
  command?: StaffInvitationRevocationCommand,
  actorId?: string,
): StaffInvitationRevocationRecord {
  const r = record(input, [
    'policy',
    'operationId',
    'invitationId',
    'actorId',
    'expectedVersion',
    'version',
    'reason',
    'outcome',
    'recordedAt',
  ]);
  if (
    r.policy !== 'staff-invitation-revocation-record-v1' ||
    !['1', '2'].includes(r.version as string) ||
    !['revoked', 'already_revoked', 'expired', 'conflict'].includes(r.outcome as string)
  )
    return invalid();
  const expectedVersion = version(r.expectedVersion, 9007199254740990n);
  if (
    (r.outcome === 'revoked' && (r.version !== '2' || expectedVersion !== '1')) ||
    (r.outcome === 'already_revoked' && (r.version !== '2' || expectedVersion !== '2')) ||
    (r.outcome === 'expired' && (r.version !== '1' || expectedVersion !== '1')) ||
    (r.outcome === 'conflict' && r.version === expectedVersion)
  )
    return invalid();
  const v = Object.freeze({
    policy: 'staff-invitation-revocation-record-v1' as const,
    operationId: uuid(r.operationId),
    invitationId: uuid(r.invitationId),
    actorId: uuid(r.actorId),
    expectedVersion,
    version: r.version as '1' | '2',
    reason: plain(r.reason, 500),
    outcome: r.outcome as StaffInvitationRevocationRecord['outcome'],
    recordedAt: instant(r.recordedAt),
  });
  if (actorId !== undefined && v.actorId !== uuid(actorId)) return invalid();
  if (command !== undefined) {
    const c = validateStaffInvitationRevocationCommand(command);
    if (
      c.operationId !== v.operationId ||
      c.invitationId !== v.invitationId ||
      c.expectedVersion !== v.expectedVersion ||
      c.reason !== v.reason
    )
      return invalid();
  }
  return v;
}
/**64KiB JSON, exact duplicate keys including escapes, and literal integer expiry hours. Validate wire shapes after parsing. */
export function parseStaffInvitationJson(source: string): unknown {
  if (typeof source !== 'string' || new TextEncoder().encode(source).byteLength > 65536)
    return invalid();
  const parsed: unknown = JSON.parse(source),
    stack: (Set<string> | null)[] = [];
  const tokens =
    source.match(
      /"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g,
    ) ?? [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === '{') stack.push(new Set());
    else if (t === '[') stack.push(null);
    else if (t === '}' || t === ']') stack.pop();
    else if (t.startsWith('"') && tokens[i + 1] === ':') {
      const key = JSON.parse(t) as string,
        keys = stack.at(-1);
      if (!keys || keys.has(key)) return invalid();
      keys.add(key);
      if (key === 'expiresAfterHours' && !/^(24|72|168)$/.test(tokens[i + 2] ?? ''))
        return invalid();
    }
  }
  return parsed;
}
