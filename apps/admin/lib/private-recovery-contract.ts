import {
  validateStaffCaptureCommand,
  validateStaffCaptureReceipt,
  type StaffCaptureCommand,
} from '@realtor/api-client';
import { validatePrivateOperationResolution } from '@realtor/domain';
import {
  validateCustomerDeletionReviewCommand,
  validateCustomerDeletionReviewTarget,
  validateCustomerDeletionReviewReceipt,
  validateCustomerDeletionReturnReceipt,
  validateDeletionPrivacyCommand,
  validateDeletionPrivacyReceipt,
  type CustomerDeletionReviewCommand,
  type CustomerDeletionReviewTarget,
  type DeletionPrivacyCommand,
  validateCompanySettingsCommand,
  validateCompanySettingsRecord,
  validateListingReportDecisionReceipt,
  validateListingReportDecisionCommand,
  type CompanySettingsCommand,
  type ListingReportDecisionCommand,
} from '@realtor/domain';
export type RecoveryKind =
  | 'settings'
  | 'report'
  | 'deletion-triage'
  | 'deletion-privacy'
  | 'capture-admin'
  | 'capture-agent';
export type RecoveryCommand =
  | StaffCaptureCommand
  | CompanySettingsCommand
  | ListingReportDecisionCommand
  | CustomerDeletionReviewCommand
  | CustomerDeletionReviewTarget
  | DeletionPrivacyCommand;
export interface RecoveryScope {
  readonly instanceId: string;
  readonly tenantId: string;
  readonly actorId: string;
}
export interface RecoveryEnvelope {
  readonly policy: 'private-recovery-envelope-v1';
  readonly scope: RecoveryScope;
  readonly kind: RecoveryKind;
  readonly operationId: string;
  readonly sealed: string;
}
export const RECOVERY_MAX_PLAIN_BYTES = 131072;
export const RECOVERY_MAX_WIRE_BYTES = 180000;
export function recoveryObject(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).length !== keys.length
  )
    throw Error('Invalid recovery record.');
  const row: Record<string, unknown> = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) throw Error('Invalid recovery record.');
    row[key] = d.value;
  }
  return row;
}
export function recoveryId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  )
    throw Error('Invalid recovery scope.');
  return value;
}
export function recoveryKind(value: unknown): RecoveryKind {
  if (
    ![
      'settings',
      'report',
      'deletion-triage',
      'deletion-privacy',
      'capture-admin',
      'capture-agent',
    ].includes(value as string)
  )
    throw Error('Invalid recovery kind.');
  return value as RecoveryKind;
}
/** Terminal retirement is implemented only for settings/report, never reviewer commands. */
export function resolutionKind(kind: RecoveryKind): 'settings' | 'report' {
  if (kind !== 'settings' && kind !== 'report')
    throw Error('Resolution is unavailable for this original.');
  return kind;
}
export function captureRecoveryScope(input: unknown): RecoveryScope {
  const r = recoveryObject(input, ['instanceId', 'tenantId', 'actorId']);
  return Object.freeze({
    instanceId: recoveryId(r.instanceId),
    tenantId: recoveryId(r.tenantId),
    actorId: recoveryId(r.actorId),
  });
}
export function sameRecoveryScope(a: RecoveryScope, b: RecoveryScope) {
  return a.instanceId === b.instanceId && a.tenantId === b.tenantId && a.actorId === b.actorId;
}
export function recoveryCommand(kind: RecoveryKind, input: unknown): RecoveryCommand {
  recoveryKind(kind);
  if (kind === 'capture-admin' || kind === 'capture-agent') {
    const command = validateStaffCaptureCommand(input);
    if (command.role !== kind.slice(8)) throw Error('Capture role changed.');
    return command;
  }
  const value =
    kind === 'settings'
      ? validateCompanySettingsCommand(input)
      : kind === 'report'
        ? validateListingReportDecisionCommand(input)
        : kind === 'deletion-privacy'
          ? validateDeletionPrivacyCommand(input)
          : Object.getOwnPropertyDescriptor(input ?? {}, 'disposition')
            ? validateCustomerDeletionReviewCommand(input)
            : validateCustomerDeletionReviewTarget(input);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > RECOVERY_MAX_PLAIN_BYTES)
    throw Error('Recovery original too large.');
  return value;
}
export function recoveryEnvelope(
  input: unknown,
  expectedScope: RecoveryScope,
  expectedKind: RecoveryKind,
): RecoveryEnvelope {
  const row = recoveryObject(input, ['policy', 'scope', 'kind', 'operationId', 'sealed']),
    scope = captureRecoveryScope(row.scope),
    kind = recoveryKind(row.kind),
    operationId = recoveryId(row.operationId);
  if (
    row.policy !== 'private-recovery-envelope-v1' ||
    kind !== expectedKind ||
    !sameRecoveryScope(scope, expectedScope) ||
    typeof row.sealed !== 'string' ||
    row.sealed.length > 175000 ||
    !/^[A-Za-z0-9_-]{39,}$/.test(row.sealed)
  )
    throw Error('Invalid recovery envelope.');
  return Object.freeze({
    policy: 'private-recovery-envelope-v1',
    scope,
    kind,
    operationId,
    sealed: row.sealed,
  });
}

/** A receipt releases only the exact original and the current actor, never a missing/refused guess. */
export function recoveryReceipt(
  scope: RecoveryScope,
  kind: RecoveryKind,
  input: unknown,
  receipt: unknown,
) {
  const command = recoveryCommand(kind, input);
  if (kind === 'capture-admin' || kind === 'capture-agent')
    return validateStaffCaptureReceipt(receipt, command as StaffCaptureCommand, scope);
  if (
    receipt &&
    typeof receipt === 'object' &&
    Object.getOwnPropertyDescriptor(receipt, 'policy')?.value === 'private-operation-resolution-v1'
  )
    return validatePrivateOperationResolution(receipt, {
      kind: resolutionKind(kind),
      original: command,
      tenantId: scope.tenantId,
      actorId: scope.actorId,
    });
  if (kind === 'deletion-privacy')
    return validateDeletionPrivacyReceipt(receipt, {
      ...validateDeletionPrivacyCommand(command),
      tenantId: scope.tenantId,
      reviewerId: scope.actorId,
    });
  if (kind === 'deletion-triage') {
    const expected = {
      ...(command as CustomerDeletionReviewTarget),
      tenantId: scope.tenantId,
      reviewerId: scope.actorId,
    };
    return 'disposition' in command
      ? validateCustomerDeletionReviewReceipt(receipt, {
          ...expected,
          disposition: command.disposition,
        })
      : validateCustomerDeletionReturnReceipt(receipt, expected);
  }
  if (kind === 'settings') {
    const value = validateCompanySettingsRecord(receipt);
    if (
      value.actorId !== scope.actorId ||
      JSON.stringify(value.request) !== JSON.stringify(command)
    )
      throw Error('Receipt does not confirm this original.');
    return value;
  }
  const value = validateListingReportDecisionReceipt(
    receipt,
    command as ListingReportDecisionCommand,
  );
  if (value.actorId !== scope.actorId) throw Error('Receipt actor changed.');
  return value;
}
