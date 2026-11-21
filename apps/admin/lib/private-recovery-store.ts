import {
  captureRecoveryScope,
  recoveryKind,
  recoveryCommand,
  recoveryEnvelope,
  recoveryReceipt,
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
  removeItem?(key: string): void;
}
/** Ciphertext-only slot. Only confirmed release; no replay or plaintext fallback; retain/readback must finish before a write. */
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
  const decode = (raw: string | null) => {
    if (raw === null) return null;
    if (
      typeof raw !== 'string' ||
      new TextEncoder().encode(raw).byteLength > RECOVERY_MAX_WIRE_BYTES
    )
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
        const raw = storage.getItem(key),
          record = decode(raw);
        if (!record) return null;
        const command = recoveryCommand(kind, await codec.open(record, signal));
        if (
          signal.aborted ||
          guard.cleared ||
          storage.getItem(key) !== raw ||
          command.operationId !== record.operationId
        )
          throw Error('Recovery cancelled.');
        return command;
      });
    },
    retain(input: unknown, caller?: AbortSignal) {
      const command = recoveryCommand(kind, input);
      return active(caller, async (signal) => {
        if (signal.aborted) throw Error('Recovery cancelled.');
        const before = storage.getItem(key),
          existing = decode(before);
        if (existing) {
          const original = recoveryCommand(kind, await codec.open(existing, signal));
          if (
            signal.aborted ||
            guard.cleared ||
            storage.getItem(key) !== before ||
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
    releaseConfirmed(input: unknown, receipt: unknown, caller?: AbortSignal) {
      const command = recoveryCommand(kind, input),
        confirmed = recoveryReceipt(scope, kind, command, receipt);
      return active(caller, async (signal) => {
        const raw = storage.getItem(key),
          record = decode(raw);
        if (raw === null || !record || record.operationId !== command.operationId)
          throw Error('Retained original unavailable.');
        const original = recoveryCommand(kind, await codec.open(record, signal));
        if (
          signal.aborted ||
          guard.cleared ||
          JSON.stringify(original) !== JSON.stringify(command) ||
          storage.getItem(key) !== raw ||
          typeof storage.removeItem !== 'function'
        )
          throw Error('Retained original changed.');
        storage.removeItem(key);
        if (storage.getItem(key) !== null) throw Error('Confirmed original release failed.');
        return confirmed;
      });
    },
    dispose: () => guard.dispose(),
  });
}
