import {
  validateCompanySettingsCommand,
  validateCompanySettingsRecord,
} from './company-settings.js';
import {
  validateListingReportDecisionCommand,
  validateListingReportDecisionReceipt,
} from './listing-reports.js';
export type PrivateOperationKind = 'settings' | 'report';
export function privateOperationKind(value: unknown): PrivateOperationKind {
  if (value !== 'settings' && value !== 'report') throw Error('Invalid private operation kind.');
  return value;
}
export function privateOperationOriginal(kind: PrivateOperationKind, value: unknown) {
  privateOperationKind(kind);
  return kind === 'settings'
    ? validateCompanySettingsCommand(value)
    : validateListingReportDecisionCommand(value);
}
function id(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  )
    throw Error('Invalid resolution identity.');
  return value;
}
/** Exact whole original and current actor; a missing receipt never implies cancellation. */
export function validatePrivateOperationResolution(
  input: unknown,
  expected: {
    kind: PrivateOperationKind;
    original: unknown;
    tenantId?: string;
    actorId?: string;
  },
) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw Error('Invalid resolution.');
  const keys = [
    'policy',
    'tenantId',
    'actorId',
    'kind',
    'operationId',
    'request',
    'outcome',
    'receipt',
    'recordedAt',
  ];
  if (
    Reflect.ownKeys(input).length !== keys.length ||
    keys.some((k) => {
      const d = Object.getOwnPropertyDescriptor(input, k);
      return !d?.enumerable || !Object.hasOwn(d, 'value');
    })
  )
    throw Error('Invalid resolution.');
  const r = input as Record<string, unknown>,
    kind = privateOperationKind(r.kind),
    original = privateOperationOriginal(kind, r.request),
    wanted = privateOperationOriginal(expected.kind, expected.original),
    tenantId = id(r.tenantId),
    actorId = id(r.actorId),
    operationId = id(r.operationId);
  if (
    r.policy !== 'private-operation-resolution-v1' ||
    kind !== expected.kind ||
    JSON.stringify(original) !== JSON.stringify(wanted) ||
    operationId !== original.operationId ||
    (expected.tenantId !== undefined && tenantId !== expected.tenantId) ||
    (expected.actorId !== undefined && actorId !== expected.actorId) ||
    !['completed', 'cancelled'].includes(r.outcome as string) ||
    typeof r.recordedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      r.recordedAt,
    ) ||
    !Number.isFinite(Date.parse(r.recordedAt))
  )
    throw Error('Resolution changed original or authority.');
  let receipt = null;
  if (r.outcome === 'completed') {
    if (kind === 'settings') {
      const saved = validateCompanySettingsRecord(r.receipt);
      if (saved.actorId !== actorId || JSON.stringify(saved.request) !== JSON.stringify(original))
        throw Error('Completed settings original changed.');
      receipt = saved;
    } else {
      const saved = validateListingReportDecisionReceipt(
        r.receipt,
        validateListingReportDecisionCommand(original),
      );
      if (saved.actorId !== actorId) throw Error('Completed report actor changed.');
      receipt = saved;
    }
  } else if (r.receipt !== null) throw Error('Cancelled original cannot have an applied receipt.');
  return Object.freeze({
    policy: 'private-operation-resolution-v1' as const,
    tenantId,
    actorId,
    kind,
    operationId,
    request: original,
    outcome: r.outcome as 'completed' | 'cancelled',
    receipt,
    recordedAt: new Date(r.recordedAt as string).toISOString(),
  });
}
