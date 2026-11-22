import { validateStaffAccessLease, type StaffAccessLease } from '@realtor/domain';
import { createBoundedPrivateLease } from './bounded-private-lease.ts';
export type PrivateLeaseScope = Readonly<{
  tenantId?: string;
  actorId?: string;
  role?: 'agent' | 'admin';
}>;
export interface PrivateLeaseOptions {
  read(signal: AbortSignal): Promise<StaffAccessLease>;
  scope: PrivateLeaseScope;
  onReady(): void;
  onClose(reason: 'expired' | 'access-changed' | 'access-unavailable'): void;
  monotonic?: () => number;
  wallNow?: () => number;
  foreground?: () => boolean;
  schedule?: (fn: () => void, delay: number) => unknown;
  cancel?: (timer: unknown) => void;
}
/** Staff wrapper retains current-role validation around the shared monotonic engine. */
export function createPrivateWorkspaceLease(options: PrivateLeaseOptions) {
  return createBoundedPrivateLease({
    ...options,
    read: (signal) => options.read(signal),
    validate: validateStaffAccessLease,
    matches: (lease) =>
      (options.scope.actorId === undefined || lease.actorId === options.scope.actorId) &&
      (options.scope.tenantId === undefined || lease.tenantId === options.scope.tenantId) &&
      (options.scope.role === undefined || lease.role === options.scope.role),
    fingerprint: (lease) => [lease.tenantId, lease.actorId, lease.role].join(':'),
  });
}
