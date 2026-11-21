import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  captureRecoveryScope,
  recoveryKind,
  recoveryCommand,
  recoveryEnvelope,
  RECOVERY_MAX_PLAIN_BYTES,
  type RecoveryScope,
  type RecoveryKind,
  type RecoveryEnvelope,
} from './private-recovery-contract.ts';
/** Server-only authenticated envelope. It stores intent, never grants execution permission. */
export function createPrivateRecoveryCipher(keyHex: string) {
  if (typeof keyHex !== 'string' || !/^[0-9a-f]{64}$/.test(keyHex))
    throw Error('Recovery storage unavailable.');
  const key = Buffer.from(keyHex, 'hex');
  const aad = (scope: RecoveryScope, kind: RecoveryKind, operationId: string) =>
    Buffer.from(
      JSON.stringify([
        'private-recovery-envelope-v1',
        kind,
        scope.instanceId,
        scope.tenantId,
        scope.actorId,
        operationId,
      ]),
    );
  return Object.freeze({
    seal(inputScope: RecoveryScope, inputKind: RecoveryKind, input: unknown): RecoveryEnvelope {
      const scope = captureRecoveryScope(inputScope),
        kind = recoveryKind(inputKind),
        command = recoveryCommand(kind, input),
        iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
      cipher.setAAD(aad(scope, kind, command.operationId));
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(command), 'utf8'),
        cipher.final(),
      ]);
      return recoveryEnvelope(
        {
          policy: 'private-recovery-envelope-v1',
          scope,
          kind,
          operationId: command.operationId,
          sealed: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url'),
        },
        scope,
        kind,
      );
    },
    open(inputScope: RecoveryScope, inputKind: RecoveryKind, input: unknown) {
      const scope = captureRecoveryScope(inputScope),
        kind = recoveryKind(inputKind),
        envelope = recoveryEnvelope(input, scope, kind),
        bytes = Buffer.from(envelope.sealed, 'base64url');
      if (
        bytes.length < 29 ||
        bytes.length > RECOVERY_MAX_PLAIN_BYTES + 28 ||
        bytes.toString('base64url') !== envelope.sealed
      )
        throw Error('Recovery unavailable.');
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12), {
        authTagLength: 16,
      });
      cipher.setAAD(aad(scope, kind, envelope.operationId));
      cipher.setAuthTag(bytes.subarray(12, 28));
      const plain = Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]);
      const command = recoveryCommand(
        kind,
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)),
      );
      if (command.operationId !== envelope.operationId) throw Error('Recovery original changed.');
      return command;
    },
  });
}
