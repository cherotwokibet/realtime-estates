import { validatePrivateOperationResolution } from '@realtor/domain';
import { ApiClientError } from '@realtor/api-client';
import {
  captureRecoveryScope,
  recoveryObject,
  resolutionKind,
  sameRecoveryScope,
  recoveryKind,
  recoveryCommand,
  recoveryEnvelope,
  RECOVERY_MAX_WIRE_BYTES,
  type RecoveryScope,
  type RecoveryKind,
} from './private-recovery-contract.ts';
import { readBrowserDecodedJson } from './browser-decoded-json.ts';
export function createPrivateRecoveryClient(
  inputScope: RecoveryScope,
  inputKind: RecoveryKind,
  transport: typeof fetch = fetch,
) {
  const scope = captureRecoveryScope(inputScope),
    kind = recoveryKind(inputKind);
  async function request(
    action: 'seal' | 'open' | 'check' | 'resolve',
    value: unknown,
    caller: AbortSignal,
  ) {
    const signal = AbortSignal.any([caller, AbortSignal.timeout(5000)]),
      path = '/api/private-workspace/recovery/' + kind + '/' + action;
    if (signal.aborted) throw new ApiClientError('CANCELLED', 'Recovery unavailable.');
    const response = await transport(path, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal,
      headers: { 'X-Preview-Instance': scope.instanceId, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        action === 'check'
          ? { scope }
          : { scope, [action === 'seal' || action === 'resolve' ? 'command' : 'envelope']: value },
      ),
    });
    if (response.status !== 200 || response.redirected) {
      void response.body?.cancel().catch(() => {});
      throw new ApiClientError('HTTP', 'Recovery unavailable.', { status: response.status });
    }
    if (response.url) {
      const actual = new URL(response.url);
      if (
        actual.pathname !== path ||
        response.url.includes('?') ||
        response.url.includes('#') ||
        actual.username ||
        actual.password ||
        (typeof location !== 'undefined' && actual.origin !== location.origin)
      ) {
        void response.body?.cancel().catch(() => {});
        throw Error('Recovery target changed.');
      }
    }
    const data = await readBrowserDecodedJson(response, RECOVERY_MAX_WIRE_BYTES, signal);
    if (signal.aborted) throw Error('Recovery cancelled.');
    return data;
  }
  return Object.freeze({
    async resolve(input: unknown, signal: AbortSignal) {
      const terminalKind = resolutionKind(kind);
      const original = recoveryCommand(kind, input);
      return validatePrivateOperationResolution(await request('resolve', original, signal), {
        kind: terminalKind,
        original,
        tenantId: scope.tenantId,
        actorId: scope.actorId,
      });
    },
    async check(signal: AbortSignal) {
      const row = recoveryObject(await request('check', undefined, signal), [
        'policy',
        'scope',
        'kind',
      ]);
      if (
        row.policy !== 'private-recovery-ready-v1' ||
        row.kind !== kind ||
        !sameRecoveryScope(captureRecoveryScope(row.scope), scope)
      )
        throw Error('Recovery readiness changed.');
    },

    async seal(input: unknown, signal: AbortSignal) {
      const command = recoveryCommand(kind, input);
      const envelope = recoveryEnvelope(await request('seal', command, signal), scope, kind);
      if (envelope.operationId !== command.operationId) throw Error('Recovery operation changed.');
      return envelope;
    },
    async open(input: unknown, signal: AbortSignal) {
      const envelope = recoveryEnvelope(input, scope, kind);
      const command = recoveryCommand(kind, await request('open', envelope, signal));
      if (command.operationId !== envelope.operationId) throw Error('Recovery operation changed.');
      return command;
    },
  });
}
