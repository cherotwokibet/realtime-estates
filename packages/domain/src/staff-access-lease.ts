/** A bounded server-checked read lease. This metadata never grants API permissions. */
export interface StaffAccessLease {
  readonly policy: 'staff-access-lease-v1';
  readonly tenantId: string;
  readonly actorId: string;
  readonly role: 'agent' | 'admin';
  readonly checkedAt: string;
  readonly expiresAt: string;
}
export const STAFF_ACCESS_LEASE_MAX_MS = 30_000;
export function validateStaffAccessLease(input: unknown, now = Date.now()): StaffAccessLease {
  const fail = (): never => {
    throw new Error('Fresh staff access is unavailable.');
  };
  const keys = ['policy', 'tenantId', 'actorId', 'role', 'checkedAt', 'expiresAt'];
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return fail();
  if (Reflect.ownKeys(input).length !== keys.length) return fail();
  const row: Record<string, unknown> = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return fail();
    row[key] = d.value;
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (
    row.policy !== 'staff-access-lease-v1' ||
    typeof row.tenantId !== 'string' ||
    !uuid.test(row.tenantId) ||
    typeof row.actorId !== 'string' ||
    !uuid.test(row.actorId) ||
    !['agent', 'admin'].includes(row.role as string) ||
    !Number.isSafeInteger(now)
  )
    return fail();
  if (typeof row.checkedAt !== 'string' || typeof row.expiresAt !== 'string') return fail();
  const checked = Date.parse(row.checkedAt),
    expires = Date.parse(row.expiresAt);
  if (
    !Number.isSafeInteger(checked) ||
    !Number.isSafeInteger(expires) ||
    new Date(checked).toISOString() !== row.checkedAt ||
    new Date(expires).toISOString() !== row.expiresAt ||
    checked > now + 10_000 ||
    checked < now - 15_000 ||
    expires <= now ||
    expires <= checked ||
    expires - checked > STAFF_ACCESS_LEASE_MAX_MS
  )
    return fail();
  return Object.freeze({
    policy: 'staff-access-lease-v1',
    tenantId: row.tenantId,
    actorId: row.actorId,
    role: row.role as 'agent' | 'admin',
    checkedAt: row.checkedAt,
    expiresAt: row.expiresAt,
  });
}
