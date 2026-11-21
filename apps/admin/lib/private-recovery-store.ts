import {
  captureRecoveryScope,
  recoveryKind,
  recoveryCommand,
  recoveryEnvelope,
  RECOVERY_MAX_WIRE_BYTES,
  type RecoveryScope,
  type RecoveryKind,
} from './private-recovery-contract.ts';
import { parseVerificationJson } from './listing-verification-wire.ts';
import { createPrivateWorkspaceGuard } from './private-workspace-guard.ts';
import type { createPrivateRecoveryClient } from './private-recovery-client.ts';
interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
/** Ciphertext-only slot. No delete/replay or plaintext fallback; retain/readback must finish before a write. */
export function createSealedRecoveryStore(
  storage: Store,
  inputScope: RecoveryScope,
  inputKind: RecoveryKind,
  codec: ReturnType<typeof createPrivateRecoveryClient>,
  onDenied: () => void = () => {},
) {
  const scope = captureRecoveryScope(inputScope),
    kind = recoveryKind(inputKind),
    key = [
      'realtor.sealed-recovery.v1',
      kind,
      scope.instanceId,
      scope.tenantId,
      scope.actorId,
    ].join(':'),
    guard = createPrivateWorkspaceGuard(onDenied);
  let busy = false;
  const read = () => {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    if (new TextEncoder().encode(raw).byteLength > RECOVERY_MAX_WIRE_BYTES)
      throw Error('Recovery record too large.');
    return recoveryEnvelope(parseVerificationJson(raw), scope, kind);
  };
  const active = async <T>(
    caller: AbortSignal | undefined,
    task: (signal: AbortSignal) => Promise<T>,
  ) => {
    if (busy) throw Error('Recovery is already pending.');
    busy = true;
    try {
      return await guard.run((signal) => {
        const combined = caller ? AbortSignal.any([signal, caller]) : signal;
        if (combined.aborted) throw Error('Recovery cancelled.');
        return task(combined);
      });
    } finally {
      busy = false;
    }
  };
  return Object.freeze({
    load(caller?: AbortSignal) {
      return active(caller, async (signal) => {
        const record = read();
        if (!record) return null;
        const command = recoveryCommand(kind, await codec.open(record, signal));
        if (signal.aborted || guard.cleared || command.operationId !== record.operationId)
          throw Error('Recovery cancelled.');
        return command;
      });
    },
    retain(input: unknown, caller?: AbortSignal) {
      const command = recoveryCommand(kind, input);
      return active(caller, async (signal) => {
        if (signal.aborted) throw Error('Recovery cancelled.');
        const existing = read();
        if (existing) {
          const original = recoveryCommand(kind, await codec.open(existing, signal));
          if (
            signal.aborted ||
            guard.cleared ||
            JSON.stringify(original) !== JSON.stringify(command)
          )
            throw Error('An original is already retained.');
          return existing;
        }
        const record = recoveryEnvelope(await codec.seal(command, signal), scope, kind);
        if (record.operationId !== command.operationId || signal.aborted || guard.cleared)
          throw Error('Recovery cancelled.');
        if (storage.getItem(key) !== null) throw Error('An original is already retained.');
        const raw = JSON.stringify(record);
        storage.setItem(key, raw);
        if (storage.getItem(key) !== raw) throw Error('Recovery readback unavailable.');
        return record;
      });
    },
    dispose: () => guard.dispose(),
  });
}
