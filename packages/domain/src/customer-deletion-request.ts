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
  const date = timestamp(row.requestedAt);
  if (
    row.policy !== 'synthetic-customer-deletion-request-v1' ||
    row.status !== 'pending_review' ||
    (expectedRequestId !== undefined && id !== expectedRequestId)
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

function timestamp(date: unknown) {
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString() !== date
  )
    return invalid();
  return date;
}
export type CustomerDeletionDisposition = 'ready_for_privacy_review' | 'needs_information';
export interface CustomerDeletionReviewTarget {
  readonly customerId: string;
  readonly requestId: string;
  readonly operationId: string;
}
export interface CustomerDeletionReviewCommand extends CustomerDeletionReviewTarget {
  readonly policy: 'synthetic-customer-deletion-review-command-v1';
  readonly disposition: CustomerDeletionDisposition;
}
function disposition(value: unknown): CustomerDeletionDisposition {
  if (value !== 'ready_for_privacy_review' && value !== 'needs_information') return invalid();
  return value;
}
function reviewTarget(row: Record<string, unknown>): CustomerDeletionReviewTarget {
  return {
    customerId: requestId(row.customerId),
    requestId: requestId(row.requestId),
    operationId: requestId(row.operationId),
  };
}
export function validateCustomerDeletionReviewTarget(value: unknown): CustomerDeletionReviewTarget {
  return Object.freeze(reviewTarget(record(value, ['customerId', 'requestId', 'operationId'])));
}
export function validateCustomerDeletionReviewCommand(
  value: unknown,
): CustomerDeletionReviewCommand {
  const row = record(value, ['policy', 'customerId', 'requestId', 'operationId', 'disposition']);
  if (row.policy !== 'synthetic-customer-deletion-review-command-v1') return invalid();
  return Object.freeze({
    policy: row.policy,
    ...reviewTarget(row),
    disposition: disposition(row.disposition),
  });
}
export function validateCustomerDeletionReviewReceipt(
  value: unknown,
  expected: CustomerDeletionReviewTarget & {
    tenantId: string;
    reviewerId: string;
    disposition?: CustomerDeletionDisposition;
  },
) {
  const row = record(value, [
    'policy',
    'tenantId',
    'reviewerId',
    'customerId',
    'requestId',
    'operationId',
    'disposition',
    'reviewedAt',
  ]);
  const tenantId = requestId(row.tenantId),
    reviewerId = requestId(row.reviewerId);
  const target = reviewTarget(row);
  const decision = disposition(row.disposition);
  if (
    row.policy !== 'synthetic-customer-deletion-review-v1' ||
    tenantId !== expected.tenantId ||
    reviewerId !== expected.reviewerId ||
    target.customerId !== expected.customerId ||
    target.requestId !== expected.requestId ||
    target.operationId !== expected.operationId ||
    (expected.disposition !== undefined && decision !== expected.disposition)
  )
    return invalid();
  return Object.freeze({
    policy: row.policy,
    tenantId,
    reviewerId,
    ...target,
    disposition: decision,
    reviewedAt: timestamp(row.reviewedAt),
  });
}

export function validateCustomerDeletionTriage(
  value: unknown,
  limit: number,
  after: string | null,
  tenantId: string,
) {
  const row = record(value, ['policy', 'tenantId', 'items', 'hasMore']);
  if (
    row.policy !== 'synthetic-customer-deletion-triage-v1' ||
    requestId(row.tenantId) !== tenantId ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    !Array.isArray(row.items) ||
    row.items.length > limit ||
    typeof row.hasMore !== 'boolean' ||
    (row.hasMore && row.items.length !== limit)
  )
    return invalid();
  let prior = after;
  const items = Array.from(row.items, (item: unknown) => {
    const entry = record(item, ['customerId', 'requestId', 'requestedAt']);
    const customerId = requestId(entry.customerId);
    if (prior !== null && customerId <= prior) return invalid();
    prior = customerId;
    return Object.freeze({
      customerId,
      requestId: requestId(entry.requestId),
      requestedAt: timestamp(entry.requestedAt),
    });
  });
  return Object.freeze({
    policy: row.policy,
    tenantId,
    items: Object.freeze(items),
    hasMore: row.hasMore,
  });
}

export function validateCustomerDeletionProgress(value: unknown, scope: CustomerScope) {
  const row = record(value, ['policy', 'tenantId', 'customerId', 'requestId', 'status']);
  const { tenantId, customerId } = validateCustomerAccount(
    {
      policy: 'customer-account-v1',
      tenantId: row.tenantId,
      customerId: row.customerId,
    },
    scope,
  );
  if (
    row.policy !== 'synthetic-customer-deletion-progress-v1' ||
    (row.status !== 'pending_review' &&
      row.status !== 'privacy_review_pending' &&
      row.status !== 'staff_follow_up_pending')
  )
    return invalid();
  return Object.freeze({
    policy: row.policy,
    tenantId,
    customerId,
    requestId: requestId(row.requestId),
    status: row.status,
  });
}

export function validateCustomerDeletionFollowUp(
  value: unknown,
  limit: number,
  after: string | null,
  tenantId: string,
  outcome: CustomerDeletionDisposition,
) {
  const row = record(value, ['policy', 'tenantId', 'disposition', 'items', 'hasMore']);
  if (
    row.policy !== 'synthetic-customer-deletion-follow-up-v1' ||
    requestId(row.tenantId) !== tenantId ||
    disposition(row.disposition) !== outcome ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    !Array.isArray(row.items) ||
    row.items.length > limit ||
    typeof row.hasMore !== 'boolean' ||
    (row.hasMore && row.items.length !== limit)
  )
    return invalid();
  let prior = after;
  const items = Array.from(row.items, (item: unknown) => {
    const entry = record(item, ['customerId', 'requestId', 'reviewedAt']);
    const customerId = requestId(entry.customerId);
    if (prior !== null && customerId <= prior) return invalid();
    prior = customerId;
    return Object.freeze({
      customerId,
      requestId: requestId(entry.requestId),
      reviewedAt: timestamp(entry.reviewedAt),
    });
  });
  return Object.freeze({
    policy: row.policy,
    tenantId,
    disposition: outcome,
    items: Object.freeze(items),
    hasMore: row.hasMore,
  });
}

export function validateCustomerDeletionReturnReceipt(
  value: unknown,
  expected: CustomerDeletionReviewTarget & { tenantId: string; reviewerId: string },
) {
  const row = record(value, [
    'policy',
    'tenantId',
    'reviewerId',
    'customerId',
    'requestId',
    'operationId',
    'returnedAt',
  ]);
  const tenantId = requestId(row.tenantId);
  const reviewerId = requestId(row.reviewerId);
  const target = reviewTarget(row);
  if (
    row.policy !== 'synthetic-customer-deletion-return-v1' ||
    tenantId !== expected.tenantId ||
    reviewerId !== expected.reviewerId ||
    target.customerId !== expected.customerId ||
    target.requestId !== expected.requestId ||
    target.operationId !== expected.operationId
  )
    return invalid();
  return Object.freeze({
    policy: row.policy,
    tenantId,
    reviewerId,
    ...target,
    returnedAt: timestamp(row.returnedAt),
  });
}
