'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { flushSync } from 'react-dom';
import { authChangeEffect } from '@realtor/browser-auth/events';
import { createPrivateWorkspaceLease } from '../lib/private-workspace-lease.ts';
import {
  readPrivateWorkspaceLease,
  type PrivateWorkspaceAccess,
} from '../lib/private-workspace-lease-client.ts';

const ClearPrivateWorkspace = createContext<() => void>(() => {});
export const usePrivateWorkspaceClear = () => useContext(ClearPrivateWorkspace);

/** Account notifications only remove private UI; fresh authority requires a new server render. */
export default function PrivateWorkspaceBoundary({
  children,
  access,
}: PropsWithChildren<{ access: PrivateWorkspaceAccess }>) {
  const [phase, setPhase] = useState<'checking' | 'active' | 'closed'>('checking');
  const closed = useRef(false),
    cleanup = useRef<() => void>(() => {});
  const clear = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    cleanup.current();
    setPhase('closed');
  }, []);
  const { profile, instanceId, tenantId, actorId, role } = access;
  useEffect(() => {
    if (closed.current) return;
    const captured = { profile, instanceId, tenantId, actorId, role };
    const lease = createPrivateWorkspaceLease({
      scope: captured,
      read: (signal) => readPrivateWorkspaceLease(captured, signal),
      onReady: () => {
        if (!closed.current) setPhase('active');
      },
      onClose: clear,
      foreground: () => document.visibilityState === 'visible',
    });
    const channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel('realtor-hosted-auth-v1');
    if (channel)
      channel.onmessage = (event) => {
        if (authChangeEffect(event.data) !== 'ignore') flushSync(() => lease.invalidate());
      };
    const hide = () => flushSync(() => lease.invalidate());
    const foreground = () => {
      if (document.visibilityState === 'visible')
        flushSync(() => {
          void lease.refresh();
        });
    };
    window.addEventListener('pagehide', hide);
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    const dispose = () => {
      lease.dispose();
      channel?.close();
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
    cleanup.current = dispose;
    void lease.refresh();
    return () => {
      dispose();
      if (cleanup.current === dispose) cleanup.current = () => {};
    };
  }, [profile, instanceId, tenantId, actorId, role, clear]);
  if (phase === 'checking')
    return (
      <section className="draft-panel" aria-label="Checking private access">
        <p role="status">Checking current private access…</p>
      </section>
    );
  if (phase === 'closed')
    return (
      <section className="draft-panel" aria-label="Private view closed">
        <h2>Private view closed</h2>
        <p role="status">
          Account access changed or this page was left. Reload to check current access before
          opening private content. This screen does not confirm any pending action.
        </p>
        <p>
          Any retained recovery records are unchanged and still need an authorized outcome check.
        </p>
        <button type="button" className="draft-secondary" onClick={() => window.location.reload()}>
          Reload current access
        </button>
      </section>
    );
  return <ClearPrivateWorkspace.Provider value={clear}>{children}</ClearPrivateWorkspace.Provider>;
}
