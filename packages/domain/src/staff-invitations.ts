/** Staff invitation intent only. Validation grants no role, membership, delivery or token. */
export interface StaffInvitationIntent {
  readonly policy: 'staff-invitation-intent-v1';
  readonly operationId: string;
  readonly recipientEmail: string;
  readonly requestedRole: 'agent' | 'admin';
  readonly branchId: string | null;
  readonly expiresAfterHours: 24 | 72 | 168;
}
const invalid = (): never => {
  throw Error('Invalid staff invitation intent.');
};
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
/** ASCII delivery-address subset, canonical lower case; no display names, quoted local parts or implicit IDN conversion. */
export function validateStaffInvitationEmail(value: unknown): string {
  if (typeof value !== 'string' || value.length > 254 || value !== value.toLowerCase())
    return invalid();
  const parts = value.split('@');
  if (parts.length !== 2) return invalid();
  const local = parts[0]!,
    domain = parts[1]!;
  if (
    !local ||
    local.length > 64 ||
    !/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local) ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..')
  )
    return invalid();
  const labels = domain.split('.');
  if (
    labels.length < 2 ||
    labels.some((label) => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  )
    return invalid();
  return value;
}
export function validateStaffInvitationIntent(input: unknown): StaffInvitationIntent {
  const keys = [
    'policy',
    'operationId',
    'recipientEmail',
    'requestedRole',
    'branchId',
    'expiresAfterHours',
  ];
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return invalid();
  const own = Reflect.ownKeys(input);
  if (own.length !== keys.length || own.some((k) => typeof k !== 'string' || !keys.includes(k)))
    return invalid();
  const fields: Record<string, unknown> = Object.create(null);
  for (const k of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, k);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return invalid();
    fields[k] = descriptor.value;
  }
  if (
    fields.policy !== 'staff-invitation-intent-v1' ||
    !uuid(fields.operationId) ||
    !['agent', 'admin'].includes(fields.requestedRole as string) ||
    (fields.branchId !== null && !uuid(fields.branchId)) ||
    ![24, 72, 168].includes(fields.expiresAfterHours as number)
  )
    return invalid();
  // An admin request is company-wide; do not imply branch-limited admin authority.
  if (fields.requestedRole === 'admin' && fields.branchId !== null) return invalid();
  return Object.freeze({
    policy: 'staff-invitation-intent-v1',
    operationId: fields.operationId,
    recipientEmail: validateStaffInvitationEmail(fields.recipientEmail),
    requestedRole: fields.requestedRole as 'agent' | 'admin',
    branchId: fields.branchId as string | null,
    expiresAfterHours: fields.expiresAfterHours as 24 | 72 | 168,
  });
}
