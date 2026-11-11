import { validateCustomerAccount, type CustomerScope } from './customer-favourites.js';
import { DomainError } from './errors.js';

export interface CustomerDeletionCommand {
  readonly policy: 'synthetic-customer-deletion-command-v1';
  readonly requestId: string;
  readonly confirmed: true;
}

export interface CustomerDeletionRequest extends CustomerScope {
  readonly policy: 'synthetic-customer-deletion-request-v1';
  readonly requestId: string;
  readonly status: 'pending_review';
  readonly requestedAt: string;
}

function invalid(): never {
  throw new DomainError('INVALID_CUSTOMER_DELETION_REQUEST', 'Invalid customer deletion request.');
}

function record(value: unknown, fields: readonly string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== fields.length
  )
    return invalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return invalid();
    result[field] = descriptor.value;
  }
  return result;
}

function requestId(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  )
    return invalid();
  return value;
}

export function validateCustomerDeletionCommand(value: unknown): CustomerDeletionCommand {
  const row = record(value, ['policy', 'requestId', 'confirmed']);
  if (row.policy !== 'synthetic-customer-deletion-command-v1' || row.confirmed !== true)
    return invalid();
  return Object.freeze({
    policy: row.policy,
    requestId: requestId(row.requestId),
    confirmed: true,
  });
}

export function validateCustomerDeletionRequest(
  value: unknown,
  scope: CustomerScope,
  expectedRequestId?: string,
): CustomerDeletionRequest {
  const row = record(value, [
    'policy',
    'tenantId',
    'customerId',
    'requestId',
    'status',
    'requestedAt',
  ]);
  const account = validateCustomerAccount(
    {
      policy: 'customer-account-v1',
      tenantId: row.tenantId,
      customerId: row.customerId,
    },
    scope,
  );
  const id = requestId(row.requestId);
  const date = row.requestedAt;
  if (
    row.policy !== 'synthetic-customer-deletion-request-v1' ||
    row.status !== 'pending_review' ||
    (expectedRequestId !== undefined && id !== expectedRequestId) ||
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString() !== date
  )
    return invalid();
  return Object.freeze({
    policy: row.policy,
    tenantId: account.tenantId,
    customerId: account.customerId,
    requestId: id,
    status: row.status,
    requestedAt: date,
  });
}
