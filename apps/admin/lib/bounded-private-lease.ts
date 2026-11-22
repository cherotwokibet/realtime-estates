import { createPrivateWorkspaceGuard } from './private-workspace-guard.ts';
export interface BoundedPrivateLeaseOptions<T extends { checkedAt: string; expiresAt: string }> {
  read(signal: AbortSignal): Promise<T>;
  validate(value: unknown, now: number): T;
  matches(value: T): boolean;
  fingerprint(value: T): string;
  onReady(): void;
  onClose(reason: 'expired' | 'access-changed' | 'access-unavailable'): void;
  monotonic?: () => number;
  wallNow?: () => number;
  foreground?: () => boolean;
  schedule?: (fn: () => void, delay: number) => unknown;
  cancel?: (timer: unknown) => void;
}
export function createBoundedPrivateLease<T extends { checkedAt: string; expiresAt: string }>(
  options: BoundedPrivateLeaseOptions<T>,
) {
  const clock = options.monotonic ?? (() => performance.now());
  const schedule = options.schedule ?? ((fn, delay) => setTimeout(fn, delay));
  const cancel =
    options.cancel ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let closed = false,
    ready = false,
    pending = false,
    lastTime = -Infinity;
  let deadline: number | null = null,
    fingerprint: string | null = null,
    checkedAt = -Infinity;
  let expiryTimer: unknown, renewTimer: unknown, probeTimer: unknown;
  function now() {
    const value = clock();
    if (!Number.isFinite(value) || value < 0 || value < lastTime)
      throw Error('Unavailable monotonic clock.');
    lastTime = value;
    return value;
  }
  function clearTimers() {
    for (const timer of [expiryTimer, renewTimer, probeTimer])
      if (timer !== undefined) cancel(timer);
    expiryTimer = renewTimer = probeTimer = undefined;
  }
  function close(reason: 'expired' | 'access-changed' | 'access-unavailable', notify = true) {
    if (closed) return;
    closed = true;
    clearTimers();
    guard.dispose();
    if (notify) options.onClose(reason);
  }
  const guard = createPrivateWorkspaceGuard(() => close('access-changed'));
  async function refresh() {
    if (closed) return;
    let started: number;
    try {
      started = now();
      if (deadline !== null && started >= deadline) {
        close('expired');
        return;
      }
    } catch {
      close('access-unavailable');
      return;
    }
    if (pending) return;
    pending = true;
    probeTimer = schedule(() => close('access-unavailable'), 5000);
    try {
      const lease = options.validate(
        await guard.run(options.read),
        options.wallNow?.() ?? Date.now(),
      );
      if (closed) return;
      const received = now();
      if (deadline !== null && received >= deadline) {
        close('expired');
        return;
      }
      if (!options.matches(lease)) {
        close('access-changed');
        return;
      }
      const current = options.fingerprint(lease);
      if (fingerprint !== null && current !== fingerprint) {
        close('access-changed');
        return;
      }
      const issued = Date.parse(lease.checkedAt);
      if (issued <= checkedAt) {
        close('access-unavailable');
        return;
      }
      const candidate = started + Date.parse(lease.expiresAt) - issued;
      if (candidate <= received) {
        close('expired');
        return;
      }
      clearTimers();
      deadline = candidate;
      checkedAt = issued;
      fingerprint = current;
      const remaining = deadline - received;
      const expire = () => {
        if (closed) return;
        try {
          const left = deadline! - now();
          if (left <= 0) close('expired');
          else expiryTimer = schedule(expire, left);
        } catch {
          close('access-unavailable');
        }
      };
      expiryTimer = schedule(expire, remaining);
      if (remaining > 1000)
        renewTimer = schedule(() => {
          if (options.foreground?.() ?? true) void refresh();
        }, remaining / 2);
      if (!ready) {
        ready = true;
        options.onReady();
      }
    } catch {
      if (!closed) close('access-unavailable');
    } finally {
      pending = false;
      if (probeTimer !== undefined) {
        cancel(probeTimer);
        probeTimer = undefined;
      }
    }
  }
  return {
    refresh,
    invalidate: () => close('access-changed'),
    dispose: () => close('access-changed', false),
    get closed() {
      return closed;
    },
    get active() {
      return ready && !closed;
    },
  };
}
