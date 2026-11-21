'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  captureRecoveryScope,
  recoveryCommand,
  type RecoveryScope,
  type RecoveryKind,
  type RecoveryCommand,
} from './private-recovery-contract.ts';
import { createPrivateRecoveryClient } from './private-recovery-client.ts';
import { createSealedRecoveryStore } from './private-recovery-store.ts';
import { createPrivateWorkspaceGuard } from './private-workspace-guard.ts';
import { usePrivateWorkspaceClear } from '../components/PrivateWorkspaceBoundary.tsx';
type Resource = {
  store: ReturnType<typeof createSealedRecoveryStore>;
  guard: ReturnType<typeof createPrivateWorkspaceGuard>;
  ready: boolean;
  busy: boolean;
  command: RecoveryCommand | null;
  abort: AbortController | null;
};
/** One live scope; retaining/readback precedes mutation, and only an exact receipt may release it. */
export function useSealedRecovery(inputScope: RecoveryScope, kind: RecoveryKind) {
  const scope = captureRecoveryScope(inputScope),
    clear = usePrivateWorkspaceClear(),
    current = useRef<Resource | null>(null);
  const [ready, setReady] = useState(false),
    [pending, setPending] = useState<RecoveryCommand | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('Checking encrypted recovery…'),
    [reload, setReload] = useState(0);
  useEffect(() => {
    setReady(false);
    setPending(null);
    setBusy(false);
    setError('Checking encrypted recovery…');
    const codec = createPrivateRecoveryClient(scope, kind),
      guard = createPrivateWorkspaceGuard(clear);
    let store: ReturnType<typeof createSealedRecoveryStore>;
    try {
      store = createSealedRecoveryStore(window.sessionStorage, scope, kind, codec, clear);
    } catch {
      setError('Encrypted storage is unavailable. No new write can start.');
      guard.dispose();
      return;
    }
    const r: Resource = {
      store,
      guard,
      ready: false,
      busy: false,
      command: null,
      abort: null,
    };
    current.current = r;
    void guard
      .run(async (signal) => {
        await codec.check(signal);
        const command = await r.store.load(signal);
        if (current.current !== r || signal.aborted) return;
        r.command = command;
        r.ready = true;
        setPending(command);
        setReady(true);
        setError(command ? 'A retained original needs an authorized outcome check.' : '');
      })
      .catch(() => {
        if (current.current === r)
          setError(
            'Encrypted recovery is unavailable. No new write can start. Retry recovery after restoring access/configuration.',
          );
      });
    return () => {
      if (current.current === r) current.current = null;
      r.abort?.abort();
      guard.dispose();
      r.store.dispose();
    };
  }, [scope.instanceId, scope.tenantId, scope.actorId, kind, clear, reload]);
  const read = useCallback(async <T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const r = current.current;
    if (!r?.ready || r.busy) throw Error('Recovery is not ready.');
    r.busy = true;
    r.abort = new AbortController();
    setBusy(true);
    try {
      return await r.guard.run((signal) => task(AbortSignal.any([signal, r.abort!.signal])));
    } finally {
      r.busy = false;
      r.abort = null;
      if (current.current === r) setBusy(false);
    }
  }, []);
  const execute = useCallback(
    async (
      input: unknown,
      task: (command: RecoveryCommand, signal: AbortSignal) => Promise<unknown>,
    ) => {
      const r = current.current,
        command = recoveryCommand(kind, input);
      if (
        !r?.ready ||
        r.busy ||
        (r.command && JSON.stringify(r.command) !== JSON.stringify(command))
      )
        throw Error('Retain and recover the current original first.');
      r.busy = true;
      r.abort = new AbortController();
      setBusy(true);
      let retained = false;
      try {
        return await r.guard.run(async (owned) => {
          const signal = AbortSignal.any([owned, r.abort!.signal]);
          await r.store.retain(command, signal);
          if (current.current !== r || signal.aborted) throw Error('Recovery cancelled.');
          retained = true;
          r.command = command;
          setPending(command);
          const receipt = await task(command, signal);
          if (current.current !== r || signal.aborted) throw Error('Recovery cancelled.');
          const confirmed = await r.store.releaseConfirmed(command, receipt, signal);
          if (current.current !== r || signal.aborted) throw Error('Recovery cancelled.');
          r.command = null;
          setPending(null);
          setError('');
          return confirmed;
        });
      } catch (error) {
        if (current.current === r) {
          if (!retained) {
            r.ready = false;
            setReady(false);
            setError(
              'Recovery preparation failed; no mutation was sent. Retry recovery before another write.',
            );
          } else
            setError(
              'The original remains encrypted and retained. No replacement or automatic retry was made.',
            );
        }
        throw error;
      } finally {
        r.busy = false;
        r.abort = null;
        if (current.current === r) setBusy(false);
      }
    },
    [kind],
  );
  return {
    ready,
    pending,
    busy,
    error,
    read,
    execute,
    resolve: (input: unknown) =>
      execute(input, (command, signal) =>
        createPrivateRecoveryClient(scope, kind).resolve(command, signal),
      ),
    cancel: () => current.current?.abort?.abort(),
    retry: () => setReload((n) => n + 1),
  };
}
