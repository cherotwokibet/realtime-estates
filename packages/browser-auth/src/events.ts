/** Notifications invalidate cached views; they never convey account authority. */
export type AuthChangeReason = 'signing-out' | 'signed-out' | 'signed-in';
export function authChange(reason: AuthChangeReason) {
  return { type: 'auth-changed' as const, reason };
}
/** Legacy/unknown notifications fail closed. A recheck hint must never unlock a cleared view. */
export function authChangeEffect(value: unknown): 'ignore' | 'block' | 'recheck' {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'ignore';
  const event = value as Record<string, unknown>;
  if (event.type !== 'auth-changed') return 'ignore';
  return Object.keys(event).sort().join(',') === 'reason,type' && event.reason === 'signed-in'
    ? 'recheck'
    : 'block';
}
