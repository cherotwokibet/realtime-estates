import { createListingCreationClient } from './listing-creation-client.ts';
import { createListingSuccessorClient } from './listing-successor-client.ts';
import type { AllocationIdentity } from './allocation-identity.ts';
import { createPrivateWorkspaceGuard } from './private-workspace-guard.ts';
/** Protect whole decoded allocation operations, including uncooperative transports and cached callbacks. */
export function createPrivateAllocationClients(
  scope: AllocationIdentity,
  onClear: () => void,
  transport: typeof fetch = fetch,
) {
  const guard = createPrivateWorkspaceGuard(onClear);
  const fetcher: typeof fetch = async (...args) => {
    const response = await transport(...args);
    if (response.status === 401 || response.status === 403) guard.invalidate();
    return response;
  };
  const creation = createListingCreationClient({
    instanceId: scope.instanceId,
    scope,
    fetch: fetcher,
  });
  const successor = createListingSuccessorClient({
    instanceId: scope.instanceId,
    scope,
    fetch: fetcher,
  });
  const protect =
    <C, R>(operation: (command: C, signal?: AbortSignal) => Promise<R>) =>
    (command: C, caller?: AbortSignal) =>
      guard.run((signal) =>
        operation(command, caller ? AbortSignal.any([signal, caller]) : signal),
      );
  return {
    creation: Object.freeze({
      create: protect(creation.create),
      recover: protect(creation.recover),
    }),
    successor: Object.freeze({
      create: protect(successor.create),
      recover: protect(successor.recover),
    }),
    dispose: () => guard.dispose(),
  };
}
