import { parseStaffInvitationJson } from './staff-invitation-records.js';

/** Retain these commands, never an issuance disclosure or a submitted raw secret. */
export interface StaffInvitationIssueCommand {
  readonly policy: 'staff-invitation-issue-command-v1';
  readonly operationId: string;
  readonly invitationId: string;
}
export interface StaffInvitationRedemptionCommand {
  readonly policy: 'staff-invitation-redemption-command-v1';
  readonly operationId: string;
  readonly invitationId: string;
}
export interface StaffInvitationIssueRecord {
  readonly policy: 'staff-invitation-issuance-record-v1';
  readonly operationId: string;
  readonly invitationId: string;
  readonly actorId: string;
  readonly recordedAt: string;
  readonly expiresAt: string;
  readonly secretRecovery: 'revoke_and_replace';
  readonly delivery: 'not_attempted';
  readonly membershipGranted: false;
}
export interface StaffInvitationRedemptionRecord {
  readonly policy: 'staff-invitation-redemption-record-v1';
  readonly operationId: string;
  readonly invitationId: string;
  readonly memberId: string;
  readonly requestedRole: 'agent' | 'admin';
  readonly branchId: string | null;
  readonly recordedAt: string;
  readonly membershipGranted: true;
}
export interface StaffIssuedInvitationState {
  readonly policy: 'staff-issued-invitation-state-v1';
  readonly operationId: string;
  readonly invitationId: string;
  readonly recordedAt: string;
  readonly expiresAt: string;
  readonly state: 'issued' | 'used' | 'revoked' | 'expired';
}
/** Sensitive, ephemeral transport result. Never put this in a retained-operation store. */
export interface StaffInvitationIssueResponse {
  readonly policy: 'staff-invitation-issue-response-v1';
  readonly record: StaffInvitationIssueRecord;
  readonly secret: string | null;
}
const invalid = (): never => {
  throw Error('Invalid single-use staff invitation facts.');
};
function own(value: unknown, fields: readonly string[]): Record<string, unknown> {
  try {
    if (
      !value ||
      typeof value !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      return invalid();
    const keys = Reflect.ownKeys(value),
      result: Record<string, unknown> = Object.create(null);
    if (
      keys.length !== fields.length ||
      keys.some((key) => typeof key !== 'string' || !fields.includes(key))
    )
      return invalid();
    for (const key of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return invalid();
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return invalid();
  }
}
const uuid = (value: unknown): string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    ? value
    : invalid();
const instant = (value: unknown): string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value
    ? value
    : invalid();
/** Canonical 32 decoded bytes (last base64url symbol has two zero padding bits). No crypto/Node dependency. */
export const validateStaffInvitationRawSecret = (value: unknown): string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value)
    ? value
    : invalid();
export function validateStaffInvitationIssueCommand(value: unknown): StaffInvitationIssueCommand {
  const row = own(value, ['policy', 'operationId', 'invitationId']);
  if (row.policy !== 'staff-invitation-issue-command-v1') return invalid();
  return Object.freeze({
    policy: row.policy,
    operationId: uuid(row.operationId),
    invitationId: uuid(row.invitationId),
  });
}
export function validateStaffInvitationRedemptionCommand(
  value: unknown,
): StaffInvitationRedemptionCommand {
  const row = own(value, ['policy', 'operationId', 'invitationId']);
  if (row.policy !== 'staff-invitation-redemption-command-v1') return invalid();
  return Object.freeze({
    policy: row.policy,
    operationId: uuid(row.operationId),
    invitationId: uuid(row.invitationId),
  });
}
export function validateStaffInvitationIssueRecord(
  value: unknown,
  operationId: unknown,
  invitationId: unknown,
  actorId?: unknown,
): StaffInvitationIssueRecord {
  const row = own(value, [
    'policy',
    'operationId',
    'invitationId',
    'actorId',
    'recordedAt',
    'expiresAt',
    'secretRecovery',
    'delivery',
    'membershipGranted',
  ]);
  const operation = uuid(operationId),
    invitation = uuid(invitationId),
    actor = uuid(row.actorId),
    recordedAt = instant(row.recordedAt),
    expiresAt = instant(row.expiresAt);
  if (
    row.policy !== 'staff-invitation-issuance-record-v1' ||
    row.operationId !== operation ||
    row.invitationId !== invitation ||
    (actorId !== undefined && actor !== uuid(actorId)) ||
    row.secretRecovery !== 'revoke_and_replace' ||
    row.delivery !== 'not_attempted' ||
    row.membershipGranted !== false ||
    Date.parse(expiresAt) <= Date.parse(recordedAt) ||
    Date.parse(expiresAt) - Date.parse(recordedAt) > 168 * 3600000
  )
    return invalid();
  return Object.freeze({
    policy: row.policy,
    operationId: operation,
    invitationId: invitation,
    actorId: actor,
    recordedAt,
    expiresAt,
    secretRecovery: row.secretRecovery,
    delivery: row.delivery,
    membershipGranted: false,
  });
}
export function validateStaffInvitationRedemptionRecord(
  value: unknown,
  operationId: unknown,
  invitationId: unknown,
  memberId?: unknown,
): StaffInvitationRedemptionRecord {
  const row = own(value, [
    'policy',
    'operationId',
    'invitationId',
    'memberId',
    'requestedRole',
    'branchId',
    'recordedAt',
    'membershipGranted',
  ]);
  const operation = uuid(operationId),
    invitation = uuid(invitationId),
    member = uuid(row.memberId);
  if (
    row.policy !== 'staff-invitation-redemption-record-v1' ||
    row.operationId !== operation ||
    row.invitationId !== invitation ||
    (memberId !== undefined && member !== uuid(memberId)) ||
    !['agent', 'admin'].includes(row.requestedRole as string) ||
    row.membershipGranted !== true ||
    (row.requestedRole === 'admin' && row.branchId !== null)
  )
    return invalid();
  return Object.freeze({
    policy: row.policy,
    operationId: operation,
    invitationId: invitation,
    memberId: member,
    requestedRole: row.requestedRole as 'agent' | 'admin',
    branchId: row.branchId === null ? null : uuid(row.branchId),
    recordedAt: instant(row.recordedAt),
    membershipGranted: true,
  });
}
export function validateStaffIssuedInvitationState(
  value: unknown,
  operationId: unknown,
  invitationId: unknown,
): StaffIssuedInvitationState {
  const row = own(value, [
    'policy',
    'operationId',
    'invitationId',
    'recordedAt',
    'expiresAt',
    'state',
  ]);
  const operation = uuid(operationId),
    invitation = uuid(invitationId),
    recordedAt = instant(row.recordedAt),
    expiresAt = instant(row.expiresAt);
  if (
    row.policy !== 'staff-issued-invitation-state-v1' ||
    row.operationId !== operation ||
    row.invitationId !== invitation ||
    !['issued', 'used', 'revoked', 'expired'].includes(row.state as string) ||
    Date.parse(expiresAt) <= Date.parse(recordedAt) ||
    Date.parse(expiresAt) - Date.parse(recordedAt) > 168 * 3600000
  )
    return invalid();
  return Object.freeze({
    policy: row.policy,
    operationId: operation,
    invitationId: invitation,
    recordedAt,
    expiresAt,
    state: row.state as StaffIssuedInvitationState['state'],
  });
}
export function validateStaffInvitationIssueResponse(
  value: unknown,
  operationId: unknown,
  invitationId: unknown,
  actorId?: unknown,
): StaffInvitationIssueResponse {
  const row = own(value, ['policy', 'record', 'secret']);
  if (row.policy !== 'staff-invitation-issue-response-v1') return invalid();
  return Object.freeze({
    policy: row.policy,
    record: validateStaffInvitationIssueRecord(row.record, operationId, invitationId, actorId),
    secret: row.secret === null ? null : validateStaffInvitationRawSecret(row.secret),
  });
}
export function parseStaffIssuedInvitationJson(value: string): unknown {
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > 8192)
    return invalid();
  return parseStaffInvitationJson(value);
}
