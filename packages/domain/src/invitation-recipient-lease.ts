import {
  validateStaffInvitationRecipientSession,
  type StaffInvitationRecipientSession,
} from './staff-invitation-issuance.js';
/** Identity-only display lifetime. This is never a membership or invitation grant. */
export interface InvitationRecipientLease extends Omit<StaffInvitationRecipientSession, 'policy'> {
  readonly policy: 'invitation-recipient-lease-v1';
  readonly checkedAt: string;
  readonly expiresAt: string;
}
export function validateInvitationRecipientLease(
  input: unknown,
  now = Date.now(),
): InvitationRecipientLease {
  const fail = (): never => {
    throw Error('Fresh recipient identity unavailable.');
  };
  const keys = [
    'policy',
    'tenantId',
    'actorId',
    'recipientEmail',
    'authority',
    'checkedAt',
    'expiresAt',
  ];
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).length !== keys.length
  )
    return fail();
  const row: Record<string, unknown> = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return fail();
    row[key] = d.value;
  }
  if (
    row.policy !== 'invitation-recipient-lease-v1' ||
    typeof row.checkedAt !== 'string' ||
    typeof row.expiresAt !== 'string' ||
    !Number.isSafeInteger(now)
  )
    return fail();
  const checked = Date.parse(row.checkedAt),
    expires = Date.parse(row.expiresAt);
  if (
    !Number.isSafeInteger(checked) ||
    !Number.isSafeInteger(expires) ||
    new Date(checked).toISOString() !== row.checkedAt ||
    new Date(expires).toISOString() !== row.expiresAt ||
    checked > now + 10000 ||
    checked < now - 15000 ||
    expires <= now ||
    expires <= checked ||
    expires - checked > 30000
  )
    return fail();
  const session = validateStaffInvitationRecipientSession({
    policy: 'synthetic-staff-invitation-recipient-session-v1',
    tenantId: row.tenantId,
    actorId: row.actorId,
    recipientEmail: row.recipientEmail,
    authority: row.authority,
  });
  return Object.freeze({
    ...session,
    policy: 'invitation-recipient-lease-v1',
    checkedAt: row.checkedAt,
    expiresAt: row.expiresAt,
  });
}
