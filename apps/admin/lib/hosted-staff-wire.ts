import { validateStaffBranchCommand, type StaffBranchCommand } from '@realtor/domain';
export interface HostedStaffSession {
  readonly policy: 'hosted-staff-session-v1';
  readonly account: {
    readonly tenantId: string;
    readonly actorId: string;
    readonly generation: string;
    readonly expiresAt: string;
  };
  readonly csrf: string;
  readonly pending: StaffBranchCommand | null;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function validateHostedStaffSession(
  v: unknown,
  tenantId: string,
  now = Date.now(),
): HostedStaffSession {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).sort().join(',') !== 'account,csrf,pending,policy'
  )
    throw Error('Invalid staff session.');
  const s = v as HostedStaffSession,
    a = s.account;
  if (
    s.policy !== 'hosted-staff-session-v1' ||
    !a ||
    typeof a !== 'object' ||
    Object.keys(a).sort().join(',') !== 'actorId,expiresAt,generation,tenantId' ||
    a.tenantId !== tenantId ||
    !uuid.test(tenantId) ||
    typeof a.actorId !== 'string' ||
    !uuid.test(a.actorId) ||
    typeof a.generation !== 'string' ||
    !/^[0-9a-f]{64}$/.test(a.generation) ||
    typeof s.csrf !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(s.csrf) ||
    typeof a.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(a.expiresAt)) ||
    new Date(a.expiresAt).toISOString() !== a.expiresAt ||
    Date.parse(a.expiresAt) <= now ||
    Date.parse(a.expiresAt) > now + 3600000
  )
    throw Error('Invalid staff session.');
  return Object.freeze({
    policy: s.policy,
    account: Object.freeze({ ...a }),
    csrf: s.csrf,
    pending: s.pending === null ? null : validateStaffBranchCommand(s.pending),
  });
}
