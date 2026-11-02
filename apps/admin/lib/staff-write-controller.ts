import { ApiClientError } from '@realtor/api-client';
import {
  validateStaffInvitationIssueResponse,
  validateStaffInvitationRawSecret,
} from '@realtor/domain';
import {
  prepareStaffWrite,
  markStaffWriteUncertain,
  resolveStaffWrite,
  serializeStaffWrite,
  restoreStaffWrite,
  canDiscardStaffWrite,
  validateStaffWriteScope,
  type StaffWriteScope,
  type StaffWriteAttempt,
} from './staff-write-attempt.ts';
import type { StaffDirectoryClient } from './staff-directory-client.ts';
interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
type Client = Pick<
  StaffDirectoryClient,
  | 'acceptInvitation'
  | 'getInvitationRedemption'
  | 'issueInvitation'
  | 'getInvitationIssue'
  | 'saveBranch'
  | 'getBranchOperation'
  | 'captureInvitation'
  | 'getInvitationOperation'
  | 'revokeInvitation'
  | 'getInvitationRevocation'
  | 'saveMembership'
  | 'getMembershipOperation'
>;
/** One retained request per verified UI scope. Persistence must succeed before dispatch. */
export function createStaffWriteController(input: {
  scope: StaffWriteScope;
  store: Store;
  client: Client;
}) {
  const scope = validateStaffWriteScope(input.scope),
    store = input.store,
    client = input.client,
    key = 'realtor.staff-write.v1:' + scope.instanceId + ':' + scope.tenantId + ':' + scope.actorId;
  let secret: string | null = null;
  let attempt: StaffWriteAttempt | null = null,
    busy = false,
    closed = false,
    blocked = false,
    error: string | null = null,
    active: AbortController | undefined;
  try {
    const retained = store.getItem(key);
    if (retained !== null) attempt = restoreStaffWrite(retained, scope);
  } catch {
    blocked = true;
    error = 'Retained staff operation needs recovery.';
  }
  const requireIdle = () => {
    if (closed || busy || blocked) throw Error('Staff workspace is unavailable.');
  };
  const persist = (value: StaffWriteAttempt) => {
    const text = serializeStaffWrite(value);
    try {
      store.setItem(key, text);
      if (store.getItem(key) !== text) throw Error();
    } catch {
      blocked = true;
      error = 'Retained operation storage is unavailable.';
      throw Error(error);
    }
  };
  async function run(mode: 'submit' | 'recover' | 'replay', rawSecret?: string) {
    requireIdle();
    if (
      !attempt ||
      attempt.phase === 'resolved' ||
      (mode === 'submit' ? attempt.phase !== 'prepared' : attempt.phase !== 'uncertain')
    )
      throw Error('Recover the retained original first.');
    const acceptanceSecret =
      attempt.kind === 'acceptance' && mode !== 'recover'
        ? validateStaffInvitationRawSecret(rawSecret)
        : undefined;
    const original = attempt,
      controller = new AbortController();
    active = controller;
    busy = true;
    error = null;
    let abort = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(Error('Staff operation interrupted.'));
      controller.signal.addEventListener('abort', abort, { once: true });
    });
    try {
      const uncertain = markStaffWriteUncertain(original, scope);
      persist(uncertain);
      attempt = uncertain;
      const pending = Promise.resolve().then<unknown>(() => {
        if (controller.signal.aborted) throw Error('Staff operation interrupted.');
        if (mode === 'recover') {
          if (uncertain.kind === 'acceptance')
            return client.getInvitationRedemption(uncertain.command, controller.signal);
          if (uncertain.kind === 'issuance')
            return client.getInvitationIssue(uncertain.command, controller.signal);
          if (uncertain.kind === 'membership')
            return client.getMembershipOperation(uncertain.command.operationId, controller.signal);
          return uncertain.kind === 'branch'
            ? client.getBranchOperation(uncertain.command.operationId, controller.signal)
            : uncertain.kind === 'invitation'
              ? client.getInvitationOperation(uncertain.command.operationId, controller.signal)
              : client.getInvitationRevocation(
                  uncertain.command.invitationId,
                  uncertain.command.operationId,
                  controller.signal,
                );
        }
        if (uncertain.kind === 'acceptance')
          return client.acceptInvitation(uncertain.command, acceptanceSecret!, controller.signal);
        if (uncertain.kind === 'issuance')
          return client.issueInvitation(uncertain.command, controller.signal);
        if (uncertain.kind === 'membership')
          return client.saveMembership(uncertain.command, controller.signal);
        return uncertain.kind === 'branch'
          ? client.saveBranch(uncertain.command, controller.signal)
          : uncertain.kind === 'invitation'
            ? client.captureInvitation(uncertain.command, controller.signal)
            : client.revokeInvitation(uncertain.command, controller.signal);
      });
      const receipt = await Promise.race([pending, cancelled]);
      if (closed || controller.signal.aborted) throw Error('Staff operation interrupted.');
      const disclosure =
        uncertain.kind === 'issuance' && mode !== 'recover'
          ? validateStaffInvitationIssueResponse(
              receipt,
              uncertain.command.operationId,
              uncertain.command.invitationId,
              scope.actorId,
            )
          : null;
      const resolved = resolveStaffWrite(
        uncertain,
        scope,
        disclosure ? disclosure.record : receipt,
      );
      persist(resolved);
      attempt = resolved;
      secret = disclosure?.secret ?? null;
      return resolved;
    } catch (cause) {
      if (
        !closed &&
        !blocked &&
        ['issuance', 'acceptance'].includes(original.kind) &&
        mode !== 'recover' &&
        cause instanceof ApiClientError &&
        cause.kind === 'HTTP' &&
        cause.submissionUncertain === false &&
        [400, 401, 403, 404, 409, 413, 422].includes(cause.status ?? 0)
      ) {
        attempt = Object.freeze({ ...original, phase: 'refused', receipt: null });
        error =
          'Request was refused without a write. Acknowledge the refusal and verify the current invitation.';
      }
      if (!error) error = 'Original not confirmed; retain and recover this operation.';
      throw Error(error);
    } finally {
      controller.signal.removeEventListener('abort', abort);
      if (active === controller) active = undefined;
      busy = false;
    }
  }
  return Object.freeze({
    snapshot: () =>
      Object.freeze({
        attempt,
        busy,
        closed,
        blocked,
        error,
        secretAvailable: secret !== null,
        canNavigate:
          secret === null &&
          !closed &&
          !busy &&
          !blocked &&
          (!attempt || canDiscardStaffWrite(attempt)),
      }),
    prepare(kind: StaffWriteAttempt['kind'], command: unknown) {
      requireIdle();
      if (attempt) throw Error('Clear the resolved or undispatched operation explicitly.');
      const value = prepareStaffWrite(scope, kind, command);
      persist(value);
      attempt = value;
      error = null;
      return value;
    },
    takeSecretOnce() {
      requireIdle();
      if (secret === null)
        throw Error('Secret unavailable. Recover metadata or revoke and replace.');
      const value = secret;
      secret = null;
      return value;
    },
    discardSecret() {
      requireIdle();
      secret = null;
    },
    submit: (rawSecret?: string) => run('submit', rawSecret),
    recover: () => run('recover'),
    replay(confirmedExactReplay: boolean, rawSecret?: string) {
      if (confirmedExactReplay !== true) throw Error('Confirm exact original replay.');
      return run('replay', rawSecret);
    },
    clear() {
      requireIdle();
      if (secret !== null) throw Error('Reveal or explicitly discard the secret first.');
      if (attempt && !canDiscardStaffWrite(attempt))
        throw Error('Uncertain operations cannot be discarded.');
      try {
        store.removeItem(key);
        if (store.getItem(key) !== null) throw Error();
      } catch {
        blocked = true;
        error = 'Retained operation storage is unavailable.';
        throw Error(error);
      }
      attempt = null;
      error = null;
    },
    close() {
      closed = true;
      secret = null;
      active?.abort();
    },
  });
}
export type StaffWriteController = ReturnType<typeof createStaffWriteController>;
