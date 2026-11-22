'use client';
import { useEffect, useRef, useState } from 'react';
import { usePrivateWorkspaceClear } from '../components/PrivateWorkspaceBoundary.tsx';
import { createPrivateWorkspaceGuard } from './private-workspace-guard.ts';
import type { RecoveryScope } from './private-recovery-contract.ts';
import type { AdminAuditQuery } from '@realtor/domain';
import { readPrivateSummary } from './private-summary-client.ts';
/** A disposed lifetime cannot repopulate cleared rows, including an uncooperative late transport. */
export function usePrivateSummary(
  scope: RecoveryScope,
  kind: 'audit' | 'push',
  query?: AdminAuditQuery,
) {
  const clear = usePrivateWorkspaceClear();
  const active = useRef<ReturnType<typeof createPrivateWorkspaceGuard> | null>(null);
  const flight = useRef<AbortController | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<typeof readPrivateSummary>> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const guard = createPrivateWorkspaceGuard(clear);
    active.current = guard;
    setData(null);
    setBusy(false);
    setError('');
    return () => {
      if (active.current === guard) active.current = null;
      flight.current?.abort();
      flight.current = null;
      guard.dispose();
    };
  }, [
    clear,
    scope.instanceId,
    scope.tenantId,
    scope.actorId,
    kind,
    query?.limit,
    query?.before,
    query?.actorId,
    query?.objectId,
  ]);
  async function refresh() {
    const guard = active.current;
    if (!guard || flight.current) return;
    const controller = new AbortController();
    flight.current = controller;
    setData(null);
    setBusy(true);
    setError('');
    try {
      const value = await guard.run((signal) =>
        readPrivateSummary(scope, kind, AbortSignal.any([signal, controller.signal]), query),
      );
      if (active.current === guard && !controller.signal.aborted) setData(value);
    } catch {
      if (active.current === guard) setError('Could not load current private data.');
    } finally {
      if (active.current === guard && flight.current === controller) {
        flight.current = null;
        setBusy(false);
      }
    }
  }
  return { data, busy, error, refresh };
}
