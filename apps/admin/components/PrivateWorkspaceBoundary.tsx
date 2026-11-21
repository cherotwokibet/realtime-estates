'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';
import { flushSync } from 'react-dom';
import { createPrivateWorkspaceGuard } from '../lib/private-workspace-guard.ts';

const ClearPrivateWorkspace = createContext<() => void>(() => {});
export const usePrivateWorkspaceClear = () => useContext(ClearPrivateWorkspace);

/** Account notifications only remove private UI; fresh authority requires a new server render. */
export default function PrivateWorkspaceBoundary({ children }: PropsWithChildren) {
  const [cleared, setCleared] = useState(false);
  const clear = useCallback(() => setCleared(true), []);
  useEffect(() => {
    if (cleared) return;
    const guard = createPrivateWorkspaceGuard(clear);
    const channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel('realtor-hosted-auth-v1');
    if (channel) channel.onmessage = (event) => flushSync(() => guard.observe(event.data));
    // Commit child teardown before a browser can freeze this page for history restoration.
    const hide = () => flushSync(() => guard.invalidate());
    window.addEventListener('pagehide', hide);
    return () => {
      guard.dispose();
      channel?.close();
      window.removeEventListener('pagehide', hide);
    };
  }, [cleared, clear]);
  if (cleared)
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
