import { validateCustomerAccount, type CustomerScope } from './customer-favourites.js';
import { DomainError } from './errors.js';

export interface CustomerPushPreferences extends CustomerScope {
  readonly policy: 'synthetic-customer-push-preferences-v1';
  readonly version: string;
  readonly enabled: boolean;
  readonly consentChangedAt: string | null;
  readonly activeDevices: number;
}
interface CommandBase {
  readonly policy: 'synthetic-customer-push-command-v1';
  readonly operationId: string;
  readonly expectedVersion: string;
}
export type CustomerPushCommand = Readonly<
  CommandBase &
    (
      | { action: 'consent'; enabled: boolean; registrationId: null }
      | { action: 'register' | 'revoke'; enabled: null; registrationId: string }
    )
>;
export interface CustomerPushReceipt {
  readonly policy: 'synthetic-customer-push-receipt-v1';
  readonly command: CustomerPushCommand;
  readonly outcome: 'applied' | 'unchanged' | 'conflict';
  readonly preferences: CustomerPushPreferences;
}

const invalid = (): never => {
  throw new DomainError(
    'INVALID_CUSTOMER_PUSH_PREFERENCES',
    'Invalid customer notification preferences.',
  );
};
function record(value: unknown, keys: readonly string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length
  )
    return invalid();
  const row: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field?.enumerable || !Object.hasOwn(field, 'value')) return invalid();
    row[key] = field.value;
  }
  return row;
}
function uuid(value: unknown) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    ? value
    : invalid();
}
function version(value: unknown, maximum = 9007199254740991n) {
  return typeof value === 'string' &&
    /^(0|[1-9][0-9]{0,15})$/.test(value) &&
    BigInt(value) <= maximum
    ? value
    : invalid();
}
export function validateCustomerPushCommand(value: unknown): CustomerPushCommand {
  const row = record(value, [
    'policy',
    'operationId',
    'expectedVersion',
    'action',
    'enabled',
    'registrationId',
  ]);
  if (row.policy !== 'synthetic-customer-push-command-v1') return invalid();
  const base = {
    policy: row.policy,
    operationId: uuid(row.operationId),
    expectedVersion: version(row.expectedVersion, 9007199254740990n),
  } as const;
  if (row.action === 'consent' && typeof row.enabled === 'boolean' && row.registrationId === null)
    return Object.freeze({
      ...base,
      action: row.action,
      enabled: row.enabled,
      registrationId: null,
    });
  if ((row.action === 'register' || row.action === 'revoke') && row.enabled === null)
    return Object.freeze({
      ...base,
      action: row.action,
      enabled: null,
      registrationId: uuid(row.registrationId),
    });
  return invalid();
}
export function validateCustomerPushPreferences(
  value: unknown,
  scope: CustomerScope,
): CustomerPushPreferences {
  const row = record(value, [
    'policy',
    'tenantId',
    'customerId',
    'version',
    'enabled',
    'consentChangedAt',
    'activeDevices',
  ]);
  const account = validateCustomerAccount(
    {
      policy: 'customer-account-v1',
      tenantId: row.tenantId,
      customerId: row.customerId,
    },
    scope,
  );
  const revision = version(row.version);
  const changedAt = row.consentChangedAt;
  if (
    row.policy !== 'synthetic-customer-push-preferences-v1' ||
    typeof row.enabled !== 'boolean' ||
    typeof row.activeDevices !== 'number' ||
    !Number.isInteger(row.activeDevices) ||
    row.activeDevices < 0 ||
    row.activeDevices > 10 ||
    (!row.enabled && row.activeDevices !== 0) ||
    (revision === '0'
      ? row.enabled || changedAt !== null
      : typeof changedAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(changedAt) ||
        !Number.isFinite(Date.parse(changedAt)) ||
        new Date(changedAt).toISOString() !== changedAt)
  )
    return invalid();
  return Object.freeze({
    policy: row.policy,
    tenantId: account.tenantId,
    customerId: account.customerId,
    version: revision,
    enabled: row.enabled,
    consentChangedAt: changedAt as string | null,
    activeDevices: row.activeDevices,
  });
}
export function validateCustomerPushReceipt(
  value: unknown,
  scope: CustomerScope,
  operationId: string,
  expected?: CustomerPushCommand,
): CustomerPushReceipt {
  const row = record(value, ['policy', 'command', 'outcome', 'preferences']);
  const command = validateCustomerPushCommand(row.command);
  const preferences = validateCustomerPushPreferences(row.preferences, scope);
  const outcome = row.outcome;
  const actual = BigInt(preferences.version),
    before = BigInt(command.expectedVersion);
  if (
    row.policy !== 'synthetic-customer-push-receipt-v1' ||
    command.operationId !== uuid(operationId) ||
    (expected &&
      JSON.stringify(command) !== JSON.stringify(validateCustomerPushCommand(expected))) ||
    (outcome !== 'applied' && outcome !== 'unchanged' && outcome !== 'conflict') ||
    (outcome === 'conflict'
      ? actual === before
      : actual !== before + (outcome === 'applied' ? 1n : 0n)) ||
    (outcome !== 'conflict' &&
      command.action === 'consent' &&
      preferences.enabled !== command.enabled) ||
    (outcome !== 'conflict' &&
      command.action === 'register' &&
      (!preferences.enabled || preferences.activeDevices === 0))
  )
    return invalid();
  return Object.freeze({ policy: row.policy, command, outcome, preferences });
}

export function validateSyntheticPushQueueSummary(value: unknown, expectedTenantId: string) {
  const row = record(value, [
    'policy',
    'tenantId',
    'asOf',
    'due',
    'scheduled',
    'waitingForRetry',
    'captured',
    'suppressed',
    'oldestDueAgeSeconds',
    'oldestRetryAgeSeconds',
    'nextRetryAt',
  ]);
  const count = (input: unknown) =>
    typeof input === 'number' && Number.isSafeInteger(input) && input >= 0 ? input : invalid();
  const timestamp = (input: unknown) => {
    if (typeof input !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input))
      return invalid();
    const date = new Date(input);
    return Number.isFinite(date.getTime()) && date.toISOString() === input ? input : invalid();
  };
  if (row.policy !== 'synthetic-push-queue-summary-v1' || uuid(row.tenantId) !== expectedTenantId)
    return invalid();
  const asOf = timestamp(row.asOf);
  const due = count(row.due);
  const waitingForRetry = count(row.waitingForRetry);
  const oldestDueAgeSeconds =
    row.oldestDueAgeSeconds === null ? null : count(row.oldestDueAgeSeconds);
  const oldestRetryAgeSeconds =
    row.oldestRetryAgeSeconds === null ? null : count(row.oldestRetryAgeSeconds);
  const nextRetryAt = row.nextRetryAt === null ? null : timestamp(row.nextRetryAt);
  if (
    (due === 0) !== (oldestDueAgeSeconds === null) ||
    (waitingForRetry === 0) !== (nextRetryAt === null) ||
    (waitingForRetry > 0 && oldestRetryAgeSeconds === null) ||
    (nextRetryAt !== null && nextRetryAt <= asOf)
  )
    return invalid();
  return Object.freeze({
    policy: row.policy,
    tenantId: expectedTenantId,
    asOf,
    due,
    scheduled: count(row.scheduled),
    waitingForRetry,
    captured: count(row.captured),
    suppressed: count(row.suppressed),
    oldestDueAgeSeconds,
    oldestRetryAgeSeconds,
    nextRetryAt,
  });
}
