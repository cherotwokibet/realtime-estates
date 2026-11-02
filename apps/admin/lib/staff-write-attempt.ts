import {
  parseStaffInvitationJson,
  validateStaffBranchCommand,
  validateStaffBranchRecord,
  validateStaffInvitationIntent,
  validateStaffInvitationRequestRecord,
  validateStaffInvitationRevocationCommand,
  validateStaffInvitationRevocationRecord,
  validateStaffMembershipCommand,
  validateStaffMembershipRecord,
  type StaffBranchCommand,
  type StaffBranchRecord,
  type StaffInvitationIntent,
  type StaffInvitationRequestRecord,
  type StaffInvitationRevocationCommand,
  type StaffInvitationRevocationRecord,
  type StaffMembershipCommand,
  type StaffMembershipRecord,
} from '@realtor/domain';
export interface StaffWriteScope {
  readonly instanceId: string;
  readonly tenantId: string;
  readonly actorId: string;
}
type Base = {
  readonly scope: StaffWriteScope;
  readonly phase: 'prepared' | 'uncertain' | 'resolved';
};
export type StaffWriteAttempt = Base &
  (
    | {
        readonly kind: 'membership';
        readonly command: StaffMembershipCommand;
        readonly receipt: StaffMembershipRecord | null;
      }
    | {
        readonly kind: 'branch';
        readonly command: StaffBranchCommand;
        readonly receipt: StaffBranchRecord | null;
      }
    | {
        readonly kind: 'invitation';
        readonly command: StaffInvitationIntent;
        readonly receipt: StaffInvitationRequestRecord | null;
      }
    | {
        readonly kind: 'revocation';
        readonly command: StaffInvitationRevocationCommand;
        readonly receipt: StaffInvitationRevocationRecord | null;
      }
  );
const fail = (): never => {
  throw Error('Retain and recover the original staff operation.');
};
function own(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return fail();
  const own = Reflect.ownKeys(input);
  if (own.length !== keys.length || own.some((k) => typeof k !== 'string' || !keys.includes(k)))
    return fail();
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(input, k);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return fail();
    out[k] = d.value;
  }
  return out;
}
function scope(input: unknown): StaffWriteScope {
  const r = own(input, ['instanceId', 'tenantId', 'actorId']);
  for (const value of Object.values(r))
    if (
      typeof value !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    )
      return fail();
  return Object.freeze({
    instanceId: r.instanceId as string,
    tenantId: r.tenantId as string,
    actorId: r.actorId as string,
  });
}
/** Scope binds retained UI work; server authorization remains authoritative. */
export function prepareStaffWrite(
  current: StaffWriteScope,
  kind: StaffWriteAttempt['kind'],
  input: unknown,
): StaffWriteAttempt {
  const captured = scope(current);
  if (kind === 'membership') {
    const command = validateStaffMembershipCommand(input);
    if (command.memberId === captured.actorId) return fail();
    return Object.freeze({
      scope: captured,
      kind,
      command,
      phase: 'prepared',
      receipt: null,
    });
  }
  if (kind === 'branch')
    return Object.freeze({
      scope: captured,
      kind,
      command: validateStaffBranchCommand(input),
      phase: 'prepared',
      receipt: null,
    });
  if (kind === 'invitation')
    return Object.freeze({
      scope: captured,
      kind,
      command: validateStaffInvitationIntent(input),
      phase: 'prepared',
      receipt: null,
    });
  if (kind === 'revocation')
    return Object.freeze({
      scope: captured,
      kind,
      command: validateStaffInvitationRevocationCommand(input),
      phase: 'prepared',
      receipt: null,
    });
  return fail();
}
export function staffWriteMatchesScope(
  attempt: StaffWriteAttempt,
  current: StaffWriteScope,
): boolean {
  const s = scope(current);
  return (
    s.instanceId === attempt.scope.instanceId &&
    s.tenantId === attempt.scope.tenantId &&
    s.actorId === attempt.scope.actorId
  );
}
export function markStaffWriteUncertain(
  attempt: StaffWriteAttempt,
  current: StaffWriteScope,
): StaffWriteAttempt {
  if (!staffWriteMatchesScope(attempt, current) || attempt.phase === 'resolved') return fail();
  return Object.freeze({ ...attempt, phase: 'uncertain', receipt: null });
}
export function resolveStaffWrite(
  attempt: StaffWriteAttempt,
  current: StaffWriteScope,
  receipt: unknown,
): StaffWriteAttempt {
  if (!staffWriteMatchesScope(attempt, current)) return fail();
  if (attempt.kind === 'membership')
    return Object.freeze({
      ...attempt,
      phase: 'resolved',
      receipt: validateStaffMembershipRecord(receipt, attempt.command, attempt.scope.actorId),
    });
  if (attempt.kind === 'branch')
    return Object.freeze({
      ...attempt,
      phase: 'resolved',
      receipt: validateStaffBranchRecord(receipt, attempt.command, attempt.scope.actorId),
    });
  if (attempt.kind === 'invitation')
    return Object.freeze({
      ...attempt,
      phase: 'resolved',
      receipt: validateStaffInvitationRequestRecord(
        receipt,
        attempt.command,
        attempt.scope.actorId,
      ),
    });
  return Object.freeze({
    ...attempt,
    phase: 'resolved',
    receipt: validateStaffInvitationRevocationRecord(
      receipt,
      attempt.command,
      attempt.scope.actorId,
    ),
  });
}
export function canDiscardStaffWrite(attempt: StaffWriteAttempt): boolean {
  return attempt.phase !== 'uncertain';
}
/** Retain immutable request facts only. Every restore requires explicit original recovery. */
export function serializeStaffWrite(attempt: StaffWriteAttempt): string {
  return JSON.stringify({
    policy: 'retained-staff-write-v1',
    scope: attempt.scope,
    kind: attempt.kind,
    command: attempt.command,
  });
}
export function restoreStaffWrite(text: string, current: StaffWriteScope): StaffWriteAttempt {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > 12288) return fail();
  const r = own(parseStaffInvitationJson(text), ['policy', 'scope', 'kind', 'command']);
  if (r.policy !== 'retained-staff-write-v1') return fail();
  const attempt = prepareStaffWrite(scope(r.scope), r.kind as StaffWriteAttempt['kind'], r.command);
  return markStaffWriteUncertain(attempt, current);
}

export const validateStaffWriteScope = scope;
